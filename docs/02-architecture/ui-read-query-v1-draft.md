# UI read/query layer V1 — approved contract

Status: **Approved V1 read contract.** The V1 read layer decisions were approved by the Product Owner and the day-read RPC is **implemented and validated locally**: migration `20260922000000_create_day_quest_reads.sql` is applied to the fresh local Supabase database, both new test suites pass, and the full backend regression passes 11/11 after a fresh local reset. The Git commit, PR and merge are **pending** (section 6). This document describes the frozen frontend read/query contract plus its current implementation status; no frontend code, cloud deployment or further SQL is authorized by this document yet. Branch: `feat/ui-readiness-v1`.

Authority: [Quest physical schema](quest-database-schema.md), [Quest event payload V1](quest-event-payload-v1.md), [Quest command API V1](quest-command-api-v1.md), [Player/EXP physical design](player-exp-database-schema.md), [Level/reward physical design](level-reward-database-schema.md), [Level/reward domain model](level-reward-domain-model.md), [operator authorization](operator-authorization-v1.md), [Auth/Profile physical design](auth-profile-database-schema.md) and the six implemented migrations under `supabase/migrations/` (including `20260922000000_create_day_quest_reads.sql`). Code and migrations are the source of truth for current behavior; the frozen documents above remain the source of truth for intent. Where this document and a frozen document appear to conflict, the conflict is listed in section 8, not silently resolved.

## 1. Scope

The Quest → EXP → Level/Reward vertical slice has passed local reset, behavior, catalog/security and full regression tests. This document defines the minimum frontend read/query contract for the existing implementation so UI work can begin without recalculation, duplication or privilege drift. Four capabilities are covered:

1. Player profile and dashboard summary.
2. EXP/Level/progression state.
3. Today's Quest occurrences with status, execution cycle and completion eligibility.
4. Level reward definitions and unlock/redemption history.

Out of scope: any write path (Quest definition CRUD, scheduling/materialization, completion/reopen invocation payloads, reward configuration/redemption), pagination of Quest definition lists beyond what direct table reads already support, chatbot/Telegram/n8n transport specifics (section 7 covers compatibility only).

## 2. Current capabilities inventory

### 2.1 Public read routines (granted to `authenticated`)

| Routine | Returns | Identity source | Notes |
| --- | --- | --- | --- |
| `public.get_current_exp()` | `numeric` exact EXP sum | `system_internal.request_user_id()` | SECURITY INVOKER; sum over `exp_ledger`. Transport as decimal integer string; no JS `Number` coercion (migration comment freezes this). |
| `public.get_progression_status()` | `public.progression_status` composite | `system_internal.request_user_id()` | SECURITY INVOKER; returns `available`, `current_exp`, `current_level`, `highest_level`, `policy_id/key/version`, `current_level_required_exp`, `next_level`, `next_level_required_exp`. `available=false` when no assigned published policy; Level fields NULL in that case. |
| `public.list_day_quest_occurrences(p_day date DEFAULT NULL)` | set of day-occurrence rows (12 columns) | `system_internal.request_user_id()` | **Implemented** in `20260922000000`. STABLE SECURITY INVOKER, `search_path = pg_catalog`, EXECUTE granted to `authenticated` only (default PUBLIC and sibling roles revoked). `p_day NULL` = today in the profile timezone; `PZ001` on missing/invalid timezone; `42501` when unauthenticated. Full contract in section 3.3. |
| `public.list_level_rewards()` | `SETOF public.level_reward_listing` | `system_internal.request_user_id()` | SECURITY INVOKER; derived lifecycle `LOCKED`/`UNLOCKED`/`REDEEMED`, unlock ID/time, redemption event ID/time. Ordered `required_level, id`. No filters/pagination. |
| `public.get_reward_history()` | `SETOF public.level_reward_events` | `system_internal.request_user_id()` | SECURITY INVOKER; full event rows ordered `recorded_at, id`. No filters/pagination/limit. |
| `public.complete_quest_occurrence(...)` / `public.reopen_quest_occurrence(...)` | receipt composites | `system_internal.request_user_id()` | Write commands (SECURITY DEFINER, frozen contract, unchanged). Listed because completion eligibility for the UI is defined by the same rules the command enforces. |

### 2.2 Direct table reads (RLS owner-scoped, `SELECT` granted to `authenticated`)

