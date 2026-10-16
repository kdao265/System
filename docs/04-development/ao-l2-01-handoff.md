# AO L2-01 local implementation handoff

Task authority: Product Owner request dated 2026-10-16 explicitly authorizes local
AO core UI/application implementation, tests and an uncommitted handoff. It
supersedes the historical documentation-only restrictions for this task only.
No commit, GitHub write, migration, deployment or acceptance-status change is authorized.

Baseline: `37ae506e11c1ca36e7b005a5504e48acf8cb057e`, verified by fetch and
`git ls-remote origin refs/heads/main`. Worktree: `D:\System\ao-l2`.
Branch: `feat/ao-l2-core-ui-v1`. Initial status clean; pre-existing worktree
HEADs/branches unchanged. The QA-10 worktree has not been accessed or modified.

Scope: approved AO requirements AO-FR-01–12, 17, 19–24 and ADR-024; reusable
isolated forms, temporal inputs, list/detail presentation and validated application
operations. Real routes retain their existing Auth/owner/onboarding gates and
unavailable state. No transport or preview route is introduced. Mock adapters
belong exclusively to tests. Domain model semantics, SQL, dependencies, shared
localization and other feature behavior remain outside this change.

## Delivery decision

**GO for independent code review of this isolated L2-01 slice. NO-GO for release,
route activation or deployment.** No QA acceptance or release gate is changed.
The full production build is **not passing**: Webpack compilation succeeds, but
Next's generated Dashboard page typecheck fails on an unchanged baseline file.
The AO source-only typecheck, scoped lint, 46 AO tests and isolated Chromium
checks pass. This is not an AO persistence or authenticated-route E2E acceptance.

## Independent review remediation (R2)

The PO reported **CHANGES REQUESTED** on the previous review ZIP and explicitly
authorized these local corrections. F-01 and F-02 are addressed for independent
re-review; reviewer acceptance and commit/PR authorization remain pending.

- **F-01:** application preparation rejects Correct Status from upcoming, ongoing
  and paused before adapter dispatch. UI availability uses the same terminal guard.
  Completed, ended_early and cancelled_before_start retain all six target choices,
  subject to existing domain date/state validation. Ordinary nonterminal actions
  continue through `activityTransition`. Invalid dates reject the entire operation.
- **F-02:** null drafts display **Not specified / Chưa cung cấp**, distinct from
  explicit Unknown. The placeholder cannot be selected as a new clearing action.
  Title-only creation retains the existing model's nullable defaults. Metadata,
  outcome and correction editors track date-edit intent and omit untouched date
  keys from the prepared request. Explicit Unknown sends `{precision:"unknown"}`;
  actual edits send their parsed specification. Omitted values still participate in
  validation through the revision-bound current snapshot, so an unchanged known
  actual date cannot silently become Unknown to make a target status valid.

Contract reconciliation uses [requirements sections 6 and 8](../01-requirements/activities-opportunities-v1.md)
and [architecture section 3.1](../02-architecture/activities-opportunities-v1.md),
plus unchanged `model.ts` nullable defaults and PATCH normalization. The architecture's
"empty optional input" describes an explicit cleared input, not a field the user
has never edited. Unknown is a date specification; null is absence of a specification.
Missing update keys preserve the current value. No new date precision, business rule,
SQL change or persistence mapping is introduced. Future adapters must preserve this
omission contract when mapping application commands to the approved backend.

Remediation changed nine of the existing 20 files: application.ts, temporal-input.ts,
ui/core-form.tsx, ui/lifecycle-form.tsx, ui/date-fields.tsx, the application and browser
test runners, tests/ao-l2/harness.tsx, and this handoff. No new inventory entries.

