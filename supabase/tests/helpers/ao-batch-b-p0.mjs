// Batch B disposable P0 coverage. QA-11-B01 resource-label parity repair is verified.
// Runtime execution only through the existing approved disposable CI runner.
// Do not pre-normalize any RPC payload: that would conceal a server divergence.
// New groups: QA-06 G-05 state, QA-08 PartialDate, QA-11 text/URL, QA-19 Opportunity
// lifecycle audit, QA-20 Activity temporal/status audit. Every negative routes through
// unchangedMutation (named SQLSTATE + message + full snapshot immutability) or
// checkRejection (constant SQLSTATE CHECK violations, no message), and every positive
// through acceptedMutation or acceptedLifecycle (canonical fields + immutable history).
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
  await repairAcceptance(env, owner);
  await exerciseAoClosedNoteNullRepair(env, owner);
  await exerciseBatchBRows(env, owner);
  console.log("PASS: Batch B QA-11-B01 verified; QA-06/08/11/19/20 remaining coverage implemented");
}
async function exerciseBatchBRows(env, owner) {
  for (const [kind, label, build] of [
    ["opportunity", "06", qa06],
    ["opportunity/activity", "08", qa08],
    ["opportunity", "19", qa19],
    ["opportunity/activity", "11", qa11],
    ["activity", "20", qa20],
  ]) await exerciseRow(env, owner, kind, label, build);
}


// Repair acceptance corpus. Expected labels are explicit, not derived by SQL
// or by pre-normalizing the RPC input. All URLs/IDs/order must survive verbatim.
function resourceFixtures() {
  const whitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const link = { id: "abcdefab-1234-4234-8234-abcdefabcdef", label: expectedLabel, url: "https://example.org/resource" };
  const padded = { ...link, label: whitespace + expectedLabel + whitespace };
  const second = { ...padded, id: randomUUID(), label: "\u00a0Second\u3000" };
  const urlAt = length => "https://example.org/" + "a".repeat(length - "https://example.org/".length);
  const accepted = (name, raw, expected) => ({ name, raw, expected, accepted: true });
  const rejected = (name, raw) => ({ name, raw, accepted: false });
  const many = Array.from({ length: 30 }, (_, index) => ({ ...padded, id: randomUUID(), label: "\u3000Link " + index + "\u00a0" }));
  return [
    accepted("canonical_unicode", [link], [link]),
    accepted("all_trim_boundaries", [padded], [link]),
    accepted("non_trim_unicode", [{ ...link, label: "\u200b\u180eText\u180e\u200b" }], [{ ...link, label: "\u200b\u180eText\u180e\u200b" }]),
    accepted("url_verbatim", [{ ...padded, url: "HTTPS://Example.ORG:443/a%2Fb?x=1#part" }], [{ ...link, url: "HTTPS://Example.ORG:443/a%2Fb?x=1#part" }]),
    accepted("120_astral_codepoints", [{ ...padded, label: whitespace + "\u{1f600}".repeat(120) + whitespace }], [{ ...link, label: "\u{1f600}".repeat(120) }]),
    accepted("internal_whitespace", [{ ...padded, label: "\u3000A  B\r\nC\u00a0" }], [{ ...link, label: "A  B\r\nC" }]),
    accepted("duplicate_urls_order", [padded, second], [link, { ...second, label: "Second" }]),
    accepted("url_2047_2048", [{ ...padded, url: urlAt(2047) }, { ...second, url: urlAt(2048) }], [{ ...link, url: urlAt(2047) }, { ...second, label: "Second", url: urlAt(2048) }]),
    accepted("empty_collection", [], []),
    accepted("30_links", many, many.map((item, index) => ({ ...item, label: "Link " + index }))),
    ...["", whitespace, null, 42, true, [], {}, whitespace + "\u{1f600}".repeat(121) + whitespace].map((label, index) =>
      rejected("invalid_label_" + index, [{ ...padded, label }])),
    rejected("missing_label", [{ id: link.id, url: link.url }]),
    rejected("duplicate_ids", [padded, { ...padded, label: "Other" }]),
    rejected("duplicate_ids_case", [padded, { ...padded, id: link.id.toUpperCase(), label: "Other" }]),
    ...[urlAt(2049), " " + link.url, link.url + "\u00a0", "http://example.org/", "https://user@example.org/", "https://example.org/a\\b", "https://example.org/a\nb"].map((url, index) =>
      rejected("invalid_url_" + index, [{ ...padded, url }])),
    rejected("extra_key", [{ ...padded, extra: "not allowed" }]),
    rejected("invalid_id", [{ ...padded, id: "invalid" }]),
    rejected("non_object", [null]),
    rejected("mixed_valid_invalid", [padded, { ...second, label: whitespace }]),
    rejected("31_links", [...many, { ...padded, id: randomUUID() }]),
    rejected("null_collection", null),
    rejected("object_collection", {}),
  ];
}

// Offline TypeScript evidence only. Never starts PostgreSQL or an RPC client.
export function verifyAoBatchBRepairModelFixtures() {
  const fixtures = resourceFixtures();
  for (const fixture of fixtures) {
    for (const kind of ["opportunity", "activity"]) {
      for (const create of [true, false]) {
        const fields = create ? fieldsFor(kind, fixture.raw) : { title: "Atomic companion edit", resource_links: fixture.raw };
        const original = structuredClone(fields);
        const result = kind === "opportunity" ? model.normalizeOpportunity(fields, create ? "create" : "update")
          : create ? model.normalizeActivityCreate(fields) : model.normalizeActivityUpdate(fields);
        assert.equal(result.ok, fixture.accepted, fixture.name + " TypeScript acceptance");
        if (fixture.accepted) assert.deepEqual(modelFields(kind, fields, create).resource_links, fixture.expected, fixture.name);
        assert.deepEqual(fields, original, "model must leave raw RPC fixture intact");
      }
    }
  }
  return { fixtures: fixtures.length, accepted: fixtures.filter(item => item.accepted).length,
    rejected: fixtures.filter(item => !item.accepted).length, cases: fixtures.length * 4,
    evidence: "TypeScript only; PostgreSQL NOT RUN" };
}

function mutation(kind, key, fields, revision = null, command = randomUUID()) {
  const create = revision === null;
  return { kind, key, fields, revision, command, operation: (create ? "create_" : "update_") + kind + "_v1",
    args: { p_command_id: command, ["p_" + kind + "_id"]: key,
      ...(create ? { p_fields: fields } : { p_expected_revision: revision, p_changes: fields }) } };
}

async function snapshot(env, request) {
  return { subject: await subjectSnapshot(env, request.kind, request.key, request.command),
    external: await externalSnapshot(env) };
}

