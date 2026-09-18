# Authentication + Profile — V1 requirements

Status: Product decisions supplied by the Human Product Owner; mechanism recommendations are specified in the linked design for later implementation. Documentation only.

Owner: Human Product Owner. Date: 2026-09-18. Related issue: not supplied. Branch: `docs/auth-profile-foundation`.

Sources: [project context](../PROJECT_CONTEXT.md), [vision](../00-product/vision.md), [V1 scope](../00-product/scope-v1.md), [ADRs 001, 010–011](../02-architecture/decisions.md), [Quest requirements](quest-engine.md), [Quest domain model](../02-architecture/quest-domain-model.md) and [Quest physical schema](../02-architecture/quest-database-schema.md). Companion: [Auth/Profile physical design](../02-architecture/auth-profile-database-schema.md).

## 1. Purpose and terminology

Establish authenticated identity, private application profile data and an explicit timezone dependency for SYSTEM V1. **Auth user** means the identity owned by Supabase Auth in `auth.users`. **Profile** means its one application record; it is not an identity provider, Player or permissions record. **Timezone-ready** means the profile currently contains a supported valid IANA timezone identifier; it is a derived condition, not another stored field.

## 2. V1 scope and non-goals

V1 uses email + password through Supabase Auth, automatic profile provisioning, owner-only profile access, optional display name and explicit timezone onboarding. Only five Profile fields exist: `user_id`, `display_name`, `timezone`, `created_at`, `updated_at`.

This task specifies behavior and future storage only. No SQL, migrations, authentication UI, middleware, packages, remote changes or commits are included. Google OAuth/other providers, extra profile settings, roles/teams, Player/EXP and other domains are deferred. An account-erasure workflow spanning retained domain history is not introduced.

## 3. User stories and functional requirements

| ID | User need |
| --- | --- |
| AP-US-01 | Sign in with email and password so my private application data is isolated |
| AP-US-02 | Receive a profile automatically so onboarding does not require creating database records |
| AP-US-03 | Set or change my display name and timezone so the system uses my explicit preferences |

| ID | Requirement |
| --- | --- |
| AP-FR-01 | Supabase Auth exclusively owns identity, credentials and sessions; use email + password for V1 |
| AP-FR-02 | Every committed Auth user has exactly one Profile after migration/backfill; create it automatically, including before email confirmation when applicable |
| AP-FR-03 | Allow the owner to read their profile and update only display_name/timezone; identity and timestamps are server-controlled |
| AP-FR-04 | Allow both optional fields to begin null; do not infer a name from email or a timezone from environment/location |
| AP-FR-05 | Validate every supplied timezone against supported IANA names and block timezone-dependent operations when absent, invalid or unreadable |
| AP-FR-06 | Preserve Quest's existing timezone, absolute-time, origin and recurrence semantics |
| AP-FR-07 | Deny arbitrary client Profile creation/deletion and preserve existing domain retention protections during account deletion |
| AP-FR-08 | Fail without partial profile changes or fabricated identity/readiness; return actionable, non-sensitive errors |

## 4. Authentication flow

1. Registration submits email/password to Supabase Auth. Only an actual Auth user insertion provisions a profile; a generic signup response is not proof a new identity or session exists.
2. Honor the configured Supabase email-confirmation requirement. When confirmation is required, show the pending state and do not treat the user as authenticated until Auth supplies a valid session. A profile may already exist but remains inaccessible without authorization.
3. Sign-in uses Supabase's email/password verification. Validate authenticated identity at server/data boundaries; do not trust a client-supplied user_id or profile existence as proof of login.
4. Load the authenticated user's own profile. Offer onboarding if timezone is absent. Authentication success and timezone readiness are separate conditions.
5. Sign-out ends the applicable Auth session and clears private UI state; it never deletes the profile. Session expiry requires reauthentication. Password recovery/change, when exposed, uses Supabase Auth rather than application credential tables.

