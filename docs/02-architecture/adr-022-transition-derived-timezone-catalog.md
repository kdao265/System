# ADR-022 - SYSTEM-owned versioned timezone rules

Date: 2026-10-04. Status: Accepted by Product Owner; backend and frontend implementation
complete on `feat/recurring-schedule-defaults-v1`.
Supersedes the uncommitted provider-round-trip and per-startup attestation design.
Deployment, commits and pushes remain unauthorized.

## Contract and authority

SYSTEM owns recurring timezone semantics. PostgreSQL provider tzdata, restart identity,
server filesystem and Cloud fingerprints never decide materialization. Profile validation,
one-off scheduling, Calendar projections and existing RPC response shapes remain unchanged.
Aliases are preserved exactly. The active SYSTEM release defines supported recurring zones;
a globally valid Profile zone absent from it raises a distinct support error (PZ003).

Authenticate, acquire the existing owner lock, capture one evaluation instant, Profile zone
and active release. Use that release for instant-to-local today, eligibility, every endpoint,
and occurrence provenance. Retained slot identity wins before interpreting current defaults.
New timed occurrences are scheduled; untimed occurrences are draft. Estimates, deadlines,
revision/audit semantics, accepted replay, retirement and capacity contracts are unchanged.

## Immutable releases and provenance

A release identifier hashes a canonical identity containing the pinned source hash, full
generated dataset hash, tzdb version, generator version and resolver semantics version.
Version all manifests, candidate offsets, UTC eras and future rules by release_id. Keep old
releases in the database permanently. A private singleton selects the active release.
Future additive migrations insert a complete immutable release, validate it, then atomically
switch the singleton. Never rewrite old datasets, occurrences or historical migrations.
One batch captures its release once; concurrent activation cannot mix its endpoint versions.

Add nullable quest_occurrences.source_tzdb_release_id, with no default or backfill. Stamp
all newly materialized recurring occurrences, timed and untimed. Preserve it through
Complete, Reopen, explicit planning, archive, restore and tombstone. Do not change historical
ck_occurrence_origin, slot uniqueness, Calendar/detail projections or strict client parsers.
Retained receipts replay without reevaluating old rules against a newer active release.

## TZif and POSIX semantics

Use TZif type 0 before the first transition. Store half-open UTC eras, merging only equal
offset AND specified/unspecified semantics. Store the actual final explicit transition;
footer activation never comes from a merged era boundary. A nonempty footer governs from
that transition, or all time for transitionless files. Fixed and empty footers are explicit:
after a final transition without a footer the semantics are unspecified; a transitionless
file without a footer uses type 0. Validate footer consistency at the final transition.
Reject unsupported or malformed sources, including leap-second inputs.

POSIX omitted transition time is 02:00. Jn omits leap day; n includes it; Mm.w.d uses
normalized weekday arithmetic and final-week semantics. Support signed transition times
through 167:59:59, non-hour/negative DST and zero offsets. Determine seasons using actual
UTC transition events, including adjacent astronomical years. Use floor division rather
than truncation for Gregorian arithmetic. Reject syntax outside the supported TZif grammar.

For local L enumerate precomputed per-release/per-zone offsets o, form u=L-o and accept iff
offset_at(release,zone,u)=o with specified semantics. Zero/one/multiple distinct preimages
mean nonexistent/unique/ambiguous. Never derive candidate DISTINCT from eras at runtime.
Unknown source semantics conservatively prevent resolving a local time where an unspecified
candidate interval could apply: unsupported_timezone_semantics is a slot-local issue.
An unspecified evaluation instant cannot establish today and yields an empty batch with an
interval-level unsupported_timezone_semantics issue for each otherwise active series;
no guessed local date authorizes generation.

## Date and instant boundaries

Local input dates remain 0001-01-01 through 9999-12-31. Internal UTC candidates and Gregorian
calculations may cross those boundaries, using astronomical years and explicit BC conversion.
Do not use JavaScript Date's 0-99 constructor convention. Only otherwise-unique endpoints
within UTC [0001-01-01,10000-01-01) may be persisted. An endpoint outside that interval produces
unsupported_instant_range, no occurrence and no capacity consumption. Untimed dates remain
supported. Overnight local endpoints past 9999-12-31 remain invalid_interval. Never clamp.

## Integrity and security

Private internal tables have explicit ownership, RLS and revoked client/executor table
access. Schema-qualified definer helpers with trusted search_path expose only necessary
execution to quest_command_owner; public owner-data commands retain existing RLS/ownership.
No zone-derived dynamic SQL. Immutable-data triggers reject ordinary UPDATE/DELETE/TRUNCATE;
additive insertion is for the migration owner only. Each use verifies release/manifest
identity and semantic hashes/counts, with complete per-zone verification once per batch.
Indexed endpoint lookup uses that checked immutable dataset. Missing/inconsistent data
raises PZ002, never a normal gap/fold/unique result. Unsupported zones use PZ003;
legitimate DST, unspecified semantics and instant-range problems are slot-local issues.

## Generation, migration and validation

Pinned TZif bytes and an explicit zone manifest live under proper test fixture paths.
Generator, schema, runtime SQL and deterministic literals compose one self-contained
20261004120000_recurring_schedule_defaults_v1.sql. No runtime includes, dependencies or
prototype imports. Hash eras, candidates, rules, manifests and release identity.

Independent acceptance includes raw TZif transition decoding, standalone POSIX fixtures,
test-only PostgreSQL comparisons, synthetic grammar cases, corrupt datasets, populated
upgrade/no-backfill, release activation and retained replay. Preserve 29 schedule tests,
23 historical SQL checkpoint suites and legacy RPC signatures/security/ACLs. Benchmark
fresh authenticated materialization at 1/10/50/100 series for explicit and far-future rules,
with varied schedules and zone batches. Both 100-series workloads must stay below four
seconds without timeout increases. Use only newly owned disposable environments.

## Alternatives and consequences

Rejected: live provider round-trips, startup attestation, exhaustive per-endpoint scans,
unversioned replacements, alias rewriting and shared-evaluator-only oracles. Side-by-side
release storage costs a few MiB per release and preserves reconstruction. Pinned recurring
rules can differ from Intl/Calendar display rules; this is an explicit V1 boundary, not
permission to rewrite those features. Reference integrity is independent of managed restarts.

References: RFC 9636; POSIX TZ environment variable; Quest RR-03/RR-06; ADR-021.
