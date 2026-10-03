# Recurring Series Management UI V1 lifecycle fixes

Task contract: implement the Product Owner's six reviewed UI lifecycle fixes on
`feat/recurring-series-management-ui-v1`, preserving existing uncommitted work.
References: Quest FR-18 / AC-36-37 and ADR-021; the recurring retirement handoff
records the unchanged backend and recovery contracts.

Scope: registry deactivation inheritance, authoritative pause detail invalidation,
command-bound fresh archive auto-close, stable hydration snapshots, focus during
pending retirement, closing the occurrence disclosure, and regression tests.
No new dependencies, migration/RPC/schema/EXP/recurrence backend changes, Cloud
access, db push/reset, commits or pushes. Existing disposable Playwright fixtures
are authorized for validation; they never target the preserved Local or Cloud stack.

The registry remains initially active and records lifecycle state before updating
existing controllers. New controllers inherit deactivation. Pause snapshots carry
a client-only invalidation version. Reconciliation invalidates details before its
lock wait and publishes a settled snapshot afterward. The modal reads authoritative
occurrence detail for that version and gates fresh actions until the read finishes.
No paused value is inferred from a historical command receipt.

Retirement results retain their existing pending command ID in client snapshot
metadata. Auto-close requires a different command from the result present at
opening, the selected quest, success, archive, and replay=false. Wire and storage
shapes are unchanged. The shared one-off lifecycle only gains result metadata;
its operation/recovery behavior is unchanged.

Normal close restores summary focus. Archive success or close with a selected-series
pending retirement focuses the archived panel (or stable Quest-tools fallback).
Escape remains available. Selection closes the owning details disclosure.

Validation results will be recorded after the requested checks.