function without(value, keys) {
  if (value === null) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

async function acceptedMutation(env, owner, request, changed = true) {
  const before = await snapshot(env, request);
  const expected = modelFields(request.kind, request.fields, request.revision === null);
  const response = await owner.rpc(request.operation, request.args);
  const after = await snapshot(env, request);
  assert.equal(after.external, before.external, "accepted command changed external domains");
  assert.equal(classifyAoBatchBResponse(response), "accepted_response", request.operation + " acceptance");
  const receipt = good(response, request.operation);
  assert(model.parseAoReceipt(receipt, { command_id: request.command, subject_kind: request.kind,
    subject_id: request.key, operation: request.operation, expected_revision: request.revision }), "strict receipt shape/identity");
  assert.equal(receipt.replay, false);
  assert.equal(receipt.changed, changed);
  assert.equal(receipt.revision_before, request.revision ?? "0");
  assert.equal(receipt.revision_after, String(BigInt(request.revision ?? "0") + BigInt(changed ? 1 : 0)));
  const prior = JSON.parse(before.subject), next = JSON.parse(after.subject);
  assert.equal(String(next.root.revision), receipt.revision_after);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(next.root[key], value, "persisted field " + key);
  }
  const read = await root(owner, request.kind, request.key);
  assert.deepEqual(read.resource_links, next.root.resource_links, "owner-visible resources");
  assert.equal(String(read.revision), receipt.revision_after);
  assert.deepEqual(next.commands.filter(item => item.command_id !== request.command), prior.commands, "prior receipts immutable");
  const commands = next.commands.filter(item => item.command_id === request.command);
  assert.equal(commands.length, 1, "exactly one accepted receipt");
  assert.deepEqual(commands[0].result, receipt, "stored receipt fidelity");
  assert.equal(commands[0].canonical_request.operation, request.operation);
  assert.equal(commands[0].canonical_request.subject_kind, request.kind);
  assert.equal(commands[0].canonical_request.subject_id, request.key);
  assert.equal(commands[0].canonical_request.expected_revision, request.revision);
  if (Object.hasOwn(expected, "resource_links")) {
    assert.deepEqual(commands[0].canonical_request.request.resource_links, expected.resource_links, "canonical intent labels/IDs/URLs/order");
  }
  assert.deepEqual(next.history.filter(item => item.command_id !== request.command), prior.history, "prior history immutable");
  const events = next.history.filter(item => item.command_id === request.command);
  assert.equal(events.length, changed ? 1 : 0, "one event per effective mutation; none for no-op");
  if (changed) {
    assert.equal(events[0].event_seq, 1);
    assert.equal(events[0].event_type, request.operation);
    assert.deepEqual(events[0].before_value, without(prior.root, ["user_id"]), "full history before image");
    assert.deepEqual(events[0].after_value, without(next.root, ["user_id"]), "full history after image");
    if (prior.root) assert.deepEqual(without(next.root, [...Object.keys(expected), "revision", "updated_at"]),
      without(prior.root, [...Object.keys(expected), "revision", "updated_at"]), "unrelated root fields unchanged");
  } else {
    assert.deepEqual(next.root, prior.root, "no-op preserves complete root including timestamps/resources");
  }
  return receipt;
}

async function unchangedMutation(env, owner, request, expected) {
  const before = await snapshot(env, request);
  const response = await owner.rpc(request.operation, request.args);
  assert.deepEqual(await snapshot(env, request), before, "root/revision/resources/history/receipts/external domains unchanged");
  if (expected.receipt) {
    assert.equal(classifyAoBatchBResponse(response), "accepted_response");
    assert.deepEqual(good(response, "replay"), { ...expected.receipt, replay: true }, "historical replay receipt fidelity");
  } else {
    assert.equal(response.status, expected.code === "23505" ? 409 : 400, "expected PostgreSQL HTTP mapping");
    assert.equal(response.error?.code, expected.code, "specific rejection SQLSTATE");
    assert.equal(response.error?.message, expected.message, "specific rejection reason");
  }
}

// Fixture-owned direct DML follows the existing disposable SQL test pattern.
// Only the resource CHECK on the intended root may satisfy this assertion.
async function directResourceCheck(env, owner, kind) {
  assert(["opportunity", "activity"].includes(kind));
  const table = kind === "opportunity" ? "opportunities" : "activities";
  const link = fixtureLink();
  const request = mutation(kind, randomUUID(), fieldsFor(kind, [{ ...link, label: expectedLabel }]));
  await acceptedMutation(env, owner, request);
  const before = await snapshot(env, request);
  try {
    await env.sql("DO $qa11$ DECLARE expected_constraint text; actual_constraint text; actual_table text; actual_schema text; BEGIN " +
      "SELECT c.conname INTO STRICT expected_constraint FROM pg_catalog.pg_constraint c " +
      "WHERE c.conrelid=" + quote("public." + table) + "::regclass AND c.contype='c' " +
      "AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%ao_resources_valid_v1(resource_links)%'; " +
      "BEGIN UPDATE public." + table + " SET resource_links=" + quote(JSON.stringify([link])) + "::jsonb WHERE id=" + quote(request.key) + "; " +
      "RAISE EXCEPTION 'Expected noncanonical resource CHECK rejection'; " +
      "EXCEPTION WHEN check_violation THEN " +
      "GET STACKED DIAGNOSTICS actual_constraint=CONSTRAINT_NAME, actual_table=TABLE_NAME, actual_schema=SCHEMA_NAME; " +
      "IF actual_constraint IS DISTINCT FROM expected_constraint OR actual_table IS DISTINCT FROM " + quote(table) +
      " OR actual_schema IS DISTINCT FROM 'public' THEN RAISE; END IF; END; END $qa11$;");
  } finally {
    // Check even unexpected SQL failures. The nested exception block rolls back
    // the rejected UPDATE; a missing rejection raises and rolls back the DO.
    assert.deepEqual(await snapshot(env, request), before,
      "direct CHECK rejection preserves root/revision/resources/history/receipts/external domains");
  }
  console.log("QA-11-B01 OBSERVED direct resource CHECK: " + kind + " rejected noncanonical storage with 23514; snapshots unchanged");
}

async function repairAcceptance(env, owner) {
  const inventory = verifyAoBatchBRepairModelFixtures();
  for (const kind of ["opportunity", "activity"]) {
    for (const create of [true, false]) {
      for (const fixture of resourceFixtures()) {
        const key = randomUUID();
        if (!create) await acceptedMutation(env, owner, mutation(kind, key, fieldsFor(kind, [{ ...fixtureLink(), label: "Original" }])));
        const fields = create ? fieldsFor(kind, fixture.raw) : { title: "Atomic companion edit", resource_links: fixture.raw };
        const request = mutation(kind, key, fields, create ? null : "1");
        if (fixture.accepted) await acceptedMutation(env, owner, request);
        else await unchangedMutation(env, owner, request, { code: "22023", message: "Invalid AO resource links" });
        console.log("QA-11-B01 OBSERVED repair fixture: " + JSON.stringify({ operation: request.operation, fixture: fixture.name,
          outcome: fixture.accepted ? "accepted_and_verified" : "rejected_and_atomic" }));
      }
      const key = randomUUID();
      const links = [fixtureLink(), { ...fixtureLink(), label: "\u3000Second\u00a0" }];
      if (!create) await acceptedMutation(env, owner, mutation(kind, key, fieldsFor(kind, [{ ...links[0], label: "Original" }])));
      const fields = create ? fieldsFor(kind, links) : { resource_links: links };
      const original = mutation(kind, key, fields, create ? null : "1");
      const receipt = await acceptedMutation(env, owner, original);
      // Advance state before replay: the old receipt must not rewrite newer state.
      const later = await acceptedMutation(env, owner, mutation(kind, key, { title: "Later title" }, receipt.revision_after));
      await unchangedMutation(env, owner, original, { receipt });
      const canonical = modelFields(kind, fields, create).resource_links;
      await unchangedMutation(env, owner, mutation(kind, key, { ...fields, resource_links: canonical }, original.revision, original.command), { receipt });
      for (const conflict of [
        canonical.map((item, index) => index ? item : { ...item, label: "Different" }),
        canonical.map((item, index) => index ? item : { ...item, url: item.url + "?different=1" }),
        canonical.map((item, index) => index ? item : { ...item, id: randomUUID() }),
        [...canonical].reverse(),
      ]) {
        await unchangedMutation(env, owner, mutation(kind, key, { ...fields, resource_links: conflict }, original.revision, original.command),
          { code: "23505", message: "Conflicting AO command identity reuse" });
      }
      await unchangedMutation(env, owner, mutation(kind, key, { resource_links: links }, receipt.revision_after),
        { code: "23514", message: "Stale AO revision" });
      await acceptedMutation(env, owner, mutation(kind, key, { resource_links: links }, later.revision_after), false);
      console.log("QA-11-B01 OBSERVED replay/collision/no-op integrity: " + original.operation + " passed");
    }
    await directResourceCheck(env, owner, kind);
  }
  console.log("PASS: QA-11-B01 repair acceptance " + inventory.cases + " boundary cases, four replay/collision/no-op sequences and two direct CHECK rejections");
}