Passwords, password hashes, tokens and credential copies must never be stored in public application tables or logs. Email stays Auth-owned; no duplicate email column is needed. Confirmation, password policy, session transport and recovery redirect configuration must be explicitly reviewed in the later Auth implementation milestone; this document does not assume local and hosted Auth defaults agree. [Supabase password-based Auth](https://supabase.com/docs/guides/auth/passwords)

## 5. Profile lifecycle

Auth insertion happens first within a transaction; automatic provisioning creates a Profile using that exact Auth ID before commit. Both optional fields start null and database timestamps are initialized. Provisioning failure must roll back the Auth insertion, not leave a silently incomplete account. Subsequent sign-ins do not create or overwrite a profile.

The future migration must also provision missing profiles for pre-existing Auth users, without overwriting any existing onboarding data. A later missing profile is an integrity error requiring controlled repair, never a reason to grant clients INSERT access.

Lifecycle conditions are derived: no authenticated session; authenticated with timezone unset; authenticated with valid timezone; integrity/dependency error. Sign-in/out changes session state independently. Profile edits move between timezone-unset and timezone-ready; no stored onboarding flag, status column or separate profile identity is introduced.

## 6. Onboarding behavior

Display name is optional plain text, not a unique handle or authorization claim. Trim surrounding whitespace; an empty entry means null. No extra product length limit is selected in V1. Render it as text, never markup.

Timezone may remain null during onboarding, so timezone-independent use is possible. A valid value requires explicit user selection/submission; neither browser detection nor a database/server timezone may silently supply it. Clearing it returns to the unset state and blocks future timezone-dependent operations. Invalid nonempty input is rejected, preserving the previous saved value. Display name remains optional even when timezone is ready.

## 7. Timezone contract

The existing logical contract `profile.timezone` maps to the authenticated owner's `public.profiles.timezone`. Store a supported IANA name, not an offset or locale. `Asia/Ho_Chi_Minh` is a valid example only; the database default is null. Recognized IANA aliases may be retained; do not silently rewrite the selected identifier. The [physical design](../02-architecture/auth-profile-database-schema.md) defines authoritative validation.

Validation is enforced at the database write boundary and rechecked by timezone-dependent services at use time. A stale client value, invalid legacy value, missing profile or failed lookup cannot authorize recurrence. Timezone changes affect interpretation of future unmaterialized slots; existing absolute timestamps and occurrence provenance are preserved.

## 8. Authorization rules

| Actor/action | Allowed behavior |
| --- | --- |
| Unauthenticated request | No profile reads or writes |
| Authenticated SELECT | Own profile only, based on verified Auth identity |
| Authenticated UPDATE | Own display_name/timezone only; no ownership or timestamp reassignment |
| Authenticated INSERT / upsert / DELETE | Denied, even for the caller's own ID |
| Automatic provisioning | Narrow trusted database path using the newly inserted Auth ID, not client authority |

RLS and column privileges enforce this boundary even when UI checks are bypassed. No privileged role or service credential reaches browser clients. A display name or user-editable Auth metadata must never convey authorization.

## 9. Account deletion

Clients cannot delete profiles directly. Recommend cascading **only the Profile** when a separately authorized hard deletion of its Auth user succeeds. A failed Auth deletion leaves both identity and profile intact; deleting a profile is never a shortcut to account deletion. Sign-out, pending confirmation, a ban or soft deletion is not an Auth-row hard delete and does not trigger this cascade.

Quest currently references `auth.users` with DELETE RESTRICT. Any retained Quest definition, including an archived one, therefore blocks Auth hard deletion. Keep that protection unchanged: do not delete Quest history, detach ownership or weaken constraints to force account erasure. No self-service deletion endpoint is specified here. A future cross-domain erasure workflow needs separate retention decisions before it can be enabled for such accounts.

Deleting an Auth user must not be described as instantly invalidating every issued access token; session/credential revocation is a separate Auth concern. For Profile access after successful deletion, the row no longer exists and clients have no INSERT capability. [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)

## 10. Failures and edge cases

Invalid credentials, expired sessions and unauthorized profile access produce safe errors without exposing another user's data or account existence. Network errors do not imply a save succeeded; retry reads the owner's authoritative profile. Profile edits commit atomically or retain previous values. Repeated signup/sign-in must not duplicate or reset a profile.

Profile provisioning errors fail the Auth transaction and produce redacted operational diagnostics. Missing profiles are distinguished internally from an unset timezone and routed to controlled repair. No fallback timezone or client-created replacement is permitted. Unknown timezone names or a timezone catalogue/runtime mismatch block dependent work before any occurrence/count/history writes.

## 11. Quest integration

Quest requirements RR-03/AC-39 and domain INV-19 remain unchanged. Creating/enabling recurrence and each materialization batch require the owner's valid `profile.timezone`. If unavailable, reject safely and direct the user to timezone onboarding when appropriate. Existing materialized work remains intact; one-off Quests do not acquire a recurrence-timezone prerequisite.

Use the persisted owner-scoped value at the operation boundary, with a consistent validated value for the batch, and capture it as occurrence `source_timezone`. Never shift existing instants, reset materialization counts, invent historical catch-up work or redesign DST/travel rules as part of Profile integration. Future Quest command-role access is described in the physical design; no Quest table or migration changes are part of this task.

## 12. Acceptance criteria

| ID | Given / When / Then | Trace |
| --- | --- | --- |
| AP-AC-01 | Given a new Auth insertion, when it commits, exactly one profile has the same ID, null optional fields and server timestamps; no credential columns exist | AP-FR-01–02, 04 |
| AP-AC-02 | Given a provisioning error, when signup is attempted, the Auth insert rolls back and no partial profile/account pair is accepted | AP-FR-02, 08 |
| AP-AC-03 | Given pre-existing Auth users, when migration/backfill completes, each has one profile and existing profile values are preserved; repeated sign-in creates none | AP-FR-02 |
| AP-AC-04 | Given users A/B or no session, when profile reads/writes target B, only B may read/update it; A and unauthenticated requests cannot obtain B's row | AP-FR-03, 07 |
| AP-AC-05 | Given the owner, when updating display_name/timezone, allowed values persist; attempts to assign user_id/created_at/updated_at, INSERT/upsert or DELETE are denied | AP-FR-03, 07 |
| AP-AC-06 | Given unset timezone, when onboarding is skipped or display_name alone is saved, timezone remains null and recurrence stays unavailable | AP-FR-04–05 |
| AP-AC-07 | Given an explicit supported IANA zone, when saved, it persists; invalid names, raw offsets and whitespace-only stored values are rejected without changing the old value | AP-FR-05, 08 |
| AP-AC-08 | Given a null/invalid/unreadable timezone or missing profile, when recurrence is created/enabled/materialized, it fails without partial effects or a guessed default; one-off behavior is unchanged | AP-FR-05–06 |
| AP-AC-09 | Given existing occurrences, when timezone changes or is cleared, their absolute times/origins remain fixed; future generation uses the new valid zone or is blocked | AP-FR-06 |
| AP-AC-10 | Given an authorized Auth hard deletion without blocking dependencies, when it succeeds, its profile is removed; with retained Quest data, deletion fails and both remain | AP-FR-07 |
| AP-AC-11 | Given a permitted profile edit, when committed, created_at/user_id stay unchanged and updated_at comes from the database rather than client input | AP-FR-03 |
| AP-AC-12 | Given confirmation is required or a session expires, when protected access is attempted without a valid session, profile existence does not confer access | AP-FR-01, 03, 08 |

## 13. Open questions and implementation gates

No unresolved Profile schema or Quest-timezone design blocker remains. Auth deployment configuration and frontend/session integration are later implementation gates, not assumed implemented behavior. Account erasure involving retained domain history remains explicitly out of scope and blocked on a separately approved retention workflow; this design does not authorize it.
