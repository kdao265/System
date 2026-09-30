// Targeted Phase A runner. No external target/env-file accepted; owns only its disposable harness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { startAuthEnvironment } from "../../tests/helpers/auth-environment.mjs";
import { exerciseGoalsWire } from "./helpers/goals-wire.mjs";

const env = await startAuthEnvironment({ buildApp: false });
const clients = [];
try {
  for (const suite of ["goals-main-quest-catalog", "goals-main-quest"]) {
    await env.sql(readFileSync(new URL(`./${suite}.sql`, import.meta.url), "utf8"));
    console.log(`PASS: ${suite}`);
  }
  for (const account of [env.owner, env.other, null]) {
    const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    if (account) assert(!(await client.auth.signInWithPassword({ email: account.email, password: account.password })).error, "Synthetic login failed");
  }
  await exerciseGoalsWire(env, ...clients);
  console.log("PASS: Goals seven-RPC owner/security, replay, no-engine-effects and three concurrency scenarios");
} finally {
  for (const client of clients) await client.auth.signOut({ scope: "local" });
  await env.close();
  console.log("Owned disposable Goals resources removed; no real Local/Cloud target.");
}
