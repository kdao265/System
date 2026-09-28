# Private Auth V1 — PR #35

Branch: `feat/private-auth-v1`. Authority: Product Owner's Private Auth V1 request.
Scope: existing Supabase SSR auth, owner authorization, signup removal, isolated
auth tests and configuration documentation. No dependencies, domain-rule changes,
existing database operations, deployment, commits, pushes or merges are authorized.
Acceptance: owner login/onboarding/refresh/logout work; anonymous and non-owner
pages/actions fail closed; signup cannot create accounts; lint, typecheck, build
and relevant tests pass. Database hardening was a proposal in this PR's original scope,
not an applied change; it is implemented, promoted and applied to Production
(Cloud) since 2026-09-28, as recorded below and in
[private-auth-database.md](private-auth-database.md).

## Configuration and manual rollout

Set `SYSTEM_OWNER_USER_ID` in Git-ignored `.env.local` to the existing owner's
Supabase **Auth user UUID**. It is server-only; never use a `NEXT_PUBLIC_` prefix,
an email allowlist, client metadata or a service-role key. The public URL and anon
key remain unchanged. Missing, blank, malformed or nil UUID configuration denies
protected requests and password login. UUID matching is case-insensitive.
Configuration is read at request time: a build can pass before the owner is
configured, but authenticated access cannot.

Manually configure the variable in each intended Vercel environment, matching the
owner in that environment's Supabase project. Preview environments need their own
explicitly intended project/owner pair. Redeploy to activate environment changes.
No Vercel settings or deployment were changed here.

The Product Owner reports `system-dev` already disables **Allow new users to sign
up** and anonymous sign-ins. Keep both disabled; website removal alone cannot
disable the public Supabase Auth API. Local `supabase/config.toml` now expresses
the same settings for future starts; this task does not restart existing Local.
Provision the owner administratively through a separately authorized operation.
There is no registration, invitation, OAuth or account-recovery feature in this PR.
See [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).

Before rollout, set the server variable, verify the intended project and disabled
signup settings manually, and review the database gap below. After an explicitly
authorized deployment, manually check owner login, onboarding if needed, dashboard,
refresh and logout. No destructive smoke test may target that deployment. Existing
Local or Cloud migrations require separate approval before any operation.

## Application boundary audit

`getAuthenticatedUser` verifies Auth using `getUser()` and accepts only the
configured UUID; `requireUser` redirects otherwise. `/dashboard` and `/onboarding`
enter through Profile context. `saveProfile`, `createQuest`, `completeQuest`,
`reopenQuest` and `resolveQuestCompletion` independently call `requireUser` before
validation or data access. Progression, Daily Quest and Reward reads also enter
through the shared boundary. Their later Auth rechecks only classify failures;
they cannot grant access or initiate a write. No business rules were changed.

`/` remains public. `/login` retains password login; `/signup` redirects to login
without a registration form. The retained signup action returns a safe unavailable
response without contacting Auth, including direct invocation. Logout remains
callable without owner authorization so old sessions can sign out.

