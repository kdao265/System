// Approved residual P0 test support. IMPLEMENTED — RUNTIME NOT VERIFIED.
// Imported only by the existing guarded disposable runner's helpers. No services,
// environment creation, caller-supplied database URLs, or top-level execution.
// Contract: QA-10/12/23 closure matrix; review/nine-p0-closure-plan.md.
// Shared snapshots avoid a second copy of the existing 38 direct SQL attempts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const sqlQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
const q = sqlQuote;
const rootTables = { opportunity: "opportunities", activity: "activities" };
const externalTables = [
  "quests", "quest_occurrences", "quest_events", "quest_recurrence_rules",
  "goals", "goal_quest_links", "exp_ledger", "schedule_events", "books",
];

function disposable(env) {
  assert.equal(process.env.AO_DISPOSABLE_QA_APPROVED, "YES");
  assert.match(env.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(typeof env.sql, "function");
}
function rows(table, where = "true", order = "id") {
  return "(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY " + order +
    "),'[]'::jsonb) FROM " + table + " x WHERE " + where + ")";
}

// One SQL statement gives a consistent snapshot. Compare full retained rows,
// not counts. Include a failed command even if its subject binding is wrong.
export async function evidenceSnapshot(env, subjects, command = null) {
  disposable(env);
  assert(subjects.length > 0);
  const pairs = [];
  const commandPredicates = [];
  for (const { kind, id } of subjects) {
    assert(Object.hasOwn(rootTables, kind));
    assert.match(id, /^[0-9a-f-]{36}$/i);
    const pred = kind + "_id=" + q(id);
    const prefix = kind + ":" + id + ":";
    pairs.push(q(prefix + "root"), rows("public." + rootTables[kind], "id=" + q(id)));
    pairs.push(q(prefix + "history"), rows("public." + kind + "_history", pred));
    for (const target of ["goal", "quest"]) {
      pairs.push(q(prefix + target), rows("public." + kind + "_" + target + "_links", pred));
    }
    pairs.push(q(prefix + "source"), rows("public.activity_source_links", pred));
    commandPredicates.push(pred);
  }
  if (command !== null) commandPredicates.push("command_id=" + q(command));
  pairs.push("'commands'", rows("system_internal.ao_commands",
    commandPredicates.map(p => "(" + p + ")").join(" OR "), "user_id,command_id"));
  for (const table of externalTables) pairs.push(q(table), rows("public." + table));
  return env.sql("SELECT jsonb_build_object(" + pairs.join(",") + ")::text;");
}

export async function expectRpcRejection(env, client, operation, args, subjects,
  code, label, message = null, privateMarkers = []) {
  const command = args.p_command_id ?? null;
  if (command !== null) assert.equal(await env.sql(
    "SELECT count(*) FROM system_internal.ao_commands WHERE command_id=" + q(command)), "0",
  label + ": test command must be fresh");
  const before = await evidenceSnapshot(env, subjects, command);
  const response = await client.rpc(operation, args);
  assert.equal(await evidenceSnapshot(env, subjects, command), before, label + ": rollback");
  assert(response.error, label + ": unexpected success");
  assert.equal(response.error.code, code, label + ": SQLSTATE");
  if (message !== null) assert.equal(response.error.message, message, label + ": error branch");
  if (privateMarkers.length) {
    assert.equal(response.data, null, label + ": no foreign response payload");
    assert.equal(response.error.code, code, label + ": neutral foreign-target SQLSTATE");
    assert.equal(response.error.message, message, label + ": neutral foreign-target message");
    assert.equal(response.error.details, null, label + ": neutral foreign-target details");
    assert.equal(response.error.hint, null, label + ": neutral foreign-target hint");
  }
  for (const marker of privateMarkers) {
    assert(!JSON.stringify(response).includes(marker), label + ": foreign content leaked");
  }
  if (command !== null) assert.equal(await env.sql(
    "SELECT count(*) FROM system_internal.ao_commands WHERE command_id=" + q(command)), "0",
  label + ": rejected command left a receipt");
  return response;
}

// An unexpected success raises P9999 OUTSIDE the expected exception class.
// Both the failed statement's subtransaction and the surrounding transaction
// are rollback-contained. No OTHERS catch and no constraint disabling.
export async function expectSqlRejection(env, dml, code, subjects, label, diagnostic = {}) {
  assert.match(code, /^[0-9A-Z]{5}$/);
  const { table, column, constraints, message } = diagnostic;
  if (constraints) assert(constraints.length > 0, label + ": no expected constraints");
  const before = await evidenceSnapshot(env, subjects);
  const checks = [];
  if (table) checks.push("actual_schema IS DISTINCT FROM 'public' OR actual_table IS DISTINCT FROM " + q(table));
  if (column) checks.push("actual_column IS DISTINCT FROM " + q(column));
  if (constraints) checks.push("(actual_constraint = ANY(ARRAY[" + constraints.map(q).join(",") + "]::text[])) IS DISTINCT FROM true");
  if (message) checks.push("actual_message IS DISTINCT FROM " + q(message));
  await env.sql("BEGIN; DO $negative$ DECLARE actual_schema text; actual_table text; " +
    "actual_column text; actual_constraint text; actual_message text; BEGIN BEGIN " + dml +
    "; RAISE EXCEPTION 'Expected rejection absent' USING ERRCODE='P9999'; " +
    "EXCEPTION WHEN SQLSTATE " + q(code) + " THEN " +
    "GET STACKED DIAGNOSTICS actual_schema=SCHEMA_NAME, actual_table=TABLE_NAME, " +
    "actual_column=COLUMN_NAME, actual_constraint=CONSTRAINT_NAME, actual_message=MESSAGE_TEXT; " +
    (checks.length ? "IF " + checks.map(s => "(" + s + ")").join(" OR ") +
      " THEN RAISE EXCEPTION 'Unexpected rejection diagnostics for %', " + q(label) +
      " USING ERRCODE='P9999'; END IF; " : "") +
    "END; END $negative$; ROLLBACK;");
  assert.equal(await evidenceSnapshot(env, subjects), before, label + ": direct SQL changed state");
}

async function constraint(env, table, type, predicate) {
  const records = JSON.parse(await env.sql(
    "SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'expression'," +
    "pg_catalog.pg_get_expr(c.conbin,c.conrelid))),'[]'::jsonb)::text " +
    "FROM pg_catalog.pg_constraint c WHERE c.conrelid=" + q("public." + table) +
    "::regclass AND c.contype=" + q(type) + " AND (" + predicate + ");"));
  assert.equal(records.length, 1, table + ": unique catalog constraint selector " + predicate);
  return records[0];
}
const exprHas = text => "position(" + q(text) + " in pg_catalog.pg_get_expr(c.conbin,c.conrelid))>0";
const onlyColumn = field => "c.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute " +
  "WHERE attrelid=c.conrelid AND attname=" + q(field) + ")]::smallint[]";

async function rpc(client, name, args) {
  const r = await client.rpc(name, args);
  assert.equal(r.error, null, name + ": fixture setup failed");
  return r.data;
}
async function makeRoot(owner, kind) {
  const id = randomUUID();
  await rpc(owner, "create_" + kind + "_v1", {
    p_command_id: randomUUID(), ["p_" + kind + "_id"]: id,
    p_fields: { title: "Residual storage " + id,
      ...(kind === "activity" ? { intent: "confirmed_started" } :
        { tracking_stage: "closed", closed_reason: "withdrawn" }) },
  });
  return { kind, id };
}
function insertRoot(kind, ownerId, changes = {}) {
  const values = { id: q(randomUUID()), user_id: q(ownerId), title: "'Storage fixture'",
    ...(kind === "activity" ? { status: "'ongoing'" } : {}), ...changes };
  return "INSERT INTO public." + rootTables[kind] + "(" + Object.keys(values).join(",") +
    ") VALUES (" + Object.values(values).join(",") + ")";
}

// Group 3 — QA-12: PostgreSQL constraints. No duplicate old root negatives.
// CHECK -> exact catalog name; NN -> column; PK/FK -> actual key constraint.
// Defaults and lifecycle/RPC rules are deliberately not treated as CHECKs.
export async function exerciseRootStorageClosure(env, owner) {
  disposable(env);
  const subjects = [await makeRoot(owner, "opportunity"), await makeRoot(owner, "activity")];
  const byKind = Object.fromEntries(subjects.map(s => [s.kind, s]));
  async function check(kind, label, set, predicate) {
    const table = rootTables[kind];
    const expected = await constraint(env, table, "c", predicate);
    await expectSqlRejection(env, "UPDATE public." + table + " SET " + set +
      " WHERE id=" + q(byKind[kind].id), "23514", subjects, label,
    { table, constraints: [expected.name] });
  }

  // T12-01: 9 Opportunity + 7 Activity missing NN probes; existing three reused.
  const nullColumns = {
    opportunity: ["id", "user_id", "revision", "created_at", "updated_at",
      "tracking_stage", "entry_mode", "selection_applicability", "resource_links"],
    activity: ["id", "user_id", "revision", "created_at", "updated_at", "title", "resource_links"],
  };
  for (const [kind, fields] of Object.entries(nullColumns)) {
    for (const field of fields) {
      const key = randomUUID();
      await expectSqlRejection(env, insertRoot(kind, env.owner.id, { id: q(key), [field]: "NULL" }),
        "23502", [...subjects, { kind, id: key }], "T12-01 " + kind + "." + field,
        { table: rootTables[kind], column: field });
    }
  }

  // T12-02: duplicate ID uses another VALID Auth owner: composite (id,user_id)
  // remains distinct, so the PK alone must reject. No RLS/grant changes.
  for (const kind of Object.keys(rootTables)) {
    const table = rootTables[kind];
    const pk = await constraint(env, table, "p", "true");
    await expectSqlRejection(env, insertRoot(kind, env.other.id, { id: q(byKind[kind].id) }),
      "23505", subjects, "T12-02 " + kind + " PK", { table, constraints: [pk.name] });
    const absentOwner = randomUUID(), key = randomUUID();
    assert.equal(await env.sql("SELECT count(*) FROM auth.users WHERE id=" + q(absentOwner)), "0");
    const fk = await constraint(env, table, "f", "c.confrelid='auth.users'::regclass AND " + onlyColumn("user_id"));
    await expectSqlRejection(env, insertRoot(kind, absentOwner, { id: q(key) }), "23503",
      [...subjects, { kind, id: key }], "T12-02 " + kind + " Auth FK", { table, constraints: [fk.name] });
  }

  // T12-03: one actual storage overflow per field, not another +/-1 RPC corpus.
  const limits = {
    opportunity: { title: 240, organization: 240, description: 4000, eligibility_notes: 10000,
      benefits_notes: 10000, closed_note: 2000, notes: 10000 },
    activity: { title: 240, organization: 240, role: 160, description: 4000,
      confirmation_note: 2000, contributions: 10000, outcomes: 10000, lessons: 10000, notes: 10000 },
  };
  for (const [kind, fields] of Object.entries(limits)) {
    for (const [field, limit] of Object.entries(fields)) {
      await check(kind, "T12-03 " + kind + "." + field,
        field + "=repeat(chr(128512)," + (limit + 1) + ")",
        onlyColumn(field) + " AND " + exprHas("ao_text_valid_v1"));
    }
  }

  // T12-04: closed fixture avoids masking closed_reason with stage invariant.
  for (const [kind, fields] of Object.entries({
    opportunity: ["category", "tracking_stage", "selection_outcome", "entry_mode",
      "selection_applicability", "closed_reason", "priority"], activity: ["category"],
  })) {
    for (const field of fields) {
      // A bad tracking stage must not also violate the separate closed-fields CHECK.
      const clear = field === "tracking_stage" ? ",closed_reason=NULL,closed_note=NULL" : "";
      await check(kind, "T12-04 " + kind + "." + field, field + "='invalid-enum'" + clear,
        onlyColumn(field));
    }
  }

  // T12-05: malformed data can also fail an ordering CHECK, evaluated first by PG.
  // Prove the exact single-field predicate returns FALSE for the candidate row,
  // then accept diagnostics only from that predicate or its paired-date guard.
  // This is explicit predicate+binding evidence, not a claim that a masked CHECK
  // was the exception source. Neither constraint is disabled.
  const partialCases = [
    ["opportunity", "program_end", { precision: "year", year: 10000 }, ["program_start", "program_end"]],
    ["opportunity", "applied_at", { precision: "month", year: 2026, month: 1.5 }, null],
    ["opportunity", "decision_at", { precision: "day", year: 2026, month: 1, day: null }, null],
    ["activity", "planned_end", 2031, ["planned_start", "planned_end"]],
    ["activity", "actual_start", { precision: "unknown", extra: 1 }, ["actual_start", "actual_end"]],
    ["activity", "actual_end", { precision: "day", year: 2026, month: 1 }, ["actual_start", "actual_end"]],
  ];
  for (const [kind, field, value, pair] of partialCases) {
    const table = rootTables[kind], subject = byKind[kind];
    const standalone = await constraint(env, table, "c", onlyColumn(field) + " AND " + exprHas("ao_partial_valid_v1"));
    const candidate = q(JSON.stringify({ [field]: value })) + "::jsonb";
    assert.equal(await env.sql("SELECT (" + standalone.expression + ")::text FROM " +
      "jsonb_populate_record(NULL::public." + table + ",(SELECT to_jsonb(r) FROM public." +
      table + " r WHERE id=" + q(subject.id) + ")||" + candidate + ") AS candidate;"),
    "false", "T12-05 standalone " + kind + "." + field);
    const names = [standalone.name];
    if (pair) {
      names.push((await constraint(env, table, "c",
        exprHas("ao_partial_order_v1(" + pair.join(", ") + ")"))).name);
    }
    await expectSqlRejection(env, "UPDATE public." + table + " SET " + field + "=" +
      q(JSON.stringify(value)) + "::jsonb WHERE id=" + q(subject.id), "23514", subjects,
    "T12-05 " + kind + "." + field, { table, constraints: names });
  }

  // T12-06: raw JSON null is not RPC's intentional JSON-null -> SQL-NULL clear.
  const o = byKind.opportunity.id;
  await expectSqlRejection(env, "UPDATE public.opportunities SET application_deadline='null'::jsonb WHERE id=" + q(o),
    "22023", subjects, "T12-06 raw deadline null", { message: "Invalid AO deadline spec" });
  const key = randomUUID();
  const probeSubjects = [...subjects, { kind: "opportunity", id: key }];
  const before = await evidenceSnapshot(env, probeSubjects);
  const first = { precision: "instant", source_date: "2026-10-10", source_time: "09:30", source_offset_minutes: 420 };
  const next = { ...first, source_time: "10:30" };
  await env.sql("BEGIN; " + insertRoot("opportunity", env.owner.id, {
    id: q(key), application_deadline: q(JSON.stringify(first)) + "::jsonb",
    deadline_at_utc: "'2000-01-01T00:00Z'::timestamptz",
  }) + "; DO $probe$ BEGIN " +
    "IF (SELECT deadline_at_utc FROM public.opportunities WHERE id=" + q(key) +
    ") IS DISTINCT FROM '2026-10-10T02:30Z'::timestamptz THEN RAISE EXCEPTION 'T12-06 insert derivation'; END IF; " +
    "UPDATE public.opportunities SET application_deadline=" + q(JSON.stringify(next)) +
    "::jsonb,deadline_at_utc='2000-01-01T00:00Z' WHERE id=" + q(key) + "; " +
    "IF (SELECT deadline_at_utc FROM public.opportunities WHERE id=" + q(key) +
    ") IS DISTINCT FROM '2026-10-10T03:30Z'::timestamptz THEN RAISE EXCEPTION 'T12-06 update derivation'; END IF; " +
    "END $probe$; ROLLBACK;");
  assert.equal(await evidenceSnapshot(env, probeSubjects), before, "T12-06 successful probes must roll back");
  await expectSqlRejection(env, "UPDATE public.opportunities SET deadline_at_utc='2026-10-10T02:30Z' WHERE id=" + q(o),
    "42501", subjects, "T12-06 unchanged-source UTC tamper", { message: "AO deadline UTC is database-owned" });

  // T12-07: existing Opportunity zero and bare bigint arithmetic probes reused.
  await check("activity", "T12-07 Activity positive revision", "revision=0", "c.conname='ao_root_revision'");
  const goal = randomUUID();
  await rpc(owner, "create_goal_v1", { p_command_id: randomUUID(), p_goal_id: goal,
    p_title: "Residual overflow target " + goal, p_description: null });
  const a = byKind.activity.id;
  await env.sql("UPDATE public.activities SET revision=9223372036854775807 WHERE id=" + q(a));
  // Setup precedes baseline. Attach inserts a link before incrementing revision;
  // overflow must roll back that link, history, receipt and complete AO state.
  await expectRpcRejection(env, owner, "attach_ao_context_v1", {
    p_command_id: randomUUID(), p_source_kind: "activity", p_source_id: a,
    p_expected_revision: "9223372036854775807", p_target_kind: "goal", p_target_id: goal,
  }, subjects, "22003", "T12-07 transactional overflow");

  // T12-08: finite/ordering negatives must hit only the root-clock CHECK; confirmation is nullable.
  const clocks = [
    ["created infinity", "created_at='-infinity'"],
    ["updated infinity", "updated_at='infinity'"],
    ["update before creation", "updated_at=created_at-interval '1 second'"],
    ["archive infinity", "archived_at='infinity'"],
    ["archive before creation", "archived_at=created_at-interval '1 second'"],
    ["archive after update", "archived_at=updated_at+interval '1 second'"],
  ];
  for (const kind of Object.keys(rootTables)) {
    for (const [label, set] of clocks) await check(kind, "T12-08 " + kind + " " + label,
      set, "c.conname='ao_root_clock'");
  }
  await check("activity", "T12-08 participation finite", "participation_confirmed_at='infinity'",
    onlyColumn("participation_confirmed_at"));
  // Approved QA-12 final direct-CHECK closure (G12-01/02/04/05).
  // All four fixtures use the existing valid roots. A matching 23514 *and*
  // the catalog-discovered constraint name are required; full AO/external
  // snapshot equivalence is asserted by check() -> expectSqlRejection().
  // No trigger, constraint, role, or release behavior is changed here.
  await check("opportunity", "G12-01 non-closed retains close fields",
    "tracking_stage='saved'",
    exprHas("tracking_stage") + " AND " + exprHas("closed_reason") +
    " AND " + exprHas("closed_note"));
  // The fixture starts CLOSED with closed_reason='withdrawn' and no note.
  // Keeping its stage CLOSED isolates the `other`-requires-note CHECK.
  await check("opportunity", "G12-02 other reason requires closed_note",
    "closed_reason='other',closed_note=NULL",
    exprHas("closed_reason") + " AND " + exprHas("closed_note") +
    " AND NOT " + exprHas("tracking_stage"));

  // Both fields are independently valid civil dates. Only their order fails.
  // The Activity root was created with confirmed_started (status ongoing),
  // so its status/actual-date CHECK cannot mask the ordering constraint.
  const dayValue = (year, month, day) => q(JSON.stringify({
    precision: "day", year, month, day,
  })) + "::jsonb";
  const reversedDates = (start, end) =>
    start + "=" + dayValue(2030, 4, 2) + "," +
    end + "=" + dayValue(2030, 4, 1);
  await check("opportunity", "G12-04 program date order",
    reversedDates("program_start", "program_end"),
    exprHas("ao_partial_order_v1") + " AND " + exprHas("program_start") +
    " AND " + exprHas("program_end"));
  await check("activity", "G12-05 actual date order",
    reversedDates("actual_start", "actual_end"),
    exprHas("ao_partial_order_v1") + " AND " + exprHas("actual_start") +
    " AND " + exprHas("actual_end"));

  // G12-03 feasibility (NOT a direct CHECK negative):
  // ao_deadline_derive_trigger_v1 fires BEFORE INSERT/UPDATE OF the deadline
  // pair. INSERT or changed source recomputes NEW.deadline_at_utc; unchanged
  // source with modified UTC raises 42501. Thus a naturally emitted root row
  // cannot reach ao_deadline_valid_v1 with an inconsistent pair while the
  // trigger is enabled. T12-06 already verifies both protective branches and
  // successful derived UTC. Do not disable triggers to force CHECK execution.
  console.log("PASS: QA-12 G12-01/02/04/05 direct named CHECK negatives");
  console.log("OPEN: QA-12 G12-03 CHECK direct-negative remains trigger-dominated; " +
    "T12-06 verifies trigger/UTC consistency, not an isolated CHECK rejection");
  console.log("PASS: Group 3 QA-12 T12-01..08 bounded storage/trigger/rollback assertions");
}

// Candidate search is read-only and has its own duplicated eligibility filters.
// Exact fixture titles contain a UUID where possible; a rejected target must not
// be silently replaced by some other result. Existing deleted privacy tests reused.
export async function assertCandidate(env, owner, kind, source, targetKind, target,
  query, included, privateMarkers = []) {
  const subjects = [{ kind, id: source }];
  const before = await evidenceSnapshot(env, subjects);
  const response = await owner.rpc("search_ao_link_candidates_v1", {
    p_source_kind: kind, p_source_id: source, p_target_kind: targetKind,
    p_query: query, p_after_id: null, p_limit: 100,
  });
  assert.equal(await evidenceSnapshot(env, subjects), before, "T23-08 search must not write");
  assert.equal(response.error, null, "T23-08 candidate request");
  assert.equal(response.data.version, 1);
  assert(Array.isArray(response.data.items));
  if (included) assert.deepEqual(response.data.items.map(item => item.id), [target],
    "T23-08 eligible target inclusion");
  else assert.deepEqual(response.data.items, [], "T23-08 ineligible/foreign target exclusion");
  assert.equal(response.data.next_after_id, null, "T23-08 exact query must be exhausted");
  for (const marker of privateMarkers) assert(!JSON.stringify(response).includes(marker),
    "T23-08 foreign candidate content leaked");
}


/*
QA-10 PROVENANCE PROCEDURE — PREPARED ONLY; DO NOT EXECUTE WITHOUT NEW APPROVAL.

Image tag observed in CI: public.ecr.aws/supabase/postgres:17.6.1.166
Registry reference for future inspection:
public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86

Evidence: AO run 38449918395, job 115477867816, pull output 2026-10-13
18:50:41 UTC. This digest may identify an image index, not a platform manifest.
Node 24.21.0 / ICU 78.3 / Node tzdb 2026c and PostgreSQL 17.6 were observed;
the PostgreSQL tzdata release is UNKNOWN until this inspection proves it.

Future procedure (selected metadata only; never dump environment/config secrets):
1. Establish the CI platform/architecture from the retained job/image evidence.
   Read the registry manifest/index for the exact digest and record the selected
   child digest for that platform. Do not assume a tag or host architecture.
   A future approved operator can use:
     docker buildx imagetools inspect <registry-reference>
   If no matching platform can be established, STOP the provenance conclusion.
2. Obtain that exact digest only under separately approved inspection permission;
   record OS/architecture, image ID and RepoDigests using a formatted image inspect.
   Inspect only Entrypoint/Cmd when identifying which server binary normally runs.
   Check Config.Volumes: image-declared volumes can create anonymous mounts even
   without -v. If any are declared, STOP this run recipe and propose a separately
   reviewed read-only extraction; do not create or mount those volumes.
   Do not use unformatted docker inspect or print Config.Env.
3. Run a NEW ephemeral inspection container, never an existing developer container:
     docker run --rm --pull=never --read-only --network=none \
       --platform <verified-platform> --entrypoint /bin/sh <selected-child-reference> \
       -c '<approved read-only inspection commands>'
   No database startup, bind mounts, volumes, host socket, package installation,
   initdb, psql, SQL, or use of an existing PostgreSQL data directory.
4. Resolve the actual server executable (including any image startup wrapper).
   Inspect its --version and the matching pg_config --version, --bindir,
   --configure, --sharedir. Resolve symlinks with readlink -f. If pg_config cannot
   be bound to the server build, STOP: a random client pg_config is not evidence.
5. Determine active rules directory from that build:
   --with-system-tzdata=<absolute-directory> means that directory is selected;
   otherwise investigate the matching server's installed sharedir/timezone,
   accounting for relocation. Resolve directory symlinks. If build/path evidence
   is ambiguous, report UNKNOWN rather than claiming /usr/share/zoneinfo.
6. Inspect the active directory's tzdata.zi release header if present and package
   ownership/version using the image's EXISTING package manager (dpkg-query/rpm/
   apk as applicable). No install/update. A tzdata package version alone is NOT
   sufficient if PostgreSQL uses a separate bundled copy. Record how the marker
   or package is tied to the actual files; otherwise keep release UNKNOWN.
7. Fingerprint the active content without writing files. In the proven directory,
   with existing find/sort/xargs/sha256sum tools, a reproducible manifest is:
     manifest=$(find -L . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
     printf '%s\n' "$manifest"
     printf '%s\n' "$manifest" | sha256sum
   Paths are relative, ordering is C locale, final newline is specified, and -L
   hashes symlink-resolved bytes under their relative alias paths. Record symlink
   mappings/resolved roots separately and fail if any read/traversal fails.
   Use shell pipefail where supported; otherwise check every pipeline stage.
   Do not accept a partial manifest as evidence. If tools are absent, stop and
   propose a separately reviewed read-only extraction; do not install utilities.
   Retain file hashes for the four existing corpus zones and UTC in the manifest.
8. Record selected image/platform identity, binary/build config, resolved rules
   source, provable release OR reproducible fingerprint, and the finite corpus.
   Node rules and PostgreSQL rules need not have the same release name: existing
   paired assertions establish behavior only for the declared inputs.
9. Under SEPARATE database-runtime authorization, reuse the existing 12 cases,
   L1-08/09/11 and T10-01/02 against the inspected runtime. Do not launch them
   as part of this read-only image inspection. Revalidate that finite corpus on
   future runtime/rules upgrades; do not promise all-zone/all-version equivalence.

Documentation source for build-time rules selection:
https://www.postgresql.org/docs/17/install-make.html#CONFIGURE-OPTIONS-MISC
This procedure is a test-support comment, not an executable inspection script.
*/
