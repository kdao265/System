# ADR-015 database hardening

Task: PR #35 on `feat/private-auth-v1`, authorized by the Product Owner's follow-up
request of 2026-09-28. Preserve the existing uncommitted application changes.
Implement singleton owner authorization, additive restrictive RLS and public RPC
guards. Preserve identity parsing, existing ownership and operator predicates,
Profile provisioning, Quest/EXP/Level behavior and idempotency. No existing Local
or Cloud operations, resets, volume deletion, deployment, commits, pushes or merges.

## Agreed implementation and staging

The Product Owner has approved implementation of ADR-015. Stage one installs only
the private administrator-managed configuration and helpers. Stage two activation
is held in `supabase/staged-migrations`, outside the automatic migration directory.
It must not be promoted until the owner is provisioned and verified on the intended
database. Thus applying all currently pending normal migrations cannot accidentally
activate empty configuration. Activation itself has an atomic configuration
preflight. After activation, missing configuration denies all application access.

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

Implementation and validation are in progress. No existing database has been
contacted. Exact deployment steps and results will be recorded before handoff.