New unit coverage exhausts all six source statuses × six correction targets,
checks EN/VI operation availability, rejects invalid merged dates without any adapter
call or snapshot mutation, and distinguishes null/Unknown/omitted/edited values.
Browser assertions inspect UI-to-prepared-command payloads for both title-only
creations, both metadata editors, outcome recording, terminal correction, deliberate
Unknown clears and actual date edits. Untouched null, Unknown and known dates are
covered. Nonterminal ordinary transitions and invalid/partially cleared correction
dates are exercised in Chromium.

Current reruns: 46 AO tests, scoped lint, source typecheck, 21 Chromium interaction
scenarios and 132 screen/locale/width checks pass. Full project typecheck was rerun
and still reports only the unchanged Dashboard PageProps error. The full build was
not repeated for R2: bundled build.log and compiled-output inspection are retained
from the previous validation (Webpack compilation passed; full build failed).
The current source import graph and route-boundary tests were rerun. Since the
remediated modules remain unreachable from Production routes, no claim is made
that the prior compilation validates the new isolated component code; current source
typecheck and the freshly compiled Chromium harness provide that validation.

## Exact changed-file inventory

20 files: **2 tracked modifications and 18 new, untracked files**. Nothing staged.

| State | File | Purpose |
| --- | --- | --- |
| Modified | `src/features/activities-opportunities/ui/presentation.tsx` | Display Not applicable instead of Unknown outcome when selection does not apply. |
| Modified | `src/styles/activities-opportunities.css` | AO-scoped responsive form, date, focus, target-size and reduced-motion styles. |
| New | `src/features/activities-opportunities/application.ts` | Validated typed operations, adapter contract, receipt/error mapping. |
| New | `src/features/activities-opportunities/command-session.ts` | Mounted command identity, warning confirmation, pending lock and draft-safe outcomes. |
| New | `src/features/activities-opportunities/read-contracts.ts` | Future read-port contracts, summary projections and loaded-record filters. |
| New | `src/features/activities-opportunities/temporal-input.ts` | Lossless date drafts and delegation to approved temporal validators. |
| New | `src/features/activities-opportunities/ui/command-feedback.tsx` | Localized warning, validation and command outcome feedback. |
| New | `src/features/activities-opportunities/ui/core-copy.ts` | Feature-local typed English/Vietnamese copy. |
| New | `src/features/activities-opportunities/ui/core-fields.tsx` | Semantic text/select fields and code-point counters/errors. |
| New | `src/features/activities-opportunities/ui/core-form.tsx` | Opportunity/Activity create and metadata-edit forms. |
| New | `src/features/activities-opportunities/ui/date-fields.tsx` | Partial date/deadline inputs and source/local display. |
| New | `src/features/activities-opportunities/ui/lifecycle-form.tsx` | Explicit stage/outcome and Activity lifecycle/correction forms. |
| New | `src/features/activities-opportunities/ui/record-browser.tsx` | Interactive loaded-record search/filters and list states. |
| New | `src/features/activities-opportunities/ui/record-detail.tsx` | Overview, selection/participation, dates and safe resource presentation. |
| New | `tests/ao-l2-application.test.mjs` | 20 application, temporal, session and rendered-component tests. |
| New | `tests/ao-l2-browser.mjs` | Isolated loopback Chromium runner and sanitized evidence generation. |
| New | `tests/ao-l2/harness.tsx` | Synthetic React fixtures and adapters, test-only. |
| New | `tests/ao-l2/node-loader.mjs` | AO-scoped extension of the existing Node UI test loader. |
| New | `tests/ao-l2/transpile-loader.mjs` | Test harness TSX compilation using the existing TypeScript dependency. |
| New | `docs/04-development/ao-l2-01-handoff.md` | Scope, implementation, validation, limitations and review handoff. |

No shared UI/localization infrastructure edits. No changes to `model.ts`, routes,
Auth/Profile, Quest/Goal/EXP/Calendar/Library, SQL, RLS, migrations, workflows,
dependencies, lockfiles, Production configuration or QA matrix. No new dependency.

