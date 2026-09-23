# Dashboard Slice 2: Daily Quests

Branch: `feat/dashboard-daily-quests`.

Task contract: add a read-only Dashboard panel using the authenticated server
Supabase client and the approved [UI read contract](../02-architecture/ui-read-query-v1-draft.md#33-day-quest-occurrences-implemented-list_day_quest_occurrences).
The actual response is defined by migration `20260922000000_create_day_quest_reads.sql`.
Related requirements: Quest FR-14/15 and Auth/Profile timezone onboarding.

Acceptance: validate all twelve SQL fields; distinguish empty, malformed, RPC,
timezone and session failures; preserve server ordering, membership and readiness;
display title, status, optional times, snapshot EXP, readiness and profile-local
day context. Keep Player/EXP visible when the Quest read fails. Provide loading,
retry and timezone repair through the existing Profile save action.

Scope excludes Quest writes, SQL/schema changes, new dependencies, frozen-document
changes, staging, commits, pushes and merges. No architecture change is proposed.

The default RPC call has no date argument. The selected day is labeled “Today
(profile-local day)”: the frozen response does not return the resolved calendar
date or timezone metadata, including for an empty day. Do not infer that date from
occurrence timestamps or the browser clock. Timestamps are formatted for display
in the loaded Profile timezone; no membership or readiness rules run in React.

Timezone repair uses `/onboarding?repair=timezone`, which only bypasses the
completed-profile redirect. Authentication, missing-profile handling, the existing
form, owner-scoped save action and database validation remain in force.

Quest session failures remain inline; RPC permission failures alone never cause
a login redirect. Auth-like RPC failures trigger fresh Auth verification using the
existing server client. Only a confirmed missing/expired session offers sign-in
recovery; inconclusive checks remain generic panel failures.

Validation commands: `node --test tests/daily-quests.test.mjs tests/progression.test.mjs tests/timezones.test.mjs`,
`npm run lint`, `npm run build`, and `git diff --check`.

Validation result (2026-09-23): 43/43 tests pass across Daily Quests, progression
and timezone suites. Lint passes with zero warnings. The production build passes,
including strict TypeScript checking. Tracked diffs and all new files were
reviewed; whitespace checks pass. The new tests cover real adapters, server
rendering/streaming, page isolation, retry navigation, repair routing and the
existing Profile save action with mocked Auth/transport.

Limitations: no live Supabase or browser visual verification was performed in
this slice. The existing day-read migration must be deployed in the target
environment. Only already-materialized occurrences can appear; this slice adds
no generation or write commands. Day/timezone context uses the loaded Profile
and the RPC's default-day semantics, not additional response metadata. No
automatic midnight refresh or alternate-day selection is included.