// ---------------------------------------------------------------------------
// Batch B remaining coverage (QA-06/08/11/19/20). Each group builds a fresh
// owner-scoped subject and derives every expectation from the TypeScript model
// and the SQL contracts only; observed output is never fed back as an expectation.
async function exerciseRow(env, owner, kind, label, build) {
  const checks = [];
  const note = (name, condition, detail) => {
    assert(condition, name + (detail ? ": " + detail : ""));
    checks.push(name);
  };
  await build(env, owner, note);
  assert.equal(checks.length, new Set(checks).size, "duplicate check names");
  assert(checks.length > 0, label + " ran no checks");
  console.log("PASS QA-" + label + " (" + kind + "): " + checks.length + " checks");
}

// CHECK-constraint rejections are unnamed, so PostgreSQL auto-generates the message.
// unchangedMutation asserts the exact message (valid for named RAISE EXCEPTION errors);
// this asserts HTTP mapping + SQLSTATE + full snapshot immutability without the message.
async function checkRejection(env, owner, request, code) {
  assert.equal(request.command, request.args.p_command_id, "snapshot command identity");
  assert.equal(request.key, request.args["p_" + request.kind + "_id"], "snapshot subject identity");
  const before = await snapshot(env, request);
  const response = await owner.rpc(request.operation, request.args);
  assert.deepEqual(await snapshot(env, request), before, "root/revision/resources/history/receipts/external domains unchanged");
  assert.equal(response.status, code === "23505" ? 409 : 400, "expected PostgreSQL HTTP mapping");
  assert.equal(response.error?.code, code, "specific rejection SQLSTATE");
  assert.match(response.error?.message ?? "", /^new row for relation "(opportunities|activities)" violates check constraint "/,
    "expected stored-state CHECK rejection, not a transition/stale error");
}



// Lifecycle RPCs have distinct payloads and history types; metadata normalization
// cannot stand in for these operations. Revision values on the wire stay strings.
function lifecycleRequest(kind, key, revision, operation, args, command = randomUUID()) {
  assert(model.isRevision(revision), "fixture revision must be a decimal string");
  return { kind, key, revision, command, operation,
    args: { ...args, p_command_id: command, ["p_" + kind + "_id"]: key, p_expected_revision: revision } };
}
const stageRequest = (key, rev, stage, kind, details = {}, command) =>
  lifecycleRequest("opportunity", key, rev, "set_opportunity_stage_v1",
    { p_stage: stage, p_kind: kind, p_details: details }, command);
const outcomeRequest = (key, rev, outcome, kind, details = {}, command) =>
  lifecycleRequest("opportunity", key, rev, "record_opportunity_outcome_v1",
    { p_outcome: outcome, p_kind: kind, p_details: details }, command);
const transitionRequest = (key, rev, action, details = {}, command) =>
  lifecycleRequest("activity", key, rev, "transition_activity_v1", { p_action: action, p_details: details }, command);
const correctionRequest = (key, rev, target, correction = {}, command) =>
  lifecycleRequest("activity", key, rev, "correct_activity_status_v1",
    { p_target_status: target, p_correction: correction }, command);

function lifecycleIntent(request) {
  const args = request.args;
  switch (request.operation) {
    case "set_opportunity_stage_v1": {
      const details = structuredClone(args.p_details);
      if (Object.hasOwn(details, "closed_note")) {
        const value = model.normalizeText(details.closed_note, "closed_note", 2000, false, true);
        assert(value.ok);
        details.closed_note = value.value;
      }
      return { stage: args.p_stage, kind: args.p_kind, details };
    }
    case "record_opportunity_outcome_v1":
      return { outcome: args.p_outcome, kind: args.p_kind, details: args.p_details };
    case "transition_activity_v1": return { action: args.p_action, details: args.p_details };
    case "correct_activity_status_v1": return { target_status: args.p_target_status, correction: args.p_correction };
    default: assert.fail("Unsupported fixture lifecycle operation");
  }
}

async function acceptedLifecycle(env, owner, request, expected, changed = true) {
  assert.equal(typeof changed, "boolean");
  assert.equal(request.command, request.args.p_command_id);
  assert.equal(request.key, request.args["p_" + request.kind + "_id"]);
  assert.equal(request.revision, request.args.p_expected_revision);
  const intent = lifecycleIntent(request); // independent of the server response
  const before = await snapshot(env, request);
  const response = await owner.rpc(request.operation, request.args);
  const after = await snapshot(env, request);
  assert.equal(after.external, before.external, "lifecycle leaves external domains unchanged");
  assert.equal(classifyAoBatchBResponse(response), "accepted_response");
  const receipt = good(response, request.operation);
  assert(model.parseAoReceipt(receipt, { command_id: request.command, subject_kind: request.kind,
    subject_id: request.key, operation: request.operation, expected_revision: request.revision }));
  assert.equal(receipt.changed, changed);
  assert.equal(receipt.replay, false);
  assert.equal(receipt.revision_before, request.revision);
  assert.equal(receipt.revision_after, String(BigInt(request.revision) + (changed ? 1n : 0n)));
  const prior = JSON.parse(before.subject), next = JSON.parse(after.subject);
  assert.equal(String(next.root.revision), receipt.revision_after);
  assert.deepEqual(without(next.root, ["revision", "updated_at"]), {
    ...without(prior.root, ["revision", "updated_at"]), ...expected,
  }, "expected lifecycle changes only; omitted fields preserved");
  const visible = await root(owner, request.kind, request.key);
  for (const [field, value] of Object.entries(expected)) assert.deepEqual(visible[field], value, field);
  assert.equal(String(visible.revision), receipt.revision_after);
  assert.deepEqual(next.commands.filter(c => c.command_id !== request.command), prior.commands, "previous receipts immutable");
  const commands = next.commands.filter(c => c.command_id === request.command);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].result, receipt);
  assert.deepEqual(commands[0].canonical_request, { operation: request.operation, subject_kind: request.kind,
    subject_id: request.key, expected_revision: request.revision, request: intent });
  assert.deepEqual(next.history.filter(h => h.command_id !== request.command), prior.history, "previous history immutable");
  const events = next.history.filter(h => h.command_id === request.command);
  assert.equal(events.length, changed ? 1 : 0);
  if (changed) {
    assert.equal(events[0].event_seq, 1);
    assert.equal(events[0].event_type, request.operation +
      (["set_opportunity_stage_v1", "record_opportunity_outcome_v1"].includes(request.operation) ? ":" + request.args.p_kind : ""));
    assert.deepEqual(events[0].before_value, without(prior.root, ["user_id"]));
    assert.deepEqual(events[0].after_value, without(next.root, ["user_id"]));
    assert.equal(events[0].reason, request.operation === "correct_activity_status_v1" ? request.args.p_correction.reason ?? null : null);
  } else {
    assert.deepEqual(next.root, prior.root, "no-op root/revision/updated_at unchanged");
  }
  return receipt;
}

