# Dashboard Visual V2

## Task contract

Authority: Product Owner's Dashboard Visual V2 implementation request, 2026-10-01.
Branch: `feat/dashboard-visual-v2`, initially clean. This active implementation request
supersedes the initial governance-only restriction. No commits, pushes, merges,
deployments, dependencies, schema/RPC/RLS changes or real Local/Cloud access.

References: [V2 foundation](visual-ui-v2-foundation.md),
[Goals requirements](../01-requirements/goals-main-quest-v1.md),
[Calendar requirements](../01-requirements/calendar-schedule.md),
[Player/EXP](../01-requirements/player-exp.md), and ADR-010/012/013/015/017/018/019/020.
Compose existing authenticated feature reads and preserve lifecycle/recovery providers.
This is presentation within the accepted architecture; no new domain engine or ADR.

## Before changes and reference interpretation

The Dashboard was a narrow single column: large shell, separate identity and EXP cards,
creation form, recovery, Daily Quests, recurring definitions, rewards and logout.
Goals and Calendar existed on separate routes; neither had a Dashboard snapshot.
Quest creation, recurrence management and rewards have no separate route and must remain accessible.

The initial implementation used the supplied written reference description. On resuming
validation on 2026-10-01, both supplied images were present and visually inspected:
[reference A](../assets/ui-references/dashboard-v2-reference-a.png) and
[reference B](../assets/ui-references/dashboard-v2-reference-b.png).
Reference B guides the compact header and operational hierarchy; reference A guides
the atmospheric gold Main Quest identity. CSS horizon geometry interprets that atmosphere
without adding an external asset dependency. Unsupported mockup modules and values
(Stats, Library, streaks, Focus and activity history) are not manufactured.

## Acceptance and validation plan

Verify authenticated rendering, vi/en labels, Main Quest empty/live progress, exact EXP,
day states, navigation, completion/reopen, hydration and no overflow at 360/390/412 px
and desktop. Preserve and run Node, disposable Auth and Playwright suites, lint,
TypeScript, production build and diff checks. Final results and limitations follow below.

## Resumed WIP audit — 2026-10-01

Resumed the existing `feat/dashboard-visual-v2` worktree without reset, stash, checkout,
deletions, commit or push. The initial inventory contained 15 modified tracked files
and the new Dashboard feature, tests, handoff and reference images. Comparing current
`src` and `tests` against the prior interrupted `.e2e/validation-ZnwD8y` snapshot found
only one later preserved change: `lang="en"` on the reopen awaiting-refresh message.
No evidence of lost WIP was found.

Shared Quest audit: completion/reopen occurrence-cycle keys, coordinator subscriptions,
activation, submit/retry branches, offline guards and confirmation gates are unchanged.
The provider still encloses creation, recovery and Daily Quests, and `QuestReopenRead`
still feeds authoritative server reads to recovery. Recurrence pause/resume calls and
recovery are unchanged. Optional locale props default to English for other consumers;
changes to shared controls are presentation and translated labels. No action, lifecycle,
RPC, migration, schema, RLS, dependency or privileged-credential change is included.

The hero selects the first active Goal in the existing stable paginated UUID order,
then reads current detail. It displays existing live membership counts and domain progress;
there is no persisted featured-Goal preference. Calendar previews at most three existing
entries across the selected date and next six days, retaining existing day-membership
semantics. Level and EXP use the existing exact progression projection. Empty and failed
reads stay explicit. Mobile order is Player/Level/EXP, Main Quest, Daily Quests, Calendar,
Recurring, then existing creation/reward tools.

Validation uses generated disposable accounts and actual application/domain commands in
temporary infrastructure, never real owner data or invented production dashboard values.
The build-only copy excludes `.env*` and uses an unreachable synthetic loopback URL.
The Auth/browser harness allows only generated loopback origins, labeled UUID containers,
tmpfs PostgreSQL and its own isolated application copy.

## Changed-file inventory

- Composition and styling: `src/app/dashboard/page.tsx`, `src/app/globals.css`,
  `src/components/app-header.tsx`.
- New Dashboard reads/presentation: `src/features/dashboard/components.tsx`, `data.ts`,
  `model.ts`, `panels.tsx`.
- Existing Quest presentation: `src/features/quests/components.tsx`, `panel.tsx`,
  `completion-control.tsx`, `recurring-controls.tsx`, `recurring-panel.tsx`.
- Bilingual labels: `src/lib/localization/dictionaries.ts`.
- Node/HTTP regression compatibility: `tests/auth-smoke.mjs`, `tests/daily-quests.test.mjs`,
  `tests/progression.test.mjs`, `tests/rewards.test.mjs`, `tests/helpers/ui-loader.mjs`.
