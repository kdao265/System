// Creates its own targets. Never accepts external URLs, IDs, credentials or env files.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const socket = process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
const images = {
  db: "public.ecr.aws/supabase/postgres:17.6.1.166",
  auth: "public.ecr.aws/supabase/gotrue:v2.197.0",
  rest: "public.ecr.aws/supabase/postgrest:v16.2",
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const secrets = [];
const redact = (text) => secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), text);
async function until(check, label) {
  for (let n = 0; n < 180; n++) {
    try { if (await check()) return; } catch { /* starting */ }
    await pause(500);
  }
  throw new Error(`${label} did not become ready`);
}
function run(command, args, { input = "", env = process.env, label = "Child process", timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let diagnostic = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${label} timed out`)); }, timeout);
    child.stdout.on("data", (data) => { output += data; });
    // Redact generated credentials before returning any child failure diagnostic.
    child.stderr.on("data", (data) => { diagnostic += data; });
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error(`${label} could not start`)); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${label} failed: ${redact(diagnostic).slice(0, 1200)}\n${diagnostic.length > 1200 ? redact(diagnostic).slice(-500) : ""}`));
    });
    child.stdin.end(input);
  });
}
const docker = (args, options) => run("docker", ["--host", socket, ...args], options);
function jwt(role, secret) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ role, iss: "supabase", iat: now, exp: now + 3600 })).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

