# Completion Alias V1 backend handoff

Status: implementation authorized by the Product Owner on 2026-09-26, following
the Completion Replay Architecture Design review. Branch: `feat/completion-alias-v1`.

## Task and acceptance

Fix the lost alternate-command response: A completes cycle 1; B resolves that
completion under another command ID; B loses the response; A reopens; B retries.
B must retain a durable identity without another Quest event, EXP credit or
progression recognition. Preserve the public completion signature and ten fields,
existing history, executor security and owner -> Quest -> occurrence lock order.

Scope: one additive migration, SQL/catalog/two-session tests, disposable CI staging,
and contract/rollout documentation. No frontend, dependency, secret, existing Local
or Cloud data changes; no commits, pushes or PR. Test only a positively identified
disposable database. Never reset the developer database or delete volumes.

Authority: [ADR-013](../02-architecture/decisions.md#adr-013--durable-completion-aliases),
[contract amendment](../02-architecture/quest-command-api-v1.md#11-completion-alias-v1-amendment),
and the existing [EXP envelope](../02-architecture/quest-event-payload-v1.md).

## Rollout

1. Validate migration-nine -> migration-ten upgrade with retained original
   completion history and an unrecorded legacy alternate request. Do not backfill
   fictional aliases. Verify fresh-install behavior separately.
2. Stop new command traffic and drain in-flight calls across app and direct RPC
   callers before applying migration ten. Already executing old routines are not
   a safe rollout boundary. No data reset is part of deployment.
3. Apply the database migration before any frontend uses the resolution RPC.
   Verify ownership, effective ACLs, RLS, and that Reopen V1 remains revoked.
4. Existing deployed completion clients retain their signature, caller command ID
   and ten-field receipt shape. New aliases can replay after reopen/recompletion.
   Old, never-recorded aliases still need the future Recovery UI; this backend
   does not claim to solve their user-facing pending state by itself.
5. Application rollback does not roll back SQL, aliases, or recovery records.
   Keep alias-aware completion/create/reopen definitions. Never restore old SQL
   that ignores alias reservations or regrant Reopen V1. A future frontend rollback
   must understand its new disposition envelopes or explicitly fail closed.

## Validation

Checked on 2026-09-26 on a fresh, privately verified disposable PostgreSQL 17.6 container
(`system-completion-alias-test-20260926b`, image `public.ecr.aws/supabase/postgres:17.6.1.166`,
Docker network `none`, no mounts, tmpfs data directory, no published ports, label
`system.test=completion-alias-v1`). Migrations one to nine were applied in order, then the
committed migration-nine fixture, then migration ten. The developer System Local stack and
Supabase Cloud were never targeted: no reset, push, link or migration was applied to either.

- `quest-completion-alias-upgrade-after.sql`: PASS. Migration-nine history, receipts, events
  and ledger rows are unchanged by the upgrade, no alias or reconciliation row was
  fabricated, and the legacy alternate request resolves as `unrecorded_superseded`.
- `quest-completion-alias-catalog.sql`: PASS. Alias table ownership, RLS, effective and column
  ACLs, policy/trigger/constraint inventory, private helper security, fixed `pg_catalog`
  paths, resolver boundary and the frozen ten-field receipt all match.
- `quest-completion-alias.sql`: PASS. Durable alias, historical replay after reopen and after
  recompletion, exact SQLSTATE/message pairs, per-owner isolation, immutability, atomic
  rollback and fail-closed inconsistent history.
- `quest-completion-alias-concurrency.mjs`: PASS, 11 two-session races. Each race first proved
  the losing backend waited on the winner's owner advisory lock, so the evidence is real
  contention rather than timing.
- `level-rewards-catalog.sql` private-inventory strengthening: PASS at migrations eight, nine
  and ten on pristine deployments, requiring exactly the five baseline `system_internal`
  helpers plus, once the alias relation exists, the four alias helpers, each with its exact
  argument and return signature. Negative runs on isolated disposable targets fail as
  intended when an approved helper is dropped, when its argument type is substituted under
  the same name (the count is unchanged) and when only its return type changes.
  `level-rewards-catalog.sql` also still asserts a pristine runtime state, so it remains
  Stage A coverage and is not re-run after committed fixtures exist.
- Cross-migration regressions at migration ten: `request-identity.sql`,
  `request-identity-compat-catalog.sql`, `profiles.sql`, `player-exp-catalog.sql`,
  `player-exp.sql`, `level-rewards.sql`, `level-rewards-catalog.sql` (pristine deployment),
  `quest-creation-catalog.sql`, `quest-creation.sql`, `day-quest-reads-catalog.sql`,
  `quest-reopen-v2-catalog.sql` and `quest-reopen-v2.sql`: PASS.
- Repository checks: `npm run lint` (zero warnings), `npx tsc --noEmit`, and the six
  database-free `node --test` suites (136 tests, 0 failures): PASS.

Unavailable or out of scope:

- The updated GitHub Actions workflow was reviewed and its move/restore shell logic was
  simulated for success and failure in both stages, but a real CI run cannot be executed
  from this Windows host.
- `quest-reopen-v2-concurrency.mjs` and `player-exp-preflight.mjs` require a GitHub-hosted
  Linux runner and were not run locally.
- `request-identity-compat.sql`, `day-quest-reads.sql` and `quest-commands-catalog.sql` fail
  identically at migration nine and ten in the hand-provisioned container: the image's
  `auth.uid()` only reads the legacy `request.jwt.claim.sub` setting instead of gotrue's
  claims-aware definition, and migration nine intentionally revoked Reopen V1 EXECUTE.
  Migration ten is not implicated.
- Migration ten is not deployed to System Local or Supabase Cloud, and no client recovery
  flow uses it.

Outstanding limitations: never-recorded legacy requests still need the future Recovery UI;
the resolution command takes owner, Quest and occurrence locks, so a stalled caller can block
one owner's commands until its timeout; `level-rewards-catalog.sql` remains fresh-deployment
Stage A coverage because its final assertion requires a pristine runtime state.
