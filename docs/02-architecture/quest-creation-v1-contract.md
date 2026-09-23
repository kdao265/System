# Quest Creation V1 Contract

Status: Approved implementation contract for one-off Quest creation. This document is additive to the frozen Quest schema, event and command contracts. It does not change those documents.

## Scope

`public.create_one_off_quest(command_id uuid, request jsonb, origin text)` creates exactly one one-off Quest definition, one scheduled occurrence, one definition `created` event and one occurrence `scheduled` event. It does not create recurring rules, EXP ledger rows or progression recognition.

The owner is exclusively `system_internal.request_user_id()`. `origin` is validated with `progression_internal.require_origin(text)` on every attempt and is attribution only. A retry may use another valid origin; the original event payloads are never rewritten.

## Request

The request is a JSON object with this closed set of keys: `title` (required string), `description`, `importance`, `priority`, `default_difficulty`, `default_estimated_duration_minutes`, `default_energy_cost`, `default_focus_demand`, `default_reward_exp`, `tags`, `notes`, `scheduled_at`, `deadline_at`, and `recurrence_mode`.

Optional values may be JSON null. `importance` defaults to `side`; `recurrence_mode` defaults to `one_off` and, when supplied, must be `one_off` or null. `default_reward_exp` defaults to `0` when omitted or null. `tags` defaults to an empty array. All integer values must be integral, within their PostgreSQL column range, and satisfy the physical Quest ranges. At least one of `scheduled_at` and `deadline_at` must be non-null; when both exist, the deadline cannot precede the schedule.

Schedule values must be explicit ISO 8601 timestamps with seconds and either `Z` or a numeric UTC offset (`2026-10-02T09:00:00Z`, `2026-10-02T16:00:00+07:00`). Date-only, timezone-less, relative, infinity and malformed values are rejected before timestamp parsing. The normalized instant is used for validation and replay; equivalent offset representations are canonicalized in event payloads as UTC `Z` strings.

Goal, Project and Penalty inputs, including `direct_goal_id`, `project_id`, `default_penalty_snapshot`, `direct_goal_id_snapshot`, `project_id_snapshot` and `penalty_snapshot`, are unavailable and rejected. Unknown keys are rejected too. Stored definition and occurrence parent/penalty fields remain null; all recurring-origin fields remain null.

## Atomic effects and payload

The occurrence is `scheduled`, has `execution_cycle = 1`, and copies the normalized definition values into its reward and execution snapshots. The definition has `materialized_occurrence_count = 1`. Definition and occurrence timestamps use server defaults; event rows use one server recording instant and `payload_version = 1`.

Each event payload is an object with exactly the following contract keys:

```json
{
	"origin": "web_ui",
	"after": {
		"definition": {
			"title": "...",
			"description": null,
			"importance": "side",
			"priority": null,
			"default_difficulty": null,
			"default_estimated_duration_minutes": null,
			"default_energy_cost": null,
			"default_focus_demand": null,
			"default_reward_exp": 0,
			"direct_goal_id": null,
			"project_id": null,
			"recurrence_mode": "one_off",
			"default_penalty_snapshot": null,
			"tags": [],
			"notes": null
		}
	}
}
```

The occurrence `after.occurrence` object has exactly: `status`, `scheduled_at`, `deadline_at`, `reward_exp_snapshot`, `difficulty_snapshot`, `estimated_duration_minutes_snapshot`, `energy_cost_snapshot`, `focus_demand_snapshot`, `direct_goal_id_snapshot`, `project_id_snapshot`, `penalty_snapshot`, `recurrence_rule_id`, `recurrence_revision`, `source_slot_date`, `source_timezone`, and `execution_cycle`. The `created` event carries normalized `after.definition` and has no occurrence or cycle. The `scheduled` event carries normalized `after.occurrence`, occurrence ID and cycle 1. Both events share the request `command_id`. The event pair is inserted in the same transaction as the definition, occurrence and counter update. No EXP or progression helper is called.

## Replay

The command validates authentication and origin, then acquires `progression_internal.lock_owner(actor)` before event lookup or UUID generation. It inspects every event for `(user_id, command_id)`. A replay is valid only when there are exactly two events, one matching definition `created` and one matching occurrence `scheduled`, both `payload_version = 1`, both `actor_kind = 'user'`, both `actor_user_id = actor`, with the definition event's `occurrence_id` and `execution_cycle` null, the scheduled event's occurrence and cycle 1, and matching owner/Quest/occurrence identities. The referenced occurrence must belong to the same Quest and owner. Both payloads must be objects with valid `origin`, `after`, and the complete nested snapshot structures, and their canonical `after` objects must exactly match the normalized request.

Partial pairs, extra events, changed normalized input, tampered actors/cycles/subjects, identity mismatches and inconsistent payloads reject; no historical pair is repaired.

Replay comparison uses immutable creation-event payloads, never later mutable Quest state. A valid replay returns the original IDs and snapshots with `replay = true`; the first origin remains in history.

## Receipt and security

The receipt fields are `command_id`, `quest_id`, `occurrence_id`, `definition_created_event_id`, `occurrence_scheduled_event_id`, `scheduled_at`, `deadline_at`, `reward_exp_snapshot`, `execution_cycle` and `replay`.

The function is `SECURITY DEFINER`, fixed to `search_path = pg_catalog`, owned by `quest_command_owner`, and executable only by `authenticated`. Authenticated users retain no direct Quest table writes. Existing RLS, role boundaries and `system_internal.request_user_id()` remain authoritative.

## Frontend Recovery Boundary

The account, persistence and recovery implementation task authorizes the following frontend boundary. It adds no SQL, roles, dependencies, CI or Cloud changes. Database ownership still comes exclusively from the authenticated request identity.

