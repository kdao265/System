// Batch B stopped at QA-11-B01: resource-label normalization parity discrepancy.
// Runtime reproduction only through the existing approved disposable CI runner.
// Do not pre-normalize the RPC payload: that would conceal the server discrepancy.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as model from "../../../src/features/activities-opportunities/model.ts";

const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const externalTables = [
  "quests", "quest_occurrences", "quest_events", "quest_recurrence_rules",
  "goals", "goal_quest_links", "exp_ledger", "schedule_events", "books",
];
const fixtureLink = () => ({
  id: randomUUID(),
  label: "\u00a0T\u00e0i li\u1ec7u \u{1f600}\u3000",
  url: "https://example.org/resource",
});
const expectedLabel = "T\u00e0i li\u1ec7u \u{1f600}";

function fieldsFor(kind, links) {
  return {
    title: "Batch B synthetic resource label",
    ...(kind === "activity" ? { intent: "confirmed_plan" } : {}),
    resource_links: links,
  };
}

function modelFields(kind, fields, create) {
  const result = kind === "opportunity"
    ? model.normalizeOpportunity(fields, create ? "create" : "update")
    : create ? model.normalizeActivityCreate(fields) : model.normalizeActivityUpdate(fields);
  assert.equal(result.ok, true, "QA-11-B01 model must accept boundary whitespace");
  return kind === "activity" && create ? result.value.fields : result.value;
}

// Safe offline check; does not import the runner or create any environment/client.
export function verifyAoBatchBModelFixtures() {
  for (const kind of ["opportunity", "activity"]) {
    const link = fixtureLink();
    for (const create of [true, false]) {
      const input = create ? fieldsFor(kind, [link]) : { resource_links: [link] };
      const normalized = modelFields(kind, input, create);
      assert.deepEqual(normalized.resource_links, [{ ...link, label: expectedLabel }]);
      assert.equal(link.label, "\u00a0" + expectedLabel + "\u3000", "fixture remains raw");
    }
  }
  return { cases: 4, evidence: "TypeScript only; PostgreSQL NOT RUN" };
}

function good(response, label) {
  assert.equal(response.error, null,
    label + ": SQLSTATE=" + (response.error?.code ?? "none") + " " + (response.error?.message ?? ""));
  return response.data;
}

async function root(owner, kind, key) {
  return good(await owner.rpc("get_" + kind + "_v1", { ["p_" + kind + "_id"]: key }),
    "read synthetic " + kind).root;
}

async function externalSnapshot(env) {
  return env.sql("SELECT jsonb_build_object(" + externalTables.map(table =>
    quote(table) + ",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public." + table + " x)"
  ).join(",") + ")::text;");
}

async function subjectSnapshot(env, kind, key, command) {
  assert(["opportunity", "activity"].includes(kind));
  const table = kind === "opportunity" ? "opportunities" : "activities";
  const predicate = kind + "_id=" + quote(key);
  return env.sql("SELECT jsonb_build_object(" +
    "'root',(SELECT to_jsonb(x) FROM public." + table + " x WHERE id=" + quote(key) + ")," +
    "'history',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public." + kind + "_history x WHERE " + predicate + ")," +
    "'commands',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.command_id),'[]'::jsonb) FROM system_internal.ao_commands x WHERE " + predicate + " OR command_id=" + quote(command) + ")" +
    ")::text;");
}

// Classification is evidence about the observed response, not acceptance.
export function classifyAoBatchBResponse(response) {
  if (!response || typeof response !== "object" || !("error" in response)) return "invalid_response";
  if (response.error === null) return response.status >= 200 && response.status < 300
    ? "accepted_response" : "invalid_response";
  const error = response.error;
  if (!error || typeof error !== "object") return "invalid_response";
  if (response.status === 401 || response.status === 403 || error.code === "42501" || /^28/.test(error.code ?? "")) {
    return "authorization_failure";
  }
  if (response.status === 0) return "transport_failure";
  if (response.status === 400 && error.code === "22023" && error.message === "Invalid AO resource links") {
    return "predicted_normalization_rejection";
  }
  return /^[0-9A-Z]{5}$/.test(error.code ?? "") ? "unrelated_postgresql_error" : "postgrest_or_transport_failure";
}

function observedResponse(response) {
  return {
    classification: classifyAoBatchBResponse(response),
    http_status: response?.status ?? null,
    code: response?.error?.code ?? null,
    message: response?.error?.message ?? null,
  };
}

// Do not dump snapshot values, harness exception messages, connection strings or credentials.
function failureIdentity(error) {
  return { name: error?.name ?? "UnknownError", code: error?.code ?? null };
}

async function check(report, name, verify) {
  try {
    await verify();
    report.checks.push({ name, result: "passed" });
  } catch (error) {
    report.checks.push({ name, result: "failed", failure: failureIdentity(error) });
  }
}

