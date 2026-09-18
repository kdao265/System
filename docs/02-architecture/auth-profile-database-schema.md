# Authentication + Profile — V1 physical database design

Status: Recommended design for a later migration, based on the Human Product Owner's V1 decisions. No SQL or implementation is supplied.

Owner: Human Product Owner. Date: 2026-09-18. Related issue: not supplied. Scope: one application Profile table and minimal provisioning/validation/timestamp infrastructure; no other domain changes.

Authority: [Auth/Profile requirements](../01-requirements/auth-profile.md), [project context](../PROJECT_CONTEXT.md), [ADRs](decisions.md), [Quest domain](quest-domain-model.md) and [Quest physical schema](quest-database-schema.md), especially sections 8, 11, 14, 16 and 18.

## 1. Table and columns

Use `public.profiles`. `auth.users` remains Supabase-owned. No password, hash, email, role, onboarding flag or separate generated Profile ID is stored here.

| Column | PostgreSQL type | Nullable | Default | Constraint / ownership |
| --- | --- | --- | --- | --- |
| user_id | uuid | No | None; supplied from the inserted Auth row | Primary key and FK to auth.users.id; immutable |
| display_name | text | Yes | NULL | Optional plain text; normalize surrounding whitespace/empty input as below; no unique or speculative length constraint |
| timezone | text | Yes | NULL | Explicit supported IANA identifier; no inferred default; validation below |
| created_at | timestamptz | No | Database now() | Immutable creation instant |
| updated_at | timestamptz | No | Database now() | Database-maintained on every accepted row update |

Use one B-tree primary-key index on user_id. It covers owner lookup, uniqueness and the referencing side of the Auth FK. No redundant user_id, display-name or timezone index is needed for V1.

## 2. Keys, cardinality and deletion

Recommend `profiles.user_id` as both PK and FK to `auth.users.id`, with **ON DELETE CASCADE / ON UPDATE RESTRICT**. No UUID default is generated for Profile identity. A profile cannot outlive or reassign its Auth identity.

The PK/FK guarantees at most one profile per Auth user and no orphan profiles; it does **not** prove every Auth user has a profile. Exactly-one coverage at transaction commit requires automatic creation, initial backfill and denial of independent client deletion. Administrator corruption is outside that guarantee and requires controlled repair.

Profile is disposable dependent account data, so its cascade differs deliberately from Quest's retained history. Existing `quests.user_id` DELETE RESTRICT still blocks Auth deletion whenever Quest definitions remain, archived or otherwise. PostgreSQL rolls back the attempted deletion and dependent effects on failure. This design neither modifies that FK nor makes all accounts deletable. Successful hard deletion removes Profile automatically; there is no separate client DELETE policy. Soft-delete/ban/sign-out do not remove the Auth row and therefore do not remove Profile.

## 3. Row validation and timestamps

- CHECK: display_name is null or nonblank after trimming; no uniqueness requirement or invented maximum. A small BEFORE INSERT/UPDATE row trigger trims it and converts an empty/whitespace-only entry to null.
- CHECK: timezone is null or nonblank with no surrounding whitespace. Empty onboarding selection is submitted as null; an invalid nonempty timezone is rejected, not silently normalized into a different zone.
- The same row trigger rejects changes to user_id/created_at on UPDATE, validates nonnull timezone, and assigns updated_at from database now() on every accepted UPDATE, including a no-op value update. Both timestamps initially default to now().
- Timestamp values are instants, independent of profile timezone. now() is a transaction timestamp: updated_at is not a revision number, unique ordering key or concurrency token.

Keep row-trigger functions SECURITY INVOKER where no additional privileges are needed; changing NEW values does not require giving clients timestamp-column UPDATE rights. Fix a safe search_path and qualify object references. No general audit subsystem, profile history table or extension is introduced.

## 4. IANA timezone validation

Authoritative validation occurs in the database BEFORE INSERT/UPDATE trigger for every nonnull timezone, not solely in a dropdown or application check. Compare the exact supplied name against the deployed PostgreSQL `pg_catalog.pg_timezone_names` catalogue, excluding implementation-only `posix/` and `right/` trees and `localtime`. Accept supported named IANA zones and retained aliases, including `UTC`; reject arbitrary offset strings, invented names and unlisted POSIX rule expressions. Do not infer validity merely because PostgreSQL can parse an input as a timezone. A regex alone is insufficient.

