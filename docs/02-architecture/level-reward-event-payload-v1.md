# Level/reward event payload V1

Status: Frozen persistence contract, documentation only. No SQL, migration or command implementation. Authority: [requirements](../01-requirements/level-rewards.md), [domain model](level-reward-domain-model.md) and [physical design](level-reward-database-schema.md).

## 1. Event set and storage

V1 has exactly four `level_reward_events.event_type` values: `configured`, `updated`, `archived`, `redeemed`. These are the existing configuration and redemption receipts. An unlock is represented by its immutable `level_reward_unlocks` row, not an additional event. Policy assignment and Level milestones are separate relations, not reward event types.

Use relational `payload_version = 1` for the entire event JSON contract. Store `request`, `before` and `after` as the three JSONB columns already described by the physical design; there is no additional wrapping `payload` column or version key inside these objects. `request` is NOT NULL. Inapplicable `before`/`after` values are SQL NULL, never JSON null. Unsupported versions reject; later incompatible shapes require a new version and explicit consumer support.

## 2. Relational authority

| Column | V1 authority |
| --- | --- |
| `id` | Server-allocated immutable event UUID; receipt identity |
| `user_id` | Auth owner resolved from request context, never JSON input |
| `command_id` | Required stable request UUID; unique with `user_id` across all four event types |
| `event_type` | One of the four literals above; must match `request.operation` as mapped below |
| `payload_version` | Required integer 1; selects all JSON shapes and validation rules in this document |
| `reward_id` | Required same-owner definition UUID; authoritative definition reference |
| `unlock_id` | Required same-owner/same-definition unlock UUID only for `redeemed`; SQL NULL otherwise |
| `definition_revision` | Required resulting positive bigint revision for configuration events; SQL NULL for `redeemed` |
| `actor_user_id` | Verified request actor UUID, equal to `user_id` for these owner reward commands |
| `origin` | Verified existing channel: `web_ui`, `web_assistant`, `telegram`, `automation`, `mobile`, `internal`; never authorization |
| `recorded_at` | Server-generated timestamptz; never a caller-supplied claim time |

No actor, owner, command ID, event ID, channel or timestamp is duplicated in `request`. JSON definition/unlock IDs and snapshot revisions are integrity cross-checks against relational references; they cannot redirect ownership or override the row. A `reward_definition_id` JSON key refers to relational `reward_id`; a `reward_unlock_id` JSON key refers to relational `unlock_id`. Do not rename the existing relational columns.

## 3. Shared JSON types and canonical configuration

Every object below is closed: all listed keys are required unless explicitly described as a partial `changes` object, and all unlisted keys reject at every nesting level. Arrays or scalar values in place of objects, missing required values, wrong types and forbidden nulls reject the transaction. This contract validates persisted JSONB objects; object key order and whitespace have no semantic meaning.

UUID values are JSON strings parseable as UUID and persisted in lowercase hyphenated canonical form. Compare their UUID identities, not alternative textual spellings. Numeric values must be JSON numbers, evaluated with exact decimal arithmetic; numeric strings, booleans and nonfinite values reject. Validate integrality/range before conversion; never round or use JavaScript floating-point coercion. Integer-valued representations such as `2.0` and `2` compare equally.

`fields` is the complete configuration object with exactly these keys:

| Key | JSON type and validation |
| --- | --- |
| `required_level` | Integral number within PostgreSQL integer range, nonnegative; fresh create/edit must reference a Level in the owner's assigned policy |
| `title` | String containing a non-whitespace character; preserve content, with no new length limit |
| `description` | String or JSON null; normalize a whitespace-only/empty string to JSON null, otherwise preserve content |
| `category` | String: `treat`, `purchase`, `experience` or `custom` |
| `estimated_cost` | Finite nonnegative exact decimal number or JSON null; no new scale/precision rule |
| `currency_label` | Nonblank string or JSON null; preserve content; must be present with cost, or both values must be JSON null |

Optional configuration values are explicit JSON nulls in complete `fields` objects, not missing keys. A partial `changes` object uses only these six keys, each with the same type rules. Omission means leave that field unchanged; explicit null clears only a nullable field. Validate the complete resulting configuration, including the cost/label pair. Do not silently add unchanged fields to the persisted `changes` object.

## 4. Canonical definition snapshot

Every nonnull `before`/`after` is one complete object with exactly these ten keys (configuration keys are flat, not nested under `fields`):

| Keys | Types / meaning |
| --- | --- |
| `reward_definition_id` | UUID string equal to relational `reward_id` |
| `revision` | Integral JSON number from 1 through 9223372036854775807; exact accepted definition revision |
| `required_level`, `title`, `description`, `category`, `estimated_cost`, `currency_label` | The six canonical configuration fields in section 3 |
| `archived_at` | JSON null for active; otherwise a server-generated UTC timestamp string in `YYYY-MM-DDTHH:MM:SS.ffffffZ` form, equal to the definition's archive instant |
| `user_id` | UUID string equal to relational `user_id`; ownership integrity check only |

Snapshots come from locked authoritative definition state, never a caller's claimed before/after values. They preserve configuration and archive state at that revision. Relational `recorded_at` records the command time; no `created_at`/`updated_at` keys are added to these snapshots. All historical snapshot comparisons use retained facts, not today's policy or definition.

## 5. Exact event shapes