- New Node coverage: `tests/dashboard-visual-v2.test.mjs`.
- Browser coverage: `tests/e2e/quest-helpers.ts`, `dashboard-v2-fixtures.ts`,
  `dashboard-v2-helpers.ts`, `dashboard-v2.desktop.spec.ts`, `dashboard-v2.mobile.spec.ts`.
- Handoff and references: this file and the two linked `docs/assets/ui-references/` PNGs.

## Deliberately deferred

Recent Activity is omitted because no suitable existing Dashboard activity read was
composed; Stats, Library, streaks and Focus are likewise omitted. A featured-Goal picker,
scenic illustration assets and full translation of legacy creation/recovery/reward tools
remain outside this task. Existing English tools are retained and language-marked.
Real Local/Cloud testing, physical-device/Safari/Firefox validation, CI, PR creation and
publishing are not part of this disposable Chromium validation run.

## Validation findings and narrow corrections

The initial full browser run finished with 26 passes and four failures. Both new Dashboard
tests expected a `:focus-visible` outline after programmatic focus following pointer input.
The test now sends Tab and Shift+Tab and retains both focus and visible-outline assertions.
No application focus style was changed to accommodate the test.

The existing mobile hardening and PWA tests caught the new hero mountain decoration's
transformed box extending to about 409px at a 360px viewport. Page scroll width was already
correct because the artwork was clipped. The mobile CSS now anchors those shapes inside
the hero, retaining the strict existing element-bound assertions unchanged. Visual review
also found an unused ring column narrowing the unconfigured Level message; mobile states
without a ring now use the whole panel. The English non-completed count is labeled
"Not completed", matching its inclusion of failed/cancelled rows and the Vietnamese copy.
No Quest state or calculation was changed.

## Validation record — 2026-10-01

| Check | Result |
| --- | --- |
| `npm run lint` | Passed before and after corrections; zero warnings |
| `node --test tests/*.test.mjs` | 234 passed, zero failures/skips, before and after corrections |
| Production build | Passed before and after corrections via `.e2e/verify-dashboard-build.mjs`, which invokes the installed Next CLI in an environment-free source copy |
| Strict TypeScript | Installed `tsc --noEmit` passed in the same source/test copy, including browser tests, before and after corrections |
| `node tests/auth-smoke.mjs` | Passed: owner/Auth/Profile, refresh/logout and RLS checks; own resources cleaned up |
| `npm run test:e2e -- --list` | 30 tests discovered across desktop/mobile Chromium |
| Initial `npm run test:e2e` | 26 passed, four failures described above; 13.4 minutes |

The isolated-copy build emits the existing multiple-lockfile workspace-root warning;
build and typecheck still exit successfully. Playwright's color-environment warning is
also non-fatal. Neither warning required configuration or dependency changes.

Logs are in ignored `.e2e/dashboard-{lint,node,build,auth,e2e}-current.log` and
`.e2e/dashboard-{lint,node,build,e2e}-final.log`. Screenshots and browser reports are
local ignored artifacts under `test-results/` and `playwright-report/`; traces are not
published because they can include the disposable authentication session.

## Git status at handoff

All implementation remains uncommitted and unstaged. No commits, pushes, PRs, merges or
deployments were performed. Tracked diff: 15 files, 339 insertions and 141 deletions
(line replacements, no deleted files). The 12 untracked files are inspected separately.

```text
## feat/dashboard-visual-v2
 M src/app/dashboard/page.tsx
 M src/app/globals.css
 M src/components/app-header.tsx
 M src/features/quests/completion-control.tsx
 M src/features/quests/components.tsx
 M src/features/quests/panel.tsx
 M src/features/quests/recurring-controls.tsx
 M src/features/quests/recurring-panel.tsx
 M src/lib/localization/dictionaries.ts
 M tests/auth-smoke.mjs
 M tests/daily-quests.test.mjs
 M tests/e2e/quest-helpers.ts
 M tests/helpers/ui-loader.mjs
 M tests/progression.test.mjs
 M tests/rewards.test.mjs
?? docs/04-development/dashboard-visual-v2.md
?? docs/assets/ui-references/dashboard-v2-reference-a.png
?? docs/assets/ui-references/dashboard-v2-reference-b.png
?? src/features/dashboard/components.tsx
?? src/features/dashboard/data.ts
?? src/features/dashboard/model.ts
?? src/features/dashboard/panels.tsx
?? tests/dashboard-visual-v2.test.mjs
?? tests/e2e/dashboard-v2-fixtures.ts
?? tests/e2e/dashboard-v2-helpers.ts
?? tests/e2e/dashboard-v2.desktop.spec.ts
?? tests/e2e/dashboard-v2.mobile.spec.ts
```
