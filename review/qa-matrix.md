# AO V1 acceptance / regression matrix — scoped disposable runtime evidence; release gate CLOSED

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
| QA-11 | P0 | G-02 | Unicode code points, Vietnamese/emoji, CRLF/LF, whitespace, URL syntax, ≤30 links; SQL/TS exact equivalence | PARTIAL — QA-11-B01 resource-label normalization parity VERIFIED in disposable PostgreSQL on `7ee1ff2`: four owner Create/Update paths accept/canonicalize raw Unicode boundary whitespace; 140 boundary RPC fixtures pass (40 accepted, 100 rejected with state unchanged); four replay/collision/stale/no-op integrity sequences and two strict direct SQL CHECK rejections pass. Existing T-B coverage is retained. Exhaustive per-field code-point limit−1/limit/limit+1 and remaining SQL/TS field parity cases are not signed off. |
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

## Batch B preparation — STOPPED for QA-11 parity review, 2026-10-12

**PENDING evidence, not PostgreSQL PASS.** Task: bounded test-only preparation for QA-06/08/11/19/20 under approved AO Requirements, ADR-024 and Architecture. Only the new Batch B helper, its runner import/invocation, workflow path trigger and this appended ledger are authorized. No product SQL, pin/guard, migration, permission, dependency, production access, commit, push, merge or deployment changes. Existing acceptance statuses and historical suites remain unchanged.

### Workspace and baseline

- Verified `origin`: `https://github.com/kdao265/System`; fetched `refs/heads/test/ao-l1-06-disposable-qa` and confirmed `1da8b3bf23e9ea1e8b5d4e610672d1f179eb7e30`.
- Separate worktree: `D:/System-ao-batch-b`; local branch `codex/ao-batch-b`; HEAD is the same exact approved SHA. Clean before preparation. No remote branch modification.
- Original `D:/System` remains detached at `d380133804704552e2ed8969570210663c486dce`; untracked `.vscode/settings.json` preserved and not read or edited.
- Added, untracked: `supabase/tests/helpers/ao-batch-b-p0.mjs`. Modified: `supabase/tests/ao-review-disposable-wire.mjs` (import/invoke only), `.github/workflows/ao-l1-06-disposable.yml` (one path trigger only), `review/qa-matrix.md` (this append only).

### Coverage inventory performed before implementation

Existing evidence below is the baseline repository's recorded evidence, not rerun runtime evidence from this task. Helper locations are under `supabase/tests/helpers/`.

| QA | Existing assertions (preserved) | Genuinely missing Batch B dimensions / disposition |
| --- | --- | --- |
| QA-06 | `ao-l1-09-final-acceptance.mjs:modelParity`: defaults/sample G-05 invalid state. `ao-l1-10-p0-closure.mjs:stageMatrix`: 48 stage/kind/target cases. `ao-l1-11-tabs.mjs:testA`: six outcomes, N/A+Unknown, N/A+Accepted rejection, Saved+Accepted and Declined+Unknown acceptance. | All five non-Unknown outcomes against N/A on create/outcome paths; invalid enum corpus on relevant mutation paths; Invitation/Direct Access+Submitted; warnings after mutations. **Not added: stopped for QA-11 review.** |
| QA-08 | L1-09 Gregorian/year/leap/unknown cases; L1-10 min/max civil days/month/extra keys; L1-11 `testB` five Activity interval pairs and rejected reversed Opportunity update; `ao-wire.mjs` F-02 decision/actual JSON-null corrections; Batch A `directJsonConstraints` 22 direct partial-date rejects across two roots. | Complete finite mutation-field corpus for both roots; omitted/null/Unknown distinctions on each permitted date path; exact rejected-write root/history/receipt snapshots. **Not added.** Existing F-02 addendum distinguishes omitted preservation, JSON null to SQL NULL, and strict malformed-date rejection; do not collapse Unknown JSON into SQL NULL. |
| QA-11 | L1-09 Vietnamese/emoji sample; L1-10 create 30/31 resources, duplicate UUID/insecure URL, multiline sample; L1-11 `testB` labels 120/121, duplicate URLs with distinct UUID/order, userinfo/space/control/overlong URL rejects. Domain tests cover pure normalization. | Complete per-field code-point limit-1/limit/limit+1; exact 2048/2049 URL; update rollback corpus; raw resource-label whitespace parity. **Only QA-11-B01 reproduction below added, then STOP.** |
| QA-19 | L1-10 full 48 transitions; L1-11 seven Closed Reasons, Other note normalization/missing note, reopening to Saved with clearing, late new_decision/correction event-type presence; `ao-wire.mjs` R-07 normalized Closed-note replay/collision. | Rich before/after audit retention, invalid annotation combinations, exact SQLSTATE and atomic stale/invalid lifecycle snapshots. **Not added; no duplicate transition matrix.** |
| QA-20 | L1-10 full 36 status/actions plus actual set/no-op/clear and Upcoming invariant; L1-11 direct terminal imports with one event/no invented dates; wire F-02/R-06 clears actual dates and retains correction reason. | Independent planned/actual field mutations with exact history; retained terminal before/after; incompatible actual dates for Cancelled Before Start; correction no-op/invalid/stale receipts and full atomic snapshots. **Not added; explicit creation intent retained in new fixtures.** |

### QA-11-B01 source-level discrepancy and minimal reproduction