The catalogue describes timezone names recognized by the database; it does not establish what timezone the user intended. Keep the explicit selection and null default. [PostgreSQL timezone-name catalogue](https://www.postgresql.org/docs/current/view-pg-timezone-names.html)

Catalogue lookup belongs in a trigger/shared validation routine, not a CHECK backed by a falsely IMMUTABLE catalogue-reading function. Only the simple row-local shape checks belong in CHECK constraints. A read-only shared lookup, if extracted, must not be marked immutable. Service/UI validation improves feedback but cannot replace the database guard on direct owner updates.

Quest must revalidate a persisted timezone when creating/enabling recurrence and materializing a batch. If its runtime cannot interpret a database-supported name, or a catalogue update makes a stored value unsupported, fail safely without substituting a default. Use one captured validated value per batch; a concurrent profile change is observed by a subsequent operation, not midway through the batch. Stored occurrence instants and source_timezone are never rewritten by Profile edits. Advanced travel/DST policy remains outside this design.

## 5. Automatic profile creation

Recommend an **AFTER INSERT, FOR EACH ROW trigger on auth.users**, inserting only the new Auth ID into profiles and relying on null optional values/server timestamp defaults. It runs in the Auth insertion transaction, so there is no externally committed Auth-only interval. Do not copy raw user metadata or email-derived values, call external services, wait for onboarding or require auth.uid() during signup. The signup request may have no authenticated session yet.

Use a narrowly scoped SECURITY DEFINER trigger function. Supabase documents trigger-based provisioning and warns that trigger failure can block signup. The transaction rollback is intentional here to preserve exactly-one coverage. An asynchronous webhook or client upsert would create missing-profile windows and require extra retry authority, so neither is the V1 recommendation. [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)

Recommended privilege boundary:

1. Own the provisioning function with a dedicated `profile_provisioner` role: NOLOGIN, not the table owner, not superuser, no BYPASSRLS or role-creation privileges. Grant only schema usage and Profile INSERT permissions needed for provisioning; grant no role membership to API/client roles.
2. Enable Profile RLS. Add a provisioning INSERT policy only for that role, permitting a row with null optional fields. It cannot use auth.uid() as its owner predicate: the trigger derives user_id exclusively from the trusted NEW Auth row, and the FK verifies existence. Do not reuse this policy for authenticated clients.
3. Keep the trigger function in a non-API-exposed internal schema, with an empty/fixed safe search_path and qualified names. Revoke default PUBLIC EXECUTE and any anon/authenticated access. Only the migration administrator needs the privileges to attach the trigger; provide no callable profile-creation RPC or caller-supplied ID argument. Profile provisioning has no Quest or other-domain privileges.
4. Let unexpected insertion/constraint errors abort the transaction; never catch-and-ignore them or overwrite an existing profile. PK uniqueness rejects duplicate profiles. Future repair/backfill is a separate reviewed administrative operation, not broader routine or browser access.

The narrow provisioning role remains subject to RLS. Its ability to insert another Auth ID is confined by the non-callable trigger path, not falsely attributed to owner-session RLS. Verify role ownership, function ACLs and Auth-trigger installation capability during the later local migration review. Do not silently fall back to table-owner/service-role bypass if the intended privilege setup is unavailable. [PostgreSQL SECURITY DEFINER safety](https://www.postgresql.org/docs/current/sql-createfunction.html)

## 6. RLS and client privileges

Enable RLS before exposure and explicitly revoke broad default table privileges from PUBLIC, anon and authenticated. Grant authenticated SELECT and **column-level UPDATE only on display_name/timezone**; never table-wide UPDATE. This permits the required small direct-profile edit surface without inventing application command routines. RLS restricts rows; column privileges restrict mutable fields. [Supabase column-level security](https://supabase.com/docs/guides/database/postgres/column-level-security)

| Policy / path | Role | Predicate / permission |
| --- | --- | --- |
| profiles_owner_select | authenticated | USING: auth.uid() is nonnull and equals user_id |
| profiles_owner_update | authenticated | USING and WITH CHECK: auth.uid() is nonnull and equals user_id; column grants restrict input |
| profiles_provision_insert | profile_provisioner | WITH CHECK: display_name/timezone are null; trusted trigger supplies identity, FK enforces existence |
| Client INSERT / DELETE | None | No grants or policies; denied even for the owner's ID |
| Eventual Auth hard-delete cascade | Internal FK action | Not a client Profile delete capability; still subject to other domains' restrictive references |

There is no unauthenticated read policy or public profile listing. No client timestamp updates, ownership changes, TRUNCATE or schema/trigger administration rights are granted. A profile upsert is not an allowed substitute for UPDATE because INSERT is unavailable.

For the existing future Quest command boundary, grant `quest_command_owner` **only SELECT(user_id, timezone)** on profiles and a separate SELECT policy requiring nonnull auth.uid() equal to user_id. It is a non-login, RLS-bound role already defined by the Quest migration. This lets later SECURITY DEFINER Quest routines read the caller's timezone without privilege bypass; it grants no Profile writes and enables no recurrence command today. If implementing Profile without that role present, defer this integration grant explicitly rather than creating/redefining Quest roles. Preserve the same validated caller context; future background jobs need their separately reviewed path.

## 7. Future migration ordering and recovery

1. Confirm existing Auth primary key, role/trigger privileges and timezone catalogue behavior in an authorized local environment. Do not inspect or change remote Supabase for this task.
2. Create profiles, its PK/FK/checks, row validator/timestamp trigger, provisioning role/function/trigger and RLS/column privileges in a controlled migration transaction. No browser write exposure precedes those protections.
3. Backfill pre-existing Auth IDs with missing profiles and null optional fields. Serialize Auth inserts across trigger installation/backfill (a suitable Auth-table lock held until commit); preserve existing profiles and verify every Auth ID has exactly one profile before commit. Failure rolls back the migration. Privileged backfill is migration-only, not a permanent client capability.
4. Add the owner-scoped Quest reader grant where its existing role is present. Run the acceptance checks below before enabling application Auth/onboarding. No existing Quest migration needs editing.

A later missing profile indicates an invariant violation. Deny dependent operations and surface an operational repair path. A controlled repair checks the Auth user still exists and inserts only a missing row, preserving existing values and handling concurrency without overwrites. No cleanup job or self-healing browser insert is introduced.

## 8. Invariant ownership and verification

| Database-owned guarantees in the future migration | Service/application responsibilities |
| --- | --- |
| PK uniqueness, Auth FK, immutable identity and creation timestamp | Use verified Auth identity; never take user_id from untrusted input as authority |
| Transactional Auth/Profile creation, initial backfill, restricted independent deletion | Distinguish missing profile from incomplete onboarding; safe errors and controlled repair |
| Owner-scoped RLS and mutable-column privileges | Session lifecycle, protected server boundaries, confirmation/recovery configuration, no credential logging |
| Null defaults, text shape checks and timezone write validation | Explicit timezone selection, readiness feedback, runtime compatibility and revalidation before dependent work |
| Database-maintained updated_at | Do not treat timestamps as optimistic-concurrency versions |
| Profile cascade only after successful Auth deletion; unchanged Quest restrictions | No account-erasure promise without reviewed retention/session handling across domains |

Later local tests must exercise: new/previously existing/unconfirmed Auth users; provisioning failure rollback; duplicate and retry behavior; two-user and unauthenticated isolation; forged ID/timestamp writes; denied INSERT/upsert/DELETE; null/valid/invalid/alias timezone values; display-name clearing; database timestamps; Quest-reader RLS; missing-profile handling; Auth deletion with and without Quest blockers. Confirm archived Quest rows still block deletion and failed deletion retains Profile. These are required future checks, not executed SQL tests.

## 9. Resolved design questions and remaining gates

| Question | V1 recommendation |
| --- | --- |
| user_id both PK and FK? | Yes; one shared immutable Auth identity |
| Auth deletion cascades to Profile? | Yes for successful hard deletion only; never cascade into Quest history |
| Initial timezone nullable? | Yes, default NULL |
| Client INSERT? | No |
| Client DELETE? | No |
| Automatic creation? | Atomic Auth AFTER INSERT trigger with narrowly privileged, RLS-bound provisioning function |
| updated_at? | Database BEFORE UPDATE trigger using now() |
| IANA validity? | Database write trigger checks supported catalogue names; dependent services revalidate at use time |
| Recurrence before timezone? | Unavailable/rejected without partial effects or guessing |

No unresolved schema-design blocker is identified. Implementation must verify the platform privilege model and test the proposed mechanisms locally. Full account erasure for users with retained Quest history requires a separate Product Owner retention decision; it is not solved by this Profile cascade. This task changes no SQL, app code, authentication configuration or Quest semantics.
