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

## Validation

The behavior and catalog suites are transactional and are intended for a disposable local Supabase database only. This task does not execute SQL, reset or migrate a database. Suggested later validation commands are:

```powershell
Get-Content -Raw supabase/tests/quest-creation-catalog.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content -Raw supabase/tests/quest-creation.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

The current suites cover normalization, absolute timestamp and numeric rejection, snapshots and counter, exact event pair/payload, replay/conflicts/partial/extra/tampered history, owner isolation and authenticated RLS reads, auth/origin, post-staging rollback, privileges/RLS and the no-EXP/no-progression boundary.

The deferred local concurrency harness uses two independent PostgreSQL connections against the same disposable database. Session A and Session B authenticate as the **same owner user ID** and call `create_one_off_quest` with the same owner and identical `command_id`; one receipt must have `replay = false`, the other `replay = true`, and exactly one definition/occurrence/two-event effect must exist. A second case uses the same owner user ID and command ID with different normalized titles; one session must accept and the other must reject `23505`, with no second Quest. A different owner is used only by the separate cross-owner isolation test. The harness must be run only after the migration is applied; it is designed here but not executed because this task prohibits SQL/database execution.