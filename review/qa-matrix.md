# L1-05 acceptance / regression matrix — prepared, NOT executed on PostgreSQL

Source of authority: approved AO requirements AO-AC-01..24, ADR-024 G-01..06, architecture §9, L1 task contract. **Every row starts as NOT RUN.** Do not convert a structural assertion to a functional PASS.

| ID | Priority | Layer | Scenario and required evidence | Status |
|---|---|---|---|---|
| QA-01 | P0 | Migration | Fresh disposable Auth+PostgreSQL apply all historical migrations with unchanged checkpoint order; AO follows Library | NOT RUN |
| QA-02 | P0 | Catalog | Exactly 10 tables, AO role NOLOGIN/NOBYPASSRLS, all rows RLS, restrictive configured-owner policies | NOT RUN |
| QA-03 | P0 | Catalog | 13 mutation/7 read RPC fixed signatures, SECURITY DEFINER owner and search_path, PUBLIC/anon EXECUTE denied | NOT RUN |
| QA-04 | P0 | Catalog | Authenticated has no direct AO SELECT/INSERT/UPDATE/DELETE; executor no AO DELETE, no writes to Quest/Goal/EXP/Calendar/Library | NOT RUN |
| QA-05 | P0 | Catalog | Legacy public RPC OID/signature/ACL/body, roles and old migrations preserved; no lingering borrowed membership | NOT RUN |
| QA-06 | P0 | SQL/TS parity | Title-only Opportunity defaults, exactly 4 tracking stages and 6 selection outcomes, G-05 rejection matrix | NOT RUN |
| QA-07 | P0 | SQL/TS parity | Title+explicit Activity intent; 4 creation intents, 6 statuses, no invented actual dates | NOT RUN |
| QA-08 | P0 | SQL/TS parity | PartialDate unknown/year/month/day; leap years including 0001 and 9999; impossible dates and extraneous keys reject | NOT RUN |
| QA-09 | P0 | G-01 | Source-clock unresolved date remains non-UTC; no invented timezone, no countdown on partial dates | NOT RUN |
| QA-10 | **BLOCKER** | G-01 | Instant deadline accepts exact supported UTC source; DST gap rejects; fold requires explicit offset; IANA offset contradiction rejects; no Profile timezone rewrite | NOT RUN — draft includes instant resolver, but review-only guard prevents database execution; UTC/DST parity remains unverified |
| QA-11 | P0 | G-02 | Unicode code points, Vietnamese/emoji, CRLF/LF, whitespace, URL syntax, ≤30 links; SQL/TS exact equivalence | NOT RUN |
| QA-12 | P0 | SQL | Direct invalid state and null/overflow JSONB rejects, constraints not merely client-side | NOT RUN |
| QA-13 | P0 | Wire | Command idempotency exact replay after newer revision; conflicting command ID rejects; receipt immutable | NOT RUN |
| QA-14 | P0 | Wire | Accepted no-op leaves root revision/updated_at unchanged but stores a recoverable command receipt | NOT RUN |
| QA-15 | P0 | Wire | New stale revision rejects, no state/EXP/history change | NOT RUN |
| QA-16 | P0 | Wire | Create vs concurrent create same subject and same command, exactly one accepted logical action | NOT RUN |
| QA-17 | P0 | Wire | Response committed but HTTP response lost; resolve receipt finds accepted; retry exact command does not duplicate changes | NOT RUN |
| QA-18 | P0 | Wire | Receipt absent = unknown, never definitive rollback; archive+read+restore with revision guards | NOT RUN |
| QA-19 | P0 | SQL/wire | Correct Opportunity `advance` forward only, correction annotated, Close reason/Other note, Reopen semantics | NOT RUN |
| QA-20 | P0 | SQL/wire | Activity state transitions, Correct Status, terminal correction, actual vs planned times | NOT RUN |
| QA-21 | P0 | SQL | Five relationship tables: exact same-owner composite FKs, partial unique active pair, retained intervals, immutable timestamps | NOT RUN |
| QA-22 | P0 | Wire | Source Opportunity provenance 0..1 current, replacement keeps audit; archived source prohibits fresh link | NOT RUN |
| QA-23 | P0 | Wire | Four contextual typed N:N attach/detach only eligible Goal/one-off Quest; no membership or progress side effect | NOT RUN |
| QA-24 | P0 | Race | Two concurrent owner transactions: AO attach vs Quest Delete; both owner-lock orders; existing AO link does not prevent Quest Delete | NOT RUN |
| QA-25 | P0 | Race | AO attach vs Goal Archive / AO source Archive; both orders and no deadlock | NOT RUN |
| QA-26 | P0 | Race | Link L1 detach/reattach→L2; late exact L1 retry must NOT detach L2 | NOT RUN |
| QA-27 | P0 | Privacy | Deleted Quest projection is neutral placeholder in AO detail, candidates, history, errors, receipts, source/derived list | NOT RUN |
| QA-28 | P0 | Privacy | Non-owner/anon/missing owner configuration: all AO writes, reads, candidate search and resolution fail closed | NOT RUN |
| QA-29 | P1 | Reads | Root lists 50 default/100 max; invalid NULL, cursor and filter reject; 51+ filtered results paginate exhaustively | NOT RUN |
| QA-30 | P1 | Reads | 6 decimal microsecond timestamp cursor order, ties broken by UUID, no repeat/drop across pages | NOT RUN |
| QA-31 | P1 | Reads | History immutable with stable pagination; source-derived Activities beyond first page still accessible | NOT RUN |
| QA-32 | P0 | Regression | Before/after snapshots prove AO does not modify Quest, Goals/goal_quest_links, EXP, Calendar, Library | NOT RUN |
| QA-33 | P0 | Regression | ADR-015 legacy catalogue/wire assertions remain at historical checkpoints, no weakening/reordering | NOT RUN |
| QA-34 | P0 | Security | Guarded SQL functions cannot be invoked through anon/Public or used to expose `system_internal` schema | NOT RUN |
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
