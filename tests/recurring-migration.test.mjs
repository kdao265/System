import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260928181000_create_recurring_quests.sql", import.meta.url), "utf8");
const sql = migration.replace(/--[^\n]*/g, "");
const routines = ["create_recurring_quest", "materialize_quest_day", "list_recurring_quests", "set_quest_recurrence_pause"];

test("recurring migration remains additive and does not replace the pinned day/completion/EXP engine", () => {
  assert.equal([...sql.matchAll(/CREATE FUNCTION /g)].length, 4);
  assert.equal([...sql.matchAll(/CREATE TYPE /g)].length, 2);
  assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|INDEX|ROLE)\b/i);
  assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE/i);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.exp_ledger/i);
  assert.match(sql, /ON CONFLICT\s*\(quest_id, source_slot_date\)/);
});

test("each recurring routine keeps explicit owner enforcement and fixed search path", () => {
  for (const routine of routines) {
    const body = sql.match(new RegExp(`CREATE FUNCTION public\\.${routine}\\([\\s\\S]*?\\$function\\$;`))?.[0];
    assert.ok(body, routine);
    assert.match(body, /SET search_path = pg_catalog/);
    assert.match(body, /PERFORM system_private\.require_owner\(\)/);
    assert.match(body, /system_internal\.request_user_id\(\)/);
    assert.ok(body.indexOf("require_owner()") < body.indexOf("request_user_id()"));
  }
});

test("recurring routines grant execution only to authenticated and keep RLS-bound ownership", () => {
  const grants = [...sql.matchAll(/GRANT EXECUTE[\s\S]*?;/g)].map((match) => match[0]);
  assert.equal(grants.length, 4);
  for (const grant of grants) assert.match(grant, /TO authenticated;/);
  for (const routine of routines) {
    if (routine === "list_recurring_quests") {
      assert.match(sql, /CREATE FUNCTION public\.list_recurring_quests\(\)[\s\S]*?SECURITY INVOKER/);
    } else {
      assert.match(sql, new RegExp(`ALTER FUNCTION public\\.${routine}\\([^;]*OWNER TO quest_command_owner;`));
    }
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${routine}\\([^;]*FROM PUBLIC`));
  }
});

test("disposable history harness applies recurring suites only at the recurring migration checkpoint", () => {
  const harness = readFileSync(new URL("./helpers/auth-environment.mjs", import.meta.url), "utf8");
  assert.match(harness, /"20260928181000": \["recurring-quests-catalog", "recurring-quests"\]/);
  assert.equal((harness.match(/"recurring-quests-catalog"/g) ?? []).length, 1);
  assert.match(harness, /readdirSync\(migrationDir\)[^\n]*\.sort\(\)/);
});