The structures below enumerate keys, not optional examples. `fields`, `changes` and snapshots have the exact definitions above. There are no extra envelope keys.

| `event_type` | Exact `request` keys and values | `before` | `after` |
| --- | --- | --- | --- |
| `configured` | `operation`: string `configureLevelReward`; `fields`: complete object from section 3 | SQL NULL | Complete new active definition snapshot |
| `updated` | `operation`: string `updateLevelReward`; `reward_definition_id`: UUID string; `expected_revision`: positive bigint-range integral JSON number; `changes`: partial configuration object from section 3 | Complete accepted prior active definition snapshot | Complete resulting active definition snapshot |
| `archived` | `operation`: string `cancelLevelReward`; `reward_definition_id`: UUID string; `expected_revision`: positive bigint-range integral JSON number | Complete accepted prior active definition snapshot | Complete resulting archived definition snapshot |
| `redeemed` | `operation`: string `redeemLevelReward`; `reward_unlock_id`: UUID string | SQL NULL | SQL NULL |

For `configured`, the command allocates the definition UUID only after checking for an accepted replay. The generated target appears in relational `reward_id` and `after.reward_definition_id`, not in create intent. `after.revision` and relational `definition_revision` are 1; `after.archived_at` is JSON null. The six `after` configuration values equal canonical `request.fields`.

For `updated`, the request definition UUID equals relational `reward_id`. `before.revision` equals `request.expected_revision`; `after.revision` is exactly the next revision and equals relational `definition_revision`. Both archive values are JSON null. Apply precisely `request.changes` to `before` to obtain the six `after` configuration values; all other fields are preserved except revision. The existing command permits only a still-locked active definition. An empty `changes` object denotes no field changes; it does not waive validation or revision rules. This contract adds no changed-field requirement beyond existing update semantics.

For `archived`, the request definition UUID equals relational `reward_id`. `before.revision` equals `request.expected_revision`; `after.revision` is exactly the next revision and equals relational `definition_revision`. All configuration values and identity are unchanged. `before.archived_at` is JSON null; `after.archived_at` equals relational `recorded_at` in canonical timestamp form. Archive remains permitted after unlock and does not rewrite its snapshot. Revision overflow rejects rather than wrapping.

For `redeemed`, the request unlock UUID equals relational `unlock_id`. Resolve `reward_id` from that immutable same-owner unlock; no definition ID, configuration fields, revision or client time is accepted in the request. Relational `definition_revision` is SQL NULL. One immutable redeemed event per unlock is enforced independently of command ID. Archived definitions do not invalidate retained unlocks.

For every configuration event, relational `unlock_id` is SQL NULL even when that command also creates an immediate unlock. That unlock references the configuration event through `definition_event_id`; do not introduce a circular event-to-unlock pointer. Snapshot owner and definition UUIDs must match the row and each other. Before/after equality checks include every applicable field.

## 6. Replay and conflict

The durable request identity is `(user_id, command_id)`. After authentication and owner serialization, look up this identity before allocating fresh IDs or checking today's definition revision, status or policy. An accepted receipt is replayed only when `payload_version`, operation/event type and the entire canonical `request` match. Normalize UUID spelling, blank descriptions and exact numeric representations as above before comparison. All other strings compare exactly; omitted `changes` keys differ from explicitly supplied keys, including an explicit unchanged value.

For create, compare the six canonical requested fields without adding the server-generated definition UUID. For update, compare definition UUID, expected revision and the exact partial changes object. For archive, compare definition UUID and expected revision. For redemption, compare unlock UUID. Changed operation, target, expected revision, fields/changes or unsupported version under the same command identity is a conflicting retry; reject without new writes. Malformed input rejects, never matches by ignoring invalid/extra keys.

Actor is authenticated as the same owner on every attempt. A retry may use another verified origin; origin is attribution, not intent, and does not create a conflict. Return the original receipt and preserve its actor, origin, timestamps, snapshots and IDs. Do not compare caller input to generated `before`/`after` snapshots as though those were request fields; validate retained receipt integrity separately. Missing required atomic evidence is an integrity error, never permission to reconstruct history from current configuration.

A different command ID targeting an already-redeemed unlock returns the already-redeemed result referencing its original receipt; it creates no second event or alias receipt. Distinct create command IDs remain distinct intentional rewards, even with identical fields. Relational uniqueness on owner/command, definition/configuration revision and redemption unlock remains required in addition to command comparison and locks.

## 7. Immutable unlock evidence and preserved semantics

The unlock row permanently retains `required_level`, `definition_revision`, `title`, `description`, `category`, `estimated_cost` and `currency_label`, plus its same-owner definition, qualifying milestone and configuration-event references and server `unlocked_at`. At first unlock these values equal the accepted configuration event's `after` snapshot and the accepted definition revision. The milestone Level equals `required_level`. Only active definitions may receive their first unlock.

The event snapshot also records archive state and owner/definition identity; those do not become mutable content on the unlock. Later archival may increment definition revision but cannot alter the earlier event or unlock. Post-unlock content edits remain forbidden. EXP reversal never deletes a milestone, revokes an unlock or removes redemption. Redemption remains at-most-once, manual, and creates neither EXP mutations nor Finance transactions.

This contract closes the reward-event key/version/replay gap. Assignment authorization and atomic progression recognition are governed by [operator authorization section 6](operator-authorization-v1.md#6-assignment-command-contract), not by new reward event types.