Every new submission and retry carries `expected_account`. The server compares it with the identity returned by `requireUser()` before the creation RPC; it never forwards that token as SQL ownership. The form is keyed by account, clears visible state on Auth account/session changes, gates submission during recovery, and ignores responses from an earlier account/component generation. The server check remains authoritative if another tab changes session cookies before the UI observes the change.

Each immutable browser snapshot has exactly `version: 2`, `userId`, `commandId`, `timezone` and `request`. Requests contain the seven UI-supported fields, normalized text and absolute UTC instants. Storage keys are `system.quest-creation.pending.v2:<userId>:<commandId>`. No credentials, session tokens or database-owned IDs are stored. The content includes the user's submitted Quest text, so it is private recovery data, not diagnostic output.

The shared lifecycle has explicit `recovering`, `ready`, `sending`, `uncertain` and `blocked` states. Recovery distinguishes `missing`, `valid`, `corrupt` and `unavailable` storage. It validates the complete schema, owner/key/command identity, supported timezone, normalized request, calendar timestamps and SQL-compatible bounds. Getter, enumeration, read, write and remove exceptions fail closed. Writes and removals are read back for verification. An insertion never overwrites an existing command. Corrupt records and old V1 records without embedded account/schema provenance are retained and block creation; they require explicit inspection/resolution of the original command rather than automatic deletion or an invented replacement ID.

An exclusive origin-wide browser Web Lock serializes recovery, persistence, RPC dispatch and cleanup across participating tabs, including tabs transitioning between accounts. This also protects localStorage key enumeration from other participating accounts changing the collection. Records and authorization remain account-scoped. New submissions recheck storage inside the lock and cannot proceed while any unresolved command exists. Each existing operation is retryable independently, and successful cleanup removes only its matching account/command record after checking the immutable content. Storage/focus events refresh other tabs; correctness does not depend on receiving those events. A stale tab that still knows a resolved or externally removed command restores that same snapshot and confirms it by replay. It never substitutes a new command. An in-flight tab holds the lock until the action settles; another tab waits. Closing the in-flight tab releases its browser lock, with its persisted command available for retry. Unsupported Web Locks or unavailable storage block creation with recovery feedback.

Before the first dispatch, successful persistence is mandatory. A definitive pre-RPC rejection of that **new** attempt removes only its unexecuted snapshot and preserves/unlocks the draft. In particular, a mismatch between its displayed timezone and the current Profile timezone requires explicit timing review; the original label and wall-clock fields remain until the user chooses to use the current Profile timezone. Authentication exceptions, RPC errors, invalid receipts and browser-to-action promise rejections are conservatively uncertain. They retain the exact command and request. A pre-RPC rejection of a **retry** does not prove that an earlier attempt failed and therefore never discards its snapshot.

Retry mode always resends the original absolute instants and command ID, verifies the authenticated account again, and does not require the original timezone to equal the current Profile timezone. It does not reinterpret local inputs. Restored times are labeled with their original timezone; current Profile timezone is shown separately. Only a validated receipt (including `replay = true`) confirms success. Success revalidates the Dashboard. Today visibility messaging considers both scheduled and deadline instants, and offers no nonexistent day selector.

Guarantees apply to cooperating V2 tabs in the same origin/browser storage partition while the stored data remains available. Web Locks and read-back verification cannot prevent browser eviction, external storage clearing/tampering, device loss, or an older application build writing outside this protocol. Closing a tab normally retains localStorage; private browsing may not. A live lifecycle can restore a lost snapshot from memory, but a fresh page cannot reconstruct externally erased data. There is no cross-device recovery, encryption boundary against same-origin scripts, or claim of deduplication between deliberately separate command IDs. Do not manually clear recovery data to work around an uncertain result. Legacy/corrupt recovery requires separate explicit resolution; this UI does not add an unsafe discard button.

Automated verification uses `node --test tests/*.test.mjs`, `npm run lint`, `node node_modules/typescript/bin/tsc --noEmit --incremental false` and `npm run build`. The creation suite executes the actual lifecycle, action, request/receipt validators and adapter with simulated storage/locks/Auth/transport; it includes simulated commit-then-lost-response replay. It does not execute SQL or prove browser/Web Locks scheduling or database atomicity.

Remaining manual local smoke scenarios: actual React hydration/Strict Mode remounts, browser reload/close recovery, two real tabs competing and receiving storage/Auth events, logout/login while an action is in flight, blocked browser storage, a browser network interruption after dispatch, and Profile-timezone changes with explicit draft review versus exact uncertain retry. Use only synthetic local data under a separately authorized database smoke task.

## Validation

The behavior and catalog suites are transactional and are intended for a disposable local Supabase database only. This task does not execute SQL, reset or migrate a database. Suggested later validation commands are:

```powershell
Get-Content -Raw supabase/tests/quest-creation-catalog.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content -Raw supabase/tests/quest-creation.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

The current suites cover normalization, absolute timestamp and numeric rejection, snapshots and counter, exact event pair/payload, replay/conflicts/partial/extra/tampered history, owner isolation and authenticated RLS reads, auth/origin, post-staging rollback, privileges/RLS and the no-EXP/no-progression boundary.

The deferred local concurrency harness uses two independent PostgreSQL connections against the same disposable database. Session A and Session B authenticate as the **same owner user ID** and call `create_one_off_quest` with the same owner and identical `command_id`; one receipt must have `replay = false`, the other `replay = true`, and exactly one definition/occurrence/two-event effect must exist. A second case uses the same owner user ID and command ID with different normalized titles; one session must accept and the other must reject `23505`, with no second Quest. A different owner is used only by the separate cross-owner isolation test. The harness must be run only after the migration is applied; it is designed here but not executed because this task prohibits SQL/database execution.
