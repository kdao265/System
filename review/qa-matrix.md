# L1-05 acceptance / regression matrix — prepared, NOT executed on PostgreSQL

Source of authority: approved AO requirements AO-AC-01..24, ADR-024 G-01..06, architecture §9, L1 task contract. **Statuses below reflect scoped evidence from disposable runtime, not deployability.** A structural assertion or a partially executed scenario is never a full functional PASS. See the dated L1-08 execution ledger below.

| ID | Priority | Layer | Scenario and required evidence | Status |
|---|---|---|---|---|
| QA-01 | P0 | Migration | Fresh disposable Auth+PostgreSQL apply all historical migrations with unchanged checkpoint order; AO follows Library | PARTIAL — historical migration checkpoints PASS; AO SQL loaded guard-stripped **in memory** only, not migration file |
| QA-02 | P0 | Catalog | Exactly 10 tables, AO role NOLOGIN/NOBYPASSRLS, all rows RLS, restrictive configured-owner policies | PASS — disposable catalog (`ao-catalog.sql`) |
| QA-03 | P0 | Catalog | 13 mutation/7 read RPC fixed signatures, SECURITY DEFINER owner and search_path, PUBLIC/anon EXECUTE denied | PASS — catalog + 20 owner-scoped RPC signatures/ACL; Auth negative matrix |
| QA-04 | P0 | Catalog | Authenticated has no direct AO SELECT/INSERT/UPDATE/DELETE; executor no AO DELETE, no writes to Quest/Goal/EXP/Calendar/Library | PASS — catalog denies authenticated direct AO DML, AO executor DELETE, and residual full public non-AO DML privilege enumeration; L1-09/T-C exact external snapshots confirm no Quest/Goal/EXP/Calendar/Library side effects across representative mutations |
| QA-05 | P0 | Catalog | Legacy public RPC OID/signature/ACL/body, roles and old migrations preserved; no lingering borrowed membership | PASS — historical migration catalog and legacy public RPC checks |
| QA-06 | P0 | SQL/TS parity | Title-only Opportunity defaults, exactly 4 tracking stages and 6 selection outcomes, G-05 rejection matrix | PARTIAL — L1-10 48/48 stage transitions, T-A all six selection outcomes, uncommon warning-only Saved+Accepted/Closed+unknown and N/A hard reject PASS; full G-05 negative state corpus pending |
| QA-07 | P0 | SQL/TS parity | Title+explicit Activity intent; 4 creation intents, 6 statuses, no invented actual dates | PASS — four explicit Activity creation intents, six statuses and 36/36 status-action TS/SQL transitions verified; T-A historical completed/ended-early direct imports have exactly one creation event and no invented actual dates |
| QA-08 | P0 | SQL/TS parity | PartialDate unknown/year/month/day; leap years including 0001 and 9999; impossible dates and extraneous keys reject | PARTIAL — L1-09/10 Gregorian 0001/9999/leap/unknown/month/day and invalid shape tests; T-B partial interval overlap vs certain reverse owner wire parity PASS; full mutation-field/NULL matrix pending |
| QA-09 | P0 | G-01 | Source-clock unresolved date remains non-UTC; no invented timezone, no countdown on partial dates | PARTIAL — L1-08 unresolved source clock persists UTC-null; L1-09 Profile timezone update preserves accepted UTC; rendering/countdown behavior not end-to-end asserted |
| QA-10 | **BLOCKER** | G-01 | Instant deadline accepts exact supported UTC source; DST gap rejects; fold requires explicit offset; IANA offset contradiction rejects; no Profile timezone rewrite | PARTIAL — L1-08/09 and T-B support real owner UTC/DST and Profile timezone non-rewrite invariance; Batch A 12 paired SQL/TS cases PASS (Node 24.21.0/ICU 78.3/tzdb 2026c, PostgreSQL 17.6). PostgreSQL container tzdb release/cross-version reproducibility remains unverified; BLOCKER stays OPEN |
| QA-11 | P0 | G-02 | Unicode code points, Vietnamese/emoji, CRLF/LF, whitespace, URL syntax, ≤30 links; SQL/TS exact equivalence | PARTIAL — T-B distinct IDs with duplicate HTTPS URL/order retained, label length 120/121, userinfo/whitespace/control/overlong URL rejection PASS; complete field-length/Unicode boundary matrix pending |
| QA-12 | P0 | SQL | Direct invalid state and null/overflow JSONB rejects, constraints not merely client-side | PARTIAL — residual nine + Batch A 29 more direct disposable PostgreSQL root SQL CHECK/NOT NULL/JSONB wrong-shape/overflow negatives preserve roots, history and external-domain snapshots; independent complete constraints/field coverage review remains OPEN |
| QA-13 | P0 | Wire | Command idempotency exact replay after newer revision; conflicting command ID rejects; receipt immutable | PASS — replay after newer revision and conflicting command identity via RPC |
| QA-14 | P0 | Wire | Accepted no-op leaves root revision/updated_at unchanged but stores a recoverable command receipt | PASS — L1-09 Opportunity and Activity accepted no-ops preserve full root including updated_at/revision/history; accepted receipt, immutable replay confirmed |
| QA-15 | P0 | Wire | New stale revision rejects, no state/EXP/history change | PASS — L1-09 stale Opportunity revision rejects with unchanged root/history/receipt/legacy-domain snapshots; existing L1-07 two-session revision race verified |
| QA-16 | P0 | Wire | Create vs concurrent create same subject and same command, exactly one accepted logical action | PASS — independently authenticated concurrent create/replay, single root and receipt |
| QA-17 | P0 | Wire | Response committed but HTTP response lost; resolve receipt finds accepted; retry exact command does not duplicate changes | PASS — dropped committed HTTP response, resolve and exact replay |
| QA-18 | P0 | Wire | Receipt absent = unknown, never definitive rollback; archive+read+restore with revision guards | PASS — L1-09 unknown command receipt remains unknown; Opportunity and Activity archive/read/idempotent archive/stale restore/successful restore with revision guards |
| QA-19 | P0 | SQL/wire | Correct Opportunity `advance` forward only, correction annotated, Close reason/Other note, Reopen semantics | PARTIAL — L1-10 48/48 stage matrix; T-A seven Closed reasons, Other note normalization/missing-note rejection, Reopen and late new-decision versus correction history PASS; full negative/annotation matrix pending |
| QA-20 | P0 | SQL/wire | Activity state transitions, Correct Status, terminal correction, actual vs planned times | PARTIAL — L1-10 36/36 transitions, actual date corrections and T-A historical imports pass; complete planned/actual cross-field mutation and history matrix pending |
| QA-21 | P0 | SQL | Five relationship tables: exact same-owner composite FKs, partial unique active pair, retained intervals, immutable timestamps | PASS — all five same-owner FK/current-unique/immutable interval SQL negatives in L1-10; residual four N:N detach/reattach produce fresh link IDs, retained intervals, expected revision/history/no-op and unchanged external-domain snapshots; source provenance interval lifecycle in T-C |
| QA-22 | P0 | Wire | Source Opportunity provenance 0..1 current, replacement keeps audit; archived source prohibits fresh link | PASS — L1-08 source S1→S2, stale and archived destination rejects; T-C source S2→none→S1 retains three distinct interval IDs with one current, existing source survives archive and Opportunity metadata changes never synchronize to Activity |
| QA-23 | P0 | Wire | Four contextual typed N:N attach/detach only eligible Goal/one-off Quest; no membership or progress side effect | PARTIAL — L1-08 four typed links, Residual P0 Goal/owner/archive guards; Batch A eight Quest ineligible target denies (archived, deleted, recurring, direct-goal-bound × Opportunity/Activity) with unchanged AO roots/history/receipts/external domains; both eligible Quest attach forms PASS. Project-bound Quest/occurrence metadata and target-side negative matrix remain OPEN |
| QA-24 | P0 | Race | Two concurrent owner transactions: AO attach vs Quest Delete; both owner-lock orders; existing AO link does not prevent Quest Delete | PASS — two observed PostgreSQL advisory owner-lock queue orders, attach/Quest Delete |
| QA-25 | P0 | Race | AO attach vs Goal Archive / AO source Archive; both orders and no deadlock | PASS — observed lock-queue orders for Goal Archive and source Opportunity Archive |
| QA-26 | P0 | Race | Link L1 detach/reattach→L2; late exact L1 retry must NOT detach L2 | PASS — old L1 detach replay does not remove newer L2 |
| QA-27 | P0 | Privacy | Deleted Quest projection is neutral placeholder in AO detail, candidates, history, errors, receipts, source/derived list | PASS — tested allowlisted detail/list/history/candidate/source/receipt/error surfaces redact deleted Quest |
| QA-28 | P0 | Privacy | Non-owner/anon/missing owner configuration: all AO writes, reads, candidate search and resolution fail closed | PASS — 20 AO RPCs reject nonowner/anon and all clients when owner config is absent |
| QA-29 | P1 | Reads | Root lists 50 default/100 max; invalid NULL, cursor and filter reject; 51+ filtered results paginate exhaustively | PASS — 63+63 filtered rows, 50/100 limits and invalid filter/limit cases |
| QA-30 | P1 | Reads | 6 decimal microsecond timestamp cursor order, ties broken by UUID, no repeat/drop across pages | PASS — microsecond cursor and UUID tie-breaker across 63-row pages |
| QA-31 | P1 | Reads | History immutable with stable pagination; source-derived Activities beyond first page still accessible | PASS — 54 immutable history entries and 63 linked Activity continuation |
| QA-32 | P0 | Regression | Before/after snapshots prove AO does not modify Quest, Goals/goal_quest_links, EXP, Calendar, Library | PARTIAL — L1-09/T-C snapshots plus residual exact cross-domain snapshots after all four N:N reattachments and rejected direct SQL; not all failure/race variants enumerated |
| QA-33 | P0 | Regression | ADR-015 legacy catalogue/wire assertions remain at historical checkpoints, no weakening/reordering | PASS — legacy checkpoints/public RPC identity, ACL, and signature regressions |
| QA-34 | P0 | Security | Guarded SQL functions cannot be invoked through anon/Public or used to expose `system_internal` schema | PASS — authenticated/anon raw table denies and internal schemas not exposed |
| QA-35 | P0 | Deployment gate | No local/cloud migration, no PR/merge/deploy without independent PO permission | ENFORCED BY WORKFLOW |