## Implemented functionality and application boundary

- Opportunity title-only creation, metadata editing, category/organization/priority,
  Entry Mode, independent Stage/Outcome/Applicability, Closed reasons and required
  Other note. Stage/Reopen/Correction and Outcome/Correction have separate commands.
  Domain hard failures stop dispatch; unusual combinations can be confirmed and saved.
  Accepted does not create Activity. Unrelated metadata edits do not reconfirm an
  existing warning. Untouched date keys are omitted on metadata updates; explicit
  Unknown is a deliberate clear, with browser payload regressions for both forms.
- Activity creation requires one explicit confirmed-plan, confirmed-started,
  historical-completed or historical-ended-early intent. No radio is preselected.
  Metadata edits exclude status. Ordinary lifecycle actions use the existing
  transition function and preserve dates; terminal-only Correct Status validates
  target and merged actual dates together, with a reason field. Nothing fabricates participation timestamps,
  Start/Complete events or EXP. Archived editors are read-only.
- Temporal controls support Unknown/Year/Month/Day, unresolved published clock and
  exact instant with explicit offset and optional matching IANA zone. Domain parsers
  handle calendar/DST/offset validity. Empty offset is not UTC zero. Source fields
  are retained; local formatting requires an explicit display zone. Uncertain dates
  have no UTC inference/countdown. Display conversion never changes source data.
- Lists support Unicode title/organization search, active/archive scope, category,
  Stage/Outcome or Activity Status filters, explicit empty/loading/error/unavailable
  states and open/next-page callbacks. Filters deliberately describe **loaded records
  only**. Detail sections render plain text, status labels and safe HTTPS resources.
  Relationships/history honestly remain unloaded placeholders.

Flow: UI draft → `prepareOperation` → existing domain normalization/state validators
→ immutable-by-copy typed command → injected `AoAdapter` → `parseAoReceipt` and
explicit application outcomes. The eight operation variants carry command ID,
subject kind/ID and decimal-string expected revision; no user ID or privileged key
is accepted. Application contracts are **not** claimed to be PostgREST wire argument
names. A future authenticated adapter owns that mapping and runtime read validation.

Pre-dispatch unavailable capability returns `unavailable` without calling transport.
Validated refusal returns `rejected`; explicit revision conflict returns `conflict`.
Thrown transport errors, malformed receipts and even an adapter's post-dispatch
`unavailable` response return `unknown`, since a commit cannot be ruled out. Success
requires a receipt bound to the attempted command; a historical replay does not
prove current state. No success is fabricated by application code.

Each mounted editor holds the original pending command/payload, disables duplicate
submission synchronously, and locks on success/conflict/unknown. Draft edits discard
old warning consent. Confirmation dispatches the exact reviewed normalized intent.
No automatic retries, browser persistence, reload recovery or optimistic state writes
exist in this slice. Pending state is in memory only.

## Production boundary and final audit

All six real routes remain protected disabled scaffolds:
`/opportunities`, `/opportunities/new`, `/opportunities/[id]`, `/activities`,
`/activities/new`, `/activities/[id]`. AO persistence/security activation has not
been approved. Existing owner/Auth/Profile/onboarding guards, route layouts, proxy,
no-store behavior and disabled-route tests are retained.

The interactive forms, lifecycle editors, list controls and detail rendering are
exercised only by the isolated harness. There is no preview route, client feature
flag, URL/storage/cookie availability bypass, Supabase adapter or AO database call.
The harness binds a temporary server to `127.0.0.1`; its browser aborts external
requests and receives only synthetic records. The server closes after testing.

Final source import-graph audit: **28 production entry files / 168 reachable modules**;
none reach the new isolated source modules or test harness. The existing shared
presentation receives no demo records. Browser globals occur only in the test
harness; interactive modules declare `use client`. Rendering the client DateValue
boundary from a server-compatible detail component uses serializable props.

