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
