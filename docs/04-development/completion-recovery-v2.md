# Completion Recovery V2

Task authorized by the Product Owner on 2026-09-27, on the existing
`feat/completion-recovery-v2` branch. Scope: resolution validation/data/action,
backward-compatible browser dispositions, recovery transitions/UI and mocked
regressions. No dependencies, SQL, database access, branch changes or Git writes.
The referenced Cline attachment was not available in the session.

Authority: ADR-013, Quest requirements FR-04/05/14/15/16, the command API
amendment, and `supabase/migrations/20260926120000_quest_completion_aliases.sql`.
The existing account-keyed provider, immutable request and origin-wide Web Lock
remain the coordination boundary. This implements the approved alias recovery
boundary without changing the database architecture.

Acceptance: every uncertain retry checks resolution first. Only validated
`unrecorded_current` permits redispatch of the exact saved mutation. Resolver
errors retain the request and offer another check. Recorded outcomes confirm
historical effects, never current Quest/EXP state. Conflicts block redispatch.
Legacy superseded outcomes retain the immutable request and full canonical/undo
evidence in a version-two terminal envelope, including after acknowledgement.
Acknowledgement changes presentation only; it never deletes historical evidence.
Old version-one requests remain readable; older clients fail closed on envelopes.

Contract verification: resolution has exactly 12 fields, version 1 and four
outcomes: `recorded`, `unrecorded_current`, `unrecorded_superseded`, `conflict`.
Current status is one of draft/scheduled/active/completed/failed/cancelled.
Recorded receipts echo the requested command; canonical receipts use a different
canonical command. Both are strict ten-field receipts with replay true, nullable
reported time and exact nonnegative bigint EXP. Superseded requires an older
cycle, canonical receipt and all three undo identifiers; recorded/conflict have
no canonical or undo evidence. Current has a canonical receipt only if completed.
Conflict is checked before the future-cycle rejection, so conflict may carry an
expected cycle ahead of the current cycle. Generic `23514` is not stale: only
`Stale quest completion cycle` identifies that rejection. History inconsistency,
unknown subjects, ahead-of-current and generic server/transport failures never
authorize mutation retry or deletion of uncertain evidence.

Validation uses only Node service/browser mocks, lint, TypeScript and production
build. No database target will be contacted or migration applied. Migration ten
must be deployed under its separate rollout procedure before using this frontend.

## Initial V2 validation and handoff (before review fixes)

2026-09-27, database-free validation of the initial V2 revision:

- `node --test tests/*.test.mjs`: 163 passed, 0 failed, 0 skipped/cancelled.
  The Completion/Reopen file contributes 70 tests, including 27 new regressions.
- `npm run lint`: passed, zero warnings. An initial unused test parameter warning
  was fixed before the final run.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `npm run build`: passed compilation, TypeScript and all three static pages.
- `git diff --check`: passed; tracked changes and new files reviewed separately.

Modified files:

- `src/features/quests/completion-action.ts`
- `src/features/quests/completion-control.tsx`
- `src/features/quests/completion-pending.ts`
- `src/features/quests/completion-provider.tsx`
- `src/features/quests/completion-recovery-ui.tsx`
- `src/features/quests/completion-recovery.ts`
- `src/features/quests/completion-resolution.ts` (new)
- `src/features/quests/completion-resolution-data.ts` (new)
- `src/features/quests/completion-resolution-action.ts` (new)
- `tests/quest-completion-ui.test.mjs`
- `docs/PROJECT_CONTEXT.md`
- `docs/04-development/completion-recovery-v2.md` (new)

Unresolved deployment/validation limits: migration ten remains unapplied to
existing Local and Cloud; a missing resolver fails closed and cannot finish
recovery until the separate backend rollout. All new RPC responses are mocked;
no database integration tests or native browser hydration/multi-tab smoke tests
were run. Cross-tab and component tests use the existing deterministic browser
and lock doubles. `router.refresh()` cannot report asynchronous network/render
failure; the selected-date reload link remains available.

Legacy terminal evidence is durable in this browser's account-scoped storage,
not server-backed or cross-device; manual browser-data clearing/eviction can
destroy it. The application never removes it on acknowledgement. A failed write
retains the original pending request and in-memory evidence, blocks further
mutation, and offers storage recovery; reloading can resolve that pending request
again. Conflict dispositions require external history reconciliation and do not
offer a destructive dismissal or automatic replacement command.