**138 generated runtime JS/JSON files** retained from the prior Webpack compilation were
scanned in `.next/server` and `.next/static`: no harness markers, synthetic fixture
markers or isolated command UI copy were found. This output audit is not a claim
that the full build succeeded. The graph audit plus retained route tests establishes
the source boundary; runtime auth/database E2E has not been rerun.

Tracked diffs and all 18 new files were inspected separately. `git diff --check`
and no-index whitespace checks for new files pass. A source review and targeted
secret-signature scan found no credentials or private data. Generated artifacts are
confined to ignored `.e2e/ao-l2`, `.next` and Next's ignored declaration file.
The ZIP includes allowlisted source/evidence only, not those runtime caches or bundles.

## Validation commands and results

Commands ran from `D:\System\ao-l2`, Node **24.18.1**, Next **16.3.5**,
TypeScript **6.0.3**, using existing dependencies in the parent checkout. No install.
The environment required elevated execution for reliable local checks; the earlier
build retry was never executed because automatic approval review hit an account
usage limit, not because it judged the command unsafe. After the PO reported quota
recovery, package scripts/configuration and the installed CLI were inspected before
retrying the supported `--webpack` option.

| Command | Result |
| --- | --- |
| `node --test tests/activities-opportunities-domain.test.mjs tests/ao-l2-ui-boundary.test.mjs tests/ao-l2-application.test.mjs` | **PASS: 46/46**, zero failures/skips (15 domain + 11 existing route boundary + 20 new). |
| `node ..\node_modules\eslint\bin\eslint.js src/features/activities-opportunities tests/ao-l2-application.test.mjs tests/ao-l2-browser.mjs tests/ao-l2 --max-warnings=0` | **PASS**, exit 0, no warnings. |
| `node ..\node_modules\typescript\bin\tsc --noEmit --incremental false` | Passed before Next-generated page types existed; final check **FAIL**, exit 2, unchanged Dashboard generated PageProps error described below. |
| `node ..\node_modules\typescript\bin\tsc --noEmit --project .e2e/ao-l2/tsconfig.source.json` | **PASS**, exit 0. Inherits project strict settings; checks all `src` TS/TSX plus the AO TSX test harness, excluding generated `.next` page checks. Does not replace the failing full project check. |
| `node tests/ao-l2-browser.mjs` | **PASS: 21 interaction scenarios**, 132 screen/locale/width checks, 20 screenshots, zero browser console errors. Rerun after F-01/F-02 remediation. |
| `npm run build` | Initially blocked by absent environment configuration; with placeholders, Turbopack could not resolve parent `node_modules` beyond this worktree root. |
| `npm run build -- --webpack` | **FAIL** overall, exit 1 (prior validation, not rerun for R2). Optimized Webpack compilation **PASS** (48 seconds); generated Next page typecheck failed on unchanged Dashboard. |
| `git diff --check` plus no-index `--check` for every new file | **PASS**. |
| Source import graph / generated runtime marker / prohibited-path diff audit | **PASS**; counts and exact inventory in bundled `evidence/final-audit.json`. |