**Fail-closed rule:** Any P0 failure, unexecuted QA-10, uncontrolled DB target, altered legacy ACL/role or privacy exposure blocks migration readiness. SQLSTATE and real multi-session behavior must come from actual PostgreSQL, never regex inspections.


## F-01/F-02 corrective QA addendum — NOT RUN on database

These are supplemental to the 35 L1 acceptance scenarios, and do not replace the concurrency/privacy/legacy gates.

| QA ID | Disposable DB/wire scenario | Expected |
| --- | --- | --- |
| QA-F01-1 | `list_opportunities_v1` owner active/archived with title, category, organization, stage and outcome | Exact allowlisted metadata is present; long/private notes and Quest rows absent |
| QA-F01-2 | `list_activities_v1` owner active/archived with title, category, organization and status | Exact allowlisted metadata is present; no notes/description |
| QA-F01-3 | Synthetic two-page filtered lists | Cursor from filtered result, strict DTO and microsecond sort order; no hidden extra values |
| QA-F01-4 | Non-owner/anon list attempts and deleted-Quest-linked roots | No cross-owner results, no deleted Quest title/status/reward/description |
| QA-F02-1 | Create optional PartialDate, clear `decision_at` via `record_opportunity_outcome_v1` explicit JSON `null` | Stored SQL NULL, increased revision on effective change, history/receipt agree |
| QA-F02-2 | Repeat already-cleared `decision_at` with new command ID | `changed=false`, no revision/history mutation, receipt accepted |
| QA-F02-3 | Set and clear `actual_start` and `actual_end` via `correct_activity_status_v1` | SQL NULL persisted and Activity invariants maintained |
| QA-F02-4 | Repeat cleared actual dates with new command ID, and replay previously accepted command | No-op unchanged revision / stable historical replay result; no side effects |
| QA-F02-5 | Omitted fields vs explicit JSON `null` vs malformed date object | Omitted preserves data, null clears, malformed rejects atomically |

