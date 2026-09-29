// Creates its own targets. Never accepts external URLs, IDs, credentials or env files.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
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
async function until(check, label, signal) {
  for (let n = 0; n < 180; n++) {
    signal?.throwIfAborted();
    try { if (await check()) return; } catch { /* starting */ }
    await pause(500);
  }
  throw new Error(`${label} did not become ready`);
}
function run(command, args, { input = "", env = process.env, cwd = root, signal, label = "Child process", timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, signal, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
      else reject(new Error(`${label} failed: ${redact(diagnostic).slice(0, 1200)}\n${diagnostic.length > 1200 ? redact(diagnostic).slice(-500) : ""}\n${redact(output).slice(-3000)}`));
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

/** @param {{ buildApp?: boolean, activateOwner?: boolean, testMigrationHistory?: boolean, isolatedApp?: boolean, signal?: AbortSignal }} [options] */
export async function startAuthEnvironment({ buildApp = true, activateOwner = true, testMigrationHistory = false, isolatedApp = false, signal } = {}) {
  assert(!process.env.DOCKER_CONTEXT && (!process.env.DOCKER_HOST || process.env.DOCKER_HOST === socket), "External Docker routing prohibited");
  const runId = randomUUID();
  const networkName = `system-private-auth-${runId}`;
  const resources = [];
  const servers = [];
  const apps = [];
  let network;
  let appDirectory = root;
  let disposableDirectory;
  let dependenciesLinked = false;
  let closing;
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
    signal?.throwIfAborted();
    const id = await docker(["run", "-d", "--pull=never", "--name", `${networkName}-${kind}`, ...labels,
      "--network", networkName, ...args, images[kind]], { label: `Start ${kind}` });
    resources.push(id);
    if (kind === "db") db = id;
    await inspect(id);
    return id;
  }
  async function cleanup() {
    const failures = [];
    const attempt = async (action) => { try { await action(); } catch (error) { failures.push(error); } };
    for (const child of [...apps].reverse()) await attempt(async () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Disposable app did not stop")), 10000);
          child.once("exit", () => { clearTimeout(timer); resolve(); });
          child.kill();
        });
      }
    });
    for (const server of servers) await attempt(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    for (const id of [...resources].reverse()) await attempt(async () => {
      await inspect(id);
      await docker(["rm", "-f", id], { label: "Remove own disposable container" });
    });
    if (network) await attempt(async () => {
      const info = JSON.parse(await docker(["network", "inspect", "--format", '{{json .}}', network]));
      assert.equal(info.Id, network);
      assert.equal(info.Labels["system.run"], runId);
      assert.equal(info.Labels["system.test"], "private-auth-v1");
      assert.equal(info.Name, networkName);
      assert.equal(Object.keys(info.Containers ?? {}).length, 0);
      await docker(["network", "rm", network], { label: "Remove own disposable network" });
    });
    if (disposableDirectory) await attempt(async () => {
      // Verify the resolved target before recursive removal; unlink the dependency
      // junction explicitly so cleanup can never traverse into node_modules.
      assert.equal(dirname(resolve(disposableDirectory)), resolve(root, ".e2e"));
      assert(basename(disposableDirectory).startsWith("app-"));
      if (dependenciesLinked) unlinkSync(join(disposableDirectory, "node_modules"));
      rmSync(disposableDirectory, { recursive: true, force: true });
    });
    if (failures.length) throw new AggregateError(failures, "Disposable cleanup failed; inspect owned run resources only");
  }
  function close() { return closing ??= cleanup(); }

  try {
    signal?.throwIfAborted();
    for (const image of Object.values(images)) await docker(["image", "inspect", "--format", "{{.Id}}", image], { label: "Required cached Docker image" });
    network = await docker(["network", "create", ...labels, networkName]);
    await container("db", ["--tmpfs", "/var/lib/postgresql/data:rw", "-e", `POSTGRES_PASSWORD=${password}`]);
    await until(async () => (await docker(["logs", db])).includes("ready for start up"), "PostgreSQL", signal);
    await until(async () => (await sql("SELECT 1;")).includes("1"), "PostgreSQL SQL socket", signal);
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
    await until(async () => (await fetch(`${authUrl}/health`, { redirect: "error" })).ok, "Supabase Auth", signal);
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
      "20260928181000": ["recurring-quests-catalog", "recurring-quests"],
    };
    for (const file of readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
      signal?.throwIfAborted();
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
    await until(async () => (await fetch(restUrl, { redirect: "error" })).ok, "PostgREST", signal);

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
    if (isolatedApp) {
      assert(buildApp && activateOwner, "Isolated E2E app requires a fresh build and activated owner");
      mkdirSync(join(root, ".e2e"), { recursive: true });
      disposableDirectory = mkdtempSync(join(root, ".e2e", "app-"));
      appDirectory = disposableDirectory;
      // `public` holds the installability assets (icons and the service worker), so the
      // copy must include it for the isolated production build to serve them.
      for (const entry of ["src", "public", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "package.json", "package-lock.json"]) {
        cpSync(join(root, entry), join(appDirectory, entry), { recursive: true });
      }
      symlinkSync(join(root, "node_modules"), join(appDirectory, "node_modules"), process.platform === "win32" ? "junction" : "dir");
      dependenciesLinked = true;
    }
    // No inherited app/service credentials, Node preloads or env files in E2E.
    const inheritedEnv = isolatedApp
      ? Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|CI)$/i.test(name)))
      : process.env;
    const appEnv = {
      ...inheritedEnv, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SYSTEM_OWNER_USER_ID: owner.id, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    };
    const next = fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url));
    console.log("PASS: isolated Auth/PostgREST/PostgreSQL ready; migrations and two admin-provisioned fixtures confined to tmpfs");
    if (buildApp) {
      await run(process.execPath, [next, "build"], { cwd: appDirectory, env: appEnv, signal, label: "Production build", timeout: 240000 });
      console.log("PASS: production build with disposable configuration");
    }
    async function startApp(ownerId = owner.id) {
      signal?.throwIfAborted();
      // Let this child bind port zero itself. Reserving then releasing a port
      // would allow another local app to acquire it before Next starts.
      const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", "0"], {
        cwd: appDirectory, env: { ...appEnv, SYSTEM_OWNER_USER_ID: ownerId }, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      });
      child.on("error", () => {});
      apps.push(child);
      let startup = "";
      let app;
      child.stdout.on("data", (data) => {
        startup = (startup + data).slice(-4000);
        app ??= startup.match(/http:\/\/127\.0\.0\.1:[1-9]\d*/)?.[0];
      });
      await until(async () => !!app && child.exitCode === null && child.signalCode === null &&
        (await fetch(app, { redirect: "error", signal: AbortSignal.timeout(5000) })).ok, "Production app", signal);
      assert(app, "Disposable app must advertise its bound loopback port");
      return app;
    }
    return { url, key: anonKey, owner, other, startApp, close, sql };
  } catch (error) {
    await close();
    throw error;
  }
}