// QA-06: G-05 hard invariants, enum negatives, and warning-only valid states.
// SQL enforces exactly the three TS validateOpportunityState() hard invariants as CHECKs
// (applicability vs outcome, closed details only when closed, 'other' needs a note); every
// TS warning-only combination must be accepted, never a hard reject. Warnings are not
// persisted, so an accepted mutation's canonical expected fields equal the model-normalized
// request. The RPC rejects malformed enums/field-keys before the CHECK layer (named 22023);
// the CHECK invariants surface as constant 23514 (checkRejection).
async function qa06(env, owner, note) {
  // Warning-only combinations: TS warns, SQL accepts at create.
  for (const state of [
    { label: "saved_accepted", fields: { tracking_stage: "saved", selection_outcome: "accepted" }, warn: "saved_accepted" },
    { label: "submitted_without_applied_at", fields: { tracking_stage: "submitted" }, warn: "submitted_without_applied_at" },
    { label: "invitation_submitted", fields: { tracking_stage: "submitted", entry_mode: "invitation" }, warn: "invitation_submitted" },
    { label: "direct_access_submitted", fields: { tracking_stage: "submitted", entry_mode: "direct_access" }, warn: "direct_access_submitted" },
    { label: "declined_without_outcome", fields: { tracking_stage: "closed", closed_reason: "declined_offer", closed_note: "Declined for another offer" }, warn: "declined_without_outcome" },
  ]) {
    const created = model.normalizeOpportunity({ title: "QA-06 warning " + state.label, ...state.fields }, "create");
    assert(created.ok, "QA-06 warning state " + state.label + " must be model-accepted");
    assert(model.validateOpportunityState(created.value).ok, "QA-06 warning state is not a hard invariant");
    note("g05_warning_model_" + state.label, model.opportunityWarnings(created.value).includes(state.warn), "expected " + state.warn);
    await acceptedMutation(env, owner, mutation("opportunity", randomUUID(), { title: "QA-06 warning " + state.label, ...state.fields }, null));
    note("g05_warning_accepted_" + state.label, true);
  }

  // Enum negatives: TS rejects; the SQL RPC rejects with a named 22023 before any CHECK.
  for (const bad of [
    { selection_outcome: "granted" }, { entry_mode: "portal" },
    { selection_applicability: "maybe" }, { tracking_stage: "archived" },
  ]) {
    const key = Object.keys(bad)[0];
    note("g05_enum_model_rejects_" + key, !model.normalizeOpportunity({ title: "QA-06 enum", ...bad }, "create").ok);
    await unchangedMutation(env, owner, mutation("opportunity", randomUUID(), { title: "QA-06 enum", ...bad }, null),
      { code: "22023", message: "Invalid AO enum value" });
    note("g05_enum_sql_rejects_" + key, true);
  }

  // Every non-Unknown outcome is invalid with N/A, on both Create and
  // Record Outcome. All requests share one UUID with their snapshot descriptor.
  const updKey = randomUUID();
  const setup = await acceptedMutation(env, owner, mutation("opportunity", updKey, { title: "QA-06 update" }));
  for (const outcome of model.SELECTION_OUTCOMES.filter(value => value !== "unknown")) {
    const fields = { title: "QA-06 N/A " + outcome, selection_outcome: outcome, selection_applicability: "not_applicable" };
    note("g05_hard_model_" + outcome, !model.normalizeOpportunity(fields, "create").ok);
    await checkRejection(env, owner, mutation("opportunity", randomUUID(), fields), "23514");
    await checkRejection(env, owner,
      outcomeRequest(updKey, setup.revision_after, outcome, "correction", { selection_applicability: "not_applicable" }), "23514");
  }
  await acceptedLifecycle(env, owner,
    outcomeRequest(updKey, setup.revision_after, "unknown", "correction", { selection_applicability: "not_applicable" }),
    { selection_outcome: "unknown", selection_applicability: "not_applicable" });
  note("g05_na_unknown_valid", (await root(owner, "opportunity", updKey)).selection_applicability === "not_applicable");
  const revision = "2";
  for (const [request, message] of [
    [outcomeRequest(updKey, revision, "granted", "correction"), "Invalid opportunity outcome intent"],
    [outcomeRequest(updKey, revision, "unknown", "correction", { selection_applicability: "maybe" }), "Invalid selection applicability"],
    [stageRequest(updKey, revision, "archived", "correction"), "Invalid opportunity stage intent"],
    [mutation("opportunity", updKey, { entry_mode: "portal" }, revision), "Invalid AO enum value"],
  ]) await unchangedMutation(env, owner, request, { code: "22023", message });

  // Recover from N/A atomically: a new applicability and Accepted outcome
  // are valid together and retain the Saved+Accepted advisory warning.
  await acceptedLifecycle(env, owner,
    outcomeRequest(updKey, revision, "accepted", "new_decision", { selection_applicability: "applicable" }),
    { selection_outcome: "accepted", selection_applicability: "applicable" });
  note("g05_warning_after_outcome", model.opportunityWarnings(await root(owner, "opportunity", updKey)).includes("saved_accepted"));

  // Hard invariant: closed details only when closed. Setting closed_reason while saved is a
  // CHECK violation (23514); the field key is valid so the RPC shape-check passes.
  note("g05_hard_model_rejects_closed_details_while_saved", !model.validateOpportunityState({
    tracking_stage: "saved", selection_outcome: "unknown", selection_applicability: "unknown", closed_reason: "withdrawn", closed_note: null }).ok);
  await checkRejection(env, owner, mutation("opportunity", randomUUID(),
    { title: "QA-06 saved-with-reason", tracking_stage: "saved", closed_reason: "withdrawn" }, null), "23514");
  note("g05_hard_closed_details_while_saved_rejected", true);

  // Hard invariant: 'other' closed reason requires a note (CHECK 23514).
  note("g05_hard_model_rejects_other_no_note", !model.validateOpportunityState({
    tracking_stage: "closed", selection_outcome: "unknown", selection_applicability: "unknown", closed_reason: "other", closed_note: null }).ok);
  await checkRejection(env, owner, mutation("opportunity", randomUUID(),
    { title: "QA-06 other", tracking_stage: "closed", closed_reason: "other" }, null), "23514");
  note("g05_hard_other_without_note_rejected", true);

  // Direct storage-layer G-05 CHECK probe (constant 23514, unnamed constraint). Mirrors
  // directResourceCheck: proves the invariant lives in public.opportunities, not just TS.
  const key = randomUUID();
  const probe = mutation("opportunity", key, { title: "QA-06 direct G-05", tracking_stage: "preparing" }, null);
  await acceptedMutation(env, owner, probe);
  const before = await snapshot(env, probe);
  try {
    await env.sql("DO $qa06$ DECLARE expected_constraint text; actual_constraint text; actual_table text; actual_schema text; BEGIN " +
      "SELECT c.conname INTO STRICT expected_constraint FROM pg_catalog.pg_constraint c " +
      "WHERE c.conrelid='public.opportunities'::regclass AND c.contype='c' " +
      "AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%selection_applicability%not_applicable%selection_outcome%unknown%'; " +
      "BEGIN UPDATE public.opportunities SET selection_applicability='not_applicable', selection_outcome='accepted' WHERE id=" + quote(key) + "; " +
      "RAISE EXCEPTION 'Expected G-05 applicability CHECK rejection'; " +
      "EXCEPTION WHEN check_violation THEN " +
      "GET STACKED DIAGNOSTICS actual_constraint=CONSTRAINT_NAME, actual_table=TABLE_NAME, actual_schema=SCHEMA_NAME; " +
      "IF actual_constraint IS DISTINCT FROM expected_constraint OR actual_table IS DISTINCT FROM 'opportunities' " +
      "OR actual_schema IS DISTINCT FROM 'public' THEN RAISE; END IF; END; END $qa06$;");
  } finally {
    assert.deepEqual(await snapshot(env, probe), before, "direct G-05 CHECK rejection preserves all snapshots");
  }
  note("g05_direct_check_probe", true);
}

