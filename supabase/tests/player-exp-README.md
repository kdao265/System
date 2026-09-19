# Player/EXP migration validation

Task contract: implement the approved [Player/EXP design](../../docs/02-architecture/player-exp-database-schema.md) and [Quest V1 payload contract](../../docs/02-architecture/quest-event-payload-v1.md) on `feat/player-exp-database-migration`. Scope is a new ledger migration, private source validation/append boundary, exact owner-total read and local rollback-only tests. Preserve historical migrations, Quest/Profile semantics and application code; no Level tables, public Quest commands, dependencies, remote access, staging, commits or pushes.

Acceptance: closed row kinds, restrictive ownership/reversal FKs, global source and reversal-target uniqueness, exact snapshot/compensation and receipt validation, zero receipts, append-only enforcement, RLS/privilege isolation, two successful local resets, catalog checks and Quest/Profile regression checks. Local Docker/Supabase and the existing migrations are prerequisites.

The new migration does not enable production completion/reopen: future Quest commands must resolve retries, accept sources and commit event/ledger/projection together. Level integration adds its owner serialization and recognition later. The private append helper accepts only a Quest event ID, derives values from its envelope and invokes the mandatory table guard. Replay resolution remains the outer command's responsibility. Source UUIDs deliberately have no Quest FK; existing retained-event policy still applies. Migration preflight locks occurrences then events and rejects either existing completed events or completed occurrence projections independently, requiring reviewed EXP reconciliation rather than silently backfilling rewards.

Run behavior and catalog scripts against the local `supabase_db_System` container using `psql -U postgres -d postgres -v ON_ERROR_STOP=1`. Scripts must never target hosted databases. Tests use synthetic identities and roll back fixtures and temporary test-only role/grant changes.

Run `node supabase/tests/player-exp-preflight.mjs` after a local reset to test the actual migration preflight block. It accepts empty history, then independently rejects a completed occurrence without an event and a completed event with an unfinished occurrence. All fixtures roll back.

## Approved request-identity decision

Root cause: the existing Quest role has EXECUTE on auth.uid() but no USAGE on the managed auth schema; the local postgres migration executor cannot grant that schema privilege. The Product Owner approved a SYSTEM-owned identity boundary instead of managed-schema grants, role membership, SECURITY DEFINER or BYPASSRLS.

The new migration creates private system_internal.request_user_id(), a STABLE SECURITY INVOKER UUID function with search_path=pg_catalog, no arguments and no table access. It reads request.jwt.claim.sub; absent/empty claims yield null and invalid UUIDs raise an error. The verified JWT gateway/controlled command remains responsible for establishing request context: the helper reads identity, it does not verify a JWT or authorize arbitrary caller-set claims. Ordinary browser/AI callers have no SQL session or command-role membership.

Only authenticated and quest_command_owner receive schema USAGE and function EXECUTE. No CREATE, Auth schema access, service-role dependency or elevated role membership is introduced. SYSTEM schema exposure is unchanged (only public/graphql_public remain exposed). The helper is migration-owned by postgres but always executes as invoker.

Forward ALTER POLICY statements update all 11 Quest policies and the Profile command-role timezone-reader policy without changing policy roles, commands, column privileges or nonnull owner-equality conditions. Both EXP policies, its source guard, private append helper and exact-total reader use the same helper. Authenticated-only Profile policies retain auth.uid(); they do not run as the command role. Historical migrations are unchanged.

Run request-identity.sql through the same local psql path to check missing/empty/invalid identity, cross-owner Quest reads/writes, Profile reader isolation and identity/security catalogs. Existing behavior tests now use the helper in command-role fixtures. A formerly unreachable test assertion was qualified with the ledger alias to remove an ambiguous id reference. Identity catalog inspection guards pg_get_functiondef against aggregates; neither correction changes production behavior.

## Validation

Reset #1 completed successfully. Player/EXP behavior and catalog suites, request-identity behavior/catalog suite, extracted-preflight regression and existing Profile regression all passed with rollback-only fixtures. The former Auth schema blocker is resolved. Reset #2 also completed successfully; the repeated Player/EXP behavior/catalog and request-identity suites all passed to completion. Both resets warned only that supabase/seed.sql is absent. The preflight and Profile suites passed after reset #1. Final documentation-link, new-file whitespace and git diff --check validation passed.

Scope remains local-only: no historical migration edits, remote operations, public Quest command implementation, staging, commits or pushes. The ledger foundation does not enable production completion/reopen; coordinated commands and later Level integration remain separate work.