**Status:** SQL catalog/value tests and PostgREST scenarios are only **prepared**, not executed. `review/static-preflight.test.mjs` includes source-level guards and synthetic negative mutation controls; it is not a substitute for these wire tests.


## R-01–R-05 follow-up regression gates — NOT RUN on PostgreSQL

| QA ID | Scenario | Required result | Status |
| --- | --- | --- | --- |
| QA-R01-1 | Create Closed Opportunity with 2-line `closed_note` in CRLF | Canonical LF persisted; same max 2000 Unicode code points as TS | NOT RUN |
| QA-R01-2 | Set Closed stage with multiline `closed_note` | SQL normalizes CRLF/CR to LF before comparison/write; replay retains receipt | NOT RUN |
| QA-R02-1 | Create Activity with multiline `confirmation_note` | SQL root CHECK accepts canonical LF; overlimit rejected | NOT RUN |
| QA-R03-1 | Opportunity detail has no derived Activities, exactly 50, 51+ across active & archived | `items` size <=50; `has_more` correct; continuation points to both scopes | NOT RUN |
| QA-R03-2 | Follow continuation from 51+ derived Activities | `list_activities_v1` `source_opportunity_id` + separate active and archived keyset pagination retrieves all without omission/duplicate | NOT RUN |
| QA-R04-1 | `source_opportunity_id` malformed, wrong type, extra filter | Stable SQLSTATE 22023, never raw UUID cast error or broad list | NOT RUN |
| QA-R05-1 | Date cursor invalid civil date/offset, UUID malformed, high precision microseconds | Stable SQLSTATE 22023; ordering and page boundaries not reinterpreted by session timezone | NOT RUN |
| QA-R05-2 | In new security and catalog sessions, compare callable RPC privileges, deleted Quest labels and owner lock races | No leak, deadlock or cross-domain write | NOT RUN |