Authority: Requirements AO-FR-19 and AO-AC-20; Architecture sections 3.3/3.4 require consistent app/SQL Unicode boundary normalization. TypeScript `parseResourceLinks` calls `normalizeText(..., required=true)` and returns the trimmed label. In the pinned SQL, `ao_fields_v1` passes the raw resource array directly to `ao_resources_valid_v1`; that function calls `ao_text_valid_v1(label_value,120,true,false)`. Its single-line branch requires `value = ao_trim_v1(value)`. It rejects a padded label rather than normalizing it.

Minimal synthetic `p_changes` for owner-authenticated `update_opportunity_v1` or `update_activity_v1` (current revision 1, retained UUID and fresh command UUID):

```json
{"resource_links":[{"id":"11111111-1111-4111-8111-111111111111","label":"\u00a0Tài liệu 😀\u3000","url":"https://example.org/resource"}]}
```

Seed the root with the same resource ID/URL and label `Original`. For create, use the same raw collection plus title; Activity also requires `intent=confirmed_plan`.

- **Expected:** both model and owner RPC accept, store label `Tài liệu 😀`, retain UUID/URL/order, and produce correct revision/history/receipt without external-domain changes.
- **Observed offline:** TypeScript accepts and returns the trimmed label on all four root/create-update combinations under Node 24.18.1.
- **SQL source inference:** raw input reaches the strict label validator and the `Invalid AO resource links` branch, predicting SQLSTATE **22023**. **No PostgreSQL response or SQLSTATE has been observed in this task.** Independent approved CI reproduction remains required.
- **Prepared regression:** `exerciseAoBatchB` sends the raw input (never substitutes model-normalized data). All four create/update cases are evaluated independently, in sequence: Opportunity update/create, Activity update/create. Each case separately reports its actual RPC response and snapshot-check outcomes; setup failures explicitly identify cases whose target RPC was not reached. A case failure does not conceal the remaining case reports.
- Rejected or uncertain responses retain strict comparisons of the full root (including resources/revision/timestamps), all subject history and command records, and exact Quest/occurrence/event/recurrence/Goal/membership/EXP/Calendar/Library snapshots. Accepted paths verify canonical stored collection, revision, before/after history and persisted receipt. Response evidence and invariant-check failures are reported separately.
- **Diagnostic classification:** the predicted HTTP `400` / SQLSTATE `22023` / `Invalid AO resource links` response is classified as a suspected normalization divergence, never a successful acceptance test. Unrelated PostgreSQL/authorization/transport errors, uncertain RPC exceptions, harness failures and incomplete execution are distinguished. No classification implies observed PostgreSQL evidence before CI actually executes it.
- **Overall result:** after collecting all four case reports, the diagnostic fails if any case diverges, any invariant check fails, or any case is incomplete. Acceptance still requires canonicalizing the raw boundary-whitespace label consistently with TypeScript; no expected-failure marker, skip or weakened assertion is used. PostgreSQL behavior remains unverified until isolated CI produces runtime evidence.
- **Stop rule applied:** broader Batch B implementation stopped when this source-level discrepancy was identified. No SQL repair or new interpretation of the product contract was attempted. This is a reviewable blocker reproduction, **not a complete Batch B implementation**.

### Per-QA result and verification

| Case | Expected behavior | Observed result / evidence |
| --- | --- | --- |
| QA-06 additional G-05 corpus | Hard invariants reject; warning-only combinations accepted on relevant writes | NOT IMPLEMENTED / NOT RUN; existing evidence above preserved |
| QA-08 additional mutation integrity | Preserve omission, distinguish null and Unknown, validate calendar/order atomically | NOT IMPLEMENTED / NOT RUN |
| QA-11-B01 four model fixtures | Padded Vietnamese/emoji label accepted and trimmed | Offline 4/4 model fixtures passed; `verifyAoBatchBModelFixtures()` returns explicitly TypeScript-only evidence |
| QA-11-B01 four SQL/RPC counterparts | Same acceptance/canonical value with audit and atomicity | PREPARED / NOT RUN; source predicts 22023 discrepancy, no runtime PASS claimed |
| QA-11 remaining boundaries | Exact field/URL/array boundaries and rejected replacement rollback | NOT IMPLEMENTED / NOT RUN beyond preserved baseline cases |
| QA-19 additional annotations/negatives | Correct audit types and immutable snapshots; stale/invalid writes atomic | NOT IMPLEMENTED / NOT RUN |
| QA-20 additional temporal corrections | Correct independent dates/status/history/receipt behavior | NOT IMPLEMENTED / NOT RUN |

Executed safe checks:

- `node --test review/static-preflight.test.mjs`: **31 passed, 1 failed**. Existing `R-05 negative mutation: IMMUTABLE cursor rejected` fails with `Missing expected exception`. The mutation string uses literal LF, while `core.autocrlf=true` checked out the unchanged SQL as CRLF (`git ls-files --eol`: `i/lf w/crlf`). Read-only inspection confirmed the replacement matches the HEAD Git blob but not the working-tree string. Neither the existing test nor SQL was edited to hide the failure.
- `node --experimental-strip-types --test tests/activities-opportunities-domain.test.mjs`: **15 passed, 0 failed**.
- `node --check` on the new helper and existing runner: **passed**.
- Offline import and `verifyAoBatchBModelFixtures()`: **4 model cases passed**, no database/client/harness started.
- `python3 review/g01-static-audit.py`: **could not execute**, command not found; no Python dependency was installed.
- Scoped ESLint attempted using the already installed `D:/System/node_modules/eslint/bin/eslint.js` and original repository configuration on the two changed JavaScript files; the bounded verification attempt **timed out after 45 seconds** (`ETIMEDOUT`/`SIGTERM`). No lint PASS claimed, no new dependencies installed. An earlier unbounded attempt was interrupted and is not acceptance evidence.
- `git diff --check`: **passed**; tracked diff reviewed and new untracked helper inspected separately. Protected paths remain unchanged.

