# SYSTEM AO V1 — L1-11 Final Acceptance Audit

**Audit date:** 2026-10-11 (Asia/Ho_Chi_Minh)
**Classification:** evidence audit / decision packet — **NOT** approval to merge, migrate, enable, or deploy.
**Audited commit:** \`c29925e0c4e51bcee3c0ca8d29c4e6a16ab3462a\`
**Repository:** \`kdao265/System\`, [Draft PR #59](https://github.com/kdao265/System/pull/59), branch \`test/ao-l1-06-disposable-qa\`.
**Baseline main:** \`cc57912a0d9a6d99c448a802abd42c576c8c3e50\`.

## A. Independent verdict

**L1 release acceptance: HOLD.** The three workflows are green on the audited head; their assertions are not equivalent to satisfying every AO acceptance condition.

| QA matrix state | Rows | Release treatment |
| --- | ---: | --- |
| PASS | 19 | Preserve as recorded, subject to source-specific evidence |
| PARTIAL | 15 | **Not approved.** Explicit residual criteria are listed below |
| QA-35 — ENFORCED BY WORKFLOW | 1 | **Closed deployment gate, not a test PASS** |
| Total | 35 | No wholesale promotion or waiver |

- [AO disposable QA PASS — run 38140868683](https://github.com/kdao265/System/actions/runs/38140868683): PostgreSQL/Auth/PostgREST fixture, SQL catalogue/value/G-01, L1-07/08/09/10.
- [Playwright E2E PASS — run 38140868680](https://github.com/kdao265/System/actions/runs/38140868680): existing UI/browser/regression scope, **not evidence that six proposed AO routes have been delivered**.
- [Quest Creation CI PASS — run 38140868674](https://github.com/kdao265/System/actions/runs/38140868674): existing Quest/migration regressions, **not an AO release migration test**.
- [QA matrix](./qa-matrix.md) is the row authority. This audit does **not** edit row statuses.

**Critical distinction:** the runner compares a pinned SHA-256 (\`0daadcb0c458d5a6ce558510535397624cb64ee0b9aea4bb267ee5389f1a33f5\`) against the guarded review-only SQL file and removes its abort **in memory solely within the throwaway test fixture**. The SQL file remains review-only, not a checked-in migration. A green run therefore cannot close QA-01 or authorize production.

## B. Audit method and provenance

Sources inspected at the audited branch:
1. [AO Requirements §§5–12](../docs/01-requirements/activities-opportunities-v1.md), especially AO-AC-01–24 and the hard-reject/warning distinction.
2. [AO Architecture §§3–10](../docs/02-architecture/activities-opportunities-v1.md), including G-01–G-06, owner locking, release sequence, and acceptance traceability.
3. [Review SQL candidate](./sql/REVIEW_ONLY_create_activities_opportunities_v1.sql) and [disposable runner](../supabase/tests/ao-review-disposable-wire.mjs), not a deployed schema.
4. [Catalog](../supabase/tests/ao-catalog.sql), [value](../supabase/tests/ao-value-parity.sql), [G-01](../supabase/tests/ao-g01-timezone.sql), [L1-07 Phase B](../supabase/tests/helpers/ao-l1-07-phase-b.mjs), [L1-08](../supabase/tests/helpers/ao-l1-08-gap-closure.mjs), [L1-09](../supabase/tests/helpers/ao-l1-09-final-acceptance.mjs), [L1-10](../supabase/tests/helpers/ao-l1-10-p0-closure.mjs), [TypeScript domain model](../src/features/activities-opportunities/model.ts).
5. Completion/failure indicators were checked against **GitHub Actions logs on the audited head**, not against comments saying tests are planned.

**Evidence standard:** A test asserting a subset of a requirement earns *subset evidence*, not row-level PASS. Neither CI green nor a static regex proves unexecuted browser flows, privileges, chronology, or migration behavior. No new executable tests were added in this audit because a bounded follow-up plan is safer than expanding the current test suite without first distinguishing phase gates from genuinely uncovered requirements.

## C. Fifteen PARTIAL rows — exact disposition

**Disposition codes:** \`GATE\` = requires separate Product Owner authority or another delivery phase; \`TARGETED TEST\` = concrete fixture/browser cases needed; \`REVIEW + TEST\` = source/behavior review plus bounded evidence; \`CANDIDATE\` = mostly proven but not yet entitled to PASS by matrix wording.

| QA | Evidence already established | Precisely missing before full closure | Disposition |
| --- | --- | --- | --- |
| **01** | Legacy migration checkpoints PASS; AO guarded SQL installed only in fixture memory. | An authorized **additive migration artifact** following Library, from a clean historical migration baseline; catalogue after migration and rollback/feature-exposure plan. Explicit approval to enter that workstream is missing. | **GATE** |
| **04** | Catalogue checks no direct authenticated AO DML, no AO DELETE for executor and some external write privileges; L1-09 external snapshots PASS for selected AO mutations. | Verify the executor's complete cross-domain privilege matrix, plus before/after snapshots for other accepted mutation types and failure/rollback paths. Avoid assuming a handful of table grants covers every external relation. | **REVIEW + TEST** |
| **06** | Opportunity title/defaults, accepted/invalid creations and **48/48** TypeScript vs SQL stage/intent/target combinations. | All **six outcomes**, three applicability choices and G-05 hard-reject vs *warning-only* combinations across create/record/correct/Closed (e.g., Saved+Accepted warning is not a DB hard reject). | **TARGETED TEST** |
| **07** | Four Activity creation intents and **36/36** status/action combinations; mapping/status and sample actual fields matched TypeScript. | Historical imports with user-specified/missing actual dates, participation-confirmation provenance, and proof no intermediate fake events/timestamps are invented. | **TARGETED TEST** |
| **08** | Unknown, year, month, day, leap and Gregorian boundaries (including years 0001/9999), extra-key and selected invalid cases. | A *bounded cross-field mutation* matrix for start/end uncertainty overlap vs certain reversal, explicit Unknown/NULL vs omitted field, and invalid JSON shapes in both Opportunity and Activity. Not a demand for infinite fuzzing. | **TARGETED TEST** |
| **09** | Source-clock unresolved stored with UTC=NULL; changed Profile timezone did not rewrite a known instant. | Explicit **no precise countdown** / no guessed local time on unresolved or partial dates is a *presentation/UI* assertion; existing L1 database tests cannot prove it. | **GATE — L2 UI** |
| **10** | SQL G-01 corpus (DST gap/fold, offset bounds, UTC year limits), owner trigger, UTC immutability after Profile timezone change PASS. | A paired TypeScript \`parseDeadline\` vs real PostgreSQL resolved-instant / reject corpus including two DST fold offsets, invalid IANA-offset combinations and year-boundary cases; verify timezone rules/tzdb fixture assumptions. | **REVIEW + TEST** |
| **11** | Unicode/CRLF examples, 30/31 links, duplicate resource IDs, HTTP rejection, SQL code point checks. | Boundary parity for **label 120**, URL 2048, text field code points and whitespace families; HTTPS URL userinfo/control/backslash, accepted duplicate *URL* with distinct IDs, retained ordering and rejected update atomicity. | **TARGETED TEST** |
| **12** | RPC invalid metadata/date/resource rejection and unchanged accepted root/history; SQL catalog constraints. | Direct disposable PostgreSQL root constraints for invalid combinations, explicit SQL/JSONB NULL and overflow, immutable/system-owned fields; compare stable SQLSTATE as relevant. Tests must not alter product SQL or active DB. | **TARGETED TEST** |
| **19** | **48/48** stage-kind-target cases, Closed/Other LF note, Reopen clearing current reason/note, one outcome. | Seven Closed reasons (and invalid/missing Other note) across corrections; outcome after Closed with separate \`new_decision\` vs \`correction\` history, annotations and before/after retained. | **TARGETED TEST** |
| **20** | **36/36** Activity transitions; terminal correction and actual start set/clear/no-op; upcoming invariant. | Planned vs actual reverse/overlap PartialDate matrix; histories for corrected actual dates and no automatic actual start/end on transition, import or metadata edits. | **TARGETED TEST** |
| **21** | For all five link tables: wrong-owner composite FK failure, current-uniqueness, attached-time immutable, DELETE denial, detached-interval guard. | Verify detached old interval *survives* reattachment with a **new identity** and correct chronology, and relationship lifecycle/revision/history via owner RPC. | **CANDIDATE — 1 bounded test** |
| **22** | S1→S2 source replacement closes S1, stale-link and archived-source guard; archive race. | Test **S2→none→S1** with distinct new link identity; archived Opportunity retains already-attached source and source metadata/status never synchronizes to Activity. | **TARGETED TEST** |
| **23** | Four typed Opportunity/Activity × Goal/Quest links exercised; no-op/detach, deleted Quest privacy, sampled external snapshots. | Explicit cross-owner/archived/recurring-or-goal-bound/deleted Quest eligibility negatives; completed-but-unarchived Activity attach, archived-root fresh attach rejection, and broader no-membership/no-progress side effects. | **TARGETED TEST** |
| **32** | Exact snapshot parity for AO-only mutations, Goal/Quest context links, Activity source and metadata; Quest creation regressions separately green. | A **bounded** cross-domain snapshot set spanning AO stage/outcome, Activity status/correction, archive/restore, accepted/no-op/rejected/stale operations and relevant races. Compare Quest/Goal link/EXP/Calendar/Library without counting legitimate *fixture setup* as AO writes. | **REVIEW + TEST** |

**Finding:** none of these 15 rows can be defensibly flipped to PASS by reinterpreting the *existing* logs alone. QA-21 is closest to being closed with one explicit interval-relink assertion. QA-01 is blocked on authorization; QA-09 includes a different phase's browser UX and must **not** be silently waived or misrepresented as a database L1 PASS.

## D. Bounded follow-up work, not an endless CI loop

A single consolidated **test-only** batch can target the remaining SQL/wire gaps *if separately approved*; use the existing disposable runner and avoid duplicated scaffolding:

- **Batch T-A — P0 domain semantics (QA-06/07/19/20):** accepted uncommon Opportunity warning states, seven Close reasons, new-vs-corrected late outcome and audited history; historical Activity import actual dates and planned/actual invariant cases. Compare TypeScript model to real RPC where there is a matching pure function.
- **Batch T-B — P0 integrity and time (QA-08/10/11/12):** finite, declared table of PartialDate mutation and UTC/DST cross-language cases, URL/Unicode exact boundaries, direct SQL constraints and rejected-write unchanged-state assertions. Assert exact inputs/outputs and write any newly discovered difference as a blocker.
- **Batch T-C — P0 relationships and regressions (QA-04/21/22/23/32):** provenance detach/reattach, five-interval chronology, archived-root/target eligibility, linked Quest subtype negatives; before/after external-domain snapshots for a representative command set, including failures. Ensure each case has an explicit expected SQLSTATE or invariant, never generic "some error" as complete proof.
- **Batch T-D — UI (QA-09):** defer to authorized AO L2/G-06 route delivery and browser tests for unresolved-clock labeling and no countdown. A green existing Playwright suite on current main-derived UI does not prove future AO pages.
- **Migration authorization (QA-01/35):** remains a separate **Product Owner decision**, only after independently reviewing all P0 failures and deciding whether UI phase gating affects the requested release boundary.

**Stop rule:** If any batch surfaces business-SQL, schema, rights or contract divergence, keep a reproducible red test and return to the PO for a *separate* narrow fix approval. Do not self-repair review-only SQL under L1-11. If all scoped tests pass, update matrix **row by row**; unresolved matrix conditions remain PARTIAL. Do not infer that all 35 rows must become PASS for a phase-specific L1 SQL review without an explicitly approved staged acceptance policy.

## E. Release decision and review packet

- [x] **Latest audited commit and CI** pinned; three workflows successful.
- [x] **19 existing PASS** preserved (not independently reclassified here).
- [x] **15 PARTIAL** mapped to concrete residual requirements/phase gates.
- [x] **Review-only SQL guard** retained; no changes to SQL SHA pin, migration files or Cloud DB.
- [x] **Draft PR** remains unmerged and main unchanged as audited.
- [ ] **Remaining SQL/wire evidence** from T-A/T-B/T-C.
- [ ] **AO L2 UI evidence** for QA-09 and other UI-only acceptance conditions.
- [ ] **Additive migration packaging/clean migration rehearsal**, separately authorized (QA-01).
- [ ] **Independent architecture/security acceptance**, release plan, and explicit PO merge/deploy authorization (QA-35).

**Decision requested from Product Owner after reading this audit:** authorize *only* the bounded test batch T-A/T-B/T-C (not migration), or explicitly amend the acceptance phase boundaries. Keep QA-01 and the deploy/merge guard closed until then.

> This document is an **audit of evidence**, not proof of the untested requirements, not a deployment plan approval and not a waiver of approved AO requirements.