**Static checks and pure TypeScript unit tests do not satisfy these PostgreSQL acceptance gates.**


## R-06–R-10 offline repair and mandatory runtime gates

| ID | Source of truth | Expected assertion | State |
| --- | --- | --- | --- |
| QA-R06-1 | Activity correction + history | Effective Correct Status with allowlisted reason retains `reason` in the immutable event returned by `list_ao_history_v1`; no deleted Quest data exposed | WRITTEN — NOT RUN on PostgreSQL |
| QA-R07-1 | Stage correction/replay | CRLF/LF-equivalent Closed note with same command ID resolves to replay of original receipt; different normalized meaning collides `23505` | WRITTEN — NOT RUN on PostgreSQL |
| QA-R08-1 | Deadline UTC bounds | Source 0001/9999 with offset crossing outside UTC 0001..9999 rejects; valid boundary-derived instants accepted; timezone parity separately verified | TypeScript unit + SQL fixtures written, SQL NOT RUN |
| QA-R09-1 | AO disposable harness | AO installs after Library on fixture-owned ephemeral PostgreSQL; old historical regression checkpoint unchanged; no external connection possible | Runner prepared, NOT RUN |
| QA-R10-1 | QA matrix version | QA-10 describes drafted resolver separately from review-only blocker/runtime state | Editorial check |

**Gate remains CLOSED:** No AO migration may be placed under `supabase/migrations`, committed as executable SQL, deployed or declared runtime-ready until explicit owner approval and full disposable PostgreSQL/Auth/PostgREST QA (including two-session races and Deleted Quest safety) passes.