Protected-artifact verification: `git diff --exit-code HEAD -- review/sql supabase/migrations src/features/activities-opportunities/model.ts review/static-preflight.test.mjs` passed. HEAD SQL blob SHA-256 still `0daadcb0c458d5a6ce558510535397624cb64ee0b9aea4bb267ee5389f1a33f5`, matching the unchanged runner pin. The Windows checkout raw-byte hash differs solely due to automatic CRLF conversion; this was verified read-only and not repaired or repinned. The local disposable runner was not launched.

No runtime suite, database query, cloud access, AO/Quest/Playwright workflow or full application build/typecheck was run. The isolated worktree has no installed dependencies; no dependency files changed. Runtime acceptance, full Batch B coverage and all three workflows on one eventual final committed HEAD remain outstanding.

**Recommended next decision:** independently review QA-11-B01 and authorize its diagnostic commit/push to the existing Draft PR if desired, so it can execute only in the already approved isolated CI environment. Any business SQL repair or revised normalization contract requires separate PO approval. Then resume remaining Batch B cases under an explicitly verified baseline. Existing QA statuses, migration gate and release/merge/deployment restrictions remain unchanged.

## Batch B — QA-11-B01 verified repair, 2026-10-12 (disposable CI Round 2)

**Scope:** This ledger supersedes only the *then-pending* QA-11-B01 claims in the historical Batch B preparation notes. It verifies one TypeScript/PostgreSQL resource-label subcase, **not** the whole Batch B, QA-11, migration packaging, 35-row QA matrix or release readiness.

