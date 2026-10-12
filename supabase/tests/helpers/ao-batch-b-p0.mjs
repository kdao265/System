// QA-11-B01 controlled parity repair: acceptance remains strict; runtime pending review.
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
  await repairAcceptance(env, owner);
  console.log("PASS: Batch B QA-11-B01 verified; remaining Batch B coverage NOT IMPLEMENTED");
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
