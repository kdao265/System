# ADR-015 database hardening

Task: PR #35 on `feat/private-auth-v1`, authorized by the Product Owner's follow-up
request of 2026-09-28. Preserve the existing uncommitted application changes.
Implement singleton owner authorization, additive restrictive RLS and public RPC
guards. Preserve identity parsing, existing ownership and operator predicates,
Profile provisioning, Quest/EXP/Level behavior and idempotency. No existing Local
or Cloud operations, resets, volume deletion, deployment, commits, pushes or merges.

## Agreed implementation and promotion

The Product Owner approved implementation of ADR-015 and, on 2026-09-28, the
promotion of stage two. Stage one installs only the private administrator-managed
configuration and helpers
(`supabase/migrations/20260928090000_install_private_owner.sql`, migration eleven).
Stage two activation is now the promoted migration
(`supabase/migrations/20260928100000_activate_private_owner.sql`, migration twelve),
so the ordinary migration sequence carries it. Promotion does not weaken the original
gate: activation is atomic and fail-closed, and its configuration preflight requires
exactly one configuration row joined to an existing Auth user and Profile. Applying
every pending normal migration to an unprovisioned database therefore raises and
changes nothing, and after activation missing configuration denies all application
access. The order is stage one, approved owner provisioning and identity verification,
then stage two.

The disposable harness in `tests/helpers/auth-environment.mjs` reproduces that order:
it defers stage two out of its filename-ordered migration loop and applies it only
after its owner fixture and configuration exist. The fresh-Supabase CI workflow holds
back every migration newer than each checkpoint cutoff, so the verified histories stay
at eight, nine and ten versions and neither private-owner migration runs there.

The owner predicate is a SECURITY DEFINER boolean helper owned by a dedicated
NOLOGIN/NOBYPASSRLS reader. The reader owns no table and can only SELECT the
singleton through RLS. All writes remain administrative. Restrictive policies AND
with existing policies, and additionally bind owner-scoped rows to the request
actor even for the assignment executor. Profile provisioning remains exempt.

All fourteen authenticated public RPCs receive an entry guard. Their OIDs,
signatures, attributes, ACLs and existing bodies are preserved using catalogue DDL
and an exact source-hash preflight; only the entry guard is inserted. This avoids
copying thousands of lines of business logic. Assignment also guards target equals
actor, and retains both existing capability checks. Retired/value-only public
functions retain their client EXECUTE revocations. The request identity parser
is unchanged. Tests compare each complete body (minus the added guard) to its
pre-activation body and verify attributes/ACLs and actual HTTP behavior.

The [PostgreSQL restrictive policy rules](https://www.postgresql.org/docs/17/sql-createpolicy.html)
require every applicable restrictive predicate as well as a permitting policy.
The [row security model](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
does not restrict trusted table owners or BYPASSRLS administrators; these are
administrative boundaries, not application credentials.

## Deployment status

### Production activation completed — 2026-09-28

The Product Owner authorized and confirmed the Production (Cloud) rollout, and on
2026-09-28 the promoted activation migration was applied successfully to Cloud.
Recorded results:

| Item | Result |
| --- | --- |
| `supabase/migrations/20260928100000_activate_private_owner.sql` | Applied successfully to Cloud |
| Local/Remote migration history | Synchronized |
| Restrictive single-owner RLS policies | 15 active |
| Public RPCs guarded | 14 |
| Configured owner configuration rows | Exactly one remains |
| Final Production smoke testing | Passed |

Final Production smoke testing passed for owner authentication, dashboard access,
EXP/Level reads, Quest complete/refresh/reopen/recomplete, two-tab consistency, and
logout and relogin. The approved order was followed: stage one, approved owner
provisioning and identity verification, then stage two. Cloud received the activation
through the ordinary migration sequence, and its fail-closed preflight still requires
the single verified owner configuration, so an unprovisioned project cannot activate.
No other Cloud data, Vercel setting, Local database or Docker resource was changed by
that rollout, and the disposable validation below was not re-run against Cloud.

### Promotion — 2026-09-28

Stage two was promoted on 2026-09-28 on branch `chore/private-auth-activation`, under
the Product Owner authorization recorded in
[decisions.md](../02-architecture/decisions.md). The file was moved from
`supabase/staged-migrations/` to `supabase/migrations/` as a git rename; its SQL
statements are unchanged and only the header comment now records the promotion. The
disposable harness, the private-owner wire test, the fresh-Supabase CI hold-back
assertions and this record were updated to match. At promotion time no existing
database was contacted, reset or migrated, and no Docker volume, backup, Vercel setting
or non-owned container was changed; the separately authorized Production application
followed on the same date as recorded above. Nothing was committed, pushed or merged
for that promotion.

Validation of the promoted set on 2026-09-28, using self-owned disposable Docker
resources only (Docker Desktop was started locally for these suites):

| Check | Result |
| --- | --- |
| `node supabase/tests/private-owner-wire.mjs` | Passed (exit 0): 17 migration-checkpoint regressions, stage one leaving stage two inactive, and all 10 database/security groups, with activation applied from the promoted path after the owner fixture and configuration existed. |
| `node tests/auth-smoke.mjs` | Passed (exit 0): disposable production build plus every Auth/RLS behavior group, including activated RLS hiding non-owner data and rejecting direct non-owner RPCs. |
| `node --test tests/*.test.mjs` | Passed: 175 tests, 0 failures. |
| `npm run lint` | Passed (ESLint with `--max-warnings=0`). |
| `npx tsc --noEmit` | Passed, no diagnostics. |
| `npm run build` | Passed: Next.js production build, all six routes and the proxy emitted. |
| `git diff --check` | Passed, no whitespace errors. |

Unresolved and pre-existing: `supabase/tests/quest-completion-resolution-wire.mjs`
asserts that `supabase/migrations` contains exactly migrations one to ten and copies
that whole directory into its disposable PostgreSQL container. It became stale when
migration eleven (`20260928090000_install_private_owner.sql`) was added, so it fails on
its own environment-setup assertion independently of this promotion, and the promoted
activation file adds a second unexpected entry. It runs only on demand, outside the CI
workflow and outside the documented command set in [testing.md](testing.md). Correcting
it requires deciding how that harness excludes the private-owner migrations from its
copy-and-apply step, so it is recorded in the [backlog](../00-product/backlog.md)
instead of being changed here.

Deploying the promoted migration was a separate, explicitly authorized step, in the
order stage one, owner provisioning and identity verification, then stage two; that step
completed for Production on 2026-09-28 as recorded above. Any other environment has to
be authorized and provisioned separately in the same order.

On 2026-09-28 the Product Owner directed the documentation status updates in this
change: [ADR-015](../02-architecture/decisions.md) and
[private-auth-v1.md](private-auth-v1.md) first recorded the design as accepted,
implemented, promoted into the migration path and validated on disposable resources with
Cloud activation pending, and now record the completed Production activation above. The
earlier wording ("proposed follow-up", "not implemented or applied", "Cloud stage two
activation remains pending") predated the stage-one implementation, the promotion and
this rollout. This file remains the authoritative current record of what runs where.
