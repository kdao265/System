# SYSTEM V1 — Activities & Opportunities: L0 Handoff & Task Contract

**Status:** APPROVED L0 TASK CONTRACT — PO approved the four-document L0 package, separately authorized its documentation branch/commit and the opening of PR #56. PR #56 is open for review; merge, code, migration, database changes and deployment remain unauthorized.
**Prepared/approved:** 2026-10-10 · **Repository location:** `docs/04-development/activities-opportunities-v1.md`.  
**Companion contracts:** [Requirements](../01-requirements/activities-opportunities-v1.md) · [ADR-024](../02-architecture/decisions.md) · [Architecture](../02-architecture/activities-opportunities-v1.md).

## 1. Mission, business success and owner authority

**Problem:** SYSTEM currently has Quest, Goals, Calendar and Library but lacks dedicated Activities/Opportunities. These must support future/history-based professional development without conflating seeking opportunity, confirmed participation, task completion, EXP, Goal Progress or verified Evidence.

**Success:** (a) save an Opportunity quickly, record meaningful deadlines and application states; (b) create/track/import an Activity with its own participation lifecycle; (c) connect AO to Goal/one-off Quest context and provenance without affecting other domain state; (d) preserve history and private data under concurrent editing, lost responses and archive/delete races; (e) usable EN/VI desktop/mobile experience with nonregressive Quest/Goal/Calendar/Auth/Library behavior.

**Authority hierarchy:** PO-approved decisions AO-01–09, G-01–06 → this PO-approved four-file contract → additive implementation tasks each separately authorized. Future repo main and accepted ADRs supersede stale observations; do not silently reinterpret PO business rules. For any conflict or missing behavioral contract, **stop, report exact conflict and seek PO direction**.

## 2. Scope freeze and explicit prohibitions

**Included V1:** 2 aggregate roots, 10 tables, four Opportunity Stages/six Outcomes, G-05 entry mode/applicability and seven Close Reasons, six Activity statuses and Correct Status, historical import, Partial Date/DeadlineSpec including unresolved clock, resource links and text caps, source provenance, four contextual N:N, immutable interval/history/receipt/revision, archive/restore, six routes/Growth nav, EN/VI, read-only deleted Quest placeholder, Auth/RLS, responsive and recovery, disposable tests.

**Excluded:** automatic Opportunity→Activity status synchronization; Quest/Goal/EXP event mutations, Goal membership/progress changes, Calendar Schedule Event creation/sync, recurring Quest contextual target, notifications/reminders, AI/chatbot, scraping/metadata fetching, Criteria/Evidence verification, Portfolio/CV generator, hard delete AO, offline action queue, cross-owner collaboration, direct production/local database access, privileged credentials in browser. No unauthorized dependency, schema rewrite, historical migration edits or broad unrelated refactor.

**Current authorization:** documentation branch, original docs-only commit and PR #56 were approved and completed; one documentation-only correction commit is separately authorized. PR #56 remains open. Merge, implementation, code, migration, manual unit/SQL/E2E execution, database operations and deployment still require separate permission.

## 3. Baseline, inputs and required future preflight

Read-only GitHub inspection in this preparation used `kdao265/System` `main@d380133804704552e2ed8969570210663c486dce` (2026-10-09). Observed modules include `src/components/system-shell.tsx`, `app-header.tsx`, typed `src/lib/localization/dictionaries.ts`, existing `src/features/goals`, `src/features/library`, Profile/Auth, `public/sw.js`, disposable `tests/helpers/auth-environment.mjs`, `supabase/tests/private-owner-wire.mjs`, and existing migrations up to `20261007120000_create_books_v1.sql`. **This is a historical baseline, not evidence about current worktree/latest main at implementation time.**

Before any separately authorized repository task: read `docs/PROJECT_CONTEXT.md`, relevant ADR/Requirements and latest code; inspect branch/worktree status, fetch/reconcile `origin/main`, list migrations and check role/RLS catalog as appropriate in **disposable** environment only; preserve concurrent work and untracked files. Confirm Goal deletion guard and deleted-Quest SELECT restrictions still behave as expected. New migration must be additive and follow current ordering/checkpoints, not filename guesswork. If changes to main invalidate the approved contract, return to PO.

## 4. Workstream / delegation model