No branch change, staging, commit, push, PR, dependency or database change.

## Independent review fixes (2026-09-27)

The Product Owner authorized targeted fixes for cross-tab evidence reconciliation
and case-insensitive UUID identity validation on the same feature branch.

Terminal merges compare the unchanged original request and all historical receipt
and undo facts, separately from `current_execution_cycle` and `current_status`.
Acknowledgement is OR-merged, a validated conflict resolution enriches a null
resolution, and a higher observed cycle wins. At equal cycles the durable record
wins: the RPC has no observation timestamp, so status alone cannot establish
which snapshot is newer. This preserves the full chosen observation without
inventing a lifecycle status ordering or changing the V1/V2 storage format.
All inventory comparisons finish before restoration writes, under the existing
shared Web Lock. Incompatible historical evidence still blocks recovery.

Validated UUID values are compared without regard to letter casing, including
nested receipt identities and canonical/undo distinctness. Saved request payloads
and storage keys retain their original representation. Historical evidence
comparison also treats UUID casing and equivalent exact EXP representations as
the same value; changed identities, cycles, amounts and timestamps remain errors.

Seven additional regressions cover failed terminal writes followed by another
tab's updated, acknowledged observation; same-cycle and later-cycle observations;
stale writes and V1 restorations; null-to-resolved conflicts; incompatible request
and historical evidence; mixed-case identity collisions; and recorded-result
cleanup failure without mutation redispatch. Before the fixes, six of these
seven tests failed; the strict corruption test passed against the pre-fix code.

Final validation after review fixes:

- `node --test --test-reporter=spec tests/*.test.mjs`: 170 passed, 0 failed,
  0 skipped/cancelled. Completion/Reopen contributes 77 tests.
- `npm run lint`: passed, zero warnings.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `npm run build`: passed compilation, TypeScript and all three static pages.
- `git diff --check`: passed; tracked diff and untracked files reviewed.

Files changed for these fixes: `completion-pending.ts`, `completion-recovery.ts`,
`completion-resolution.ts` and `completion-receipt.ts` under `src/features/quests`,
`tests/quest-completion-ui.test.mjs`, and this handoff. Other pre-existing edits
were preserved. No dependency, migration, database, branch, staging, commit or
push operation was performed. Native browser and migration-ten RPC integration
remain unverified; the existing deployment and browser-storage limits above apply.

## Phase 2A migration-ten wire integration (2026-09-27)

Task: exercise migration ten's `get_quest_completion_resolution_v1` and the ten-field
completion receipt over real PostgREST HTTP, then feed the unmodified wire payloads into
the real frontend validators. No production file, migration, dependency, branch, commit,
push or deployment was involved, and the operator's System Local stack, Supabase Cloud,
`.env.local`, `supabase/config.toml` and the Supabase CLI were never used.

Harness: `supabase/tests/quest-completion-resolution-wire.mjs` with
`supabase/tests/helpers/wire-server-client.mjs`. Each run creates its own Docker network,
a `public.ecr.aws/supabase/postgres:17.6.1.166` container on tmpfs with no volume, bind or
published port, and a `public.ecr.aws/supabase/postgrest:v16.2` container published on
`127.0.0.1` only. Migrations one to ten are applied inside that container. Every resource
carries `system.test=completion-recovery-v2a` and `system.run=<run id>` labels, is verified
by immutable ID before removal, and is removed by that ID in a `finally` block that then
proves no container from the run remains. No image is pulled and no existing container,
network or volume is read or touched.

Client path: the real application modules (`create-data`, `completion-data`,
`reopen-data`, `completion-resolution-data`) and the real validators
(`completion-resolution`, `completion-receipt`, `create-receipt`, `reopen-receipt`) run
against the disposable runtime. The only substitution is `@/lib/supabase/server`, which
needs Next request cookies: the harness injects the disposable URL and a per-identity
session cookie into the real `@supabase/ssr` `createServerClient` with its production
options. The installed client builds `<url>/rest/v1/rpc/<fn>`; a loopback recording
adapter strips only the `/rest/v1` prefix, so PostgREST receives its own `/rpc/<fn>` path
and every assertion reads PostgREST's own status and body bytes. The disposable
`pgrst_wire_authenticator` login holds exactly `anon` and `authenticated`, and is proven
to hold neither `service_role` nor superuser or BYPASSRLS.