**Diagnosis:** On commit `fcea57c8271e94a786c33df7468ccfcc7c5f4d74`, [AO disposable run 38261531018](https://github.com/kdao265/System/actions/runs/38261531018) observed HTTP `400` / SQLSTATE `22023` / `Invalid AO resource links` for all four Opportunity/Activity Create/Update owner RPCs with raw `\u00a0Tài liệu 😀\u3000` labels, while TypeScript accepted/trimmed them. Rejected-state snapshot checks passed; the former source-level prediction was confirmed in PostgreSQL.

**Verified repair source:** [commit `7ee1ff24a9533471645966082f0054c6d69322c6`](https://github.com/kdao265/System/commit/7ee1ff24a9533471645966082f0054c6d69322c6) on Draft [PR #59](https://github.com/kdao265/System/pull/59). Only guarded review-only SQL, the Batch B helper and the pinned disposable runner checksum changed. Canonical-LF SQL SHA-256: `81c8823c1b0a24b2a34ca845fc22323114fb59b7d93a64b48dda526cb6eaa899`. Checked-in abort guard remains; its removal for execution occurs **only in memory** in the approved fixture-owned loopback/tmpfs CI. No migration, Cloud DB, merge or deploy.

**Same-commit CI results:**

| Workflow | Run | Verified result |
| --- | --- | --- |
| [AO L1-06 disposable QA](https://github.com/kdao265/System/actions/runs/38278904435) | `38278904435` | PASS |
| [Quest Creation CI](https://github.com/kdao265/System/actions/runs/38278904430) | `38278904430` | PASS |
| [Playwright E2E](https://github.com/kdao265/System/actions/runs/38278904298) | `38278904298` | PASS — 68/68 |

**Observed owner RPC evidence:** The four original QA-11-B01 Opportunity Update/Create and Activity Update/Create cases returned HTTP `200`, stored canonical `Tài liệu 😀`, and passed revision, immutable before/after history, persisted receipt and external-domain snapshot assertions.

**Boundary corpus:** All 140 PostgreSQL owner RPC cases were logged and passed: 35 fixtures × 4 operations, with 40 accepted and canonically persisted, 100 rejected with expected error and unchanged subject/external snapshots. Tested Unicode trim/code-point boundaries, URL length 2047/2048 vs 2049, 30 vs 31 links, invalid labels/IDs/URLs/JSON shapes, and link identity/order. Separate 144 TypeScript model cases passed offline but are not used as substitutes for SQL evidence.

**Command integrity:** Four create/update replay/collision/stale/no-op sequences passed. Raw/canonical-equivalent command IDs return immutable historical receipts after newer writes; changed canonical label/URL/UUID/order collides, fresh stale revision rejects, equivalent fresh no-op keeps revision/timestamps/history unchanged and stores a receipt. Required complete root/history/commands and Quest/Goal/EXP/Calendar/Library snapshots were asserted.

**Direct SQL CHECK:** Direct noncanonical resource-label storage rejected with SQLSTATE `23514` for both `public.opportunities` and `public.activities`; tests checked the catalog-identified constraint/table/schema plus identical complete snapshots after rejection. Normalizing owner RPC inputs did not weaken the stored-data constraint.

**CI and local notes:** Linux static preflight and AO domain tests passed; Quest Creation passed; Playwright 68/68 includes the Library mobile visual case previously failed. Its prior failure did not reproduce, but root cause is not established. Windows checkout CRLF-sensitive R-05 static-test issue remains a separate historical local diagnostic.

**Disposition:** QA-11-B01 is **VERIFIED REPAIR / PASS for the tested subcase**, while **QA-11 remains PARTIAL**. QA-06, QA-08, QA-19, QA-20 remain PARTIAL; QA-01/09/10/12/23/32 retain their documented gaps. QA-10 PostgreSQL tzdb/cross-version blocker remains open. QA-35 remains **ENFORCED BY WORKFLOW**; no migration, PR merge, release signoff or deploy.

**Next scoped Batch B work — separate authorization required:**

| Row | Remaining evidence, without duplicating passed QA-11-B01 |
| --- | --- |
| QA-06 | G-05 N/A vs non-Unknown outcome/invalid enums, Invitation/Direct Access + Submitted, warning-only cases |
| QA-08 | PartialDate allowed mutation fields; omitted vs JSON `null` vs Unknown; malformed/reversed dates and exact rollback |
| QA-11 | Other text fields' Unicode code-point limit−1/limit/limit+1, SQL/TS normalization, rejected multi-field rollback |
| QA-19 | Opportunity Close/Reopen audit before/after, annotation negatives, stale/invalid lifecycle and exact SQLSTATE |
| QA-20 | Planned/actual field changes, terminal/Cancelled Before Start invariants, correction receipts/no-op/stale/rollback |

**Stop rule:** A scoped CI PASS cannot promote all QA rows or open migration/release gates. Further SQL changes, checksum updates, code work, runtime dispatch, commit/push, merge or deployment require fresh PO approval.


## Batch B runtime verification and independent acceptance reconciliation — 2026-10-14

**Scope of this append:** documentation-only evidence reconciliation of the latest verified CI results on `7c52a4ce46e24cb0d7a0d6be9abad6fe07f0dae3`. No QA row status changes; no requirement, fixture, SQL, workflow, checksum or guard changes. Historical NOT RUN and pending sections above remain valid chronological records and are not rewritten. **Status counts before and after this append: 23 PASS / 11 PARTIAL / QA-35 ENFORCED BY WORKFLOW — unchanged.** QA-10 remains the **BLOCKER** row; QA-35 deployment gate remains **CLOSED**.

### A. Execution baseline

- **Worktree/branch verified for this task:** `D:/System-ao-batch-b`, local branch `codex/ao-batch-b`, HEAD `7c52a4ce46e24cb0d7a0d6be9abad6fe07f0dae3`. Clean tracked tree before this append; the untracked scratch file `preflight-qa0608.mjs` was preserved untouched.
- **Draft PR:** [#59](https://github.com/kdao265/System/pull/59) — independently re-inspected read-only on 2026-10-14: `state=OPEN`, `isDraft=true`, `mergedAt=null`, head `test/ao-l1-06-disposable-qa`. It must remain open, Draft and unmerged.
- **All three workflows completed with `conclusion=success` on the exact commit `7c52a4ce46e24cb0d7a0d6be9abad6fe07f0dae3`** (runs created 2026-10-13T17:11Z, i.e. 2026-10-14 Asia/Ho_Chi_Minh):

| Workflow | Run (exact URL) | headSha | Verified conclusion |
| --- | --- | --- | --- |
| AO L1-06 disposable QA (temporary) | [38436619336](https://github.com/kdao265/System/actions/runs/38436619336) | `7c52a4ce46e24cb0d7a0d6be9abad6fe07f0dae3` | PASS (success) |
| Playwright E2E | [38436619452](https://github.com/kdao265/System/actions/runs/38436619452) | `7c52a4ce46e24cb0d7a0d6be9abad6fe07f0dae3` | PASS (success) — 68/68 |
| Quest Creation CI | [38436619323](https://github.com/kdao265/System/actions/runs/38436619323) | `7c52a4ce46e24cb0d7a0d6be9abad6fe07f0dae3` | PASS (success) |

- **Inspection provenance (read-only `gh run view` / `gh pr view`, no workflow triggered):** run metadata for all three runs and the full logs of the AO disposable and Playwright runs were inspected directly on 2026-10-14. The disposable log contains no `##[error]`/`not ok`/`ERR_` lines. The Playwright log ends `68 passed (10.3m)`, including `library.mobile.spec.ts:29` (Library visual QA in both languages at all three phone sizes) and `library.desktop.spec.ts:113` — the Library mobile visual QA failure is resolved within this tested run. The Quest Creation CI log was sampled (multiple `PASS: supabase/tests/...` suite lines observed); its authoritative result is the workflow `success` conclusion on the same SHA. Information carried over from the approved handoff (and not re-derived line-by-line here) is the scoped-marker inventory quoted below; every marker quoted in section B was matched against the actual run log.
- **Environment:** fixture-owned disposable Auth/PostgREST/PostgreSQL (loopback gateway + tmpfs-only Docker network, synthetic identities). The runner (`supabase/tests/ao-review-disposable-wire.mjs`) pins the review-only SQL by SHA-256 `409aef907f98887bd2a1486d412db2609f24dce611615fc33ee95c2cceac2772` — re-verified locally against the HEAD git blob (identical); the `0A000` abort guard is asserted present and stripped **only in memory** for the disposable database. The Windows working-tree byte hash differs solely from the known `core.autocrlf` CRLF checkout effect (documented in prior ledgers), verified read-only, not repaired or repinned.
- **Not performed:** no actual AO migration (nothing placed under `supabase/migrations`), no Supabase Cloud or production access, no merge, no deployment, no CI trigger, no database operation outside the throwaway harness inside CI.
- **Caveat:** check markers are **NOT** equal to total assertions, total RPC calls or complete acceptance; a scoped PASS never promotes a row by itself (see status policy above).

### B. Batch B evidence reconciliation

All new runtime evidence comes from `supabase/tests/helpers/ao-batch-b-p0.mjs`, dispatched by `exerciseAoBatchB()` → `exerciseBatchBRows()` in the AO disposable run 38436619336. Positive paths assert through `acceptedMutation()`/`acceptedLifecycle()` (model-derived canonical fields, exact receipt/revision, immutable before/after history, unchanged external-domain snapshots); negative paths assert through `unchangedMutation()` (named SQLSTATE + exact message + full snapshot immutability), `checkRejection()` (constant SQLSTATE CHECK violations) or catalog-resolved direct `DO`-block probes. Every QA row below remains **PARTIAL** — the row statuses are unchanged.

#### QA-06 — G-05 entry mode/applicability matrix (PARTIAL)

- **Criterion:** Title-only Opportunity defaults, exactly 4 tracking stages and 6 selection outcomes, G-05 rejection matrix (hard invariants vs warning-only combinations; AO-AC-02..04, ADR-024 D2).
- **Fixture mapping:** `qa06()` (30 check markers) — warning corpus at create, enum-negative corpus, N/A×outcome corpus on Create and `record_opportunity_outcome_v1`, `validateOpportunityState()`/`opportunityWarnings()` model cross-checks, and a catalog-resolved direct storage CHECK probe in `public.opportunities`.
- **Confirmed positives:** five warning-only combinations accepted at create and confirmed non-hard by `model.validateOpportunityState` with the expected warning id — `saved_accepted`, `submitted_without_applied_at`, `invitation_submitted`, `direct_access_submitted`, `declined_without_outcome`; `not_applicable`+`unknown` accepted via Record Outcome correction; recovery from N/A to `applicable`+`accepted` (`new_decision`) accepted and retains the `saved_accepted` warning; stage forward advances `saved→preparing→submitted→closed` (via qa19 path) remain accepted. Warnings are UI-only and are not persisted — acceptance equals model-normalized request.
- **Confirmed negatives:** four invalid enum values (`selection_outcome=granted`, `entry_mode=portal`, `selection_applicability=maybe`, `tracking_stage=archived`) rejected by model **and** by SQL with `22023 Invalid AO enum value`; all five non-Unknown outcomes × `not_applicable` hard-rejected (`23514`) on **both** Create and Record Outcome paths (10 CHECK rejections), each with rollback; invalid outcome intent (`granted`, `unlisted`), invalid applicability on correction, invalid stage intent (`archived`, `teleport`) and invalid enum on update → `22023` with exact messages; `closed_reason` set while `saved` → `23514`; `other` without note → `23514`; direct SQL UPDATE probe violating the applicability CHECK → `23514` on the catalog-identified constraint with all snapshots unchanged (proves the invariant lives in the table, not only in TypeScript).
- **CI evidence:** run 38436619336 log, `2026-10-13T17:14:48Z`: `PASS QA-06 (opportunity): 30 checks`.
- **Missing (why PARTIAL):** the nine-P0 closure plan specifies a **finite selected G-05 combination matrix**, not an exhaustive Stage × Outcome × Entry Mode × Applicability × Intent product. Selected combinations and mutation paths not yet proven include: Invitation/Direct Access entry modes paired with additional selected outcomes/applicability combinations; N/A-recovery and warning-carrying corrections via mutation paths beyond the sampled `record_opportunity_outcome_v1` calls; and direct storage CHECK probes for root constraints other than the applicability CHECK. Warning display/confirmation behavior is **AO L2 UI acceptance under AO-AC-04** (not QA-09, which concerns unresolved temporal data) and has no browser assertion in this batch. An independent criterion-to-assertion signoff against G-05 / AO-AC-02..04, row by row, has not been recorded.

#### QA-08 — PartialDate mutation matrix (PARTIAL)

- **Criterion:** PartialDate unknown/year/month/day; leap years including 0001 and 9999; impossible dates and extraneous keys reject (AO-AC-11), plus omitted vs `null` vs Unknown mutation semantics and reversal/rollback.
- **Fixture mapping:** `qa08()` (103 check markers) — exercises the **partial-date variants on nine fields**: Opportunity `application_deadline` (a `DeadlineSpec` supporting partial-date forms plus exact/unresolved variants — only its partial-date forms are exercised here; this does not claim the complete DeadlineSpec instant/DST contract) and eight ordinary `PartialDate` fields — Opportunity `program_start`, `program_end`, `applied_at`, `decision_at` (the last via `record_opportunity_outcome_v1` correction) and Activity `planned_start`, `planned_end`, `actual_start`, `actual_end`; plus program/planned pair ordering probes.
- **Confirmed positives:** seed `{precision:"unknown"}` round-trips; **omission** at the owning operation is a verified no-op (`changed=false`, field preserved); explicit JSON `null` clears to SQL NULL; four calendar values accepted on every field — `day 2026-06-15`, `year 0001`, `month 9999-12`, `day 2000-02-29` (Gregorian leap) — each with exact persisted value; re-setting Unknown accepted; concrete-date omission re-verified after later writes; exact revision ladder asserted (`revision === "7"` per field); genuine uncertainty overlap (month envelope containing day bound) accepted for both root kinds.
- **Confirmed negatives:** six invalid values per field — `2026-02-30`, month 13, `year 0`, extraneous key `extra`, `precision "fortnight"`, non-leap `1900-02-29` — rejected with `22023 Invalid AO date` / `Invalid decision date` and a companion "Must roll back" field, proving atomic rollback of the whole request; certain reversal of program/planned pairs → `23514` with rollback; model `parsePartialDate`/`isCertainReverse` parity asserted for every case.
- **CI evidence:** run 38436619336 log, `2026-10-13T17:15:25Z`: `PASS QA-08 (opportunity/activity): 103 checks`.
- **Missing (why PARTIAL):** the documented finite remaining cases are: malformed JSON types on the nine fields; decimal and out-of-range year inputs; selected precision/reversal cases on the actual bounded start/end pairs (`program_*`, `planned_*` — ordering is exercised on one pair per root kind; no chronological ordering is asserted or required between `applied_at` and `decision_at`); and mutation parity for these cases. Beyond those finite cases, PartialDate behavior on archived roots, interaction with replay/stale for date-only commands beyond the sampled paths, and an independent constraint-to-fixture coverage audit remain open. The exact/unresolved/DST portion of `application_deadline` belongs to the DeadlineSpec contract under QA-10 and is not claimed here.

#### QA-11 — text/Unicode/URL parity (PARTIAL)

- **Criterion:** Unicode code points, Vietnamese/emoji, CRLF/LF, whitespace, URL syntax, ≤30 links; SQL/TS exact equivalence (AO-AC-19/20, G-02).
- **Fixture mapping (two evidence blocks, kept separate):** **(a)** resource links (labels/URLs) — QA-11-B01 corpus only (preserved below; 35 fixtures × 4 owner Create/Update operations); **(b)** plain-text fields — new `qa11()` (100 check markers): per-field code-point **limit−1 / limit / limit+1** for **all seven** Opportunity fields (`title` 240, `organization` 240, `description` 4000, `eligibility_notes` 10000, `benefits_notes` 10000, `closed_note` 2000, `notes` 10000) and **all nine** Activity fields (`title` 240, `organization` 240, `role` 160, `description` 4000, `confirmation_note` 2000, `contributions`/`outcomes`/`lessons`/`notes` 10000); astral 😀 is used for the at-limit and over-limit fixtures and `é` for the under-limit fixtures, so code points (not UTF-16 units) are measured.
- **Confirmed positives:** at-limit emoji (😀) and under-limit `é` text accepted and persisted verbatim without truncation on both root kinds — Unicode code-point handling evidence, **not** a Vietnamese-language corpus on every text field; the Vietnamese `Tài liệu 😀` resource-label evidence belongs to the separate QA-11-B01 corpus below. CRLF/CR/LF edge whitespace canonicalizes to LF for multiline fields and trims for single-line fields with the exact expected value asserted against `model.normalizeText` first; zero-composition-change (`e` + combining acute ≠ precomposed) preserved on `title`/`description`; blank input normalizes to `null` (or rejects for `title`); `closed_note` limits exercised through the `set_opportunity_stage_v1` correction path.
- **Confirmed negatives:** over-limit (+1 code point) on every field rejected with `22023 Invalid AO text value` / `Invalid closed note` **with a companion field in the same request**, proving multi-field rollback; blank `title` rejected; model-vs-SQL parity asserted for each rejection. Resource/URL boundaries (labels ≤120 code points, HTTPS ≤2048 with 2047/2048 accepted and 2049 rejected, 30 vs 31 links, duplicate IDs/URLs, invalid schemes/userinfo/control chars) remain covered exclusively by the QA-11-B01 corpus — deliberately not duplicated here.
- **CI evidence:** run 38436619336 log, `2026-10-13T17:15:57Z`: `PASS QA-11 (opportunity/activity): 100 checks`.
- **Missing (why PARTIAL):** exhaustive SQL/TS exact equivalence is not proven for every normalization category × every field × every mutation path (e.g., multi-link arrays combined with text overflow in one request, remaining Unicode categories, all correction paths per field); rejected multi-field rollback proven for sampled pairs only; no independent row-coverage audit.

##### Preserved separate evidence — QA-11-B01 resource-label normalization repair (VERIFIED PASS for the tested subcase; QA-11 stays PARTIAL)

- Re-verified in run 38436619336 on `7c52a4ce`: all four diagnostic cases (`update_opportunity_v1`, `create_opportunity_v1`, `update_activity_v1`, `create_activity_v1`) reported `outcome=accepted_and_verified` with **5/5 checks passed each** (`external_domains_unchanged`, `accepted_revision_receipt`, `persisted_resources_and_revision`, `before_after_history`, `persisted_receipt_fidelity`).
- `PASS: QA-11-B01 repair acceptance 140 boundary cases, four replay/collision/no-op sequences and two direct CHECK rejections` — 35 fixtures × 4 operations (40 accepted/canonically persisted, 100 rejected with exact SQLSTATE and unchanged subject/external snapshots), catalog-resolved `23514` direct noncanonical-label storage rejections on both `public.opportunities` and `public.activities`. This re-confirms the already-verified `7ee1ff2` subcase on the current baseline; it neither supersedes that ledger nor changes the QA-11 PARTIAL status.

##### Preserved separate evidence — closed-note NULL repair (tested subcase PASS; QA-06/QA-19 rows unchanged)

- `PASS: closed-note repair, 7 closure cases, 4 historical replays, 2 omission collisions, 2 no-op corrections` (run 38436619336). Fixtures `closedNoteFixtures()` + `exerciseAoClosedNoteNullRepair()`: `other` with `null`/blank/omitted note rejected `23514` against the catalog-resolved single Other-requires-note CHECK (constraint name resolved from `pg_catalog.pg_constraint`, not guessed); `withdrawn` with `null`/omitted/blank accepted with canonical LF; `other` with meaningful note canonicalizes CRLF→LF; four historical command replays return immutable stored receipts; equivalent C/E intents collide `23505` (`Conflicting AO command identity reuse`) while omitted-vs-present note remains a deliberately distinct command intent; no-op corrections keep revision/timestamps/root/history unchanged. Repair-scoped evidence only — not G-05 corpus closure.

#### QA-19 — Opportunity stage/outcome audit (PARTIAL)

- **Criterion:** Correct Opportunity `advance` forward only, correction annotated, Close reason/Other note, Reopen semantics (AO-AC-05/06, G-05).
- **Fixture mapping:** `qa19()` (4 check markers plus the surrounding `acceptedLifecycle`/`unchangedMutation` assertions) — one Opportunity driven through `set_opportunity_stage_v1` (kinds `advance`/`reopen`/`correction`) and `record_opportunity_outcome_v1` (supported kinds `new_decision` and `correction` only — `annotation` is sent solely as an **invalid intent expected to be rejected**, not a supported outcome action).
- **Confirmed positives:** forward-only advances `saved→preparing→submitted→closed`; Close with CRLF note persists canonical LF and emits the `declined_without_outcome` warning; Close reason correction (`process_finished` + note) and same-value correction no-op (`changed=false`, receipt stored, no history row); late `new_decision` (`accepted` with `decision_at`) after Closed accepted **without reopening** (stage stays `closed`); outcome correction to `waitlisted` and its no-op replay; Reopen clears current `closed_reason`/`closed_note` while the original Close, correction and late-decision receipts replay unchanged (`replay=true` fidelity); later metadata edit does not alter stage; exact `event_type` (`operation` or `operation:kind`), full before/after images and prior-history immutability asserted by `acceptedLifecycle`.
- **Confirmed negatives:** invalid stage kind `teleport` → `22023 Invalid opportunity stage intent`; same-stage advance, advance from `closed`, reopen from non-Closed → `23514 Invalid stage transition`; malformed Closed annotations (extraneous key, unlisted reason, numeric note) → `22023 Invalid closed details`/`Invalid closed reason`/`Invalid closed note`; closed details on reopen → `22023 Closed details only for Closed stage`; `annotation` kind (an invalid intent, not a supported outcome action — supported kinds are `new_decision`/`correction`) and `new_decision` with invalid outcome → `22023 Invalid opportunity outcome intent`; unsupported outcome detail key → `22023 Invalid outcome detail keys`; command-ID collision on the replayed Close → `23505 Conflicting AO command identity reuse`; stale revision on stage/outcome → `23514 Stale AO revision`; each rejection leaves root/history/receipts/external snapshots byte-identical.
- **CI evidence:** run 38436619336 log, `2026-10-13T17:15:33Z`: `PASS QA-19 (opportunity): 4 checks`.
- **Missing (why PARTIAL):** the full negative matrix remains open. Outcome actions are limited to `new_decision` and `correction`; stage corrections use `kind="correction"` — there is no `annotation` operation kind to cover, `annotation` is only ever asserted as a rejected invalid intent, and `reason` is **not** an allowlisted outcome detail (the fixture rejects `{ reason: "unsupported annotation" }` with `22023 Invalid outcome detail keys`). Remaining finite verification covers the supported stage-correction audit history, `new_decision` versus `correction` event semantics, immutable before/after records and the approved negative cases; additionally, no explicit assertion that a late outcome never creates an Activity; the seven Close Reasons are not re-enumerated in this batch (T-A evidence above is separate); warning display behavior untested; no independent row-coverage audit.

#### QA-20 — Activity temporal/status audit (PARTIAL)

- **Criterion:** Activity state transitions, Correct Status, terminal correction, actual vs planned times (AO-AC-07..10).
- **Fixture mapping:** `qa20()` (11 check markers) — three independent legal paths (`start→pause→resume→complete` from `confirmed_plan`; `pause→end_early` from `confirmed_started`; `cancel_before_start`), both historical imports, terminal planned/actual mutations on a `completed` root, and a `correct_activity_status_v1` battery.
- **Confirmed positives:** all six statuses visited with `model.activityTransition` parity per step; terminal roots have `actual_start`/`actual_end` **null** (no invented timestamps) on the complete/end-early/cancel paths; both historical imports (`historical_completed`, `historical_ended_early`) land directly in their factual status with null actuals and exactly one Create event; independent planned/actual set (`planned_start` 06-01, `planned_end` 06-15, `actual_start` 05-01, `actual_end` 05-10) on a completed Activity keeps `status=completed`; correction to `ongoing` with omitted dates preserves actual dates; correction to `cancelled_before_start` with explicit `null`s clears them; correction to `upcoming` with `actual_start={precision:"unknown"}` accepted; annotation-only correction is a verified no-op (`changed=false`, receipt stored); later metadata edit preserves planned/actual/status (`planned_actual_preserved_independently`); stored receipts replay unchanged and `event_type`/`reason` fields asserted.
- **Confirmed negatives:** invalid action per path (`pause` on completed, `resume` on ended-early, `start` on cancelled) and unknown action `finish` → `23514 Invalid activity transition`; certain reversal of planned and actual pairs → `23514` with companion-field rollback; actual dates set on `cancelled_before_start` → `23514`; malformed transition details (extra keys, `action`/`details` nesting) → `22023 Invalid activity transition details`; correction to `unlisted` → `22023 Invalid activity status correction`; non-allowlisted or invalid reason (wrong type, 2001 chars) → `22023 Invalid status correction details/reason`; impossible corrected actual date `2026-02-30` → `22023 Invalid corrected actual dates`; invalid correction targets → `23514` CHECK violation; stale correction → `23514 Stale AO revision`; command collision on a correction → `23505 Conflicting AO command identity reuse`; every rejection preserves root/history/receipts/external snapshots.
- **CI evidence:** run 38436619336 log, `2026-10-13T17:16:10Z`: `PASS QA-20 (activity): 11 checks`.
- **Missing (why PARTIAL):** the correction-target matrix is not exhaustive across all six source statuses (exercised from `completed`/`ongoing` here); `unknown` vs omitted vs clear for `actual_end` is only partially sampled; timestamp non-fabrication is asserted at path terminals, not after every individual action; full history-event content for every action class and an independent row-coverage audit remain open.

### C. Other outstanding P0 criteria — re-executed without promotion

The same AO disposable run re-executed the prior Batch A / residual / L1 suites on `7c52a4ce`. These runs **re-confirm existing evidence only; no row status changes:**

- **QA-10 (BLOCKER, stays PARTIAL):** `PASS: Batch A QA-10 12 paired Zone/UTC cases; Node=24.21.0, ICU=78.3, Node tzdb=2026c; PostgreSQL runtime=17.6;timezone=UTC;zones=1196` plus `PASS: L1-08 QA-10 owner wire date trigger UTC, unresolved, DST fold/gap, boundary, immutability and rollback`. **Still open:** PostgreSQL container tzdb release fingerprint and cross-version reproducibility are unverified; the finite tested IANA-zone/year corpus is not a universal parity proof. The BLOCKER stays open exactly as recorded in the Batch A ledger.
- **QA-12 (stays PARTIAL):** `PASS: Residual P0 QA-12 nine direct SQL constraint/JSONB/null/overflow negatives atomic` and `PASS: Batch A QA-12 29 extra direct PostgreSQL wrong-shape/null/field tests and atomic snapshots; review of all constraints still required`. **Still open:** independent constraint-to-fixture coverage review (malformed JSONB shapes/types corpus per the nine-P0 plan) not signed off.
- **QA-23 (stays PARTIAL):** `PASS: Residual P0 QA-23 archived/missing Goal, nonowner and archived AO source denial` and `PASS: Batch A QA-23 8 Quest ineligible owner cases plus both eligible source types, nonowner and legacy bound fixture; archived/deleted/recurring privacy remains independently gated`. **Still open:** project-bound Quest and mismatched-occurrence-metadata eligibility states, and full target-side negative matrix.
- **QA-32 (stays PARTIAL):** `PASS: L1-07B QA-32 exact external-domain snapshot parity after AO-only operations` (plus per-mutation external snapshots inside every Batch A/B acceptance/rejection assertion). **Still open:** the single bounded mutation × expected-side-effect ledger spanning all 13 AO mutation RPCs (incl. races) has not been built; failure/race variants not exhaustively enumerated.

### D. AO UI versus the existing E2E suite

- The six AO routes are served by `src/features/activities-opportunities/ui/route-page.tsx`, which states in-code: *"No AO RPC, mutation or sample records: these are protected, disabled UI shells."* It renders `AoUnavailable`, disabled search/scope controls and `AoListView records={[]}` — there is no AO read/write RPC wiring, no countdown and no timezone rendering on these pages.
- Therefore **Playwright run 38436619452 (`68 passed`, 0 failed) cannot evidence AO UI acceptance**: it exercises the existing (non-AO) application surface, including Library visual QA (`library.mobile.spec.ts:29`, `library.desktop.spec.ts:113`) that previously failed and passed within this run. Per the closure plan and L1-11 audit, QA-09 requires AO L2/G-06 browser evidence (unresolved source-clock labelling, no countdown on partial dates, profile-timezone display) that does not exist yet — **QA-09 remains PARTIAL**. The 68/68 result is recorded as a regression baseline, never as an AO UI sign-off.

### E. Remaining release gates

1. **QA-01** — additive AO migration packaging, checksum pin review and clean-migration rehearsal verified against the disposable migration history (QA-01 closure scope). A real database migration/deployment is a **separate, independently authorized release operation** — not automatically part of QA-01 closure and requiring its own fresh approval when reached.
2. **QA-09** — AO L2/L3 UI implementation plus browser tests for unresolved-clock/no-countdown behavior; disabled-shell pages cannot satisfy it.
3. **QA-10 (BLOCKER)** — PostgreSQL tzdb provenance, cross-version reproducibility and independent review of the finite zone/year corpus.
4. **QA-11/QA-06/QA-08/QA-19/QA-20** — the per-row residual corpora listed in section B, each with an independent row-by-row coverage audit before any PASS is considered.
5. **QA-12** — independent constraint-to-fixture coverage audit of all root CHECK/NOT NULL/JSONB/overflow guards.
6. **QA-23** — project-bound Quest and occurrence-metadata eligibility negatives.
7. **QA-32** — bounded all-RPC mutation × cross-domain side-effect ledger with race/failure variants.
8. **QA-35** — deployment gate (remains **CLOSED**): independent architecture/security acceptance, release plan and **explicit Product Owner merge/deploy approval**. Draft PR #59 must stay unmerged until then; no manual CI dispatch or rerun, migration or deployment may be triggered without fresh authorization. Workflows that run automatically following a separately approved Git push are governed by that push approval — automatic CI execution per se is not forbidden by this gate.

**Disposition:** this append records verified runtime evidence and its limits only. 23 PASS / 11 PARTIAL / QA-35 ENFORCED BY WORKFLOW are unchanged; QA-10 stays **BLOCKER**, QA-35 stays **CLOSED**. No code, fixture, SQL, checksum, guard, workflow, dependency or status line was modified; `git diff` validation results are reported in the task handoff, not recorded here.
