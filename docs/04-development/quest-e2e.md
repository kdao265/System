# Quest browser lifecycle increment

Task contract: `feat/playwright-e2e-v1`, 2026-09-28. Extend the existing
[Playwright foundation](playwright-e2e.md) without redesigning its disposable
Supabase/app lifecycle. Scope: desktop UI creation, completion, exact EXP,
refresh, reopen/new-cycle completion, and two-tab convergence after reload.
No mobile mutations, visual snapshots, application feature changes, dependencies,
schema/RLS changes, Cloud/Local access, publishing or deployment.

Authority: [Quest requirements](../01-requirements/quest-engine.md),
[command contract](../02-architecture/quest-command-api-v1.md), ADRs 012–015 and
[operator bootstrap contract](../02-architecture/operator-authorization-v1.md).
Completion credits the occurrence's reward once per cycle; reopen reverses that
exact credit and advances the cycle. Recompletion earns a fresh credit, leaving
net EXP equal to one completion of that unchanged reward.

The Product Owner approved minimal Level-policy prerequisite provisioning strictly
inside the disposable E2E stack. `provisionE2ELevelPolicyPrerequisite` in
`tests/e2e/quest-prerequisites.ts` authenticates the generated owner with the
generated loopback configuration, reads the already-published `level_policy_v1`,
temporarily grants only `level_policy_assign`, and calls the real guarded
`assign_level_policy` RPC. It never inserts a policy assignment directly.

The exact temporary grant is revoked in `finally`, including when assignment fails.
The immutable audit row remains with `revoked_at` set; no active capability remains.
This follows the grant-retention contract rather than deleting authorization history.
Before the fixture yields to tests, it verifies the current policy, exactly one
assignment, zero active grants, the revoked audit row, and empty Quest/event/EXP
history. Replaying assignment with the still-authenticated owner must fail with
`42501`, proving that the RPC enforces revocation. The setup session is signed out
in an outer `finally`; browser tests still authenticate through the real login UI.

Each test creates a UUID-titled Quest through the real UI with an explicit 37 EXP
reward. Tests read the displayed EXP before and after every transition and reload;
assertions use the starting balance plus/minus that fixture-defined reward.
Dates use an explicit fixed selected day and UTC onboarding rather than the wall
clock. A SELECT-only helper counts immutable completion events and matching EXP
credits/reversals per cycle, because a displayed net balance alone could conceal
duplicate offsetting ledger entries. It never seeds or mutates Quest state.

Two-tab coverage uses two pages in the same authenticated browser context. Page A
mutates, page B reloads, and both must show the same authoritative state/EXP.
Realtime synchronization is not assumed. All mutations use accessible UI controls;
completion uses the existing recovery link to reload authoritative state.

## Validation and handoff — 2026-09-28

Status: implemented and validated. No final Quest
state, EXP, reward definition, schema, RLS policy or application behavior is seeded
or changed. The distinct Quest worker fixture isolates its owner from Auth's
unassigned-policy scenario; the original harness/configuration/mobile suite and
all production files remain unchanged by this increment.

Both scenarios passed in the focused run and again in the full suite. Completion
and refresh retained exactly one credit; reopening restored the starting balance;
cycle-two completion restored one net reward. Two pages sharing the browser
session converged after reload at every transition, with exactly two completion
events/credits and one reversal per test Quest after recompletion. No product
failure was exposed and no assertions were weakened.

| Requested check | Actual result |
| --- | --- |
| `npm run test:e2e -- --list` | 5 tests discovered; 2 Quest tests desktop-only |
| `npm run test:e2e -- --project=desktop-chromium quests.desktop.spec.ts --max-failures=1` | 2 passed; 47 seconds |
| `npm run test:e2e` | 5 passed; 1 worker; 1.9 minutes |
| `node --test tests/*.test.mjs` | 177 passed; no failures/skips |
| `node tests/auth-smoke.mjs` | Passed |
| `node supabase/tests/private-owner-wire.mjs` | 17 checkpoint suites and 10 security groups passed |
| `npm run lint` | Passed, zero warnings |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed using synthetic loopback configuration |
| `git diff --check` | Passed |
| Cleanup | No disposable containers, networks or app copies remain; existing 9-volume inventory unchanged |

The prerequisite proof passed before Quest assertions: the current assignment is
the published V1 policy, assignment count is one, active grant count is zero, the
exact temporary grant is revoked, and all Quest/event/EXP entry counts are zero.
The still-authenticated assignment replay is rejected with `42501`. Audit rows
are retained, so “grant absent” means no active authorization, not deleted history.

No commits, pushes, PRs, merges, deployments or Cloud/Vercel changes were made.
