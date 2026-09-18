# Profile migration validation

Task: implement the approved [Profile design](../../docs/02-architecture/auth-profile-database-schema.md) and [requirements](../../docs/01-requirements/auth-profile.md) on `feat/profile-database-migration`. Scope is one new Profile migration and local validation; no Quest migration edits, frontend/Auth flows, remote operations, commits or pushes.

Migration: [20260918083114_create_profiles.sql](../migrations/20260918083114_create_profiles.sql), using its UTC creation timestamp. It creates the five-column Profile table, internal provisioning/validation functions, two triggers, four policies and restricted grants. It backfills existing Auth users under an Auth-table lock in the migration transaction. No application domain tables beyond profiles are added.

## Local checks performed on 2026-09-18

- Supabase CLI 2.117.0 was already installed. Docker Desktop was installed but stopped; the initial local start failed because its Linux engine pipe was absent. Starting Docker Desktop resolved this.
- `npx --no-install supabase start` succeeded after Docker startup.
- `npx --no-install supabase db reset --local` succeeded **twice**, replaying both migrations each time. Both resets warned that `supabase/seed.sql` is absent; no seed file was added.
- Local PostgreSQL catalog queries verified five column types/defaults, RLS enabled, the PK and Auth FK (DELETE CASCADE / UPDATE RESTRICT), two checks, four policies, two triggers, fixed function search paths and the dedicated non-login/non-superuser/non-BYPASSRLS provisioning owner. Profiles has only its primary-key index.
- Effective privilege checks confirmed owner SELECT and only display_name/timezone UPDATE; no client INSERT/DELETE or timestamp/identity writes. Quest's role can read only user_id/timezone under owner RLS. Browser roles have no provisioning-role membership or function EXECUTE permission.
- [profiles.sql](profiles.sql) passed after both resets. It uses synthetic identities and rolls back all data and temporary privilege changes. Tests cover atomic provisioning, failure rollback, uniqueness/FK, two-user isolation, missing identity, anonymous denial, update column restrictions, denied insert/upsert/delete, whitespace normalization, timezone null/valid/alias/invalid cases, server timestamps, Quest reader isolation and deletion with/without archived Quest blockers.
- The first test attempt lacked temporary membership to assume the Quest role. The test harness now grants it inside the rollback transaction; production grants were not changed. The final test also verifies that the database overrides a supplied updated_at value.
- `git diff --check` and explicit whitespace checks of new files passed. The prior Quest migration is unchanged. Application lint/build were not rerun because no application code or dependencies changed.

The reset databases had no pre-existing Auth users. Backfill was reviewed statically and catalog coverage reported zero missing profiles; populated pre-migration backfill/concurrent-signup testing was not performed. Session handling, recurrence-time revalidation/runtime compatibility, onboarding and cross-domain account-erasure decisions remain service-layer work.

## Repeat the behavior test locally

After an authorized local reset, run from the repository root in PowerShell:

```powershell
Get-Content -Raw supabase/tests/profiles.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

The container name comes from this repository's local `project_id = "System"`. This test is for a disposable local database only; it temporarily revokes provisioning INSERT to verify rollback and must not run against a live shared database. It creates no persistent fixtures. No remote project was linked or contacted. Docker and the local Supabase stack remain running after validation.