Password login uses isolated, buffered SSR cookie storage. Only Auth's successful
owner response commits cookies. Rejected login clears existing project session
cookies and attempts current-session revocation without exposing tokens, even if
revocation fails. Other valid non-owner sessions are denied by the server boundary;
that boundary does not claim to revoke independently issued Supabase tokens.
Proxy retains its refresh/forward-cookie work and private cache headers. It is
not the authorization boundary. Timezone onboarding and database-triggered Profile
provisioning retain their behavior. See [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
and [SSR cookie refresh](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

## Database audit — migrations 1–10

This is a repository audit and disposable verification, not a Cloud catalogue inspection;
the completed Production activation is recorded in the
[Production rollout](#production-rollout--2026-09-28) section below.

| Surface | Existing protection | Single-owner gap |
| --- | --- | --- |
| Profiles | `auth.uid() = user_id`, SELECT and limited-column UPDATE; private RLS-bound provisioning trigger | Any valid user can read/update their own profile directly |
| Quest tables, EXP, progression assignments/milestones and reward records | Verified JWT subject through `system_internal.request_user_id()`, owner-row RLS, constrained command roles | Subject is not compared to a configured SYSTEM owner |
| Published Level Policy/thresholds | Published rows available to authenticated identities and command roles | Non-owners can read published configuration |
| `get_current_exp`, `get_progression_status`, `list_level_rewards`, `get_reward_history`, `list_day_quest_occurrences` | Authenticated EXECUTE, subject checks and RLS | Non-owner tokens can call these outside Next.js |
| `create_one_off_quest`, `complete_quest_occurrence`, `reopen_quest_occurrence_v2`, `get_quest_completion_resolution_v1` | Authenticated EXECUTE, RLS-bound Quest executor, ownership/cycle/idempotency checks | Non-owners can operate on their own data via the API |
| `configure_level_reward`, `update_level_reward`, `cancel_level_reward`, `redeem_level_reward` | Authenticated EXECUTE, RLS-bound progression executor and ownership checks | Same direct-API gap |
| `assign_level_policy` | Explicit active `level_policy_assign` capability; isolated assignment executor | Grant is separate from app owner; authorized actor can target another user |
| `system_internal.request_user_id` | Callable by authenticated and command roles; parses verified gateway claims only | Identity helper, not a SYSTEM owner allowlist |
| Internal command helpers, trigger functions, `quest_valid_weekdays`, legacy `reopen_quest_occurrence` | No client EXECUTE; private schemas and constrained roles | Preserve revocations and narrow grants |

Ownership isolation is **not single-owner enforcement**. Disabling new accounts
does not invalidate previously issued tokens or existing accounts. PostgreSQL
cannot read the Next.js environment variable. Application access is restricted by
this PR; the database-level enforcement described below is implemented in this
repository and applied to Cloud on 2026-09-28 (see the
[ADR-015 database hardening record](private-auth-database.md#deployment-status)), so any
database that has not applied it is the only place this gap remains.

## Database hardening follow-up

See accepted ADR-015. Add an administrator-managed singleton owner UUID in a
private schema (Auth foreign key; no client writes or owner-setting RPC), and a
narrowly privileged predicate comparing verified request identity to that value.
An absent setting denies access. Its provisioning must be separately approved
and match the server environment; never put real UUIDs in migrations. The design is
implemented and promoted into the migration path
(`20260928090000_install_private_owner.sql` for stage one and
`20260928100000_activate_private_owner.sql` for stage two activation) and fully
validated on disposable resources, and applied to Cloud (Production) on 2026-09-28,
where Local/Remote migration history is synchronized, 15 restrictive single-owner policies
and 14 public-RPC entry guards are active, exactly one configured owner remains, and the
final Production smoke testing passed. See the
[ADR-015 database hardening record](private-auth-database.md).

Add restrictive policies alongside existing policies on application tables,
including published Level configuration, internal command history/aliases and
operator grants. Cover `authenticated`, `quest_command_owner`,
`progression_command_owner` and `level_policy_assignment_owner`; preserve the
private Profile provisioning path. Keep row-ownership predicates, column grants
and RLS-bound executors. Gate public RPC entry points with the same predicate so
non-owner reads fail explicitly even when tables are empty. Assignment requires
both actor and target to be the singleton owner, retaining the capability check.
Do not change the identity parser to conflate identity and authorization or use
client-settable GUCs. Do not disable RLS or alter Quest/EXP/Level rules.

Accompanying SQL/catalogue and PostgREST tests:

- Missing singleton fails closed; configured owner succeeds with existing business regressions.
- Non-owner and anonymous SELECT/UPDATE on every exposed table and every public RPC fail.
- Cover no-row reads, idempotent replays, history/aliases, and operator-granted non-owners.
- Owner assignment to a non-owner target fails; capability checks still apply.
- Clients cannot set the singleton; effective ACLs and no-BYPASSRLS invariants hold.
- Trigger provisioning and owner onboarding/refresh/logout remain functional.

These tests were required to pass on disposable instances before a Local/Cloud rollout
was requested, and they did. Applying the enforcement to a real database is a separate,
recorded step; see the
[ADR-015 database hardening record](private-auth-database.md#deployment-status).

## Validation

Run `node tests/auth-smoke.mjs` without `--env-file`. The harness owns new labelled
tmpfs PostgreSQL, Auth and PostgREST containers, a loopback gateway and production
app servers. It refuses external Docker routing, uses pinned cached images only,
and verifies immutable resource IDs/labels/mounts before cleanup. It does not use
the Supabase CLI, existing Local/Cloud URLs, volumes or databases. Admin credentials
are generated in memory for temporary services only. Two confirmed synthetic users
are created administratively despite disabled signup and removed with the containers.

The HTTP checks cover owner/non-owner/anonymous access, disabled registration,
invalid credentials, Profile action replay, onboarding validation and RLS isolation,
password login, actual cookie refresh/logout, and missing/invalid runtime settings.
`tests/private-auth.test.mjs` additionally calls every protected action and the
disabled signup action directly, and tests rejection when remote revocation fails.

Run `node --test tests/*.test.mjs`, `npm run lint`, `npx tsc --noEmit`, and
`npm run build`. The smoke harness invokes the production build with its disposable
URL/key. **Never deploy the smoke build output**; rebuild with the intended public
Supabase values. The application-boundary validation adds no dependencies. Database
hardening is tracked separately by [ADR-015](../02-architecture/decisions.md) and
[private-auth-database.md](private-auth-database.md), with stage-one install and
stage-two activation migrations; both are applied to Cloud since 2026-09-28.

## Handoff results — 2026-09-28

| Check | Result |
| --- | --- |
| `node --test tests/*.test.mjs` | 175 passed, 0 failed, 0 skipped |
| `node tests/auth-smoke.mjs` | Passed all HTTP/SSR scenarios on real disposable services |
| `npm run lint` | Passed, zero warnings |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed; repeated after smoke to replace disposable build configuration |
| Client bundle inspection | Server owner environment name absent from static JavaScript |
| Git diff/untracked-file review | Reviewed, whitespace checks passed |
| Disposable resource cleanup | No test-labelled containers or networks remain |

Early harness setup failures (reserved Auth role bootstrap and Docker metadata
shape), a legacy non-UUID test fixture and one lint warning were corrected before
the passing final runs. The failed-run containers were removed after verifying
their immutable IDs, run labels, names and absence of volumes. No outstanding test
failure remains. The smoke suite exercises server-rendered HTTP forms, not hydrated
browser interactions, hosted email delivery or Vercel deployment. Cloud settings
and the four Cloud smoke results are Product Owner-supplied facts, not rechecked.

Changed files:

| Area | Paths |
| --- | --- |
| Auth boundary and login | `src/features/auth/owner.ts`, `src/features/auth/session.ts`, `src/features/auth/actions.ts`, `src/features/auth/auth-form.tsx`, `src/lib/supabase/server.ts` |
| Routes | `src/app/login/page.tsx`, `src/app/signup/page.tsx` |
| Configuration | `.env.example`, `supabase/config.toml` |
| Validation | `tests/auth-smoke.mjs`, `tests/helpers/auth-environment.mjs`, `tests/private-auth.test.mjs`, `tests/progression.test.mjs` |
| Documentation | `README.md`, `docs/PROJECT_CONTEXT.md`, `docs/01-requirements/auth-profile.md`, `docs/02-architecture/overview.md`, `docs/02-architecture/decisions.md`, `docs/04-development/auth-application-layer.md`, `docs/04-development/testing.md`, this file |

All changes remain uncommitted. No push, PR update, merge, deployment, existing
database operation or Vercel setting change occurred as part of this PR. The
direct-Supabase security gap is closed where the ADR-015 migrations have been applied:
the hardening is implemented, promoted into the migration path and fully validated on
disposable resources, and on 2026-09-28 the Product Owner authorized and completed the
Production application of the activation migration, so Cloud now rejects direct non-owner
Supabase access. Application checks are not the enforcement and never replaced it.

## Production rollout — 2026-09-28

The Product Owner authorized and confirmed the Production (Cloud) rollout on
2026-09-28, and the promoted activation migration was applied successfully to Cloud.
Recorded results, also kept in
[private-auth-database.md](private-auth-database.md#deployment-status):

| Item | Result |
| --- | --- |
| `20260928100000_activate_private_owner.sql` | Applied successfully to Cloud |
| Local/Remote migration history | Synchronized |
| Restrictive single-owner RLS policies | 15 active |
| Public RPCs guarded | 14 |
| Configured owner rows | Exactly one remains |
| Final Production smoke testing | Passed |

Final Production smoke testing passed for owner authentication, dashboard access,
EXP/Level reads, Quest complete/refresh/reopen/recomplete, two-tab consistency, and
logout and relogin. These are Product Owner-supplied Production results: the disposable
suites above were not re-run against Cloud, no Cloud database was reset or migrated again
for this record, no Vercel setting was changed, and no application code, SQL, migration,
test or configuration file was modified.