| Role | Responsibility | Must not do |
| --- | --- | --- |
| Product Owner | Approved final L0 docs; separately authorized documentation branch/commits and PR #56; must independently approve merge and each implementation tranche; resolves contract deviations | Need not write code or infer implementation status |
| Orchestrator/Architect | Trace decisions→requirements→ADR→schema/RPC→tests; resolve dependencies, maintain explicit file ownership | Auto-authorize coding or hide design conflicts |
| Backend/database agent | Add additive AO-owned tables, role/RLS/FKs/indexes/RPCs and real disposable SQL/concurrency tests | Write Quest/Goal/EXP/Calendar data, change old migrations, access live DB |
| Application agent | Typed model/contracts/data/actions; verified owner reads/actions; response validation and recovery | Trust client owner IDs, swallow unknown responses as rejection |
| UI/UX agent | Six routes, Growth nav, EN/VI, forms, history, links, recovery, keyboard/mobile/accessibility | Duplicate lifecycle business rules in JSX, invent UX states, broaden unrelated CSS |
| QA/reviewer | Catalog/wire, race/retry, authorization, deleted-content privacy, regression and device/locale audits | Report tests not actually executed as passed |

Agents coordinate ownership of shared files: `SystemShell`, `AppHeader`, `dictionaries.ts`, `src/app/globals.css`, harness registration and ADR. One owner per shared file per tranche, or explicit sequenced integration; don't simultaneously edit without coordination.

## 5. Delivery tranches and separate gates