## L1-08 execution ledger — 2026-10-11 (disposable, pre-release)

- **Candidate:** [draft PR #59](https://github.com/kdao265/System/pull/59), test branch at `d97a245c085ef50491bd60f669588607995b7ac4`; AO SQL checksum remains pinned. No historical migration changes, Cloud access, merge, or deployment.
- **Prior verified baseline:** [L1-07 Final Hardening AO PASS](https://github.com/kdao265/System/actions/runs/38117586565) for actual Auth/PostgREST/PG owner, RLS, deleted-Quest privacy, keyset, linked history, and observed advisory wait queue. [Playwright E2E PASS](https://github.com/kdao265/System/actions/runs/38117586656), [Quest Creation PASS](https://github.com/kdao265/System/actions/runs/38117586613) on `f6d4677`.
- **L1-08 new test run:** [AO Disposable QA, run 38134152597](https://github.com/kdao265/System/actions/runs/38134152597) **FAILED**. `QA-10` owner-authenticated UTC trigger/unresolved-source/DST fold+gap/UTC underflow/wrong-offset/rollback **PASS**. Opportunity lifecycle assertions ran before the Activity transition failure. **QA-20 BLOCKER:** `transition_activity_v1` returned PostgreSQL `42883: operator does not exist: text ->> unknown`.
- **Source diagnosis (not a change approval):** review-only SQL `system_internal.ao_run_v1` contains `v_status:=CASE v_activity.status ||':'|| p_req->>'action'`. PostgreSQL operator precedence can bind the JSON extraction to a concatenated `text` expression; parenthesizing `(p_req->>'action')` is the proposed scoped repair. This was **not performed** under L1-08 approval.
- **Not executed due to fail-fast:** later L1-08 Activity state transitions/corrections, all four contextual link variants/source replacement, and additional invalid JSON/filter/cursor cases. Tests in the repository alone are **not PASS** until their runtime assertions execute.
- **Release gate:** CLOSED. A separate Product Owner approval is required for any review-only SQL business/runtime repair. Then update the SHA-256 pin, rerun AO disposable and regressions, reassess full QA gaps, and only later seek independent merge/deployment decisions.

**Evidence interpretation:** `PASS` applies only to exact scenarios proved by CI; `PARTIAL` means the full row is **not** signed off. Previously written addenda marked NOT RUN may have individual coverage in later runs, but they require their own row-by-row evidence audit before being reclassified.


## L1-09 Final Acceptance Coverage — scoped execution evidence, 2026-10-11

- **Runner head:** [`2dfacd8`](https://github.com/kdao265/System/commit/2dfacd843c137b2c7aa7a3f416f1cf41dc7ffb12). [AO Disposable QA PASS](https://github.com/kdao265/System/actions/runs/38137477176), real PostgreSQL 17 / Auth / PostgREST on isolated loopback + tmpfs test database. SQL review guard and SHA pin unchanged; no migrations or production connectivity.
- **QA-14/15/18:** Opportunity and Activity no-op preserve root revision, timestamp and history; accepted command receipt and replay; stale optimistic revision rejection leaves roots, receipts, history, and external domains unchanged; unknown receipt is not treated as rollback; both root kinds archive/no-op/stale restore/restore successfully. These specific matrix rows are marked PASS.
- **QA-09/10:** Changing the disposable owner's Profile timezone to `Asia/Tokyo` does not alter an accepted DST-resolved Opportunity UTC deadline, including after an unrelated Opportunity metadata edit; Profile timezone restored in `finally`.
- **QA-06/07/08/11:** Sample TypeScript vs PostgreSQL owner wire parity for Opportunity creation, Vietnamese/emoji and CRLF normalization, Activity intent mapping, unknown/year/leap-day PartialDates, and selected invalid G-05/partial-date cases. This does **not** mean exhaustive SQL/TS parity.
- **QA-04/23/32:** Exact external-domain snapshots around AO-only Opportunity/Activity mutations, typed Goal/Quest context links and Activity provenance show no Quest/Goal/EXP/Calendar/Library changes. Specific legacy Quest/Goal fixture setup happens **before** the snapshot to avoid treating authorized fixture creation as AO side effects.
- **Test-only correction:** initial [run 38137313625](https://github.com/kdao265/System/actions/runs/38137313625) failed on numeric vs string revision assertion (`3 !== '3'`); corrected assertion at `2dfacd8` and successfully rerun. This was not an SQL defect.
- **Outstanding release blockers:** other P0 rows marked PARTIAL, exhaustive lifecycle/SQL-TS parity/cross-domain mutation coverage, independent migration packaging review, and explicit Product Owner merge/deployment approval. **QA-35 deployment gate is unchanged and CLOSED.**

**Status policy:** PASS on a row requires evidence for its stated acceptance conditions; PARTIAL remains unapproved even where tested subcases pass. Old ledgers are historical execution records, not the latest status.


## L1-10 Remaining P0 Acceptance Closure — 2026-10-11

- [AO Disposable run 38140670833](https://github.com/kdao265/System/actions/runs/38140670833) **PASS**, code head `0adb77025d3ee349ddec64c6f82c4e2093aac2e1`; test fixture-only Auth/PostgREST/Postgres; release SQL and checksum unmodified.
- **QA-06/19:** 48 Opportunity current stage × intent × target combinations verified against TypeScript model and real RPC, including rejected transitions.
- **QA-07/20:** 36 Activity current status × action combinations verified against TypeScript model and real RPC. Correction actual date set/no-op/clear, preservation of omitted fields, upcoming invariant rejection verified.
- **QA-08/11/12:** six accepted and seven rejected owner-authenticated date/resource/text cases (including 30/31 links, duplicate URL identifiers, HTTPS, leap/calendar bounds). Prior tests remain cumulative; not a full SQL/TS fuzz corpus.
- **QA-21:** all five link tables checked directly in isolated PostgreSQL for mismatched-owner composite FKs, unique current links, immutable attached time, DELETE denial, and detached interval immutability. All direct SQL attempts are inside the throwaway harness; no Cloud DB.
- **Release posture:** still PARTIAL for these eight matrix rows because untested criteria remain; QA-01 migration packaging is specifically outside current test-only approval. QA-35 gate remains CLOSED. No AO SQL edits, migration promotion, merge, or deploy.


## L1-11 bounded T-A/T-B/T-C execution — 2026-10-12

- **Candidate code HEAD:** `ae22402f6d24fd11f2f99e2fecff7dc31da01566`; [AO disposable CI run 38159772447](https://github.com/kdao265/System/actions/runs/38159772447) **PASS**. Auth/PostgREST/PostgreSQL on fixture-owned loopback/tmpfs; no active SQL migration/cloud database involved.
- **T-A:** Six Outcome enums, N/A hard reject and uncommon warning-only accepted states; all seven Closed Reasons with Other note and Reopen audit; distinct late `new_decision` versus `correction` history; Activity historical completed/early-ended import has exactly one creation event and null actual dates.
- **T-B:** TypeScript `parseDeadline` versus owner-authenticated PostgreSQL acceptance/rejection and exact UTC comparisons for DST fold both offsets, gap, inconsistent offset, civil-year UTC underflow/overflow, unresolved and year precision. Additional PartialDate certainty/overlap, 120/121 labels, duplicate HTTPS URLs with distinct resource identities/order, userinfo/URL control/overflow, and rejected update atomicity.
- **T-C:** Activity source S1→S2→none→S1 produces three distinct retained intervals with exactly one current; archived source and Opportunity metadata do not rewrite current source membership/Activity fields. Completed Activity linked to eligible Quest; new AO Goal link and stage/outcome/Activity status/restore followed by exact Quest/Goal/EXP/Calendar/Library snapshot parity; other-owner attach denied.
- **Row decisions:** QA-07 and QA-22 upgraded to PASS because their stated acceptance criteria are covered by cumulative L1-07..L1-11 evidence; other changed rows remain PARTIAL for explicitly listed residual cases. **QA-01 migration and QA-09 unresolved-clock UI behavior require separate phase/permission; QA-35 remains closed.**
- **Non-claim:** AO CI PASS on `ae22402` does not imply new docs HEAD Playwright/Quest CI PASS; confirm all three workflows separately. No SQL business modification, checksum pin, merge, or deploy.


## Residual P0 Closure — disposable test-only run 2026-10-12

- **Source code commit:** `d8c7a6e3d2794c0476b312a588fd2f7454acc5be`; [AO disposable run 38163498674](https://github.com/kdao265/System/actions/runs/38163498674) **PASS**. Pinned review-only SQL was applied exclusively in-memory on loopback/tmpfs. No product SQL/migration change.
- **QA-04:** enumerate every public regular/partitioned table outside AO for `ao_command_owner` INSERT/UPDATE/DELETE privilege. All prohibited DML grants absent. Cumulative catalog deny and mutation snapshots complete the row's stated SQL/Wire coverage.
- **QA-12:** nine directly rejected PostgreSQL DML attempts on Opportunity/Activity, including invalid state, SQL NULL, JSONB null, resource URL, revision, planned/actual ordering and bigint overflow; roots/history and all external-domain snapshots unchanged after each. The row stays PARTIAL for untested forms.
- **QA-21:** four typed Goal/Quest relationship variants detach/reattach via owner RPC, each preserving two historical link IDs, one live link, sequence/revision, immutable event history and no-op; previously five-table composite FK, uniqueness, immutability checks and Activity source intervals passed. Row upgraded to PASS.
- **QA-23:** archived/missing Goal, nonowner and archived AO source denies pass; Quest recurring/archived/goal-bound/deleted eligibility still not fully tested. Remains PARTIAL.
- **Evidence handling:** QA-04 and QA-21 upgraded on cumulative direct SQL and owner RPC runtime tests; QA-12/23/32 kept PARTIAL. QA-01 and UI QA-09 remain separate gates; QA-35 closed, no deploy/merge permission.


## Batch A — QA-10/12/23 disposable evidence, 2026-10-12

- **Executed source HEAD:** `8172ddd82fa7262adf39a97710edca89715f4620` · [AO disposable runtime PASS](https://github.com/kdao265/System/actions/runs/38169761621). Batch A harness `supabase/tests/helpers/ao-batch-a-p0.mjs`; only disposable owner Profile timezone configured via authenticated RLS for a synthetic recurring Quest fixture. In-memory review SQL digest/guard unchanged; no production DB, migration, or SQL business edit.
- **QA-10:** twelve paired Node `parseDeadline` and PostgreSQL/owner-RPC exact UTC/DST acceptance/rejection cases for New York winter/summer/gap/folds/wrong offset; Berlin winter/summer/gap; Ho Chi Minh; Auckland summer/winter. Runtime log: Node `24.21.0`, ICU `78.3`, Node tzdb `2026c`; PostgreSQL `17.6`, server timezone `UTC`, 1196 named zones. **Not** PostgreSQL tzdb release fingerprint or a guarantee of cross-version parity; blocker remains PARTIAL.
- **QA-12:** 29 additional direct PostgreSQL malformed JSONB/date/resource, SQL NULL, state/shape checks; SQLSTATE-specific failures; no AO root/history/external mutation. Cumulative evidence is strong but full constraint-to-fixture traceability is not yet signed off; remains PARTIAL.
- **QA-23:** archived/deleted/recurring/direct-goal-bound synthetic Quest, each rejected for both Opportunity and Activity with retained root/history/no command receipt and no Quest/Goal/EXP/Calendar/Library mutations; eligible one-off succeeds in both kinds; nonowner denied. Project-bound and damaged occurrence metadata states not independently tested; remains PARTIAL.
- **Important:** 23 PASS / 11 PARTIAL / QA-35 gate CLOSED; this evidence ledger does not silently promote any row. Quest Creation and Playwright on the documentation HEAD must be checked separately before 3/3 CI green claims.
