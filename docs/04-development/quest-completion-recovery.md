# Quest completion recovery repair

Scope: the Product Owner's “Fix Four Verified Completion Merge Blockers and Broken Tests” task on `feat/quest-completion-ui-v1`. No SQL, dependencies, CI, database or Cloud changes, or Git writes are authorized.

Baseline reproduced before edits: the isolated `storage-removal failure` test fails on an unset shared RPC counter; TypeScript reports TS2367 for the row control's obsolete `success` and `rejected` phases.

## Decision: one Dashboard owner

Status: accepted within the task's explicit authorization for a stable Dashboard client provider. This records the implementation choice before coding; no database or domain architecture changes.

A client provider keyed by authenticated account owns one completion coordinator. Server-rendered panels and their Suspense boundaries remain children of the provider. Recovery and rows consume that exact context instance. Only the provider subscribes to Auth/storage/focus and manages owner activation. Row handles cancel only their own queued work on unmount; a dispatched response still settles in the living owner. Same-account notification is idempotent. A different account requires a new keyed provider, never retargeting an old coordinator.

Alternatives: the previous module singleton needs explicit lifetime/reference counting and risks stale dependencies; independent row/recovery instances cannot preserve one authoritative in-memory inventory. Neither is retained.

Under one origin-wide completion Web Lock, new submissions validate and merge stored/in-memory inventory, block unreadable or changed records, and defer to the original command for an unresolved occurrence/cycle. Confirmations remain keyed by command with independent cleanup status and immutable historical messaging. Cleanup retries acquire the same lock and never send RPCs. Client refresh invokes Next's current-route refresh, retaining the selected date and provider state; a date-preserving full-navigation fallback remains available.

Authority: [Quest command contract](../02-architecture/quest-command-api-v1.md), [approved creation recovery boundary](../02-architecture/quest-creation-v1-contract.md#frontend-recovery-boundary), and ADR-001/010. Receipts establish historical effects only; current Quest status, EXP and Level remain server reads.

Validation requires the isolated cleanup test first, then focused/all frontend tests, lint, TypeScript, production build and diff review. Tests must exercise shared component wiring, row cancellation, unreadable and missing inventory, independent confirmation cleanup, actual refresh callbacks, and exact RPC dispatch counts. Browser hydration and real multi-tab scheduling remain separate smoke checks.

## Validation results (2026-09-25)

- Isolated `storage-removal failure` test: 1 passed, 0 failed; its own send stub records the asserted requests.
- `node --test tests/quest-completion-ui.test.mjs`: 27 passed, 0 failed.
- Each of those 27 regressions also passed in its own fresh Node process with an exact test-name filter.
- `node --test tests/*.test.mjs`: 120 passed, 0 failed.
- `npm run lint`: passed with zero warnings.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed; obsolete phase comparisons removed, no error suppression.
- `npm run build`: passed, including Next.js compilation, type checking and page generation.
- `git diff --check`: passed; tracked diff and untracked completion files reviewed separately.

The component tests load the actual provider, row controls and Recovery, execute their effects, cleanups and button handlers, and assert rendered markup. They use a deterministic hook/context host and external Auth/RPC/cache/router/browser doubles; they do not run native React DOM scheduling, hydration or a real Next.js navigation. The progression suite's unrelated Dashboard harness uses a pass-through provider mock; completion wiring is covered separately by the dedicated component tests.

Regressions cover one owner with two rows plus Recovery, row removal before/after dispatch, keyed account transitions, retained requests after account rejection or unavailable/corrupt/removed storage, stale-tab duplicate prevention, lost-response replay, multiple enabled cleanup controls while refresh is required, nonrecursive locking and queued cancellation, and the actual Recovery refresh handler after server invalidation failure. Historical messages never update current Quest status or client EXP/Level.

Local browser acceptance remains: hydrate the Dashboard; complete a Quest while its row disappears; exercise two native tabs and delayed lock acquisition; retry a lost response after reload/account transitions; and refresh all three panels on a non-today selected date. Next.js `router.refresh()` returns void, so the app can catch an immediate throw but cannot await or detect a later network/render failure through that API. The confirmed receipt, refresh control and date-preserving full-navigation fallback remain available.
