# Goals / Main Quest V1 — Phase A

Task: implement the approved [requirements](../01-requirements/goals-main-quest-v1.md),
[architecture](../02-architecture/goals-main-quest-v1.md) and ADR-020 on
`feat/goals-main-quest-v1`. The Product Owner's Phase A request authorizes backend/migration
implementation and disposable validation, superseding the earlier design-only task restriction.
No UI, Calendar presentation, dependencies, historical migration edits, commits, pushes, PRs,
deployment or real Local/Cloud database operations are authorized.

Acceptance: the seven approved RPCs, three relations, same-owner restrictive FKs, single current
membership, retained detach history, exact durable retries, stable attach-order, derived progress
and ADR-015 owner enforcement. Quest lifecycle/EXP remain unchanged. Tests must exercise the
actual Quest completion/reopen pipeline and compare Goal-only operations against engine state.

Migration: `20260930120000_create_goals_main_quest.sql`. Validation uses only the repository's
owned tmpfs Auth/PostgREST/PostgreSQL harness. No existing Local, browser-smoke or restore-drill
environment is a target.

## Resume audit (2026-09-30)

The resumed task inspected the existing branch/status/diff first, then read the current
migration, Goals SQL/wire/Node tests and private-owner/harness integration before validation.
No new implementation defect was found. The migration and test implementation were preserved;
only this handoff was updated during the resume. The earlier catalog adjustment already on
disk permits PostgreSQL's creator ADMIN-only role membership only when both INHERIT and SET
are false; client/executor membership remains forbidden.

Exactly one new migration implements the approved architecture. No historical migration,
application/UI, dependency, environment or deployment file changed. Existing Quest importance
and historical parent fields retain their prior meanings; no data is reinterpreted or backfilled.

## Implemented storage and commands

- `public.goals`: caller UUID primary key, owner UUID, title, nullable description/archive time,
  bigint revision and creation/update timestamps. Title is nonblank and at most 120 characters;
  description is at most 4000 characters; revision is at least one. No completion or percentage
  columns. `uq_goal_owner (id, user_id)` and `ix_goals_owner (user_id, id)` support ownership/read.
- `public.goal_quest_links`: generated UUID primary key, owner/Goal/Quest/occurrence identities,
  positive integer position, attached timestamp and nullable detached timestamp (not before
  attachment). `uq_goal_quest_current` is unique on `(quest_id) WHERE detached_at IS NULL`,
  including membership in archived Goals. Composite same-owner FKs bind Goal, Quest and exact
  occurrence identity. Normal detach retains the interval; reattach creates a new identity.
- `system_internal.goal_commands`: `(user_id, command_id)` primary key, Goal identity, fixed
  operation, canonical request/result JSON objects and recorded timestamp. Accepted no-ops
  also retain receipts. The command-type CHECK reserves `reorder` without exposing a handler.
- All seven FKs use ON UPDATE/DELETE RESTRICT, including both current and detached references.
  There are 11 indexes including primary/unique constraint indexes. Remaining link indexes are
  `ix_goal_links_current_order (user_id, goal_id, position, id) WHERE detached_at IS NULL`,
  `ix_goal_links_goal_owner (goal_id, user_id)`,
  `ix_goal_links_occurrence_owner (occurrence_id, quest_id, user_id)` and
  `ix_goal_links_quest_owner (quest_id, user_id)`.
  `ix_goal_commands_history (user_id, goal_id, recorded_at, command_id)` supports retained history.
  Two triggers reject receipt mutation/deletion, membership deletion, identity changes and
  any mutation/reactivation of detached intervals.

All seven public RPCs return `jsonb`, with the exact approved named parameters:

| RPC | Parameters |
| --- | --- |
| `create_goal_v1` | `p_command_id uuid, p_goal_id uuid, p_title text, p_description text` |
| `update_goal_v1` | `p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_title text, p_description text` |
| `set_goal_archived_v1` | `p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_archived boolean` |
| `attach_goal_quest_v1` | `p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_quest_id uuid` |
| `detach_goal_quest_v1` | `p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_link_id uuid` |
| `get_goal_v1` | `p_goal_id uuid` |
| `list_goals_v1` | `p_scope text DEFAULT 'unarchived', p_after_id uuid DEFAULT NULL, p_limit integer DEFAULT 50` |

Mutation entry points are guarded SECURITY DEFINER routines owned by the dedicated,
non-login, non-table-owner, NOBYPASSRLS `goal_command_owner`. Reads and their shared projection
are STABLE SECURITY INVOKER. All use a fixed `pg_catalog` search path and begin with
`system_private.require_owner()`. All three tables have RLS and restrictive owner policies.
The executor receives read-only Quest/rule/occurrence access plus the existing shared owner
lock; no Quest writes, completion/reopen calls, EXP access or progression recognition grants.
Authenticated clients have SELECT on Goals/links and EXECUTE on public RPCs, not direct writes
or private receipt access. Non-owner/anonymous RPC rejection is `42501`.

