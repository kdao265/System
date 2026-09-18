# Quest Engine database migration

Task: implement the first Quest-owned storage migration on `feat/quest-database-migration`, following the approved [physical schema](../docs/02-architecture/quest-database-schema.md), [requirements](../docs/01-requirements/quest-engine.md), [domain model](../docs/02-architecture/quest-domain-model.md) and [ADRs](../docs/02-architecture/decisions.md).

Migration: [20260918034836_create_quest_engine.sql](migrations/20260918034836_create_quest_engine.sql). The filename uses the actual UTC creation timestamp. It creates only `quests`, `quest_recurrence_rules`, `quest_occurrences` and `quest_events`, plus one immutable weekday constraint helper, indexes, policies and the dedicated `quest_command_owner` role. No application code, dependencies, scheduler, external domain tables or remote changes are included.

## Access boundary

RLS is enabled on every table. Four SELECT policies allow authenticated owners and the command role to read only their own rows. Four INSERT and three UPDATE policies are restricted to the non-login, non-superuser, non-BYPASSRLS command role, which does not own the tables. Every policy requires a nonnull `auth.uid()` matching `user_id`; updates check both old and new rows. Composite foreign keys enforce matching Quest/occurrence/rule/event ownership.

Authenticated clients have SELECT only; anonymous users have no access. No client membership in the command role and no callable write commands are created. Events have no UPDATE permission or policy. No table has a DELETE permission or policy for these roles, so deletion remains denied by both privileges and RLS. This deliberately leaves the schema's permitted trivial-draft purge unavailable until a reviewed routine can enforce its history/dependency guard. Owner equality alone is insufficient to authorize that purge. See the [PostgreSQL policy rules](https://www.postgresql.org/docs/current/sql-createpolicy.html) and [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Future command routines must use the dedicated role, fixed safe search paths, explicit EXECUTE grants and the caller's authenticated context. Do not substitute service-role writes. Platform administrators remain privileged; these policies are the normal application boundary, not a restriction on database administrators.

## Static review coverage

| Approved schema sections | Migration coverage |
| --- | --- |
| 4-7, 9-12 | All documented columns, UUID defaults, timestamp types, text vocabularies and named row checks; nullable unknown values retained |
| 6, 12 | Canonical one-based weekdays, discriminator-specific required/forbidden recurrence parameters, positive limits/revisions, inclusive end-date storage |
| 12 | Parent exclusivity; scheduled/completed/failed projection guards; all-or-none recurring origin; event subject/cycle/actor guards; JSON object and positive-integer envelope checks |
| 13 | Six UNIQUE constraints (five composite owner keys and one rule-per-Quest key) and five partial unique indexes, including completion-cycle and separate definition/occurrence retry keys |
| 14 | Seven foreign keys, each with RESTRICT on both delete and update; no cascading history deletion |
| 15 | All ten documented access-pattern indexes, in addition to four primary-key indexes and the eleven uniqueness indexes |
| 16 | Four enabled RLS tables; eleven owner-scoped policies and explicit grants/revocations; no arbitrary client writes |
| 17-18 | Stable completion identity, execution cycle, fixed snapshot columns, original-slot key and nonnegative cumulative materialization counter; no claim of working EXP or recurrence operations |

CHECK expressions explicitly reject missing required JSON keys and missing recurrence discriminator parameters rather than allowing SQL NULL to pass. The weekday helper validates only its input and reads no table. Penalty `source_rule_id` is optional; supported envelope versions and Penalty-owned contents require external validation.

## Deferred behavior and dependencies

- Controlled services/routines own transitions, immutable IDs/owners/origins/created timestamps, server-maintained updates, snapshot capture and audited edits, rule revision history, event payload contracts and related-event semantics. No write routines are exposed yet.
- Completion retry resolution must lock Quest then occurrence and validate expected execution cycle. A unique completed-cycle index is a backstop, not an implemented completion workflow.
- Materialization must validate `profile.timezone`, lock Quest, check limits, copy all seven execution values and insert/increment once atomically. Skipped slots consume no capacity; edits/retries/removal of an eligible draft never reset or decrement the counter. No Profile table or universal timezone is supplied.
- Archive requires one decision instant and all unfinished rows plus lifetime execution history. Active, overdue, previously started or otherwise meaningfully executed work must be resolved explicitly. Stop alone leaves existing work unchanged. No archive or purge command is implemented.
- Goal/Project UUIDs remain nullable without foreign keys to nonexistent tables. Later migrations must add owner-safe restrictive foreign keys. Nonnull association features require external ownership validation first.
- Penalty owns supported snapshot versions, source identifiers and applicable policy data. Quest checks the basic retained envelope, without inventing Penalty tables.
- Player owns credit/reversal idempotency. Production completion plus EXP and compensated reopening remain disabled until its ledger and atomic integration exist. Source contract: `quest_completion`, Completion Event ID, `completion_reward`, snapshotted amount. At most one unreversed entitlement requires that integration.
- Fractional numeric inputs must be rejected before PostgreSQL integer coercion. The migration constrains stored integer values, not arbitrary API input.

## Validation and deployment limits

Static review compared all table columns, constraint/index names, owner policies, reference targets and deferred invariants with the three Quest documents. `git diff --check` and an explicit untracked-file whitespace check were run. PowerShell checks compare the documented columns and index names with the migration and verify counts for tables, policies, enabled RLS and restrictive foreign keys.

No database execution, runtime RLS test, concurrency test or query-plan validation was performed. `Get-Command supabase,psql,docker,node -ErrorAction SilentlyContinue` found Docker and Node, but neither Supabase CLI nor `psql`; `Test-Path supabase/config.toml` returned false. No tools were installed and no local stack was initialized. There are no repository lint/typecheck/test commands configured.

Before later deployment, verify Supabase Auth/roles, `gen_random_uuid()`, schema exposure and permission to create the dedicated role. The migration is intended to run once on a fresh Supabase PostgreSQL database; an existing role/table name collision must be reviewed, not silently reused. Validate constraints and two-user/anonymous access on an authorized local disposable environment before production. Remote connection, migration execution, commits and pushes were outside this task.
