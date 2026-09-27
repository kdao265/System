// Completion Recovery V2, Phase 2A: real PostgREST HTTP integration for migration ten.
//
// Disposable by construction: one per-run Docker network, one tmpfs-only PostgreSQL
// container (no volumes, no binds, no published ports) from the local
// public.ecr.aws/supabase/postgres image, and one PostgREST container from the local
// public.ecr.aws/supabase/postgrest image published on 127.0.0.1 only. Migrations one
// to ten are applied inside that container. The Supabase CLI, System Local, Supabase
// Cloud, .env.local, supabase/config.toml and any persistent database are never read,
// contacted or changed; no image is pulled (both images must already be local).
// Resources carry system.test/system.run labels and are removed by immutable ID in a
// finally block after the ID is re-verified.
//
// Real in this test: the application modules that talk to PostgREST
// (create-data, completion-data, reopen-data, completion-resolution-data) and the
// frontend validators (completion-resolution, completion-receipt, create-receipt,
// reopen-receipt); the installed @supabase/ssr createServerClient factory with its
// production auth options; the installed @supabase/supabase-js -> @supabase/postgrest-js
// request path and the /rest/v1/rpc/<fn> URL it builds; PostgreSQL 17.6 with all ten
// migrations; PostgREST 16.2 and its raw error envelopes.
//
// Substituted: src/lib/supabase/server.ts reads Next's request cookies, so this run
// resolves that single module to supabase/tests/helpers/wire-server-client.mjs, which
// injects the disposable URL and a per-identity session cookie into the real
// createServerClient. Nothing else is doubled.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const sourceRoot = new URL("../../src/", import.meta.url);
const wireClientModule = new URL("./helpers/wire-server-client.mjs", import.meta.url).href;

// The application modules are the real ones. The resolve hook only maps extensionless
// "@/..." and "./..." specifiers inside src/ to their .ts/.tsx file, and redirects
// "@/lib/supabase/server" to the disposable-runtime client injector.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (specifier === "@/lib/supabase/server") return { url: wireClientModule, shortCircuit: true };
      if (specifier.startsWith("@/") || specifier.startsWith("./")) {
        const base = specifier.startsWith("@/")
          ? new URL(specifier.slice(2), sourceRoot)
          : new URL(specifier, context.parentURL);
        for (const extension of [".ts", ".tsx"]) {
          const url = new URL(base.href + extension);
          if (existsSync(url)) return { url: url.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
const { createOneOffQuest } = await import("../../src/features/quests/create-data.ts");
const { completeQuestOccurrence } = await import("../../src/features/quests/completion-data.ts");
const { reopenQuestOccurrence } = await import("../../src/features/quests/reopen-data.ts");
const { getQuestCompletionResolution } = await import("../../src/features/quests/completion-resolution-data.ts");
const { validateCompletionResolution } = await import("../../src/features/quests/completion-resolution.ts");
const { validateQuestCompletionReceipt } = await import("../../src/features/quests/completion-receipt.ts");
const { validateQuestCreationReceipt } = await import("../../src/features/quests/create-receipt.ts");
const { validateQuestReopenReceipt } = await import("../../src/features/quests/reopen-receipt.ts");
const { configureWireServer, registerWireIdentity, selectWireIdentity, createServerSupabaseClient } =
  await import("./helpers/wire-server-client.mjs");
hooks.deregister();

const socket = process.platform === "win32"
  ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
const POSTGRES_IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.166";
const POSTGREST_IMAGE = "public.ecr.aws/supabase/postgrest:v16.2";
const AUTHENTICATOR_ROLE = "pgrst_wire_authenticator";
const COOKIE_NAME = "sb-wire-auth-token";
const RESOLVER_FUNCTION = "get_quest_completion_resolution_v1";
const RESOLVER_SIGNATURE = `public.${RESOLVER_FUNCTION}(uuid,uuid,integer)`;
const RESOLUTION_FIELDS = ["version", "outcome", "command_id", "occurrence_id", "expected_execution_cycle",
  "current_execution_cycle", "current_status", "receipt", "canonical_receipt", "correction_event_id",
  "reopened_event_id", "reversal_entry_id"];
const RECEIPT_FIELDS = ["command_id", "occurrence_id", "quest_id", "execution_cycle", "completed_event_id",
  "exp_entry_id", "exp_amount", "reported_completed_at", "recorded_completed_at", "replay"];
const CREATION_FIELDS = ["command_id", "quest_id", "occurrence_id", "definition_created_event_id",
  "occurrence_scheduled_event_id", "scheduled_at", "deadline_at", "reward_exp_snapshot", "execution_cycle", "replay"];
const REOPEN_FIELDS = ["command_id", "occurrence_id", "quest_id", "undone_cycle", "correction_event_id",
  "reopened_event_id", "reversal_entry_id", "reversed_amount", "original_credit_entry_id", "replay"];

const runId = `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
const runLabel = "completion-recovery-v2a";
const networkName = `system-wire-net-${runId}`;
const databaseName = `system-wire-db-${runId}`;
const apiName = `system-wire-api-${runId}`;
const checks = [];
let networkId = null;
let databaseId = null;
let apiId = null;
let adapter = null; // Assign immediately on creation so startup failures also close the listener.
let interruption = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (interruption) return;
    interruption = signal;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    console.error(`${signal}: finishing the current operation and cleaning up this run's resources`);
  });
}
function assertNotInterrupted() {
  if (interruption) throw new Error(`Interrupted by ${interruption}; starting scoped teardown`);
}

// ---------------------------------------------------------------------------- secrets
// Generated per run, never printed. Every rendered diagnostic and child-process
// failure message passes through redact().
const secrets = [];
function generateSecret(length) {
  // Even disposable PostgreSQL credentials and JWT secrets must be unpredictable.
  const value = randomBytes(length).toString("base64url").slice(0, length);
  secrets.push(value);
  return value;
}
function redact(text) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output;
}