## Verified behavior

Exact normalized retries return immutable receipts before current revision/archive checks.
Changed intent under a recorded command is `23505`; stale fresh revisions are `23514`.
Delayed attach replay cannot resurrect a detached link. Detach addresses an exact link ID,
so replay or a fresh no-op against an old interval cannot detach a newer attachment.
Owner locking serializes mutations with the existing Quest pipeline; the partial unique index
is the structural backstop. Real concurrent transactions verified one winner across two Goals,
one mutation plus one replay for duplicate commands, and one winner for conflicting revisions.

Current progress counts links with `detached_at IS NULL`, joined by same-owner Quest/occurrence
identity. Only the bound occurrence's `status = 'completed'` contributes to completed count.
Completion is `total > 0 AND completed = total`; empty is incomplete and presentation percentage
is zero. No percentage is stored or returned; consumers derive it from decimal-string counts.
The SQL suite uses real Quest commands for 0/3, 1/3, 2/3, 3/3 and reopen back to 2/3, including
zero-EXP completion, old completion replay after reopen, and a new execution cycle.
Completed attachment and detach change counts on the next read. Full engine snapshots verify
Goal-only commands do not change Quest state/events, EXP, aliases or progression/reward history.

Server-side attachment requires an unarchived same-owner Quest with definition mode `one_off`,
no recurrence rule (even stopped), exactly one occurrence, and null recurrence provenance
(`recurrence_rule_id`, `recurrence_revision`, `source_slot_date`, `source_timezone`). Both legacy
definition parent fields and both occurrence parent snapshots must also be null. Recurring
definition modes and one-off definitions with stopped rules are rejected with `23514`; source
inspection confirms the occurrence provenance checks independently of UI behavior.

Archived Goals retain membership and live progress; a real reopen while archived changes their
counts. Fresh metadata/attach/detach commands reject, including would-be no-ops. Restore permits
edits again. Exact historical receipt replay acknowledges past work without changing current
archive state. There is no reorder endpoint or position UPDATE grant. Current links use append
position `max(current position) + 1`, ordered by `(position, id)`; detach preserves survivor order.

An otherwise archived linked Quest stays visible/countable from its occurrence status; new
attachment to an archived Quest rejects. Quest/occurrence hard deletion is restricted even for
detached history. No new Quest archive/delete capability or historical completion snapshot exists.

## Validation results

All database execution used newly created, labelled, tmpfs-only resources with generated
synthetic accounts. Both runs completed their own cleanup successfully. No real Local/Cloud,
`supabase_db_System`, preserved browser-smoke or restore-drill resource was targeted.

| Check | Result |
| --- | --- |
| `node supabase/tests/goals-main-quest-wire.mjs` | PASS: Goals catalog SQL, behavior SQL, seven-RPC wire/security checks and three concurrency scenarios; exit 0 |
| `node supabase/tests/private-owner-wire.mjs` | PASS: 23 migration checkpoint suites and 12 database/security groups; exit 0 |
| `node --test tests/*.test.mjs` | PASS: 213 tests, zero failures/skips, including four Goals migration checks and private Auth security regression; exit 0 |
| `npm run lint` | PASS with zero warnings; exit 0 |
| `npx tsc --noEmit` | PASS; exit 0 |
| `git diff --check` and separate new-file whitespace/link checks | PASS |

Historical suites still run at their original checkpoints, before the Goals migration. The
harness change adds only the Goals checkpoint mapping; Stage A/B/C expectations and historical
migration files are unchanged. The post-activation owner catalog additionally audits the new
executor and three new restrictive policies; wire integration also retests all Goals entry
points after owner configuration is removed.

Auth HTTP smoke was not rerun: no Auth application, route, cookie, session, or harness lifecycle
code changed; the harness edit only registers this migration's two SQL suites. Actual Auth
tokens, non-owner/anonymous authorization, provisioning and missing-configuration behavior
were covered by the disposable wire/security runs. Full Playwright is outside Phase A scope.

## Changed-file handoff

New files: this note, the single Goals migration, `supabase/tests/goals-main-quest-catalog.sql`,
`supabase/tests/goals-main-quest.sql`, `supabase/tests/goals-main-quest-wire.mjs`,
`supabase/tests/helpers/goals-wire.mjs` and `tests/goals-migration.test.mjs`.
Modified integration files: `supabase/tests/private-owner-catalog.sql`,
`supabase/tests/private-owner-wire.mjs` and `tests/helpers/auth-environment.mjs`.

No implementation restart, commit, push, PR, merge, deployment or Phase B UI work occurred.
Phase A is ready for backend review. There are no unresolved validation failures; real-project
migration application and Phase B remain outside this task.