| Tranche | Planned deliverables | Completion gate / authority |
| --- | --- | --- |
| **L0 — Final documentation review (completed)** | Four PO-approved files, decision mapping, review notes, QA consistency check and ZIP | PO approval recorded; repo writes and PR required their own later permissions |
| **L0D — Documentation promotion (PR #56 open)** | Docs branch created, four approved documents committed, ADR-024 appended and PR #56 opened for review; small approval-status correction authorized | PR #56 is not merged; merge requires independent PO authorization |
| **L1 — Domain and database foundation (future)** | New additive AO migration for approved 10 tables, SQL validators, role/RLS, FK/indexes, command/read RPCs, durable receipts, history; pure TS model and disposable SQL/catalog/race tests | Separate PO authorization and SQL/security/domain QA signoff |
| **L2 — Core application and UX (future)** | AO protected routes, create/list/detail/edit, Opportunity Stage/Outcome/Entry mode, Activity lifecycle/import, dates, Resource Links, Archive/Restore, History UI, EN/VI responsive | Separate PO authorization; unit/action/E2E acceptance |
| **L3 — Relationships UX/recovery (future)** | Source Opportunity link management, four Contextual Link pickers, candidate search, archived/deleted projection, exact replay UI and command resolution | Separate PO authorization; concurrency and deleted-content privacy signoff |
| **L4 — Integration regression, release review (future)** | SQL/wire/full app/browser/mobile/regression matrix, remediation within scope, preview review and handoff | Separate PO authorization and explicit deployment release approval |

These are **responsibility gates**, not predetermined Git branches/PR counts. L1 may implement database relationships needed by later UI; L3 means application integration, not deferred integrity constraints. No automatic promotion from one tranche to another.

## 6. Required acceptance-to-test mapping

| Coverage | Must verify | Reference | Candidate test placement |
| --- | --- | --- | --- |
| Opportunity fields/lifecycle | Create title-only, defaults, stage/outcome/applicability independence, Close/Reopen, accepted-but-declined, no-submit opportunity | AO-FR-01,03–06; AO-AC-01–06 | Pure domain + SQL behavior + E2E |
| Activity participation | Explicit Upcoming, Ongoing, Pause/Resume/Complete/EndEarly, terminal Correct, historical import no fake transitions | AO-FR-02,07–08; AO-AC-07–10 | Domain + SQL + E2E |
| Temporal | 4 precisions, deadline exact/unresolved clock, server UTC, DST fold/gap, leap day, time range, timezone change, temporal history | AO-FR-09–12; AO-AC-11–13 | TS/SQL parity, timezone tests, E2E |
| Resource/text | Unicode codepoints, limits, 30 structured HTTPS URLs, no hidden fetch, validation parity | AO-FR-18–19; AO-AC-19–20 | TypeScript corpus + SQL/check constraints + E2E |
| Source & contextual | 0..1 source, four typed N:N, immutable intervals, no Goal membership/EXP changes | AO-FR-13–16; AO-AC-14–17 | SQL/catalog + real PostgREST + E2E |
| Archive/history | Readonly archived, restore, meaningful audit, no hard delete, preserve source/context/Quest placeholder | AO-FR-16–17,21; AO-AC-16–18 | SQL/RLS + E2E |
| Idempotency/recovery | Canonical same command exact replay, accepted no-op, stale revision, late detach, commit + lost HTTP response, after-reload receipt-only resolution | AO-FR-21–22; AO-AC-21–22 | SQL multi-session + action unit + Playwright network injection |
| Owner/privacy | Same-owner FK, restrictive RLS, no direct DML, definer safety, deleted Quest title not visible in any response | AO-FR-23; AO-AC-16,23 | Catalog + owner/non-owner/anon wire + redaction assertions |
| Layout & a11y | Growth + 6 routes, EN/VI, mobile 360/390/412/tablet 820/desktop 1024/1280, keyboard, no overflow | AO-FR-20; AO-AC-23 | Playwright visual + a11y interactions |
| Nonregression | No AO writes into Quest, Goal membership, EXP, Calendar, Library; existing fixtures/gates unchanged | AO-FR-24; AO-AC-24 | Before/after DB snapshots + existing suites |

Concrete G01–G06 test obligations are in Architecture §9. Test fixtures must be synthetic or redacted, isolated, disposable and not target real owner data. The current test runner uses isolated Postgres/Auth/PostgREST and network-bound E2E; AO checkpoint is **after Library**, preserving pre-Library frozen ADR-015 assertions. Execute multi-session race tests, not only serial RPC sequences.

### Planned validation commands — not run yet

```bash
npm run lint
npx tsc --noEmit
npm run build
node --test tests/*.test.mjs
node supabase/tests/private-owner-wire.mjs
node tests/auth-smoke.mjs
npm run test:e2e
```

Once permitted, report executed commands, exit results, missing Docker/runtime, test omissions, environment identity (disposable), and regressions. Never claim pass from a planned command or code review alone.

## 7. L0 consistency checks and technical implementation review

**Approved design directions now closed:** G-01 Partial Date/DeadlineSpec/UTC; G-02 Resource Links/closed reason caps; G-03 ten tables/RPC/receipts; G-04 owner locking/RLS/tombstones; G-05 Entry Mode/Applicability/hard reject matrix; G-06 Shell/route/recovery/harness. They must no longer be listed as unresolved PO votes.

**Implementation-detail checks remain** (not permission to change semantics):

1. Verify newest `main`/ADR IDs/migration numbers, exact callable RPC signatures/defaults and RLS policy compatibility.
2. Prove strict JSONB/UTC/DST validator, source-zone rule provenance, finite calendar year support, TS/SQL parity.
3. Finalize event-type name, command canonicalization and atomic FK write ordering across 10 tables.
4. Prove `ao_command_owner` has only limited Quest/Goal reads, no deleted Quest information leak in any AO read/history/error/receipt and no write privileges outside AO.
5. Prove owner-lock race behavior and correct action for source archived, Quest deleted, Goal archived, late replay and two-tab stale revision.
6. Confirm sessionStorage metadata shape does not contain personal draft payload and read-only receipt resolution cannot auto reissue vanished payload.
7. Confirm tests install AO migration after Library without changing existing frozen historical checkpoints or legacy RPC/ACLs; run nonvacuous role matrix.

If an implementation review discovers a need for an eleventh table, a new external dependency, broad Quest grants, revised Quest Delete semantics, live DB migration or altered business status flow, **stop** and request new PO architecture approval rather than silently adjusting this contract.

## 8. Review/release checklist and evidence packet

At each handoff, supply: (a) exact approved scope/task ID; (b) branch/head vs main and git status; (c) files changed; (d) ADR/FR/AC mapping; (e) tests actually run and outcomes; (f) DB migration additive/role-grant/diff assessment; (g) residual limitations; (h) user-visible proof for UX, including screenshots/Playwright where applicable; (i) explicit next gate request. Review all new/untracked files, not only tracked `git diff`.

**Documentation-only L0D:** validate Markdown relative links, references, status/authority language, file paths and source anchors; `git diff --check`, status and diff summary. Do not run application or database tests unless separately authorized.

**L1 security review:** verify list of all `CREATE FUNCTION` privileges and default EXECUTE, private schema exposure, no temporary role memberships, RLS on public/internal relations, immutable history triggers, strict constraints and Quest tombstone absence of leakage. All negative tests required.

**L4 release gate:** verify separate PO approval of deployment; use Vercel preview if authorized/available; no direct `main` push. Establish observability and safe rollout plan before exposure. Production/Cloud DB migration not implied by passing disposable tests.

## 9. Completion of this L0 preparation task

**Deliverable:** four PO-approved Markdown contracts (Requirements, ADR-024, Architecture Design, Task Contract), first assembled outside the repository and now included in the open documentation-only PR #56. **Still awaiting:** separate merge approval and implementation authorization for each tranche. 

**Not done / not claimed:** merge, migration, SQL/RPC/UI implementation, manually running test commands, DB operations, Cloud sync, deploying or confirming product works. Baseline `main` was inspected read-only; local repository working-tree status was **not** checked because no checkout/worktree was modified.