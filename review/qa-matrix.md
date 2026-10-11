# L1-05 acceptance / regression matrix — prepared, NOT executed on PostgreSQL

Source of authority: approved AO requirements AO-AC-01..24, ADR-024 G-01..06, architecture §9, L1 task contract. **Statuses below reflect scoped evidence from disposable runtime, not deployability.** A structural assertion or a partially executed scenario is never a full functional PASS. See the dated L1-08 execution ledger below.

| ID | Priority | Layer | Scenario and required evidence | Status |
|---|---|---|---|---|
| QA-01 | P0 | Migration | Fresh disposable Auth+PostgreSQL apply all historical migrations with unchanged checkpoint order; AO follows Library | PARTIAL — historical migration checkpoints PASS; AO SQL loaded guard-stripped **in memory** only, not migration file |
| QA-02 | P0 | Catalog | Exactly 10 tables, AO role NOLOGIN/NOBYPASSRLS, all rows RLS, restrictive configured-owner policies | PASS — disposable catalog (`ao-catalog.sql`) |
| QA-03 | P0 | Catalog | 13 mutation/7 read RPC fixed signatures, SECURITY DEFINER owner and search_path, PUBLIC/anon EXECUTE denied | PASS — catalog + 20 owner-scoped RPC signatures/ACL; Auth negative matrix |
| QA-04 | P0 | Catalog | Authenticated has no direct AO SELECT/INSERT/UPDATE/DELETE; executor no AO DELETE, no writes to Quest/Goal/EXP/Calendar/Library | PARTIAL — AO catalog denies cross-domain write privileges; L1-09 exact Quest/Goal/EXP/Calendar/Library snapshot stayed unchanged after Goal/Quest links, Activity provenance and metadata; all mutation classes not exhaustively covered |
| QA-05 | P0 | Catalog | Legacy public RPC OID/signature/ACL/body, roles and old migrations preserved; no lingering borrowed membership | PASS — historical migration catalog and legacy public RPC checks |
| QA-06 | P0 | SQL/TS parity | Title-only Opportunity defaults, exactly 4 tracking stages and 6 selection outcomes, G-05 rejection matrix | PARTIAL — L1-09 owner RPC + TypeScript creation parity verified accepted/invalid Opportunity state and boundary samples; complete G-05 transition corpus pending |
| QA-07 | P0 | SQL/TS parity | Title+explicit Activity intent; 4 creation intents, 6 statuses, no invented actual dates | PARTIAL — L1-08 Activity four intents and selected transitions/correction PASS; L1-09 TypeScript/SQL intent-to-status/actual-date parity PASS; complete transition table pending |
| QA-08 | P0 | SQL/TS parity | PartialDate unknown/year/month/day; leap years including 0001 and 9999; impossible dates and extraneous keys reject | PARTIAL — SQL/TS valid year 0001, year 9999, leap-day, unknown dates and invalid year/day/extra-keys rejected in L1-09; exhaustive date matrix pending |
| QA-09 | P0 | G-01 | Source-clock unresolved date remains non-UTC; no invented timezone, no countdown on partial dates | PARTIAL — L1-08 unresolved source clock persists UTC-null; L1-09 Profile timezone update preserves accepted UTC; rendering/countdown behavior not end-to-end asserted |
| QA-10 | **BLOCKER** | G-01 | Instant deadline accepts exact supported UTC source; DST gap rejects; fold requires explicit offset; IANA offset contradiction rejects; no Profile timezone rewrite | PARTIAL — L1-08 real owner UTC trigger/DST/invalid input PASS; L1-09 real Profile timezone change preserved stored UTC before/after unrelated metadata edit; full SQL/TS timezone parity review open |
| QA-11 | P0 | G-02 | Unicode code points, Vietnamese/emoji, CRLF/LF, whitespace, URL syntax, ≤30 links; SQL/TS exact equivalence | PARTIAL — L1-08 Unicode/emoji/url/31-link negatives and L1-09 Unicode/CRLF positive parity pass; complete SQL/TS URL and length corpus pending |
| QA-12 | P0 | SQL | Direct invalid state and null/overflow JSONB rejects, constraints not merely client-side | PARTIAL — catalog/SQL negatives; L1-08 extended atomic invalid-write suite not reached |
| QA-13 | P0 | Wire | Command idempotency exact replay after newer revision; conflicting command ID rejects; receipt immutable | PASS — replay after newer revision and conflicting command identity via RPC |
| QA-14 | P0 | Wire | Accepted no-op leaves root revision/updated_at unchanged but stores a recoverable command receipt | PASS — L1-09 Opportunity and Activity accepted no-ops preserve full root including updated_at/revision/history; accepted receipt, immutable replay confirmed |
| QA-15 | P0 | Wire | New stale revision rejects, no state/EXP/history change | PASS — L1-09 stale Opportunity revision rejects with unchanged root/history/receipt/legacy-domain snapshots; existing L1-07 two-session revision race verified |
| QA-16 | P0 | Wire | Create vs concurrent create same subject and same command, exactly one accepted logical action | PASS — independently authenticated concurrent create/replay, single root and receipt |
| QA-17 | P0 | Wire | Response committed but HTTP response lost; resolve receipt finds accepted; retry exact command does not duplicate changes | PASS — dropped committed HTTP response, resolve and exact replay |
| QA-18 | P0 | Wire | Receipt absent = unknown, never definitive rollback; archive+read+restore with revision guards | PASS — L1-09 unknown command receipt remains unknown; Opportunity and Activity archive/read/idempotent archive/stale restore/successful restore with revision guards |
| QA-19 | P0 | SQL/wire | Correct Opportunity `advance` forward only, correction annotated, Close reason/Other note, Reopen semantics | PARTIAL — L1-08 Opportunity stage/reopen/correction/outcome tested; all reasons/branches pending |
| QA-20 | P0 | SQL/wire | Activity state transitions, Correct Status, terminal correction, actual vs planned times | PARTIAL — L1-08 real Activity creation/transition/terminal rejection/correction and L1-09 four intents pass; complete actual/planned date and transition matrix pending |
| QA-21 | P0 | SQL | Five relationship tables: exact same-owner composite FKs, partial unique active pair, retained intervals, immutable timestamps | PARTIAL — catalog five relationship tables/unique-current constraints and L1-08 four typed Goal/Quest link variants and detach passed; full composite FK/immutability negative matrix pending |
| QA-22 | P0 | Wire | Source Opportunity provenance 0..1 current, replacement keeps audit; archived source prohibits fresh link | PARTIAL — L1-08 source S1→S2 closes old interval; stale-link and archived-source negative cases pass; L1-07 lock-order race verified; complete interval retention matrix pending |
| QA-23 | P0 | Wire | Four contextual typed N:N attach/detach only eligible Goal/one-off Quest; no membership or progress side effect | PARTIAL — L1-08 four typed Goal/Quest attach/no-op/detach; L1-09 external-domain snapshot after typed links and provenance PASS; full eligibility and permission matrix pending |
| QA-24 | P0 | Race | Two concurrent owner transactions: AO attach vs Quest Delete; both owner-lock orders; existing AO link does not prevent Quest Delete | PASS — two observed PostgreSQL advisory owner-lock queue orders, attach/Quest Delete |
| QA-25 | P0 | Race | AO attach vs Goal Archive / AO source Archive; both orders and no deadlock | PASS — observed lock-queue orders for Goal Archive and source Opportunity Archive |
| QA-26 | P0 | Race | Link L1 detach/reattach→L2; late exact L1 retry must NOT detach L2 | PASS — old L1 detach replay does not remove newer L2 |
| QA-27 | P0 | Privacy | Deleted Quest projection is neutral placeholder in AO detail, candidates, history, errors, receipts, source/derived list | PASS — tested allowlisted detail/list/history/candidate/source/receipt/error surfaces redact deleted Quest |
| QA-28 | P0 | Privacy | Non-owner/anon/missing owner configuration: all AO writes, reads, candidate search and resolution fail closed | PASS — 20 AO RPCs reject nonowner/anon and all clients when owner config is absent |
| QA-29 | P1 | Reads | Root lists 50 default/100 max; invalid NULL, cursor and filter reject; 51+ filtered results paginate exhaustively | PASS — 63+63 filtered rows, 50/100 limits and invalid filter/limit cases |
| QA-30 | P1 | Reads | 6 decimal microsecond timestamp cursor order, ties broken by UUID, no repeat/drop across pages | PASS — microsecond cursor and UUID tie-breaker across 63-row pages |
| QA-31 | P1 | Reads | History immutable with stable pagination; source-derived Activities beyond first page still accessible | PASS — 54 immutable history entries and 63 linked Activity continuation |
| QA-32 | P0 | Regression | Before/after snapshots prove AO does not modify Quest, Goals/goal_quest_links, EXP, Calendar, Library | PARTIAL — L1-07 before/after AO-only snapshots plus L1-09 exact Quest/Goal/EXP/Calendar/Library snapshots through typed Goal+Quest attachments, source link, metadata; untested mutation variants remain |
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