// QA-08: PartialDate mutation coverage — omitted vs JSON null vs {precision:"unknown"}
// vs concrete value, plus invalid-date rollback and certain-reversal rejection. The RPC
// uses CASE WHEN v_fields ? key THEN NULLIF(value,'null') ELSE stored END, so an omitted key
// preserves the stored value, an explicit JSON null clears it to SQL NULL, and
// {precision:"unknown"} stores a JSON object (distinct from SQL NULL). This distinction is
// preserved exactly and never pre-normalized.
async function qa08(env, owner, note) {
  const dateFields = {
    opportunity: ["application_deadline", "program_start", "program_end", "applied_at", "decision_at"],
    activity: ["planned_start", "planned_end", "actual_start", "actual_end"],
  };
  const calendarValues = [
    { precision: "day", year: 2026, month: 6, day: 15 },
    { precision: "year", year: 1 },
    { precision: "month", year: 9999, month: 12 },
    { precision: "day", year: 2000, month: 2, day: 29 },
  ];
  const invalidDates = [
    { precision: "day", year: 2026, month: 2, day: 30 },
    { precision: "month", year: 2026, month: 13 },
    { precision: "year", year: 0 },
    { precision: "day", year: 2026, month: 6, day: 15, extra: 1 },
    { precision: "fortnight", year: 2026 },
    { precision: "day", year: 1900, month: 2, day: 29 },
  ];
  for (const kind of ["opportunity", "activity"]) {
    for (const field of dateFields[kind]) {
      const key = randomUUID(), tag = kind + "_" + field;
      const seed = { ...fieldsFor(kind, []), [field]: { precision: "unknown" } };
      if (kind === "activity") seed.intent = "confirmed_started";
      const created = await acceptedMutation(env, owner, mutation(kind, key, seed));
      let revision = created.revision_after;
      assert.deepEqual((await root(owner, kind, key))[field], { precision: "unknown" });
      const decision = field === "decision_at";
      const requestFor = changes => decision
        ? outcomeRequest(key, revision, "unknown", "correction", changes)
        : mutation(kind, key, changes, revision);
      const accept = async (changes, expected, changed = true) => {
        const request = requestFor(changes);
        const receipt = decision
          ? await acceptedLifecycle(env, owner, request, { selection_outcome: "unknown", ...expected }, changed)
          : await acceptedMutation(env, owner, request, changed);
        revision = receipt.revision_after;
        for (const [name, value] of Object.entries(expected))
          assert.deepEqual((await root(owner, kind, key))[name], value, tag + " exact value");
      };
      // Omission at the operation that owns this field, with unchanged companion data.
      await accept(decision ? {} : { title: seed.title }, {}, false);
      assert.deepEqual((await root(owner, kind, key))[field], { precision: "unknown" });
      await accept({ [field]: null }, { [field]: null });
      for (const [index, value] of calendarValues.entries()) {
        note("partial_calendar_" + tag + "_" + index, model.parsePartialDate(value).ok);
        await accept({ [field]: value }, { [field]: value });
      }
      await accept(decision ? {} : { title: seed.title }, {}, false);
      assert.deepEqual((await root(owner, kind, key))[field], calendarValues.at(-1), "omission preserves concrete date");
      await accept({ [field]: { precision: "unknown" } }, { [field]: { precision: "unknown" } });
      for (const [index, bad] of invalidDates.entries()) {
        note("partial_invalid_" + tag + "_" + index, !model.parsePartialDate(bad).ok);
        await unchangedMutation(env, owner, requestFor(decision ? { [field]: bad } :
          { title: "Must roll back companion edit", [field]: bad }),
          { code: "22023", message: decision ? "Invalid decision date" : "Invalid AO date" });
      }
      note("partial_roundtrip_" + tag, revision === "7");
    }
    const pair = kind === "opportunity" ? ["program_start", "program_end"] : ["planned_start", "planned_end"];
    const overlapSeed = { ...fieldsFor(kind, []),
      [pair[0]]: { precision: "month", year: 2026, month: 6 },
      [pair[1]]: { precision: "day", year: 2026, month: 6, day: 15 } };
    const startBounds = model.possibleCivilRange(overlapSeed[pair[0]]);
    const endBounds = model.possibleCivilRange(overlapSeed[pair[1]]);
    note("partial_genuine_overlap_" + kind, startBounds[0] < endBounds[0] && startBounds[1] > endBounds[1]);
    assert.equal(model.isCertainReverse(overlapSeed[pair[0]], overlapSeed[pair[1]]), false);
    await acceptedMutation(env, owner, mutation(kind, randomUUID(), overlapSeed));
    const reverseSeed = { ...fieldsFor(kind, []),
      [pair[0]]: { precision: "day", year: 2026, month: 6, day: 15 },
      [pair[1]]: { precision: "day", year: 2026, month: 6, day: 10 } };
    note("partial_reverse_" + kind, model.isCertainReverse(reverseSeed[pair[0]], reverseSeed[pair[1]]));
    await checkRejection(env, owner, mutation(kind, randomUUID(), reverseSeed), "23514");
  }
}
// QA-19: Opportunity Close/Reopen, outcome correction, immutable history, and
// invalid/stale/replay behavior. Stage uses set_opportunity_stage_v1 with explicit
// kind advance/reopen/correction; decision_at uses record_opportunity_outcome_v1 with
// kind new_decision/correction; closed_note via Opportunity Create or Stage command
// only. Stage no-ops (same stage + same details => changed=false) still record a
// receipt but no history row; replays return the stored receipt with replay:true.
// Stale expected_revision (v_before<>p_rev) => 23514.
async function qa19(env, owner, note) {
  const key = randomUUID();
  let revision = (await acceptedMutation(env, owner, mutation("opportunity", key, { title: "Life QA-19" }))).revision_after;
  let currentStage = "saved";
  const reject = async (request, code, message) =>
    unchangedMutation(env, owner, request, { code, message });
  const stage = async (target, kind, details, expected, changed = true) => {
    assert(model.opportunityStageTransition(currentStage, target, kind).ok, "model permits lifecycle step");
    const request = stageRequest(key, revision, target, kind, details);
    const receipt = await acceptedLifecycle(env, owner, request,
      { tracking_stage: target, closed_reason: null, closed_note: null, ...expected }, changed);
    revision = receipt.revision_after;
    currentStage = target;
    return { request, receipt };
  };
  await reject(stageRequest(key, revision, "preparing", "teleport"), "22023", "Invalid opportunity stage intent");
  note("stage_same_advance_model", !model.opportunityStageTransition("saved", "saved", "advance").ok);
  await reject(stageRequest(key, revision, "saved", "advance"), "23514", "Invalid stage transition");
  for (const target of ["preparing", "submitted"]) await stage(target, "advance", {}, {});
  await reject(stageRequest(key, revision, "saved", "reopen"), "23514", "Invalid stage transition");
  const close = await stage("closed", "advance",
    { closed_reason: "declined_offer", closed_note: "Closing: offer declined\r\nwith CRLF" },
    { closed_reason: "declined_offer", closed_note: "Closing: offer declined\nwith CRLF" });
  note("close_warning_only", model.opportunityWarnings(await root(owner, "opportunity", key)).includes("declined_without_outcome"));
  await reject(stageRequest(key, revision, "submitted", "advance"), "23514", "Invalid stage transition");

  // Fresh malformed lifecycle annotations must not mutate a closed root.
  for (const [details, message] of [
    [{ closed_reason: "withdrawn", bogus: 1 }, "Invalid closed details"],
    [{ closed_reason: "unlisted" }, "Invalid closed reason"],
    [{ closed_reason: "withdrawn", closed_note: 42 }, "Invalid closed note"],
  ]) await reject(stageRequest(key, revision, "closed", "correction", details), "22023", message);
  await reject(stageRequest(key, revision, "preparing", "reopen", { closed_reason: "withdrawn" }),
    "22023", "Closed details only for Closed stage");
  const correctedClose = await stage("closed", "correction",
    { closed_reason: "process_finished", closed_note: "Corrected closure" },
    { closed_reason: "process_finished", closed_note: "Corrected closure" });
  await stage("closed", "correction",
    { closed_reason: "process_finished", closed_note: "Corrected closure" },
    { closed_reason: "process_finished", closed_note: "Corrected closure" }, false);

  const lateDate = { precision: "day", year: 2026, month: 6, day: 15 };
  const lateRequest = outcomeRequest(key, revision, "accepted", "new_decision", { decision_at: lateDate });
  const lateReceipt = await acceptedLifecycle(env, owner, lateRequest,
    { selection_outcome: "accepted", decision_at: lateDate });
  revision = lateReceipt.revision_after;
  const correction = outcomeRequest(key, revision, "waitlisted", "correction", { decision_at: { precision: "unknown" } });
  const corrected = await acceptedLifecycle(env, owner, correction,
    { selection_outcome: "waitlisted", decision_at: { precision: "unknown" } });
  revision = corrected.revision_after;
  await acceptedLifecycle(env, owner, outcomeRequest(key, revision, "waitlisted", "correction"),
    { selection_outcome: "waitlisted" }, false);
  note("late_outcome_keeps_closed", (await root(owner, "opportunity", key)).tracking_stage === "closed");
  for (const request of [
    outcomeRequest(key, revision, "accepted", "annotation"),
    outcomeRequest(key, revision, "unlisted", "new_decision"),
  ]) await reject(request, "22023", "Invalid opportunity outcome intent");
  await reject(outcomeRequest(key, revision, "accepted", "correction", { reason: "unsupported annotation" }),
    "22023", "Invalid outcome detail keys");

  await stage("preparing", "reopen", {}, {});
  // Original Close/outcome/correction events and receipts must survive reopening.
  for (const { request, receipt } of [close, correctedClose, { request: lateRequest, receipt: lateReceipt }])
    await unchangedMutation(env, owner, request, { receipt });
  await reject(stageRequest(key, close.request.revision, "closed", "correction",
    close.request.args.p_details, close.request.command), "23505", "Conflicting AO command identity reuse");
  await reject(stageRequest(key, "1", "closed", "advance"), "23514", "Stale AO revision");
  await reject(outcomeRequest(key, "1", "rejected", "correction"), "23514", "Stale AO revision");
  await stage("saved", "correction", {}, {});
  const noop = await stage("saved", "correction", {}, {}, false);
  await acceptedMutation(env, owner, mutation("opportunity", key, { notes: "Later metadata" }, revision));
  await unchangedMutation(env, owner, noop.request, { receipt: noop.receipt });
  note("reopen_cleared_current_details", (await root(owner, "opportunity", key)).closed_reason === null &&
    (await root(owner, "opportunity", key)).closed_note === null);
}

