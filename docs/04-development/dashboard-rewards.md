# Dashboard Slice 3: Rewards Preview

Task: authenticated, read-only rewards preview on `feat/dashboard-rewards`.
Authority: [approved query contract](../02-architecture/ui-read-query-v1-draft.md#34-level-reward-definitions-and-unlock-history-approved-defer-backend-pagination), [requirements](../01-requirements/level-rewards.md), and the `level_reward_listing` type / `list_level_rewards()` in migration `20260920050000_create_level_rewards.sql`.

Scope: feature adapter, strict full-response validation, first five rows in SQL order, independent Suspense panel, accessible states and full-navigation retry. SQL owns lifecycle; archived state is separate. No history request, writes, configuration, redemption, dependencies, SQL changes, frozen-document changes or Git writes.

Transport: request all 14 fields, casting only numeric estimated_cost and bigint revision to text through PostgREST select. This retains exact decimals and bigint values before JSON parsing without changing the function. Require exact text for those fields; reject numeric fallbacks. Required Level is a nonnegative PostgreSQL int (including zero). Nullable fields must be explicitly present. Validate the entire returned array before taking the preview prefix. Do not reconstruct lifecycle from receipt fields.

Auth: use the existing cookie-aware server client and verified session. Permission/token RPC errors trigger fresh Auth verification; only confirmed expiry offers inline sign-in recovery. Generic and inconclusive failures stay panel-local. Existing Dashboard profile/auth gates remain unchanged.

Acceptance/validation: synthetic Node tests follow existing frontend conventions and cover fields, numeric boundaries, lifecycle, failure/recovery, streaming isolation, retry and markup accessibility. Run focused/all frontend tests, lint and production build. No database-writing smoke tests. Live browser/database verification, if unavailable, must be reported explicitly.

Implementation handoff (2026-09-23):

- Added `src/features/rewards/model.ts`, `data.ts`, `components.tsx`, and `panel.tsx`; integrated the independent panel in `src/app/dashboard/page.tsx`.
- Added `tests/rewards.test.mjs`. Existing `tests/daily-quests.test.mjs` and `tests/progression.test.mjs` only gain inert Rewards mocks for their focused suites; the Rewards suite renders the real Dashboard and sibling panels.
- `node --test tests/rewards.test.mjs`: 10/10 passed. `node --test tests/*.test.mjs`: 53/53 passed. `npm run lint`: passed. `npm run build`: passed, including strict TypeScript. An initial new-file encoding failure was corrected before the successful build. `git diff --check`: passed.
- Tests cover the real Supabase client's request construction with a synthetic fetch response, including exact text projection and absence of eager history. Live authenticated PostgREST execution and browser/screen-reader review were not performed. Accessibility coverage is server-rendered semantic markup and responsive/wrapping classes.
- Preview size is five. The RPC still fetches its full V1 response (backend pagination is deferred by the contract). Cost/revision remain validated metadata and are not displayed.
- No SQL, database writes, installs, frozen-document edits, commits, pushes or branch changes performed.