Result: PASS, 31 checks over 29 real HTTP exchanges, exit code 0.

- All four outcomes over HTTP: `recorded` (canonical and durable alias after Reopen),
  `unrecorded_current` (live and completed cycle), `unrecorded_superseded` (a genuinely
  unrecorded legacy command) and `conflict`. The resolver echoes the requested command,
  occurrence and cycle, returns exactly the twelve contract fields with strict ten-field
  nested receipts, and every payload was accepted by `validateCompletionResolution` for
  its exact identity, cycle and outcome while near-miss variants were refused.
- The superseded request is proven unrecorded (0 Quest events, 0 aliases) while the
  canonical command keeps its single event and no alias, and the resolution's
  correction, reopened and reversal identities plus canonical receipt match the Reopen
  receipt exactly, including the reversal's link to the canonical credit. No resolution
  call created an event, alias or EXP row.
- Observed wire serialization: `exp_amount` (bigint) arrives as a JSON number and
  `recorded_completed_at` as `YYYY-MM-DDTHH:MM:SS.ffffff+00:00`, both accepted by the
  existing validators; `reversed_amount` arrives as a negative JSON number.
- Observed PostgREST envelopes: 42501 maps to 401 for the anonymous role and to 403 for
  an authenticated caller, 23505 to 409, 23514 to 400 (only `Stale quest completion
  cycle` identifies staleness), an invalid JWT signature to 401/PGRST301, and an unknown
  parameter to 404/PGRST202. Each case asserts the exact SQLSTATE and message.
- Owner isolation holds on the read and mutation paths, and an aliased command requested
  with a foreign occurrence or cycle resolves as a conflict, never as a mismatched
  receipt. This corrected an earlier reading of migration ten: `completion_binding`
  compares the requested occurrence and cycle after both its branches, so aliases are
  conflicts on identity mismatch too. No product code was altered.

Unavailable or out of scope for Phase 2A: no browser or Next.js runtime was launched, so
the server action `resolveQuestCompletion`, the cookie plumbing, multi-tab Web Locks and
the recovery UI still rely on their existing mocked suites; this harness is not yet wired
into `.github/workflows/quest-creation-ci.yml`; and the two-session concurrency suites
still require their own runners.

Repository checks after the change: `node --test tests/*.test.mjs` 170 passed and 0
failed, `npm run lint` zero warnings, `node node_modules/typescript/bin/tsc --noEmit
--incremental false` passed, `git diff --check` passed. The two harness files were untracked, while
`docs/04-development/completion-recovery-v2.md` and `docs/PROJECT_CONTEXT.md`
were modified. Migration ten remains undeployed. No commit,
push, PR or dependency change was made.

## Phase 2A static-review safety hardening (2026-09-27)

Independent review found that the initial disposable harness removed a recorded
container ID even when its identity/isolation re-verification failed; a listener
created during startup could also escape cleanup if readiness failed before
`startEnvironment()` returned. The harness now refuses removal of any container
whose immutable ID, name, labels or isolation checks fail; it continues
independent cleanup and reports all failures. Stopped containers can be
verified from immutable inspect metadata. The loopback adapter is registered
immediately after creation so startup errors still close it. Disposable
credentials use `randomBytes`, and each run ID includes a random suffix.
SIGINT/SIGTERM trigger best-effort graceful interruption and scoped cleanup;
forced termination or a Docker daemon outage can still leave resources for
manual inspection, and the harness will report them rather than bulk-delete.

The patched JavaScript modules passed `node --check`; three mocked teardown
regressions passed (mismatched identity is never removed, complete verified
cleanup, and continuation after a separate removal failure). The initial
Cline run reported 31 checks over 29 real HTTP exchanges and exit 0, but
**the hardened harness has not yet been rerun against live Docker**. Native
browser / GoTrue, the Next.js server action and GitHub CI remain unverified.