// QA-11 remaining plain-text boundaries. Resource/URL coverage stays exclusively
// in the preserved QA-11-B01 corpus. Long text preserves nonblank boundary spacing.
async function qa11(env, owner, note) {
  const limits = {
    opportunity: { title: 240, organization: 240, description: 4000, eligibility_notes: 10000, benefits_notes: 10000, closed_note: 2000, notes: 10000 },
    activity: { title: 240, organization: 240, role: 160, description: 4000, confirmation_note: 2000, contributions: 10000, outcomes: 10000, lessons: 10000, notes: 10000 },
  };
  const multiline = new Set(["description", "eligibility_notes", "benefits_notes", "closed_note",
    "notes", "confirmation_note", "contributions", "outcomes", "lessons"]);
  for (const kind of ["opportunity", "activity"]) {
    const key = randomUUID();
    const seed = { ...fieldsFor(kind, []),
      ...(kind === "opportunity" ? { tracking_stage: "closed", closed_reason: "withdrawn" } : {}) };
    let revision = (await acceptedMutation(env, owner, mutation(kind, key, seed))).revision_after;
    for (const [field, limit] of Object.entries(limits[kind])) {
      const lifecycle = field === "closed_note";
      const at = "😀".repeat(limit), under = "é".repeat(limit - 1), over = "😀".repeat(limit + 1);
      note("text_codepoints_" + kind + "_" + field,
        [...under].length === limit - 1 && [...at].length === limit && [...over].length === limit + 1);
      const edge = "  edge\r\nline\rend\u2009 ";
      const fixtures = [
        { name: "at", raw: at, expected: at },
        { name: "over", raw: over, reject: true },
        { name: "under", raw: under, expected: under },
        { name: "blank", raw: " 　  ", expected: null, reject: field === "title" },
        { name: "edges_crlf", raw: edge,
          expected: multiline.has(field) ? "  edge\nline\nend\u2009 " : "edge\r\nline\rend" },
        ...(["title", "description"].includes(field)
          ? [{ name: "no_composition", raw: "e\u0301 ≠ é 😀", expected: "e\u0301 ≠ é 😀" }] : []),
      ];
      for (const fixture of fixtures) {
        const normalized = model.normalizeText(fixture.raw, field, limit, field === "title", multiline.has(field));
        note("text_model_" + kind + "_" + field + "_" + fixture.name, normalized.ok === !fixture.reject);
        if (!fixture.reject) assert.deepEqual(normalized.value, fixture.expected, "independent normalization expectation");
        const request = lifecycle
          ? stageRequest(key, revision, "closed", "correction",
            { closed_reason: fixture.reject ? "not_interested" : "withdrawn", closed_note: fixture.raw })
          : mutation(kind, key, fixture.reject
            ? { [field === "title" ? "organization" : "title"]: "Must roll back", [field]: fixture.raw }
            : { [field]: fixture.raw }, revision);
        if (fixture.reject) {
          await unchangedMutation(env, owner, request, { code: "22023",
            message: lifecycle ? "Invalid closed note" : "Invalid AO text value" });
        } else {
          const receipt = lifecycle
            ? await acceptedLifecycle(env, owner, request,
              { tracking_stage: "closed", closed_reason: "withdrawn", closed_note: fixture.expected })
            : await acceptedMutation(env, owner, request);
          revision = receipt.revision_after;
          assert.deepEqual((await root(owner, kind, key))[field], fixture.expected, "raw text persisted canonically without truncation");
        }
      }
    }
  }
}