async function reproduce(env, owner, kind, create, report) {
  const key = randomUUID();
  const link = fixtureLink();
  const expectedLinks = [{ ...link, label: expectedLabel }];
  if (!create) {
    // Seed a valid collection so a rejected replacement must retain real data.
    report.phase = "seed";
    const seed = await owner.rpc("create_" + kind + "_v1", {
      p_command_id: randomUUID(), ["p_" + kind + "_id"]: key,
      p_fields: fieldsFor(kind, [{ ...link, label: "Original" }]),
    });
    report.seed_response = observedResponse(seed);
    good(seed, "seed canonical " + kind);
  }
  const command = randomUUID();
  const operation = report.operation;
  const fields = create ? fieldsFor(kind, [link]) : { resource_links: [link] };
  report.phase = "model";
  assert.deepEqual(modelFields(kind, fields, create).resource_links, expectedLinks);
  report.phase = "before_snapshots";
  const before = await subjectSnapshot(env, kind, key, command);
  const externalBefore = await externalSnapshot(env);
  report.phase = "mutation";
  report.attempted = true;
  let response;
  try {
    response = await owner.rpc(operation, {
      p_command_id: command, ["p_" + kind + "_id"]: key,
      ...(create ? { p_fields: fields } : { p_expected_revision: "1", p_changes: fields }),
    });
    report.response = observedResponse(response);
  } catch (error) {
    // A thrown RPC error may originate in transport or the client/harness; its origin and commit outcome are uncertain.
    report.response = { classification: "rpc_exception_uncertain_origin", failure: failureIdentity(error) };
  }
  report.phase = "after_checks";
  await check(report, "external_domains_unchanged", async () => {
    assert.equal(await externalSnapshot(env), externalBefore, operation + " changed external domains");
  });
  if (report.response.classification !== "accepted_response") {
    await check(report, "root_revision_resources_history_commands_unchanged", async () => {
      assert.equal(await subjectSnapshot(env, kind, key, command), before,
        operation + " changed root/revision/resources/history/accepted commands");
    });
    // Even an exact match is a failed acceptance expectation. Retain the actual
    // response separately from snapshot failures so neither conceals the other.
    report.outcome = report.response.classification === "predicted_normalization_rejection"
      ? "normalization_divergence" : "unrelated_failure_or_uncertain_outcome";
  } else {
    const receipt = response.data;
    await check(report, "accepted_revision_receipt", () => {
      assert(receipt && typeof receipt === "object", "missing accepted receipt");
      assert.equal(receipt.changed, true);
      assert.equal(receipt.revision_before, create ? "0" : "1");
      assert.equal(receipt.revision_after, create ? "1" : "2");
    });
    await check(report, "persisted_resources_and_revision", async () => {
      const after = await root(owner, kind, key);
      assert.deepEqual(after.resource_links, expectedLinks, operation + " must store canonical label");
      assert.equal(String(after.revision), create ? "1" : "2");
    });
    await check(report, "before_after_history", async () => {
      const events = JSON.parse(await env.sql("SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.event_seq),'[]'::jsonb)::text FROM public." +
        kind + "_history x WHERE " + kind + "_id=" + quote(key) + " AND command_id=" + quote(command) + ";"));
      assert.equal(events.length, 1, "one effective mutation event");
      assert.equal(events[0].event_type, operation);
      assert.deepEqual(events[0].after_value.resource_links, expectedLinks);
      if (!create) assert.deepEqual(events[0].before_value.resource_links, [{ ...link, label: "Original" }]);
    });
    await check(report, "persisted_receipt_fidelity", async () => {
      const stored = JSON.parse(await env.sql("SELECT result::text FROM system_internal.ao_commands WHERE command_id=" + quote(command) + ";"));
      assert.deepEqual(stored, receipt, "accepted receipt fidelity");
    });
    report.outcome = report.checks.every(item => item.result === "passed") ? "accepted_and_verified" : "acceptance_check_failure";
  }
  report.phase = "complete";
}

// Separate aggregation from execution so offline checks can prove that a
// predicted rejection (or an incomplete/check-failing report) can never pass.
export function assertAoBatchBDiagnostics(reports) {
  assert.deepEqual(reports.map(report => report.operation), [
    "update_opportunity_v1", "create_opportunity_v1", "update_activity_v1", "create_activity_v1",
  ], "All four diagnostic cases must be reported in order");
  const failed = reports.filter(report => !report.attempted || report.outcome !== "accepted_and_verified" ||
    report.response?.classification !== "accepted_response" || report.phase !== "complete" ||
    report.checks.length !== 5 || report.checks.some(item => item.result !== "passed"));
  assert.equal(failed.length, 0, "QA-11-B01 diagnostic FAILED: " + failed.map(report =>
    report.operation + "=" + report.outcome + "/" + (report.response?.classification ?? "no_target_response")
  ).join(", ") + ". Review observed responses and snapshot checks; remaining Batch B stays STOPPED.");
}

export async function exerciseAoBatchB(env, owner) {
  assert.equal(process.env.AO_DISPOSABLE_QA_APPROVED, "YES", "Existing CI-only runtime approval required");
  assert.match(env.url, /^http:\/\/127\.0\.0\.1:\d+$/, "Existing harness-owned loopback only");
  const reports = [];
  // Independent subjects; collect all four outcomes before failing overall.
  // Setup failure means no target response, not a normalization divergence.
  for (const kind of ["opportunity", "activity"]) {
    for (const create of [false, true]) {
      const report = {
        case: "QA-11-B01", operation: (create ? "create_" : "update_") + kind + "_v1",
        expectation: "accept_and_canonicalize_raw_label", attempted: false,
        phase: "setup", response: null, checks: [], outcome: "not_completed",
      };
      try {
        await reproduce(env, owner, kind, create, report);
      } catch (error) {
        report.outcome = "setup_or_harness_failure";
        report.failure = failureIdentity(error);
      }
      reports.push(report);
      console.log("QA-11-B01 OBSERVED diagnostic: " + JSON.stringify(report));
    }
  }
  assertAoBatchBDiagnostics(reports);
  console.log("PASS: Batch B QA-11-B01 four owner RPC cases verified; remaining Batch B coverage NOT IMPLEMENTED");
}
