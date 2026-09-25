# Reopen UI V1 recovery fixes

Scope: the Product Owner's three verified recovery bugs on `feat/reopen-ui-v1`.
Authority: [ADR-012](../02-architecture/decisions.md#adr-012--quest-reopen-v2-cycle-guard),
the [V2 contract](../02-architecture/quest-command-api-v1.md#10-reopen-v2-appendix),
and the existing [Dashboard recovery owner](quest-completion-recovery.md).

Acceptance: stale cycles remain blocked until a relevant server Quest read arrives;
definitive command conflicts preserve their immutable request without futile retries;
changed confirmed payloads block recovery and cleanup without replacing evidence.
Completion behavior and account isolation must remain intact. Add regressions and run
the focused Node suite, lint, TypeScript, and production build. Native browser behavior
is not established by the deterministic component host.

No database, SQL, dependency, branch, staging, commit, push, or PR changes are in scope.
Existing uncommitted work is preserved. The account-keyed provider, shared Web Lock,
server-rendered panels, and current-route refresh remain the architecture.

Implementation:

- Match the migration's exact SQLSTATE/message pairs: `23514` / `Stale quest
  reopen cycle`, and `23505` / `Conflicting quest command reuse`. Generic constraint,
  ownership, and receipt-integrity errors remain uncertain with the original request.
- A rejected request keeps its original V1 payload inside a V2 browser envelope
  with a `stale` or `conflict` disposition under its existing account/command key.
  Legacy pending records remain readable; older UI tabs fail closed on the new
  envelope. Writes and cleanup use the existing shared lock and read-back checks.
- The existing server Quest panel reports its validated result to the provider.
  A stale blocker is reconciled only when that result contains the affected
  occurrence with an advanced execution cycle. Failed reads, absent occurrences,
  unchanged or older cycles, other accounts, focus, and refresh dispatch do not clear it.
  The live owner still rejects late callbacks for reconciled stale cycles.
- Conflicts remain blocked for explicit reconciliation against command history;
  this fix does not invent a discard or automated reconciliation command.
- Inventory validation compares full pending, blocked, and confirmed payloads
  before filtering confirmed IDs or permitting cleanup. Corruption preserves known
  confirmation evidence and the changed stored record for inspection.

Limitations: if the selected day does not contain the affected occurrence, its
stale blocker remains until a relevant read is obtained. Browser eviction or failed
storage writes cannot guarantee durable recovery across reloads. The component
test router now has stable identity; the hook host still does not model native
React scheduling, hydration, or Next.js navigation/network completion.

Validation (2026-09-25):

- Test-first run: eight regression checks failed before implementation.
- `node --test tests/quest-completion-ui.test.mjs`: 43 passed, zero failed
  (eleven added tests and the strengthened stale-cycle regression).
- Adjacent Daily Quests suite: 20 passed, zero failed. Its standalone panel
  fixture now supplies the same provider as the Dashboard.
- `npm run lint`, `npx --no-install tsc --noEmit`, and `npm run build`: passed.
- No database or native browser checks were run. No Git staging, commits, pushes,
  branch switches, or PR creation were performed.