// QA-20 uses independent legal paths, never a transition out of a terminal state
// as a fixture reset. Existing full status/action matrix coverage is not duplicated.
async function qa20(env, owner, note) {
  const visited = new Set();
  const paths = [
    { name: "complete", intent: "confirmed_plan", actions: ["start", "pause", "resume", "complete"], invalid: "pause" },
    { name: "end_early", intent: "confirmed_started", actions: ["pause", "end_early"], invalid: "resume" },
    { name: "cancel", intent: "confirmed_plan", actions: ["cancel_before_start"], invalid: "start" },
  ];
  let completed;
  for (const path of paths) {
    const key = randomUUID();
    let revision = (await acceptedMutation(env, owner,
      mutation("activity", key, { title: "QA-20 " + path.name, intent: path.intent }))).revision_after;
    let status = model.statusFromIntent(path.intent);
    visited.add(status);
    for (const action of path.actions) {
      const expected = model.activityTransition(status, action);
      assert(expected.ok);
      const receipt = await acceptedLifecycle(env, owner, transitionRequest(key, revision, action), { status: expected.value });
      revision = receipt.revision_after;
      status = expected.value;
      visited.add(status);
    }
    const current = await root(owner, "activity", key);
    note("terminal_dates_not_invented_" + path.name, current.actual_start === null && current.actual_end === null);
    assert.equal(model.activityTransition(status, path.invalid).ok, false);
    await unchangedMutation(env, owner, transitionRequest(key, revision, path.invalid),
      { code: "23514", message: "Invalid activity transition" });
    if (path.name === "complete") completed = { key, revision };
    if (path.name === "cancel") {
      for (const field of ["actual_start", "actual_end"])
        await checkRejection(env, owner, mutation("activity", key,
          { title: "Must roll back", [field]: { precision: "year", year: 2026 } }, revision), "23514");
    }
  }
  note("all_six_statuses", model.ACTIVITY_STATUSES.every(status => visited.has(status)) && visited.size === 6);
  // Imports have one Create event, no synthetic Start/Complete events or actuals.
  for (const intent of ["historical_completed", "historical_ended_early"]) {
    const key = randomUUID();
    await acceptedMutation(env, owner, mutation("activity", key, { title: "QA-20 import", intent }));
    const current = await root(owner, "activity", key);
    note("historical_" + intent, current.status === model.statusFromIntent(intent) &&
      current.actual_start === null && current.actual_end === null);
  }

  const key = completed.key;
  let revision = completed.revision;
  const day = (month, value) => ({ precision: "day", year: 2026, month, day: value });
  // Independent planned rescheduling vs actual correction on a terminal record.
  for (const [field, value] of [
    ["planned_start", day(6, 1)], ["planned_end", day(6, 15)],
    ["actual_start", day(5, 1)], ["actual_end", day(5, 10)],
  ]) {
    const done = await acceptedMutation(env, owner, mutation("activity", key, { [field]: value }, revision));
    revision = done.revision_after;
    note("temporal_field_" + field, (await root(owner, "activity", key)).status === "completed");
  }
  for (const pair of [["planned_start", "planned_end"], ["actual_start", "actual_end"]]) {
    const changes = { [pair[0]]: day(7, 15), [pair[1]]: day(7, 10), title: "Must roll back" };
    assert(model.isCertainReverse(changes[pair[0]], changes[pair[1]]));
    await checkRejection(env, owner, mutation("activity", key, changes, revision), "23514");
  }
  // Correct terminal status with omitted dates: actual dates must survive.
  const correction = correctionRequest(key, revision, "ongoing", { reason: "Correct terminal entry" });
  const corrected = await acceptedLifecycle(env, owner, correction, { status: "ongoing" });
  revision = corrected.revision_after;
  for (const details of [{ note: "extra" }, { action: "start" }, { details: {} }, { action: "start", details: {}, extra: 1 }])
    await unchangedMutation(env, owner, transitionRequest(key, revision, "complete", details),
      { code: "22023", message: "Invalid activity transition details" });
  await unchangedMutation(env, owner, transitionRequest(key, revision, "finish"),
    { code: "23514", message: "Invalid activity transition" });
  for (const [target, details, message] of [
    ["unlisted", {}, "Invalid activity status correction"],
    ["paused", { note: "not allowlisted" }, "Invalid status correction details"],
    ["paused", { reason: 42 }, "Invalid status correction reason"],
    ["paused", { reason: "x".repeat(2001) }, "Invalid status correction reason"],
    ["ongoing", { actual_start: { precision: "day", year: 2026, month: 2, day: 30 } }, "Invalid corrected actual dates"],
  ]) await unchangedMutation(env, owner, correctionRequest(key, revision, target, details), { code: "22023", message });
  for (const [target, details] of [
    ["upcoming", {}],
    ["cancelled_before_start", { actual_start: null }],
    ["ongoing", { actual_start: day(7, 15), actual_end: day(7, 10) }],
  ]) await checkRejection(env, owner, correctionRequest(key, revision, target, details), "23514");
  await unchangedMutation(env, owner, correctionRequest(key, "1", "paused"),
    { code: "23514", message: "Stale AO revision" });

  const noop = correctionRequest(key, revision, "ongoing", { reason: "Annotation alone is a no-op" });
  const noopReceipt = await acceptedLifecycle(env, owner, noop, { status: "ongoing" }, false);
  revision = (await acceptedMutation(env, owner,
    mutation("activity", key, { planned_end: day(6, 20) }, revision))).revision_after;
  await unchangedMutation(env, owner, correction, { receipt: corrected });
  await unchangedMutation(env, owner, noop, { receipt: noopReceipt });
  await unchangedMutation(env, owner,
    correctionRequest(key, correction.revision, "paused", correction.args.p_correction, correction.command),
    { code: "23505", message: "Conflicting AO command identity reuse" });
  // Clear known dates atomically when correcting to Cancelled Before Start.
  revision = (await acceptedLifecycle(env, owner,
    correctionRequest(key, revision, "cancelled_before_start", { actual_start: null, actual_end: null }),
    { status: "cancelled_before_start", actual_start: null, actual_end: null })).revision_after;
  revision = (await acceptedLifecycle(env, owner,
    correctionRequest(key, revision, "upcoming", { actual_start: { precision: "unknown" } }),
    { status: "upcoming", actual_start: { precision: "unknown" } })).revision_after;
  for (const field of ["actual_start", "actual_end"])
    await checkRejection(env, owner, mutation("activity", key, { [field]: day(6, 1) }, revision), "23514");
  const metadataNoop = mutation("activity", key, { planned_end: day(6, 20) }, revision);
  const metadataReceipt = await acceptedMutation(env, owner, metadataNoop, false);
  await unchangedMutation(env, owner, metadataNoop, { receipt: metadataReceipt });
  note("planned_actual_preserved_independently", (await root(owner, "activity", key)).planned_start.day === 1 &&
    (await root(owner, "activity", key)).planned_end.day === 20 &&
    (await root(owner, "activity", key)).actual_start.precision === "unknown");
}


// Closed-note NULL repair only. Independent of the unfinished Batch B groups.
// Runtime expectations below require separately approved disposable PostgreSQL.
function closedNoteFixtures() {
  const blank = "\t\r\n\u00a0\u1680\u2003\u202f\u3000\ufeff";
  return [
    { name: "A_other_null", details: { closed_reason: "other", closed_note: null }, accepted: false },
    { name: "B_other_blank", details: { closed_reason: "other", closed_note: blank }, accepted: false },
    { name: "other_omitted", details: { closed_reason: "other" }, accepted: false },
    { name: "C_withdrawn_null", details: { closed_reason: "withdrawn", closed_note: null },
      canonical: { closed_reason: "withdrawn", closed_note: null }, accepted: true },
    { name: "D_withdrawn_omitted", details: { closed_reason: "withdrawn" },
      canonical: { closed_reason: "withdrawn" }, accepted: true },
    { name: "E_withdrawn_blank", details: { closed_reason: "withdrawn", closed_note: blank },
      canonical: { closed_reason: "withdrawn", closed_note: null }, accepted: true },
    { name: "F_other_meaningful", details: { closed_reason: "other", closed_note: "Owner decision\r\nKeep spacing  \u00e9" },
      canonical: { closed_reason: "other", closed_note: "Owner decision\nKeep spacing  \u00e9" }, accepted: true },
  ];
}