- `public.profiles` — policy `profiles_owner_select`; already used by `src/features/profile/session.ts`.
- `public.quests`, `public.quest_recurrence_rules`, `public.quest_occurrences`, `public.quest_events` — policies `*_owner_select`, rewritten in the EXP migration to use `system_internal.request_user_id()`. Existing access-pattern indexes (`ix_occurrence_schedule`, `ix_occurrence_deadline`, `ix_quests_owner_active`, etc.) already cover owner + status + time filters.
- `public.level_policies` (published only), `public.level_thresholds` (published policies only), `public.progression_policy_assignments`, `public.level_milestones`, `public.level_reward_definitions`, `public.level_reward_unlocks`, `public.level_reward_events` — owner- or published-scoped SELECT policies using `system_internal.request_user_id()`.

### 2.3 Frontend infrastructure

- Cookie-aware Supabase clients: `src/lib/supabase/client.ts` (browser, anon key only) and `src/lib/supabase/server.ts` (`readOnly` mode for Server Components). Only `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are referenced; no service-role secret reaches the browser.
- Identity: `src/features/auth/session.ts` derives the user from `supabase.auth.getUser()`; `src/features/profile/session.ts` caches the render-scoped profile context. No `user_id` is ever read from client input.
- Dashboard: `src/app/dashboard/page.tsx` renders profile only; no Quest/EXP/Level reads are wired yet.

### 2.4 Read-capability status

1. **RESOLVED — day-occurrences read routine (was the only genuinely missing V1 read).** `public.list_day_quest_occurrences(p_day date DEFAULT NULL)` is now implemented and validated (migration `20260922000000`, behavior + catalog/security suites, 11/11 regression on a fresh local reset). The UI still must not derive eligibility itself (frozen rule): eligibility rules live in `complete_quest_occurrence` (status in `draft|scheduled|active`, nonnull `reward_exp_snapshot`, `execution_cycle` match — plus mandatory progression recognition) and the routine projects them server-side as `progression_ready`/`completable`.
2. **PENDING — occurrence materialization command (separate future write-path milestone).** No routine creates recurring occurrences from `quest_recurrence_rules`; `source_slot_date` is only populated by a future command. This is explicitly **not part of the V1 read layer**: until that separate reviewed write milestone exists, the day read can only return occurrences created by another implemented write path (e.g. one-off draft/schedule commands, also not yet implemented). The implemented read contract in section 3.3 was designed so the materialization milestone can be delivered afterwards with no read-side schema change — recurring rows simply start appearing once materialization exists.
3. **PENDING (optional) — Quest definition read projection.** Direct table SELECT suffices for V1 lists (owner RLS + existing indexes); a projection is optional polish, not required.
4. **RESOLVED (by deferral) — no pagination/limit on `get_reward_history()` or `list_level_rewards()`.** Accepted for V1 by PO decision 4: backend pagination is deferred and reward history loads lazily behind a frontend data-access boundary (section 3.4).
5. **PENDING — frontend data-access integration and Dashboard.** No React code consumes any of the section-3 contracts yet; `src/app/dashboard/page.tsx` still renders profile only (section 2.3).

## 3. V1 read contracts (approved)

All read routines are `LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog`, resolving identity exclusively via `system_internal.request_user_id()` and raising `42501` when it is NULL — exactly the existing pattern of `get_progression_status()`. No `user_id` parameter ever exists. No new role, grant schema or SECURITY DEFINER routine is needed for reads: owner RLS already scopes every underlying table for `authenticated`. The day-read routine of section 3.3 is implemented and validated; the other contracts compose existing routines unchanged.

### 3.1 Profile & dashboard summary

- **Data source:** existing `profiles` row via the existing `getProfileContext()` server path; no new SQL.
- **Contract:** unchanged frontend type `{ display_name: string | null; timezone: string | null }` plus `user.email` from Auth. No aggregate function: V1 composes the dashboard from 3.2 + 3.3.
- **Auth boundary:** server component; identity from `requireUser()`. RLS: `profiles_owner_select` (exists).
- **Filters/sorting/pagination:** single row by implicit owner identity; none needed.
- **States:** loading = server render (no client spinner needed); empty = `missing` profile (existing `ProfileError`); unavailable = existing `unavailable` error state.

### 3.2 EXP, Level, progress, highest Level

- **Data sources:** `public.get_progression_status()` (all display numbers) — **new SQL not necessary**. Do not sum `exp_ledger` or compare `level_thresholds` in React.
- **Contract (already frozen by the composite type):**

  ```
  available                  boolean   -- false ⇒ render "progression not set up", never invented numbers
  current_exp                numeric   -- render as decimal string
  current_level              integer | null
  highest_level              integer | null  -- from level_milestones max, survives reversal
  policy_id / policy_key / policy_version
  current_level_required_exp numeric | null   -- threshold of current_level
  next_level                 integer | null
  next_level_required_exp    numeric | null   -- threshold of next_level
  ```

- **Level progress formula (corrected).** With `T(l)` denoting the frozen `required_exp` threshold of Level `l` under the assigned policy (`T(current_level) = current_level_required_exp`, `T(next_level) = next_level_required_exp`, both server-provided):

  - EXP within the current Level: `progress_in_level = current_exp - T(current_level)`
  - EXP still required for the next Level: `exp_to_next = T(next_level) - current_exp`
  - Total span of the current Level: `level_span = T(next_level) - T(current_level)`
  - Display fraction (optional): `progress_in_level / level_span` — all inputs are server values; the UI performs only this arithmetic, never threshold lookups or Level derivation.

  Boundary cases: at the configured policy cap `next_level` and `next_level_required_exp` are NULL — render "max level", never a guessed threshold. `available=false` renders a neutral "Level system not configured" state; Level numbers are never invented. Because published policies require strictly increasing thresholds with a zero baseline (enforced by `progression_internal.publish_level_policy`), `level_span` is always positive.
- **Numeric serialization (precision — corrected).** `current_exp`, thresholds and `exp_ledger.amount` are `numeric`/`bigint`. Published thresholds (`100 * (L-1)^2`, max 980,100) and the per-completion amount cap (≤ 2,147,483,647) do **not** bound cumulative EXP: `current_exp` is an unbounded running sum of signed ledger amounts (completion credits are positive; completion reversals are stored as negative amounts), so values can legitimately exceed JavaScript's `Number.MAX_SAFE_INTEGER` (2^53 − 1) over a lifetime.

  Frontend number handling requirements:

  - Render EXP/threshold values as exact decimal text (string formatting), never through `Number()`/`parseInt`/`parseFloat` float coercion and never via client-side aggregation.
  - Never silently display rounded or abbreviated EXP: a displayed total must be the exact value or an explicitly labeled approximation chosen by the UI — never a silent `Number`-parse artifact.
  - Parse with a safe path (BigInt or digit-string handling) before any arithmetic; if a transported value cannot be represented exactly (`Number.isSafeInteger` fails), fail closed to an exact-text/error state instead of rendering a rounded number.

  Transport caveat: the existing frozen APIs (`get_current_exp()`, `get_progression_status()`) return `numeric`, which PostgREST/JSON serializes as a JSON number that the JS parser silently rounds beyond 2^53 − 1 — the loss happens before application code runs. These frozen signatures must not change, so once cumulative EXP can exceed `Number.MAX_SAFE_INTEGER`, an additive exact-text transport (e.g. a text-returning RPC variant or API-layer formatting) must be introduced and the section-3.4 data-access modules switched to it; the display rules above stay mandatory meanwhile. This matches the frozen `get_current_exp` comment's decimal-string intent.
- **Auth boundary:** the browser client may call the RPC directly through the anon-key client; the JWT derives ownership server-side. RLS: the function runs as invoker, so owner-scoped policies on its underlying tables still apply unchanged.
- **Filters/sorting/pagination:** none — single row by definition.
- **States:** loading = RPC pending; empty/unavailable = `available=false` (no assigned published policy) → neutral "Level system not configured" state; error = RPC exception (`42501` when logged out) → redirect to login.

### 3.3 Day Quest occurrences (implemented: `list_day_quest_occurrences`)

- **Data source (implemented).** A direct RLS SELECT on `quest_occurrences` would force the UI to derive eligibility itself — prohibited. The PO-approved read routine is **now implemented** in `20260922000000_create_day_quest_reads.sql`:

  ```sql
  public.list_day_quest_occurrences(p_day date DEFAULT NULL)
  ```

  `p_day NULL` (the V1 default usage) means **today in the authenticated user's profile timezone**; an explicit date selects that profile-local day. Per-occurrence output:

  ```
  occurrence_id, quest_id, quest_title, status,
  scheduled_at, deadline_at,                -- absolute instants; render in profile.timezone
  source_slot_date date,                    -- profile-local slot date (recurring occurrences)
  execution_cycle integer,                  -- required input for complete_quest_occurrence
  reward_exp_snapshot integer,
  progression_ready boolean,                -- server-derived; see completable note below
  completable boolean,                      -- server-derived; see completable note below
  already_completed_cycle integer | null    -- nonnull ⇒ a completed event exists at the occurrence's CURRENT execution_cycle; historical completions from earlier cycles (before reopen) never surface
  ```

- **Day membership (approved decision 1).** An occurrence belongs to the selected profile-local day `D` when **any** of: (a) recurring occurrence whose `source_slot_date = D`; (b) `scheduled_at` within `[local midnight of D, local midnight of D+1)`; (c) `deadline_at` within that same interval. Inclusive disjunction — an occurrence matching several predicates is listed once. Intermediate days of a long-running quest are **never synthesized**: only materialized rows whose slot date or absolute instants fall on `D` are returned. Boundaries are computed in `profile.timezone`, respecting DST (a 23- or 25-hour local day yields the corresponding absolute interval; midnights are offsets from the local date, never UTC-midnight arithmetic). Exact edge semantics are fixed at implementation time per frozen RR-03 (unmaterialized slots use current profile local time; materialized instants stay fixed).
- **Why this SQL exists (validated).** It centralizes the completion-eligibility rule (frozen in [quest-command-api-v1.md](quest-command-api-v1.md) §3 and enforced by `complete_quest_occurrence`) so the UI never duplicates it. Alternatives rejected: client-side derivation (duplicates business rules), a view (adds naming surface without hiding the rule), SECURITY DEFINER (no privilege escalation is needed — owner RLS suffices). The implemented routine is STABLE SECURITY INVOKER with `search_path = pg_catalog`, identity via `system_internal.request_user_id()` only, `42501` when unauthenticated, and grants matching the section-5 boundary (verified by the catalog suite).
- **Timezone handling (approved decision 2; implemented).** The authoritative zone is `profile.timezone`, re-validated at read time per the Profile column comment. Missing or invalid timezone produces an **explicit actionable error** (distinct, typed error result instructing the user to complete timezone setup) — the routine **never** silently falls back to the database/session timezone, UTC or any guessed default. The frozen error contract is SQLSTATE `PZ001` for both missing and invalid zones (a user-defined condition class; no existing migration uses the `PZ` class, so the code is collision-free) — **implemented and covered by the behavior suite** (missing, invalid, and explicit-date-with-missing cases). Frontend mapping (pending integration): the data-access module catches the RPC error, matches `code = 'PZ001'`, and renders an actionable "complete Profile timezone setup" state linking to the timezone onboarding/settings flow — distinct from the empty-day and generic-unavailable states; a `PZ001` result must never be treated as "no Quests today".
- **`completable` flag — accounts for progression availability (review finding, verified in migrations, implemented).** `complete_quest_occurrence` calls `progression_internal.recognize_after_exp` → `recognize_progress`, which **raises `'Progression policy is not assigned'` (P0001) when no policy assignment exists** and is not caught — so without an assigned published policy, any completion fails at recognition and the whole atomic transaction rolls back. The advisory flag must therefore not claim eligibility from Quest state alone. Server-derived definitions (all inside the routine, not React; **implemented and behavior-tested**, including the no-policy → published-policy transition):
  - `progression_ready` — an assigned **published** policy exists for the owner (mirrors `get_progression_status().available`).
  - `completable` — `progression_ready AND status IN ('draft','scheduled','active') AND reward_exp_snapshot IS NOT NULL`.

  The UI renders a "level system setup required" state when `completable` is false solely because `progression_ready` is false; it never re-derives any of these predicates. Advisory only: the command re-checks locks, cycle, snapshots and recognition at execute time; a stale-cycle or recognition rejection triggers exactly one refresh.
- **Auth boundary / RLS (implemented and catalog-verified):** SECURITY INVOKER as `authenticated`; underlying owner-select policies apply unchanged. No new roles. EXECUTE granted to `authenticated` only after revoking default PUBLIC and all sibling roles (`anon`, `service_role`, `quest_command_owner`, `progression_command_owner`, `level_policy_assignment_owner`); the catalog suite asserts exactly this ACL plus STABLE/INVOKER/plpgsql/`search_path = pg_catalog` and the frozen 13-entry argument contract.
- **Indexes:** the existing partial indexes `ix_occurrence_schedule (user_id, scheduled_at, id)` and `ix_occurrence_deadline (user_id, deadline_at, id)` serve the unfinished-time access pattern; `ix_occurrence_quest_history` serves the quest-title join. **Qualification (correction):** both time indexes are partial on `status IN ('draft','scheduled','active')`, but the day read also returns completed (and timestamped failed/cancelled) rows belonging to the selected day — completed-history day reads are therefore **not** covered by these partial indexes and may degrade to owner-wide occurrence scans at the planner's discretion; the `source_slot_date` predicate likewise has no owner-day-shaped index (the unique slot index is `(quest_id, source_slot_date)`). This is acceptable at V1 personal volumes and **no new index is justified yet**; revisit only with real plan/volume evidence.
- **Filters/sorting/pagination:** V1 = single profile-local day via `p_day` (NULL = today), ordered `COALESCE(scheduled_at, deadline_at) NULLS LAST, id`. Keyset pagination only if a day could exceed hundreds of rows.
- **States:** loading = RPC pending; empty = no occurrences on the selected day (distinct from the timezone error); explicit timezone error = actionable setup prompt (never a silent empty list); unavailable = other RPC error → retry surface, never a fake list. `already_completed_cycle` nonnull renders the completed/replay state — keyed to the current `execution_cycle` only, so a reopened occurrence at its advanced cycle correctly reports NULL and shows actionable again (the pre-reopen completion is history, not the current-cycle projection); `completable` is advisory only, per the note above.

### 3.4 Level reward definitions and unlock history (approved: defer backend pagination)

- **Data sources:** `public.list_level_rewards()` (definitions with derived lifecycle + unlock + redemption in one call) and `public.get_reward_history()` (append-only event log). **New SQL not necessary for V1.**
- **Contract:** as returned by the existing composites/rows: `reward_id, required_level, title, description, category, estimated_cost, currency_label, revision, archived_at, lifecycle (LOCKED | UNLOCKED | REDEEMED), unlock_id, unlocked_at, redemption_event_id, redeemed_at`; history rows are full `level_reward_events` rows (event id, reward_id, unlock_id, event_type, definition snapshot payload, `recorded_at`).
- **Lazy history load (approved decision 4).** Reward definitions load with the rewards view; `get_reward_history()` is fetched **only when the user opens the history view**. Backend pagination is deferred in V1 — no limit/offset parameters are added now.
- **Frontend data-access boundary (approved decision 4).** All reward reads go through a single frontend data-access module (e.g. a `features/rewards` read module); components never call Supabase RPCs directly. When pagination is introduced later, only that module and (optionally) a backend keyed-limit revision change — component contracts stay stable. The same boundary pattern applies to the other read contracts in this document.
- **Auth boundary / RLS:** SECURITY INVOKER as `authenticated`; underlying owner-scoped policies apply. No new SQL objects.
- **Filters/sorting/pagination:** none exposed today; `list_level_rewards` ordering is frozen (`required_level, id`), history ordering `recorded_at, id`. Full lists are acceptable for V1 volumes.
- **States:** loading = RPC pending; empty = no definitions (render an onboarding affordance; creation is a write path, out of scope here); unavailable = RPC error. `lifecycle` is derived server-side; the UI must not recompute it from `archived_at`/unlock/event presence.

## 4. Data flow (Supabase → frontend)

1. The browser holds only the anon key (`NEXT_PUBLIC_*`); every request carries the user's JWT from the cookie session.
2. Server Components use `createServerSupabaseClient(true)` (read-only cookies); interactive client components may use `createSupabaseClient()` for RPC reads that need no cookie writes.
3. Identity resolution: Postgres `request.jwt.claim.sub` → `system_internal.request_user_id()` inside each routine; direct table reads rely on the same claim via the `*_owner_select` policies. No client-supplied `user_id` exists anywhere in the contract.
4. SECURITY INVOKER routines execute with the caller's privileges; owner RLS remains the final barrier even if a routine regressed.
5. The UI renders returned numbers verbatim (numeric as decimal strings); no EXP/Level/lifecycle/eligibility arithmetic beyond the display-only subtraction noted in 3.2.

## 5. Security boundaries

- Supabase remains the source of truth; the frontend is a projection of committed facts only.
- No service-role key in browser code, env exposure or server bundles; only anon-key clients exist today and must remain the only ones.
- Prefer SECURITY INVOKER + RLS for all reads; the existing SECURITY DEFINER commands are writes with frozen justification and stay untouched. **No new SECURITY DEFINER was introduced** — the day-read routine is SECURITY INVOKER, as catalog-verified.
- The day-read routine rejects a NULL request identity with `42501` before any row access (behavior-verified).
- The frozen write contracts (`complete_quest_occurrence`, `reopen_quest_occurrence`, reward command functions) are respected; the read layer exposes the `execution_cycle` and occurrence state those commands consume and nothing more.
- The `level_policy_assignment_owner` executor and `system_internal.operator_grants` remain internal; no UI read touches them.

## 6. Implementation status and sequence

### 6.1 Completed (validated locally)

1. **Day Quest read RPC** — `public.list_day_quest_occurrences(p_day date DEFAULT NULL)` implemented in migration `20260922000000_create_day_quest_reads.sql` (STABLE SECURITY INVOKER, `search_path = pg_catalog`, `42501`/`PZ001` error contracts, approved day membership, DST-safe separate midnights, `progression_ready`/`completable`, current-cycle `already_completed_cycle`, authenticated-only EXECUTE).
2. **Behavior and catalog/security tests** — `supabase/tests/day-quest-reads.sql` and `supabase/tests/day-quest-reads-catalog.sql` following the sibling-suite conventions, both fully transactional (ROLLBACK).
3. **Fresh local Supabase reset** — exactly one PO-authorized `npx supabase db reset --local`; all six migrations replayed cleanly.
4. **Full backend regression — 11/11 PASS** on the freshly reset database: request-identity, profiles, player-exp (behavior + catalog + Node preflight), level-rewards (behavior + catalog), quest-commands (behavior + catalog), day-quest-reads (behavior + catalog).

### 6.2 Pending (requires separate review/authorization)

1. **Git commit, PR and merge** — the four files (this document, migration, two test suites) remain untracked; staging and committing are the immediate next step after human review.
2. **Cloud deployment verification** — no linked/remote migration has been applied; a future linked push requires its own authorization and post-deploy verification.
3. **Frontend data-access integration and Dashboard** — no React code consumes the section-3 contracts yet; the section-3.4 data-access boundary, `PZ001` mapping and lazy history load apply there.
4. **Quest creation and occurrence materialization** — Quest definition CRUD and the recurring-occurrence materialization command remain unimplemented write-path milestones (section 2.4 item 2); until they exist, the day view legitimately renders empty.

### 6.3 Remaining sequence (unchanged in substance, renumbered)

1. Human review → Git commit → PR → merge of `feat/ui-readiness-v1`.
2. Linked (cloud) migration deployment and verification, separately authorized.
3. Frontend read hooks (server-first, behind per-feature data-access modules): profile context (exists) → `get_progression_status` → `list_day_quest_occurrences` → `list_level_rewards` (eager) / `get_reward_history` (lazy, on open), with the empty/loading/unavailable/timezone-error states from section 3.
4. Wire the existing dashboard page; defer all write-path UI — including occurrence materialization and completion invocation — to separate reviewed tasks (materialization per section 2.4 item 2).

## 7. Future client compatibility

The contracts are transport-neutral RPC/table reads: any client presenting a valid JWT (web, chatbot, Telegram bot, n8n via a Supabase client) receives identical owner-scoped results. `origin` attribution on write commands already enumerates `web_ui, web_assistant, telegram, automation, mobile, internal`; reads need no origin parameter. Keeping "selected day" logic in SQL rather than the web client is what keeps chatbot/Telegram answers consistent with the dashboard.

## 8. Decision log

Items 1–4 were approved by the Product Owner and are incorporated into sections 3.3 and 3.4; they are recorded here as resolved. Item 5 remains open.

1. **RESOLVED — Day membership:** recurring `source_slot_date = D` OR `scheduled_at` OR `deadline_at` falls on the selected profile-local date `D`; intermediate days of long-running quests are never included; timezone and DST boundaries respected (section 3.3).
2. **RESOLVED — Missing/invalid profile timezone:** explicit actionable error; never silently use the database/session timezone or any default (section 3.3).
3. **RESOLVED — RPC contract:** `public.list_day_quest_occurrences(p_day date DEFAULT NULL)`; NULL means today in the authenticated user's profile timezone (section 3.3).
4. **RESOLVED — Rewards pagination:** backend pagination deferred in V1; reward history loads only when the user opens it; a frontend data-access boundary preserves future pagination (section 3.4).
5. **OPEN — Documentation discrepancy to reconcile:** `docs/PROJECT_CONTEXT.md` states "no public Quest completion/reopen command is enabled" (and "no Level/reward behavior is implemented"), but migrations `20260921090000` and `20260920050000` implement those commands and grant `EXECUTE` to `authenticated`, and the task brief confirms the slice passed full regression. The PROJECT_CONTEXT paragraphs appear stale relative to shipped migrations; this document treats the migrations as current behavior per the context file's own "code/tests describe current implementation" rule and defers the frozen-document update to the Product Owner.