export async function startAuthEnvironment({ buildApp = true, activateOwner = true, testMigrationHistory = false } = {}) {
  assert(!process.env.DOCKER_CONTEXT && (!process.env.DOCKER_HOST || process.env.DOCKER_HOST === socket), "External Docker routing prohibited");
  const runId = randomUUID();
  const networkName = `system-private-auth-${runId}`;
  const resources = [];
  const servers = [];
  const apps = [];
  let network;
  const password = randomBytes(32).toString("hex");
  const secret = randomBytes(40).toString("hex");
  const anonKey = jwt("anon", secret);
  const adminKey = jwt("service_role", secret);
  secrets.push(password, secret, anonKey, adminKey);
  let db;
  const labels = ["--label", "system.test=private-auth-v1", "--label", `system.run=${runId}`];

  async function inspect(id) {
    assert.match(id, /^[a-f0-9]{64}$/, "Expected immutable container ID");
    // Deliberately exclude Config.Env, which contains disposable secrets.
    const info = JSON.parse(await docker(["inspect", "--format",
      '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"tmpfs":{{json (index .HostConfig "Tmpfs")}}}', id]));
    assert.equal(info.id, id);
    assert.equal(info.labels["system.test"], "private-auth-v1");
    assert.equal(info.labels["system.run"], runId);
    assert.equal(info.network, networkName);
    assert.deepEqual(info.mounts, [], "No bind mounts or volumes permitted");
    if (id === db) assert.deepEqual(Object.keys(info.tmpfs), ["/var/lib/postgresql/data"]);
    for (const binding of Object.values(info.ports ?? {})) {
      for (const address of binding ?? []) assert.equal(address.HostIp, "127.0.0.1");
    }
    return info;
  }
  async function sql(input, user = "postgres") {
    await inspect(db);
    return docker(["exec", "-i", db, "env", "-i", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "psql", "-X", "-Atq", "-h", "/var/run/postgresql", "-p", "5432", "-U", user, "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-f", "-"], { input, label: "Disposable SQL" });
  }
  async function container(kind, args) {
    const id = await docker(["run", "-d", "--pull=never", "--name", `${networkName}-${kind}`, ...labels,
      "--network", networkName, ...args, images[kind]], { label: `Start ${kind}` });
    resources.push(id);
    if (kind === "db") db = id;
    await inspect(id);
    return id;
  }
  async function close() {
    for (const child of apps.reverse()) {
      if (child.exitCode === null) {
        await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
      }
    }
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const id of resources.reverse()) {
      await inspect(id);
      await docker(["rm", "-f", id], { label: "Remove own disposable container" });
    }
    if (network) {
      const info = JSON.parse(await docker(["network", "inspect", "--format", '{{json .}}', network]));
      assert.equal(info.Id, network);
      assert.equal(info.Labels["system.run"], runId);
      assert.equal(info.Labels["system.test"], "private-auth-v1");
      assert.equal(info.Name, networkName);
      assert.equal(Object.keys(info.Containers ?? {}).length, 0);
      await docker(["network", "rm", network], { label: "Remove own disposable network" });
    }
  }

  try {
    for (const image of Object.values(images)) await docker(["image", "inspect", "--format", "{{.Id}}", image], { label: "Required cached Docker image" });
    network = await docker(["network", "create", ...labels, networkName]);
    await container("db", ["--tmpfs", "/var/lib/postgresql/data:rw", "-e", `POSTGRES_PASSWORD=${password}`]);
    await until(async () => (await docker(["logs", db])).includes("ready for start up"), "PostgreSQL");
    await until(async () => (await sql("SELECT 1;")).includes("1"), "PostgreSQL SQL socket");
    await sql(`ALTER ROLE supabase_auth_admin PASSWORD '${password}';`, "supabase_admin");
    await sql(`CREATE ROLE auth_smoke_api LOGIN NOINHERIT PASSWORD '${password}';
GRANT anon, authenticated TO auth_smoke_api;`);
    const auth = await container("auth", ["-p", "127.0.0.1::9999",
      "-e", "GOTRUE_API_HOST=0.0.0.0", "-e", "GOTRUE_API_PORT=9999",
      "-e", "API_EXTERNAL_URL=http://127.0.0.1:9999", "-e", "GOTRUE_SITE_URL=http://127.0.0.1",
      "-e", "GOTRUE_DB_DRIVER=postgres", "-e", `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${password}@${networkName}-db:5432/postgres`,
      "-e", `GOTRUE_JWT_SECRET=${secret}`, "-e", "GOTRUE_JWT_ADMIN_ROLES=service_role", "-e", "GOTRUE_JWT_AUD=authenticated",
      "-e", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated", "-e", "GOTRUE_JWT_EXP=3600",
      "-e", "GOTRUE_DISABLE_SIGNUP=true", "-e", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
      "-e", "GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false", "-e", "GOTRUE_MAILER_AUTOCONFIRM=true",
      "-e", "GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true"]);
    const authPort = (await inspect(auth)).ports["9999/tcp"][0].HostPort;
    const authUrl = `http://127.0.0.1:${authPort}`;
    await until(async () => (await fetch(`${authUrl}/health`, { redirect: "error" })).ok, "Supabase Auth");
    // The actual Auth service has installed its schema before application migrations.
    const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
    // ADR-015 stage two is promoted into the automatic migration directory, but its
    // fail-closed preflight requires an already provisioned and verified owner, so it
    // is never applied by filename order here. It is applied below, after the owner
    // fixture and its configuration exist, reproducing the approved deployment order:
    // stage-one install, owner provisioning and verification, then stage-two activation.
    const deferredActivation = "20260928100000_activate_private_owner.sql";
    // Each historical suite runs at the first checkpoint whose committed schema its
    // assertions describe. The Player/EXP suites were amended by migration four
    // (8ab0326), which added the two exp_ledger executor SELECT policies that its
    // catalogue counts, so they belong to that checkpoint and not to migration three.
    // Suites are never rescheduled, skipped or relaxed to make a checkpoint pass.
    const regressionAtVersion = {
      "20260918083114": ["profiles"],
      "20260920050000": ["player-exp-catalog", "player-exp", "level-rewards-catalog", "level-rewards"],
      "20260921090000": ["quest-commands-catalog", "quest-commands"],
      "20260922000000": ["day-quest-reads-catalog", "day-quest-reads"],
      "20260923000000": ["request-identity-compat-catalog", "request-identity-compat"],
      "20260923120000": ["quest-creation-catalog", "quest-creation"],
      "20260926000000": ["quest-reopen-v2-catalog", "quest-reopen-v2"],
      "20260926120000": ["quest-completion-alias-catalog", "quest-completion-alias"],
    };
    for (const file of readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
      if (file === deferredActivation) continue;
      await sql(readFileSync(new URL(file, migrationDir), "utf8"));
      if (testMigrationHistory) {
        for (const suite of regressionAtVersion[file.slice(0, 14)] ?? []) {
          await sql(readFileSync(new URL(`../../supabase/tests/${suite}.sql`, import.meta.url), "utf8"));
          console.log(`PASS: migration checkpoint regression ${suite}`);
        }
      }
    }
    const rest = await container("rest", ["-p", "127.0.0.1::3000",
      "-e", `PGRST_DB_URI=postgres://auth_smoke_api:${password}@${networkName}-db:5432/postgres`,
      "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", `PGRST_JWT_SECRET=${secret}`]);
    const restPort = (await inspect(rest)).ports["3000/tcp"][0].HostPort;
    const restUrl = `http://127.0.0.1:${restPort}`;
    await until(async () => (await fetch(restUrl, { redirect: "error" })).ok, "PostgREST");

    // Loopback gateway supplies Supabase's URL prefixes. Targets are constructed
    // solely from the inspected containers, never from a request or environment.
    const gateway = createServer(async (req, res) => {
      try {
        const prefix = req.url.startsWith("/auth/v1/") ? "/auth/v1" : req.url.startsWith("/rest/v1/") ? "/rest/v1" : null;
        if (!prefix) { res.writeHead(404).end(); return; }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = {};
        for (const key of ["authorization", "apikey", "content-type", "accept", "prefer", "x-client-info", "x-supabase-api-version"]) {
          if (req.headers[key]) headers[key] = req.headers[key];
        }
        const upstream = await fetch((prefix === "/auth/v1" ? authUrl : restUrl) + req.url.slice(prefix.length), {
          method: req.method, headers, body: body.length ? body : undefined, redirect: "error",
        });
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch { res.writeHead(502).end(); }
    });
    servers.push(gateway);
    await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${gateway.address().port}`;
    async function account() {
      const email = `auth-${randomUUID()}@example.invalid`;
      const accountPassword = `${randomBytes(24).toString("hex")}Aa1!`;
      secrets.push(accountPassword);
      const response = await fetch(`${authUrl}/admin/users`, {
        method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: accountPassword, email_confirm: true }),
      });
      assert(response.ok, "Disposable account provisioning failed");
      const user = await response.json();
      assert.match(user.id, /^[a-f0-9-]{36}$/);
      return { email, password: accountPassword, id: user.id };
    }
    const owner = await account();
    const other = await account();
    if (activateOwner) {
      await sql(`INSERT INTO system_private.owner_configuration(user_id) VALUES ('${owner.id}');`);
      await sql(readFileSync(new URL(deferredActivation, migrationDir), "utf8"));
    }
    const appEnv = {
      ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SYSTEM_OWNER_USER_ID: owner.id, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    };
    const next = fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url));
    console.log("PASS: isolated Auth/PostgREST/PostgreSQL ready; migrations and two admin-provisioned fixtures confined to tmpfs");
    if (buildApp) {
      await run(process.execPath, [next, "build"], { env: appEnv, label: "Production build", timeout: 240000 });
      console.log("PASS: production build with disposable configuration");
    }
    async function startApp(ownerId = owner.id) {
      const reserve = createServer();
      await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
      const port = reserve.address().port;
      await new Promise((resolve) => reserve.close(resolve));
      const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: root, env: { ...appEnv, SYSTEM_OWNER_USER_ID: ownerId }, stdio: "ignore", windowsHide: true,
      });
      apps.push(child);
      const app = `http://127.0.0.1:${port}`;
      await until(async () => (await fetch(app, { redirect: "error" })).ok, "Production app");
      return app;
    }
    return { url, key: anonKey, owner, other, startApp, close, sql };
  } catch (error) {
    await close();
    throw error;
  }
}