// ---------------------------------------------------------------------- docker helpers
function docker(args, label, { input = "", timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["--host", socket, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout.trim());
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${label}: docker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(new Error(`${label}: docker could not start (${error.message})`)));
    child.on("close", (code, signal) => {
      if (code === 0) finish(null);
      else finish(new Error(redact(`${label}: docker exited ${code} (signal ${signal})\n${stderr.trim().slice(-2000)}`)));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function dockerExists(args, label) {
  try {
    await docker(args, label, { timeoutMs: 20000 });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------- SQL helpers
// Every statement runs inside the disposable container over its own Unix socket with
// an explicit user, database and port, an empty environment and no psqlrc, so host or
// container PG* defaults cannot redirect it.
async function sql(script, label) {
  return docker(["exec", "-i", databaseId, "env", "-i",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    `PGAPPNAME=system-wire-${label}`,
    "PGOPTIONS=-c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000",
    "psql", "-X", "-Atq", "-h", "/var/run/postgresql", "-p", "5432",
    "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], label, { input: script });
}

/** One text value, NULL as the literal NULL, from the disposable database. */
async function fact(expression, label) {
  const output = await sql(`SELECT 'V=' || coalesce((${expression})::text, 'NULL');`, label);
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith("V="));
  assert.ok(line !== undefined, `${label}: no value returned`);
  return line.slice(2);
}

// ------------------------------------------------------------------------- JWT helpers
// The disposable runtime verifies HS256 with its own secret, so no GoTrue instance is
// needed and no real credential is involved.
function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}
function signJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/** The session object @supabase/ssr's cookie storage holds in production. */
function sessionFor(accessToken, userId) {
  return {
    access_token: accessToken,
    refresh_token: "wire-refresh-token",
    token_type: "bearer",
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: { id: userId, aud: "authenticated", role: "authenticated", email: `${userId}@wire.invalid`,
      app_metadata: { provider: "wire" }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
// -------------------------------------------------------------------- /rest/v1 adapter
// PostgREST serves /rpc/<fn> at its root; supabase-js always builds
// "<url>/rest/v1/rpc/<fn>" (verified in the installed @supabase/postgrest-js bundle).
// This loopback-only recording adapter strips the /rest/v1 prefix and forwards the
// request to PostgREST unchanged: same method, same body bytes, same auth headers.
// The upstream status and body are relayed byte-for-byte so every assertion reads
// PostgREST's own envelope rather than a re-serialization.
const forwardedHeaders = ["authorization", "apikey", "content-type", "accept",
  "accept-profile", "content-profile", "prefer", "x-client-info"];
const exchanges = [];

async function startAdapter(upstreamBase) {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const body = Buffer.concat(chunks);
      const target = new URL(request.url, upstreamBase);
      const forwardedPath = target.pathname.replace(/^\/rest\/v1/, "") || "/";
      const headers = {};
      for (const name of forwardedHeaders) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const record = { method: request.method, requestPath: request.url, forwardedPath, status: 0,
        requestBody: body.toString("utf8"), responseBody: "" };
      try {
        const upstream = await fetch(`${upstreamBase}${forwardedPath}${target.search}`, {
          method: request.method, headers, body: body.length ? body : undefined,
        });
        record.status = upstream.status;
        record.responseBody = await upstream.text();
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        response.end(record.responseBody);
      } catch (error) {
        record.responseBody = redact(String(error?.message ?? error));
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: record.responseBody }));
      }
      exchanges.push(record);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function waitUntil(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    assertNotInterrupted();
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`${label}: timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Re-read the immutable resource ID and prove it is still the disposable target. */
async function verifyDatabaseTarget({ requireRunning = true } = {}) {
  const info = JSON.parse(await docker(["inspect", "--format",
    "{\"id\":{{json .Id}},\"name\":{{json .Name}},\"running\":{{json .State.Running}},\"test\":{{json (index .Config.Labels \"system.test\")}},\"run\":{{json (index .Config.Labels \"system.run\")}},\"network\":{{json .HostConfig.NetworkMode}},\"mounts\":{{json .Mounts}},\"tmpfs\":{{json .HostConfig.Tmpfs}},\"ports\":{{json .HostConfig.PortBindings}}}",
    databaseId], "verify disposable postgres"));
  assert.equal(info.id, databaseId, "database container id changed");
  assert.equal(info.name, `/${databaseName}`, "database container name mismatch");
  if (requireRunning) assert.equal(info.running, true, "database container is not running");
  assert.equal(info.test, runLabel, "database label mismatch");
  assert.equal(info.run, runId, "database run label mismatch");
  assert.equal(info.network, networkName, "database is not on the disposable network");
  assert.deepEqual(info.mounts, [], "database must have no mounts");
  assert.deepEqual(Object.keys(info.tmpfs), ["/var/lib/postgresql/data"], "database must use tmpfs storage");
  assert.deepEqual(info.ports ?? {}, {}, "database must publish no port");
}

async function verifyApiTarget({ requireRunning = true } = {}) {
  const info = JSON.parse(await docker(["inspect", "--format",
    "{\"id\":{{json .Id}},\"name\":{{json .Name}},\"running\":{{json .State.Running}},\"test\":{{json (index .Config.Labels \"system.test\")}},\"run\":{{json (index .Config.Labels \"system.run\")}},\"network\":{{json .HostConfig.NetworkMode}},\"mounts\":{{json .Mounts}},\"networkPorts\":{{json .NetworkSettings.Ports}},\"hostPorts\":{{json .HostConfig.PortBindings}}}",
    apiId], "verify disposable postgrest"));
  assert.equal(info.id, apiId, "api container id changed");
  assert.equal(info.name, `/${apiName}`, "api container name mismatch");
  if (requireRunning) assert.equal(info.running, true, "api container is not running");
  assert.equal(info.test, runLabel, "api label mismatch");
  assert.equal(info.run, runId, "api run label mismatch");
  assert.equal(info.network, networkName, "api is not on the disposable network");
  assert.deepEqual(info.mounts, [], "api must have no mounts");
  const requested = Object.entries(info.hostPorts ?? {});
  assert.equal(requested.length, 1, "api must request exactly one port");
  assert.equal(requested[0][0], "3000/tcp");
  assert.equal(requested[0][1].length, 1, "api must request one address");
  assert.equal(requested[0][1][0].HostIp, "127.0.0.1", "api must be requested on loopback only");
  // Stopped containers lose NetworkSettings.Ports, but HostConfig.PortBindings,
  // name, labels, ID and mounts remain inspectable for safe teardown.
  if (!requireRunning && !info.running) return null;
  const published = Object.entries(info.networkPorts ?? {});
  assert.equal(published.length, 1, "api must publish exactly one port");
  assert.equal(published[0][0], "3000/tcp");
  assert.equal(published[0][1]?.length, 1, "api must publish one address");
  assert.equal(published[0][1][0].HostIp, "127.0.0.1", "api must be published on loopback only");
  return Number(published[0][1][0].HostPort);
}

function pass(label) {
  checks.push(label);
  console.log(`PASS: ${label}`);
}

const OWNER = randomUUID();
const OUTSIDER = randomUUID();
const OPERATOR = randomUUID();

/**
 * Bring up the disposable runtime. No application or developer resource is touched:
 * the only targets are the two containers and the network created here, all named and
 * labelled with this run's id and all verified by immutable ID before and after use.
 */
async function startEnvironment() {
  assert.ok(!process.env.SUPABASE_CI_CONTAINER_ID && !process.env.SUPABASE_DB_CONTAINER &&
    !process.env.COMPLETION_ALIAS_DISPOSABLE_ID, "Refusing to run with an externally supplied database target");
  assert.ok(!process.env.DOCKER_CONTEXT && (!process.env.DOCKER_HOST || process.env.DOCKER_HOST === socket),
    "Unexpected Docker routing in the environment");
  for (const image of [POSTGRES_IMAGE, POSTGREST_IMAGE]) {
    assert.ok(await dockerExists(["image", "inspect", image], `inspect ${image}`),
      `${image} must already exist locally; this run never pulls an image`);
  }

  const databasePassword = generateSecret(40);
  const authenticatorPassword = generateSecret(40);
  const jwtSecret = generateSecret(48);
  const now = Math.floor(Date.now() / 1000);
  const anonKey = signJwt({ role: "anon", iss: "wire-disposable", iat: now, exp: now + 86400 }, jwtSecret);
  const tokens = {
    owner: signJwt({ role: "authenticated", sub: OWNER, iat: now, exp: now + 86400 }, jwtSecret),
    outsider: signJwt({ role: "authenticated", sub: OUTSIDER, iat: now, exp: now + 86400 }, jwtSecret),
    anonymous: anonKey,
    invalidSignature: signJwt({ role: "authenticated", sub: OWNER, iat: now, exp: now + 86400 }, generateSecret(48)),
  };
  assert.notEqual(tokens.invalidSignature.split(".")[2], tokens.owner.split(".")[2],
    "the invalid-signature token must differ from the owner token");

  networkId = await docker(["network", "create", "--label", `system.test=${runLabel}`,
    "--label", `system.run=${runId}`, networkName], "create disposable network");
  assert.match(networkId, /^[a-f0-9]{64}$/, "network id must be an immutable 64-hex id");

  databaseId = await docker(["run", "-d", "--name", databaseName,
    "--label", `system.test=${runLabel}`, "--label", `system.run=${runId}`,
    "--network", networkName, "--tmpfs", "/var/lib/postgresql/data:rw",
    "-e", `POSTGRES_PASSWORD=${databasePassword}`, POSTGRES_IMAGE], "start disposable postgres");
  assert.match(databaseId, /^[a-f0-9]{64}$/, "container id must be an immutable 64-hex id");
  await verifyDatabaseTarget();

  await waitUntil(async () => (await docker(["logs", databaseId], "database logs")).includes("ready for start up"),
    240000, "PostgreSQL init completion");
  await waitUntil(() => dockerExists(["exec", databaseId, "pg_isready", "-U", "postgres", "-h", "/var/run/postgresql"], "pg readiness"),
    120000, "PostgreSQL readiness");
  pass(`disposable PostgreSQL ${POSTGRES_IMAGE} ready on tmpfs with no published port`);

  const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(migrations.map((name) => name.slice(0, 14)),
    ["20260918034836", "20260918083114", "20260919063117", "20260920050000", "20260921090000",
      "20260922000000", "20260923000000", "20260923120000", "20260926000000", "20260926120000"],
    "migrations one to ten must be the only migration files");
  await docker(["cp", fileURLToPath(new URL("../../supabase/migrations", import.meta.url)), `${databaseId}:/tmp/migrations`],
    "copy migrations into the disposable database");
  const applied = await docker(["exec", databaseId, "sh", "-c",
    "for f in /tmp/migrations/*.sql; do psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f \"$f\" >/dev/null || exit 1; echo \"$(basename $f)\"; done"],
    "apply migrations one to ten", { timeoutMs: 180000 });
  assert.deepEqual(applied.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), migrations,
    "the disposable database must apply exactly migrations one to ten in order");
  assert.equal(await fact("SELECT to_regclass('system_internal.quest_completion_aliases') IS NOT NULL", "verify"),
    "true", "migration ten's alias table must exist after the init phase");
  assert.equal(await fact(`SELECT to_regprocedure('${RESOLVER_SIGNATURE}') IS NOT NULL`, "verify"),
    "true", "migration ten's resolver must exist after the init phase");
  pass("migrations one to ten applied in order to the disposable database");

  await sql(`BEGIN;
INSERT INTO auth.users (id) VALUES ('${OWNER}'), ('${OUTSIDER}'), ('${OPERATOR}');
INSERT INTO system_internal.operator_grants (user_id, capability) VALUES ('${OPERATOR}', 'level_policy_assign');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${OPERATOR}', true);
SELECT public.assign_level_policy('${OWNER}', (SELECT id FROM public.level_policies WHERE policy_key = 'level_policy_v1' AND status = 'published'), gen_random_uuid(), 'internal');
COMMIT;`, "provision");
  assert.equal(await fact(`SELECT count(*) FROM auth.users WHERE id IN ('${OWNER}', '${OUTSIDER}', '${OPERATOR}')`, "users"), "3");
  assert.equal(await fact(`SELECT has_function_privilege('authenticated', '${RESOLVER_SIGNATURE}', 'EXECUTE')`, "acl"), "true");
  assert.equal(await fact(`SELECT has_function_privilege('anon', '${RESOLVER_SIGNATURE}', 'EXECUTE')`, "acl"), "false");
  assert.equal(await fact(`SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE proname = '${RESOLVER_FUNCTION}'`, "acl"), "quest_command_owner");
  pass("resolver effective ACL: authenticated only, anon denied, owned by quest_command_owner");

  // The disposable authenticator receives anon and authenticated only: never service_role.
  await sql(`CREATE ROLE ${AUTHENTICATOR_ROLE} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${authenticatorPassword}';
GRANT anon, authenticated TO ${AUTHENTICATOR_ROLE};`, "create disposable authenticator");
  assert.equal(await fact(`SELECT string_agg(granted.rolname, ',' ORDER BY granted.rolname) FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE member.rolname = '${AUTHENTICATOR_ROLE}'`, "acl"),
    "anon,authenticated", "the disposable authenticator must hold anon and authenticated only");
  assert.equal(await fact(`SELECT format('login=%s super=%s bypass=%s createdb=%s createrole=%s replication=%s', rolcanlogin::text, rolsuper::text, rolbypassrls::text, rolcreatedb::text, rolcreaterole::text, rolreplication::text) FROM pg_roles WHERE rolname = '${AUTHENTICATOR_ROLE}'`, "acl"),
    "login=true super=false bypass=false createdb=false createrole=false replication=false");
  pass("disposable authenticator holds anon + authenticated only (no service_role, no superuser, no BYPASSRLS)");

  apiId = await docker(["run", "-d", "--name", apiName,
    "--label", `system.test=${runLabel}`, "--label", `system.run=${runId}`,
    "--network", networkName, "-p", "127.0.0.1::3000",
    "-e", `PGRST_DB_URI=postgres://${AUTHENTICATOR_ROLE}:${authenticatorPassword}@${databaseName}:5432/postgres`,
    "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon",
    "-e", `PGRST_JWT_SECRET=${jwtSecret}`, "-e", "PGRST_SERVER_PORT=3000", POSTGREST_IMAGE], "start disposable postgrest");
  assert.match(apiId, /^[a-f0-9]{64}$/, "api container id must be an immutable 64-hex id");
  const apiPort = await verifyApiTarget();
  assert.ok(apiPort > 0 && apiPort < 65536, "api port must be a real published port");

  adapter = await startAdapter(`http://127.0.0.1:${apiPort}`);
  await waitUntil(async () => {
    try {
      return (await fetch(`${adapter.base}/rest/v1/`)).status === 200;
    } catch {
      return false;
    }
  }, 120000, "PostgREST readiness");
  assert.equal(exchanges[0]?.forwardedPath, "/", "the adapter must strip only the /rest/v1 prefix");
  pass(`disposable PostgREST ${POSTGREST_IMAGE} published on 127.0.0.1:${apiPort} with its schema cache loaded`);

  configureWireServer({ url: adapter.base, anonKey, cookieName: COOKIE_NAME });
  registerWireIdentity("owner", sessionFor(tokens.owner, OWNER));
  registerWireIdentity("outsider", sessionFor(tokens.outsider, OUTSIDER));
  registerWireIdentity("anonymous", null);
  registerWireIdentity("invalid-signature", sessionFor(tokens.invalidSignature, OWNER));
  selectWireIdentity("owner");
  const probe = await createServerSupabaseClient();
  assert.equal(probe.rest.url, `${adapter.base}/rest/v1`, "the installed client must build the /rest/v1 URL");
  const probeSession = await probe.auth.getSession();
  assert.equal(probeSession.error, null, "session lookup must not fail");
  assert.equal(probeSession.data.session?.access_token, tokens.owner, "the session cookie must carry the owner token");
  pass("the real @supabase/ssr createServerClient loaded the owner session from its cookie and builds <url>/rest/v1");

  return { adapter, tokens };
}

// ------------------------------------------------------- application call helpers
// Each helper calls a real application module through the real HTTP client and returns
// the raw PostgREST body the adapter captured, so the frontend validators can be fed
// the unmodified wire payload.
async function invoke(run, label, functionName) {
  const startIndex = exchanges.length;
  let value = null;
  let thrown = null;
  try {
    value = await run();
  } catch (error) {
    thrown = error;
  }
  assert.equal(exchanges.length, startIndex + 1, `${label}: exactly one HTTP exchange expected`);
  const exchange = exchanges[startIndex];
  assert.equal(exchange.requestPath, `/rest/v1/rpc/${functionName}`,
    `${label}: the installed client must request <url>/rest/v1/rpc/${functionName}`);
  assert.equal(exchange.forwardedPath, `/rpc/${functionName}`,
    `${label}: the adapter must forward PostgREST's own /rpc path`);
  return { value, thrown, exchange, raw: exchange.responseBody === "" ? null : JSON.parse(exchange.responseBody) };
}
function assertFieldShape(value, fields, label) {
  assert.deepEqual([...Object.keys(value)].sort(), [...fields].sort(), `${label}: unexpected field set`);
}
function assertResolutionShape(raw, label) {
  assert.deepEqual([...Object.keys(raw)].sort(), [...RESOLUTION_FIELDS].sort(),
    `${label}: the resolver must return exactly the twelve contract fields`);
  assert.equal(raw.version, 1, `${label}: version`);
}

const notes = [];
function note(text) {
  notes.push(text);
  console.log(`NOTE: ${text}`);
}
function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error);
}
function creationRequest(title, reward) {
  return { title, description: null, importance: "side", priority: null, default_reward_exp: reward,
    scheduled_at: "2026-10-01T09:00:00.000Z", deadline_at: null };
}
async function createQuest(title, reward) {
  const commandId = randomUUID();
  const request = creationRequest(title, reward);
  selectWireIdentity("owner");
  const call = await invoke(() => createOneOffQuest(commandId, request), `create ${title}`, "create_one_off_quest");
  assert.equal(call.thrown, null, `create ${title}: ${describe(call.thrown)}`);
  assert.equal(call.exchange.status, 200, `create ${title}: HTTP status`);
  assertFieldShape(call.raw, CREATION_FIELDS, `create ${title}`);
  assert.ok(validateQuestCreationReceipt(call.raw, commandId, request),
    `create ${title}: the real creation validator must accept the wire receipt`);
  assert.deepEqual(call.value, call.raw, `create ${title}: the data layer must return the unmodified wire receipt`);
  return { commandId, occurrenceId: call.raw.occurrence_id, questId: call.raw.quest_id };
}
async function completeQuest(occurrenceId, cycle, commandId = randomUUID()) {
  selectWireIdentity("owner");
  const call = await invoke(() => completeQuestOccurrence(commandId, occurrenceId, cycle), "complete", "complete_quest_occurrence");
  assert.equal(call.thrown, null, `complete: ${describe(call.thrown)}`);
  assert.equal(call.exchange.status, 200, "complete: HTTP status");
  assertFieldShape(call.raw, RECEIPT_FIELDS, "complete");
  assert.ok(validateQuestCompletionReceipt(call.raw, commandId, occurrenceId, cycle),
    "complete: the real receipt validator must accept the wire receipt");
  return { commandId, receipt: call.raw, exchange: call.exchange };
}
async function reopenQuest(occurrenceId, cycle, commandId = randomUUID()) {
  selectWireIdentity("owner");
  const call = await invoke(() => reopenQuestOccurrence(commandId, occurrenceId, cycle), "reopen", "reopen_quest_occurrence_v2");
  assert.equal(call.thrown, null, `reopen: ${describe(call.thrown)}`);
  assert.equal(call.exchange.status, 200, "reopen: HTTP status");
  assertFieldShape(call.raw, REOPEN_FIELDS, "reopen");
  assert.ok(validateQuestReopenReceipt(call.raw, commandId, occurrenceId, cycle),
    "reopen: the real reopen validator must accept the wire receipt");
  return { commandId, receipt: call.raw, exchange: call.exchange };
}
async function resolveOk(commandId, occurrenceId, cycle, identity = "owner") {
  selectWireIdentity(identity);
  const call = await invoke(() => getQuestCompletionResolution(commandId, occurrenceId, cycle), "resolve", RESOLVER_FUNCTION);
  assert.equal(call.thrown, null, `resolve: ${describe(call.thrown)}`);
  assert.equal(call.exchange.status, 200, "resolve: HTTP status");
  assert.deepEqual(call.value, call.raw, "resolve: the data layer must return the unmodified wire payload");
  assertResolutionShape(call.raw, "resolve");
  for (const [name, nested] of [["receipt", call.raw.receipt], ["canonical_receipt", call.raw.canonical_receipt]]) {
    if (nested !== null) assertFieldShape(nested, RECEIPT_FIELDS, `resolve ${name}`);
  }
  assert.equal(call.raw.command_id, commandId, "resolve: the payload must echo the requested command");
  assert.equal(call.raw.occurrence_id, occurrenceId, "resolve: the payload must echo the requested occurrence");
  assert.equal(call.raw.expected_execution_cycle, cycle, "resolve: the payload must echo the requested cycle");
  assert.ok(validateCompletionResolution(call.raw, commandId, occurrenceId, cycle),
    "resolve: the real frontend validator must accept the unmodified wire payload");
  return call.raw;
}
async function resolveRejects(commandId, occurrenceId, cycle, identity = "owner") {
  selectWireIdentity(identity);
  const call = await invoke(() => getQuestCompletionResolution(commandId, occurrenceId, cycle), "resolve rejection", RESOLVER_FUNCTION);
  assert.ok(call.thrown !== null, "resolveRejects: the data layer must reject");
  assert.equal(call.value, null, "resolveRejects: no value is returned on rejection");
  return call;
}

// ------------------------------------------------------------------------ wire checks
async function runWireChecks() {
  const first = await createQuest("Wire canonical", 37);
  const canonical = await completeQuest(first.occurrenceId, 1);
  assert.equal(canonical.receipt.replay, false, "the first recording must not report a replay");
  pass("create + complete over HTTP returned receipts accepted by the real frontend validators");

  const recorded = await resolveOk(canonical.commandId, first.occurrenceId, 1);
  assert.equal(recorded.outcome, "recorded");
  assert.equal(recorded.current_execution_cycle, 1);
  assert.equal(recorded.current_status, "completed");
  assert.ok(recorded.receipt !== null, "recorded must carry the caller receipt");
  assert.equal(recorded.canonical_receipt, null, "recorded must not carry canonical evidence");
  assert.equal(recorded.correction_event_id, null);
  assert.equal(recorded.reopened_event_id, null);
  assert.equal(recorded.reversal_entry_id, null);
  assert.equal(recorded.receipt.replay, true, "resolver receipts are historical replays");
  assert.equal(recorded.receipt.command_id, canonical.commandId);
  assert.equal(recorded.receipt.occurrence_id, first.occurrenceId);
  assert.equal(recorded.receipt.execution_cycle, 1);
  assert.equal(recorded.receipt.completed_event_id, canonical.receipt.completed_event_id);
  assert.equal(recorded.receipt.exp_entry_id, canonical.receipt.exp_entry_id);
  assert.equal(String(recorded.receipt.exp_amount), "37", "recorded must report the exact nonnegative EXP");
  assert.ok(["number", "string"].includes(typeof recorded.receipt.exp_amount));
  assert.equal(recorded.receipt.reported_completed_at, null);
  assert.equal(typeof recorded.receipt.recorded_completed_at, "string");
  note(`recorded wire types: exp_amount is typeof ${typeof recorded.receipt.exp_amount}, recorded_completed_at is "${recorded.receipt.recorded_completed_at}"`);
  pass("recorded: twelve-field envelope with a strict ten-field receipt and outcome=recorded");

  // A second occurrence stays live for the conflict, stale and ahead-of-current cases.
  const second = await createQuest("Wire second", 11);

  const conflict = await resolveOk(canonical.commandId, second.occurrenceId, 1);
  assert.equal(conflict.outcome, "conflict");
  assert.equal(conflict.receipt, null);
  assert.equal(conflict.canonical_receipt, null);
  assert.equal(conflict.correction_event_id, null);
  assert.equal(conflict.reopened_event_id, null);
  assert.equal(conflict.reversal_entry_id, null);
  assert.equal(conflict.current_execution_cycle, 1);
  assert.equal(conflict.current_status, "scheduled");
  pass("conflict: a command already recorded for another occurrence resolves as outcome=conflict");

  const conflictAhead = await resolveOk(canonical.commandId, second.occurrenceId, 6);
  assert.equal(conflictAhead.outcome, "conflict");
  assert.equal(conflictAhead.expected_execution_cycle, 6);
  assert.equal(conflictAhead.current_execution_cycle, 1);
  assert.ok(validateCompletionResolution(conflictAhead, canonical.commandId, second.occurrenceId, 6),
    "the validator must accept a conflict whose expected cycle is ahead of the current cycle");
  pass("conflict: checked before the future-cycle rejection, and the validator accepts the ahead-of-current conflict");

  const reuse = await invoke(() => completeQuestOccurrence(canonical.commandId, second.occurrenceId, 1),
    "conflicting completion", "complete_quest_occurrence");
  assert.ok(reuse.thrown !== null, "the command path must reject a recorded command reuse");
  assert.equal(reuse.exchange.status, 409, "unique_violation must map to HTTP 409");
  assert.equal(reuse.raw.code, "23505");
  assert.equal(reuse.raw.message, "Conflicting quest command reuse");
  assert.equal(reuse.value, null);
  pass(`conflict: complete_quest_occurrence reuse rejected by PostgREST with 409/${reuse.raw.code} '${reuse.raw.message}'`);

  const stale = await invoke(() => completeQuestOccurrence(randomUUID(), second.occurrenceId, 4),
    "stale completion", "complete_quest_occurrence");
  assert.equal(stale.exchange.status, 400, "check_violation must map to HTTP 400");
  assert.equal(stale.raw.code, "23514");
  assert.equal(stale.raw.message, "Stale quest completion cycle");
  pass("stale: only 'Stale quest completion cycle' identifies staleness inside a 23514 envelope");

  const ahead = await resolveRejects(randomUUID(), second.occurrenceId, 6);
  assert.equal(ahead.exchange.status, 400);
  assert.equal(ahead.raw.code, "23514");
  assert.equal(ahead.raw.message, "Expected execution cycle is ahead of current occurrence");
  pass("unknown subject: an unrecorded command ahead of the current cycle is rejected, never authorized");

  // ------------------------------------------------- durable alias and Reopen history
  const alias = await completeQuest(first.occurrenceId, 1);
  assert.equal(alias.receipt.replay, true, "a second command for the same completion reports a replay");
  assert.equal(alias.receipt.command_id, alias.commandId);
  assert.equal(alias.receipt.completed_event_id, canonical.receipt.completed_event_id);
  assert.equal(await fact(`SELECT count(*) FROM public.quest_events WHERE user_id = '${OWNER}' AND command_id = '${alias.commandId}'`, "alias"), "0",
    "a durable alias must not mint a Quest event");
  assert.equal(await fact(`SELECT count(*) FROM system_internal.quest_completion_aliases WHERE user_id = '${OWNER}' AND command_id = '${alias.commandId}'`, "alias"), "1");
  assert.equal(await fact(`SELECT count(*) FROM public.exp_ledger WHERE user_id = '${OWNER}' AND source_type = 'quest_completion'`, "alias"), "1",
    "a durable alias must not mint another EXP credit");
  pass("durable alias: the lost alternate command is bound with no Quest event and no second EXP credit");

  const reopen = await reopenQuest(first.occurrenceId, 1);
  assert.equal(reopen.receipt.replay, false);
  assert.equal(reopen.receipt.undone_cycle, 1);
  assert.equal(reopen.receipt.original_credit_entry_id, canonical.receipt.exp_entry_id);
  assert.equal(await fact(`SELECT format('%s|%s|%s', (SELECT execution_cycle FROM public.quest_occurrences WHERE id = '${first.occurrenceId}'), (SELECT status FROM public.quest_occurrences WHERE id = '${first.occurrenceId}'), (SELECT count(*) FROM public.quest_events WHERE occurrence_id = '${first.occurrenceId}'))`, "state"),
    "2|scheduled|4", "reopen must leave cycle 2 with correction, reopened and completion history");
  pass("reopen: occurred over HTTP with correction, reopened and reversal history");

  const aliasAfterReopen = await resolveOk(alias.commandId, first.occurrenceId, 1);
  assert.equal(aliasAfterReopen.outcome, "recorded", "a durable alias must replay after Reopen");
  assert.equal(aliasAfterReopen.receipt.command_id, alias.commandId);
  assert.equal(aliasAfterReopen.receipt.completed_event_id, canonical.receipt.completed_event_id);
  assert.equal(aliasAfterReopen.receipt.exp_entry_id, canonical.receipt.exp_entry_id);
  assert.equal(aliasAfterReopen.receipt.replay, true);
  assert.equal(aliasAfterReopen.canonical_receipt, null);
  assert.equal(aliasAfterReopen.current_execution_cycle, 2);
  assert.equal(aliasAfterReopen.current_status, "scheduled");
  assert.equal(aliasAfterReopen.reopened_event_id, null);
  assert.equal(aliasAfterReopen.reversal_entry_id, null);
  const canonicalAfterReopen = await resolveOk(canonical.commandId, first.occurrenceId, 1);
  assert.equal(canonicalAfterReopen.outcome, "recorded");
  assert.equal(canonicalAfterReopen.receipt.command_id, canonical.commandId);
  pass("recorded (durable alias after Reopen): both identities replay the historical receipt");

  // ------------------------------------------- unrecorded_current (live occurrence)
  const neverRecorded = randomUUID();
  const current = await resolveOk(neverRecorded, second.occurrenceId, 1);
  assert.equal(current.outcome, "unrecorded_current");
  assert.equal(current.receipt, null);
  assert.equal(current.canonical_receipt, null);
  assert.equal(current.current_execution_cycle, 1);
  assert.equal(current.current_status, "scheduled");
  assert.equal(current.correction_event_id, null);
  pass("unrecorded_current: a live cycle with no completion authorizes redispatch of the exact saved mutation");

  const secondCompletion = await completeQuest(second.occurrenceId, 1);
  const currentWithCanonical = await resolveOk(neverRecorded, second.occurrenceId, 1);
  assert.equal(currentWithCanonical.outcome, "unrecorded_current");
  assert.equal(currentWithCanonical.receipt, null, "an unrecorded command must never receive a receipt");
  assert.equal(currentWithCanonical.current_status, "completed");
  assert.ok(currentWithCanonical.canonical_receipt !== null, "a completed cycle must expose canonical evidence");
  assert.equal(currentWithCanonical.canonical_receipt.command_id, secondCompletion.commandId);
  assert.equal(currentWithCanonical.canonical_receipt.replay, true);
  assert.equal(currentWithCanonical.canonical_receipt.completed_event_id, secondCompletion.receipt.completed_event_id);
  assert.equal(currentWithCanonical.correction_event_id, null);
  pass("unrecorded_current: a completed cycle exposes canonical evidence only, never a caller receipt");

  // ------------------------------------------------------ unrecorded_superseded
  const secondReopen = await reopenQuest(second.occurrenceId, 1);
  const superseded = await resolveOk(neverRecorded, second.occurrenceId, 1);
  assert.equal(superseded.outcome, "unrecorded_superseded");
  assert.equal(superseded.receipt, null);
  assert.equal(superseded.current_execution_cycle, 2);
  assert.equal(superseded.current_status, "scheduled");
  assert.equal(superseded.canonical_receipt.command_id, secondCompletion.commandId);
  assert.equal(superseded.canonical_receipt.execution_cycle, 1);
  assert.equal(superseded.canonical_receipt.exp_entry_id, secondReopen.receipt.original_credit_entry_id);
  assert.equal(superseded.correction_event_id, secondReopen.receipt.correction_event_id);
  assert.equal(superseded.reopened_event_id, secondReopen.receipt.reopened_event_id);
  assert.equal(superseded.reversal_entry_id, secondReopen.receipt.reversal_entry_id);
  assert.equal(new Set([superseded.correction_event_id, superseded.reopened_event_id, superseded.reversal_entry_id]).size, 3,
    "the three undo identities must be distinct");
  assert.equal(await fact(`SELECT reverses_entry_id = '${secondCompletion.receipt.exp_entry_id}' FROM public.exp_ledger WHERE id = '${superseded.reversal_entry_id}'`, "ledger"),
    "true", "the reversal must reverse the canonical credit");
  pass("unrecorded_superseded: the canonical receipt and all three undo identities match the Reopen receipt");

  assert.equal(await fact(`SELECT format('%s|%s', (SELECT count(*) FROM public.quest_events WHERE user_id = '${OWNER}' AND command_id = '${neverRecorded}'), (SELECT count(*) FROM system_internal.quest_completion_aliases WHERE user_id = '${OWNER}' AND command_id = '${neverRecorded}'))`, "evidence"),
    "0|0", "the superseded request must have no event and no alias");
  assert.equal(await fact(`SELECT format('%s|%s|%s', (SELECT count(*) FROM public.quest_events WHERE user_id = '${OWNER}' AND command_id = '${secondCompletion.commandId}'), (SELECT count(*) FROM system_internal.quest_completion_aliases WHERE user_id = '${OWNER}' AND command_id = '${secondCompletion.commandId}'), (SELECT max(execution_cycle) FROM public.quest_events WHERE user_id = '${OWNER}' AND command_id = '${secondCompletion.commandId}'))`, "evidence"),
    "1|0|1", "the canonical command stays recorded with no alias");
  pass("unrecorded_superseded evidence: the requested command is proven unrecorded (0 events, 0 aliases)");

  const contrast = await resolveOk(neverRecorded, second.occurrenceId, 2);
  assert.equal(contrast.outcome, "unrecorded_current", "the same command at the current cycle is current, not superseded");
  assert.equal(contrast.current_execution_cycle, 2);
  assert.equal(contrast.canonical_receipt, null);
  pass("unrecorded_current vs unrecorded_superseded: decided by the requested cycle, never by inferred history");

  // ----------------------------- owner isolation and rejected credentials
  const outsiderRead = await resolveRejects(canonical.commandId, first.occurrenceId, 1, "outsider");
  assert.equal(outsiderRead.exchange.status, 400);
  assert.equal(outsiderRead.raw.code, "23514");
  assert.equal(outsiderRead.raw.message, "Unknown quest occurrence");
  pass("owner isolation: another authenticated account cannot see or resolve the owner's occurrence");

  const anonymous = await resolveRejects(canonical.commandId, first.occurrenceId, 1, "anonymous");
  assert.equal(anonymous.exchange.status, 401, "PostgREST maps insufficient_privilege (42501) to HTTP 401");
  assert.equal(anonymous.raw.code, "42501");
  assert.ok(anonymous.raw.message.includes("permission denied for function"), `unexpected message: ${anonymous.raw.message}`);
  pass(`anon role denied with 401/42501 '${anonymous.raw.message}'`);

  const invalid = await resolveRejects(canonical.commandId, first.occurrenceId, 1, "invalid-signature");
  assert.equal(invalid.exchange.status, 401, "an invalid JWT signature must be unauthorized");
  assert.equal(invalid.raw.code, "PGRST301");
  assert.equal(typeof invalid.raw.message, "string");
  assert.ok(invalid.raw.message.length > 0, "the rejection must explain itself");
  note(`invalid-signature JWT envelope: HTTP 401 ${JSON.stringify(invalid.raw)}`);
  pass("invalid JWT: rejected with 401/PGRST301 before any database work");

  // ----------------------------- raw RPC argument envelopes
  async function rawRpc(args, identity = "owner") {
    selectWireIdentity(identity);
    const startIndex = exchanges.length;
    const client = await createServerSupabaseClient();
    const result = await client.rpc(RESOLVER_FUNCTION, args);
    assert.equal(exchanges.length, startIndex + 1, "raw rpc: exactly one HTTP exchange expected");
    const exchange = exchanges[startIndex];
    return { ...result, exchange, raw: exchange.responseBody === "" ? null : JSON.parse(exchange.responseBody) };
  }

  const nullCommand = await rawRpc({ command_id: null, occurrence_id: second.occurrenceId, expected_execution_cycle: 1 });
  // PostgREST maps 42501 to 403 when the request is authenticated and to 401 when it
  // is not, so the same SQLSTATE from the anonymous role is a 401 one line above.
  assert.equal(nullCommand.status, 403, "an authenticated 42501 must be HTTP 403");
  assert.equal(nullCommand.error.code, "42501");
  assert.equal(nullCommand.error.message, "Authentication and required command inputs are mandatory");
  assert.equal(nullCommand.data, null);
  pass("null command: an explicitly null command_id is refused with 403/42501, never treated as absent");

  const zeroCycle = await rawRpc({ command_id: randomUUID(), occurrence_id: second.occurrenceId, expected_execution_cycle: 0 });
  assert.equal(zeroCycle.status, 400);
  assert.equal(zeroCycle.error.code, "23514");
  assert.equal(zeroCycle.error.message, "Expected execution cycle is out of range");
  pass("zero cycle: a non-positive expected cycle is refused with 400/23514");

  const unknownArgument = await rawRpc({ command_id: randomUUID(), occurrence_id: second.occurrenceId,
    expected_execution_cycle: 1, unexpected: "x" });
  assert.equal(unknownArgument.status, 404, "an unknown parameter must not silently match the signature");
  assert.equal(unknownArgument.error?.code, "PGRST202", "PostgREST must report its own schema-cache miss");
  note(`unknown-parameter envelope: HTTP 404 ${JSON.stringify(unknownArgument.raw)}`);
  pass(`unknown parameter: the resolver signature cannot be widened (404/PGRST202)`);

  // ----------------------------- aliased identity mismatch is a conflict
  // completion_binding compares the requested occurrence and cycle for aliased and
  // canonical commands alike, so an alternate command cannot be used to dress up a
  // receipt for another occurrence or cycle. The resolver answers conflict with no
  // receipt at all and the frontend validator accepts that disposition.
  const foreignOccurrence = await resolveOk(alias.commandId, second.occurrenceId, 1);
  assert.equal(foreignOccurrence.outcome, "conflict", "an aliased command for a foreign occurrence must be a conflict");
  assert.equal(foreignOccurrence.receipt, null, "a conflict must never carry a receipt");
  assert.equal(foreignOccurrence.canonical_receipt, null);
  assert.equal(foreignOccurrence.correction_event_id, null);
  assert.equal(foreignOccurrence.reopened_event_id, null);
  assert.equal(foreignOccurrence.reversal_entry_id, null);
  assert.equal(foreignOccurrence.current_execution_cycle, 2);
  assert.equal(foreignOccurrence.current_status, "scheduled");
  const foreignCycle = await resolveOk(alias.commandId, first.occurrenceId, 2);
  assert.equal(foreignCycle.outcome, "conflict", "an aliased command for a foreign cycle must be a conflict");
  assert.equal(foreignCycle.receipt, null);
  const aliasStillRecorded = await resolveOk(alias.commandId, first.occurrenceId, 1);
  assert.equal(aliasStillRecorded.outcome, "recorded", "a conflict must not disturb the durable alias");
  assert.equal(aliasStillRecorded.receipt.completed_event_id, canonical.receipt.completed_event_id);
  pass("aliased identity mismatch: a foreign occurrence or cycle is a conflict, never a mismatched receipt");

  // ----------------------------- validator contract on real payloads
  assert.equal(validateCompletionResolution(recorded, canonical.commandId, first.occurrenceId, 2), false,
    "a mismatched expected cycle must be refused");
  assert.equal(validateCompletionResolution(recorded, randomUUID(), first.occurrenceId, 1), false,
    "a mismatched command must be refused");
  assert.equal(validateCompletionResolution({ ...superseded, outcome: "recorded" }, neverRecorded, second.occurrenceId, 1), false,
    "an outcome swap on real superseded evidence must be refused");
  assert.equal(validateCompletionResolution({ ...superseded, outcome: "recorded", receipt: superseded.canonical_receipt },
    neverRecorded, second.occurrenceId, 1), false,
    "a canonical receipt must never be promoted to a caller receipt");
  pass("validator contract: real wire payloads are accepted only for their exact identity, cycle and outcome");
}

/** Catalog evidence that the wire contract and the security boundary are what they claim. */
async function runCatalogChecks() {
  assert.equal(await fact(`SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.quest_completion_resolution_v1'::regclass AND attnum > 0`, "catalog"),
    RESOLUTION_FIELDS.join(","), "the composite type must carry the twelve contract fields in order");
  assert.equal(await fact(`SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.quest_completion_receipt'::regclass AND attnum > 0`, "catalog"),
    RECEIPT_FIELDS.join(","), "the receipt type must carry the ten contract fields in order");
  assert.equal(await fact(`SELECT format('%s|%s', provolatile::text, prosecdef::text) FROM pg_proc WHERE proname = '${RESOLVER_FUNCTION}'`, "catalog"),
    "v|true", "the resolver must stay volatile and security definer");
  assert.equal(await fact(`SELECT relrowsecurity FROM pg_class WHERE oid = 'system_internal.quest_completion_aliases'::regclass`, "catalog"),
    "true", "the alias table must keep row level security enabled");
  assert.equal(await fact(`SELECT has_table_privilege('authenticated', 'system_internal.quest_completion_aliases', 'SELECT')`, "catalog"),
    "false", "browser roles must not read completion aliases directly");
  assert.equal(await fact(`SELECT has_schema_privilege('authenticated', 'system_internal', 'USAGE')`, "catalog"),
    "true", "the schema grant must not be the thing that protects the alias table");
  pass("catalog: twelve- and ten-field composite order, volatile definer resolver, RLS alias table denied to authenticated");
}

/**
 * Remove only what this run created, by the immutable ID captured at creation time.
 * Each ID is re-verified immediately before removal, and removal is verified after.
 */
async function teardown(activeAdapter) {
  const removed = [];
  const cleanupErrors = [];
  if (activeAdapter?.server) {
    try {
      await new Promise((resolve, reject) => activeAdapter.server.close((error) => error ? reject(error) : resolve()));
    } catch (error) {
      cleanupErrors.push(new Error(`adapter close failed: ${redact(error?.message ?? error)}`));
    }
  }

  // Identity and isolation checks are mandatory. A verification failure must
  // NEVER be followed by docker rm, even if the recorded ID still exists.
  // Continue checking other owned resources so one failure does not skip cleanup.
  for (const [kind, id, verify] of [["api", apiId, verifyApiTarget], ["database", databaseId, verifyDatabaseTarget]]) {
    if (id === null) continue;
    try {
      await verify({ requireRunning: false });
    } catch (error) {
      cleanupErrors.push(new Error(`${kind} identity/isolation check failed; NOT removing ${id}: ${redact(error?.message ?? error)}`));
      continue;
    }
    try {
      await docker(["rm", "-f", id], `remove disposable ${kind}`);
      assert.equal(await dockerExists(["inspect", id], `inspect removed ${kind}`), false,
        `${kind} container ${id} must be gone`);
      removed.push(`${kind} ${id.slice(0, 12)}`);
    } catch (error) {
      cleanupErrors.push(new Error(`${kind} teardown failed: ${redact(error?.message ?? error)}`));
    }
  }

  if (networkId !== null) {
    try {
      const before = JSON.parse(await docker(["network", "inspect", "--format",
        "{\"id\":{{json .Id}},\"name\":{{json .Name}},\"test\":{{json (index .Labels \"system.test\")}},\"run\":{{json (index .Labels \"system.run\")}}}", networkId],
        "verify disposable network"));
      assert.equal(before.id, networkId, "network ID mismatch");
      assert.equal(before.name, networkName, "network name mismatch");
      assert.equal(before.test, runLabel, "network test label mismatch");
      assert.equal(before.run, runId, "network run label mismatch");
      await docker(["network", "rm", networkId], "remove disposable network");
      assert.equal(await dockerExists(["network", "inspect", networkId], "inspect removed network"), false,
        "the disposable network must be gone");
      removed.push(`network ${networkId.slice(0, 12)}`);
    } catch (error) {
      cleanupErrors.push(new Error(`network identity/teardown failure; retained when unsafe: ${redact(error?.message ?? error)}`));
    }
  }

  try {
    assert.equal(await docker(["ps", "-a", "--filter", `label=system.run=${runId}`, "--format", "{{.ID}}"], "verify container removal"),
      "", "no container from this run may remain");
  } catch (error) {
    cleanupErrors.push(new Error(`leftover container inventory: ${redact(error?.message ?? error)}`));
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, `Cleanup incomplete: ${removed.join(", ") || "nothing removed"}. Investigate named leftovers manually; never bulk-remove.`);
  }
  return removed;
}
try {
  const environment = await startEnvironment();
  adapter = environment.adapter;
  assertNotInterrupted();
  await runCatalogChecks();
  assertNotInterrupted();
  await runWireChecks();
  assertNotInterrupted();
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL: ${redact(error?.message ?? error)}`);
  for (const [kind, id] of [["api", apiId], ["database", databaseId]]) {
    if (id === null) continue;
    try {
      console.error(`--- ${kind} container log tail ---`);
      console.error(redact(await docker(["logs", "--tail", "40", id], `${kind} logs`)));
    } catch {
      console.error(`(${kind} logs unavailable)`);
    }
  }
  const last = exchanges.at(-1);
  if (last) console.error(`last exchange: ${JSON.stringify({ path: last.requestPath, forwarded: last.forwardedPath, status: last.status, request: last.requestBody, response: last.responseBody.slice(0, 600) })}`);
} finally {
  try {
    const removed = await teardown(adapter);
    pass(`teardown removed ${removed.join(", ")} and no container from this run remains`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL: teardown: ${redact(error?.message ?? error)}`);
    if (error instanceof AggregateError) {
      for (const detail of error.errors) console.error(`  - ${redact(detail.message)}`);
    }
  }
  try {
    const labelled = await docker(["ps", "-a", "--filter", `label=system.test=${runLabel}`, "--format", "{{.ID}} {{.Names}}"]);
    note(`containers labelled system.test=${runLabel} after teardown: ${labelled === "" ? "none" : labelled}`);
  } catch {
    note("labelled-container inventory unavailable");
  }
  if (process.exitCode) {
    console.error(`FAILED after ${checks.length} passing checks`);
  } else {
    console.log(`PASS: ${checks.length} checks against disposable PostgreSQL 17.6 + PostgREST 16.2 over ${exchanges.length} real HTTP exchanges`);
  }
}