// Pure TypeScript evidence, not a simulation of PostgreSQL or an RPC PASS.
export function verifyAoClosedNoteModelFixtures() {
  const fixtures = closedNoteFixtures();
  for (const fixture of fixtures) {
    const original = structuredClone(fixture.details);
    const result = model.normalizeOpportunity({
      title: "Closed-note repair", tracking_stage: "closed", ...fixture.details,
    }, "create");
    assert.equal(result.ok, fixture.accepted, fixture.name);
    if (fixture.accepted) {
      assert.equal(result.value.closed_reason, fixture.canonical.closed_reason);
      assert.equal(result.value.closed_note, fixture.canonical.closed_note ?? null);
      assert.equal(Object.hasOwn(fixture.canonical, "closed_note"),
        Object.hasOwn(fixture.details, "closed_note"), "omission remains distinct in command intent");
    } else {
      assert.equal(result.field, "closed_note", fixture.name);
      assert.equal(result.code, "required", fixture.name);
    }
    assert.deepEqual(fixture.details, original, "raw RPC fixture unchanged");
  }
  assert.deepEqual(fixtures.find(f => f.name === "C_withdrawn_null").canonical,
    fixtures.find(f => f.name === "E_withdrawn_blank").canonical);
  return { cases: fixtures.length, accepted: 4, rejected: 3, evidence: "TypeScript only; PostgreSQL NOT RUN" };
}

function closedNoteRequest(key, revision, details, command = randomUUID(), stageKind = "advance") {
  return { kind: "opportunity", key, revision, command, operation: "set_opportunity_stage_v1",
    args: { p_command_id: command, p_opportunity_id: key, p_expected_revision: revision,
      p_stage: "closed", p_kind: stageKind, p_details: details } };
}

async function acceptedClosedNote(env, owner, request, canonicalDetails, changed = true) {
  const before = await snapshot(env, request);
  const response = await owner.rpc(request.operation, request.args);
  const after = await snapshot(env, request);
  assert.equal(after.external, before.external, "closure leaves related domains unchanged");
  assert.equal(classifyAoBatchBResponse(response), "accepted_response");
  const receipt = good(response, "closed-note repair");
  assert(model.parseAoReceipt(receipt, { command_id: request.command, subject_kind: request.kind,
    subject_id: request.key, operation: request.operation, expected_revision: request.revision }));
  assert.equal(receipt.replay, false);
  assert.equal(receipt.changed, changed);
  assert.equal(receipt.revision_before, request.revision);
  assert.equal(receipt.revision_after, String(BigInt(request.revision) + (changed ? 1n : 0n)));
  const prior = JSON.parse(before.subject), next = JSON.parse(after.subject);
  assert.equal(String(next.root.revision), receipt.revision_after);
  assert.deepEqual(without(next.root, ["revision", "updated_at"]), {
    ...without(prior.root, ["revision", "updated_at"]), tracking_stage: "closed",
    closed_reason: canonicalDetails.closed_reason, closed_note: canonicalDetails.closed_note ?? null,
  }, "complete root retains closure reason and unrelated fields");
  const visible = await root(owner, request.kind, request.key);
  assert.equal(visible.closed_reason, canonicalDetails.closed_reason);
  assert.equal(visible.closed_note, canonicalDetails.closed_note ?? null);
  assert.equal(String(visible.revision), receipt.revision_after);
  assert.deepEqual(next.commands.filter(c => c.command_id !== request.command), prior.commands,
    "all previous receipts immutable");
  const commands = next.commands.filter(c => c.command_id === request.command);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].result, receipt);
  assert.deepEqual(commands[0].canonical_request, {
    operation: request.operation, subject_kind: request.kind, subject_id: request.key,
    expected_revision: request.revision,
    request: { stage: "closed", kind: request.args.p_kind, details: canonicalDetails },
  }, "whole canonical request survives, including reason and omitted keys");
  assert.deepEqual(next.history.filter(h => h.command_id !== request.command), prior.history,
    "all previous history immutable");
  const events = next.history.filter(h => h.command_id === request.command);
  assert.equal(events.length, changed ? 1 : 0);
  if (changed) {
    assert.equal(events[0].event_seq, 1);
    assert.equal(events[0].event_type, request.operation + ":" + request.args.p_kind);
    assert.deepEqual(events[0].before_value, without(prior.root, ["user_id"]));
    assert.deepEqual(events[0].after_value, without(next.root, ["user_id"]));
  } else {
    assert.deepEqual(next.root, prior.root, "no-op keeps revision, timestamps and complete root");
  }
  return receipt;
}

async function exerciseAoClosedNoteNullRepair(env, owner) {
  verifyAoClosedNoteModelFixtures();
  // Resolve the actual unnamed CHECK rather than guessing its generated name.
  const constraints = JSON.parse(await env.sql(
    "SELECT coalesce(jsonb_agg(conname),'[]'::jsonb)::text FROM pg_catalog.pg_constraint " +
    "WHERE conrelid='public.opportunities'::regclass AND contype='c' " +
    "AND position('closed_reason IS DISTINCT FROM' in pg_catalog.pg_get_constraintdef(oid))>0 " +
    "AND position('closed_note IS NOT NULL' in pg_catalog.pg_get_constraintdef(oid))>0;"));
  assert.equal(constraints.length, 1, "exactly one Other-requires-note constraint");
  for (const fixture of closedNoteFixtures()) {
    const key = randomUUID();
    const seed = await acceptedMutation(env, owner, mutation("opportunity", key, {
      title: "Closed-note repair " + fixture.name, notes: "Retain this metadata",
      resource_links: [{ ...fixtureLink(), label: "Retain resource" }],
    }));
    const request = closedNoteRequest(key, seed.revision_after, fixture.details);
    if (!fixture.accepted) {
      // Expected from the unchanged CHECK; still requires runtime confirmation.
      await unchangedMutation(env, owner, request, { code: "23514",
        message: 'new row for relation "opportunities" violates check constraint "' + constraints[0] + '"' });
    } else {
      const receipt = await acceptedClosedNote(env, owner, request, fixture.canonical);
      if (fixture.name === "C_withdrawn_null" || fixture.name === "E_withdrawn_blank") {
        const later = await acceptedMutation(env, owner,
          mutation("opportunity", key, { title: "Later edit " + fixture.name }, receipt.revision_after));
        await unchangedMutation(env, owner, request, { receipt });
        const equivalent = fixture.name === "C_withdrawn_null"
          ? closedNoteFixtures().find(f => f.name === "E_withdrawn_blank").details
          : closedNoteFixtures().find(f => f.name === "C_withdrawn_null").details;
        await unchangedMutation(env, owner,
          closedNoteRequest(key, request.revision, equivalent, request.command), { receipt });
        // Omitted note is deliberately a distinct command intent, even though
        // the persisted nullable field is the same.
        await unchangedMutation(env, owner,
          closedNoteRequest(key, request.revision, { closed_reason: "withdrawn" }, request.command),
          { code: "23505", message: "Conflicting AO command identity reuse" });
        await acceptedClosedNote(env, owner,
          closedNoteRequest(key, later.revision_after, equivalent, randomUUID(), "correction"),
          fixture.canonical, false);
      }
    }
  }
  console.log("PASS: closed-note repair, 7 closure cases, 4 historical replays, 2 omission collisions, 2 no-op corrections");
}