Build environment variables were **process-scoped only**:
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY=ao-build-placeholder-not-a-credential`,
`NEXT_TELEMETRY_DISABLED=1`. These are non-secret placeholders; no `.env` or
configuration file was created/changed, and no real Supabase endpoint was selected.

### Existing build blocker (not changed under AO scope)

`.next/types/app/dashboard/page.ts:39` reports TS2344: the Dashboard function's first
argument is `{ searchParams?: Promise<...> } | undefined`, which does not satisfy
`PageProps`. `src/app/dashboard/page.tsx:32–34` has a default whole argument (`= {}`),
making it optional. That source file, `tsconfig.json`, `next.config.ts`, package.json
and lockfile have **zero diff from the baseline**. No full baseline rebuild in a new
checkout was performed; attribution is based on the exact diagnostic and unchanged
source/configuration. The failure must be resolved in separately scoped work before
a green release build. It has not been bypassed, suppressed or fixed in another module.

### Browser/accessibility evidence and limits

EN and VI × 360/390/412/820/1024/1280px × 11 screens = 132 checks. Screens cover both
create forms, both metadata editors, both lifecycle editors, both lists, both details
and archived read-only editing. Long Vietnamese/Unicode strings were exercised.
No horizontal overflow, missing native input labels or tested interactive targets
under 44px were found. Keyboard Tab/focus styling passed; reduced motion was enabled.
Status/error content uses text and semantic live regions, not color alone.

Interactions cover invalid title, title-only save/receipt, warning confirmation,
Closed Other note, explicit historical Activity import, unknown/conflict/rejection/
unavailable states, metadata revision/lifecycle separation, untouched-null dates,
terminal correction, outcome/applicability, Unicode search/archive/open/next controls
and keyboard focus. Static rendering also checks localized forms, N/A badges,
uncertain-time labels and safe text. Domain tests cover DST gaps/folds and offsets.

20 synthetic screenshots are included; mobile/desktop Opportunity, list, detail and
Activity correction samples were visually inspected. This is isolated Chromium
component validation, **not authenticated Production-route E2E**, an automated WCAG
certification, screen-reader testing or cross-browser acceptance.

Not run: Docker/disposable database tests, SQL/wire/Production tests, full app E2E,
full-repository lint/test suite, Firefox/WebKit or screen-reader audits. No reason to
touch a database for this isolated UI slice. Existing Auth test source assertions
must not be confused with executing the Auth integration harness.

## Known limitations and remaining L2 work

1. Real read/write adapters, authenticated actions, capability verification and
   approved backend activation remain absent. Client validation cannot replace RLS
   or server validation. Source-level checks do not grant database/release approval.
2. The current wire list DTO omits selection applicability. The future read adapter
   must obtain/validate a complete projection before connecting these N/A-aware
   summaries; this task does not silently extend the SQL/model contract.
3. Search/filtering is local to loaded records. Server query validation, true cursor
   pagination, deadline filters and integrated list/detail navigation remain to wire.
4. Archive/Restore commands, Resource Link editing, real History, source provenance,
   derived Activities and contextual relationship pickers remain to implement in
   later authorized work. Detail placeholders do not imply those features exist.
5. No durable pending metadata, account-change handling, receipt-only reload recovery,
   exact retry UI or refreshed record loading is implemented. Unknown/conflict locks
   are intentionally conservative. Future integration must coordinate mounted editors
   and verified account state before exposing persistence.
6. Forms are complete core editors, not a final progressive-disclosure UX. Native
   semantic controls and source/local date display are present; additional usability,
   screen-reader and cross-browser review remains.
7. The existing Dashboard PageProps build blocker is unresolved outside this scope.
   Full build/release readiness is explicitly **NO-GO**.

## Portable review bundle

ZIP: `D:\System\ao-l2\.e2e\ao-l2\ao-l2-01-review-r2.zip`.
The original review ZIP is preserved. Sidecars: `ao-l2-01-review-r2.patch`,
`ao-l2-01-review-r2-manifest.json`, and `ao-l2-01-review-r2.zip.sha256` in the same directory.

Contents: all 20 changed/new files under `changes/`, complete tracked+untracked
`changes.patch`, selected unchanged baseline context under `reference/`, this handoff,
sanitized command logs, browser JSON and 20 screenshots under `evidence/`, plus a
README and SHA-256 manifest. No node_modules, `.env`, credentials, private user data,
database dumps, generated runtime bundles or unrelated temporary files are included.
The patch is for the exact recorded baseline; review it before applying in a separate
checkout. No Git index, commit, push, PR, merge or deployment was created here.

Work stops at local review handoff. Further repository writes or activation require
independent review and separate Product Owner authorization.
