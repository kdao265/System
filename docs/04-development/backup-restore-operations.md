# Backup & Restore Operations — SYSTEM V1

Task: **OPS-60-D01**, [Issue #60](https://github.com/kdao265/System/issues/60).
Branch: `docs/issue-60-backup-restore`. Prepared: **2026-10-15**.
Status: **Documentation Prepared — pending independent PR review. Backup Operationally Verified: NO.**

Architecture Review: **R1–R4: Documentation Review PASSED**. Independent PR review
remains pending. Operating policy, RPO/RTO, backup provider, budget, implementation
and personal-use go-live have **not** been approved by the Product Owner.

## 1. Authority, scope and evidence

The Product Owner decision recorded in Issue #60 on 2026-10-13 makes verified backup
and restore readiness mandatory **before storing real personal-life data**. Installation
as a PWA, successful application tests, a backup file or a checksum alone cannot open
this gate. Issue acceptance also requires configured recurring backups, a recorded
disposable restore drill, incident handling, a pre-migration gate and a separately
reviewed documentation-only PR. This task prepares documentation; it does not complete
those operational or PR requirements.

This task authorizes Markdown changes only. No Cloud/Production or existing Local
database connection, dump, restore, reset, migration, data change, credential retrieval,
backup configuration, dependency, commit, push, PR, merge or deployment is authorized.
Issue #60 and its checkboxes remain unchanged. PR #59 and Activities & Opportunities
(AO) work remain untouched; the AO release gate remains closed.

Issue #60's test-stage exception applies only to
`20261007120000_create_books_v1.sql`: the PO accepted possible loss of test data without
a prior backup for that single migration. It neither proves the database empty nor
authorizes another migration or an exception to the personal-use go-live gate.

| Evidence inspected | What it establishes; limits |
| --- | --- |
| `AGENTS.md`, [project context](../PROJECT_CONTEXT.md), [agent workflow](ai-agent-workflow.md) | Documentation scope, narrow changes, PO-controlled architecture and operational authorization. |
| Local branch and working tree | Initial preflight: requested branch, clean tree, HEAD `cc57912` (`feat(ao): add protected Growth UI scaffold (#58)`). Review follow-up preserves the same branch and the two uncommitted Markdown changes. No inference about unmerged PR #59 or live deployment. |
| [Cloud readiness record](../operations/cloud-readiness-20260928.md) | Historical SQL backup and SHA-256 recorded; full restore explicitly **not verified**, with Cloud/local Auth schema mismatch. Backup was local and Git-excluded. Artifact availability, freshness and external retention were not checked here. |
| [Private Auth](private-auth-v1.md), [database hardening](private-auth-database.md), ADR-014/015 in [decisions](../02-architecture/decisions.md) | Historical PO-supplied Production activation record; owner UUID must agree between Auth, private database configuration and server configuration. This task does not revalidate Cloud. |
| [Auth requirements](../01-requirements/auth-profile.md), [Auth design](../02-architecture/auth-profile-database-schema.md), repository migrations and [Supabase notes](../../supabase/README.md) | Recoverable application dependencies include Auth identities, Profile provisioning, internal schemas, roles, policies and immutable history. Historical milestone docs are not a current deployed inventory. |
| [Personal Beta / PWA](personal-beta-pwa.md), ADR-017, Quest/Library recovery providers | PWA cache contains static assets only. Browser pending-command state exists separately and is not a database backup. |

**Unknown until a separately authorized operational preflight:** actual Supabase plan,
deployed migration list, PostgreSQL/Auth/Storage versions, data size, populated buckets,
external jobs, managed backup/PITR availability, backup destination, scheduler, credential
custodian, encryption keys and measured recovery time. Repository files do not establish
any of these live facts. Missing coverage is a blocker, not an assumed empty dataset.

## 2. Data inventory and coverage boundaries

The future operator must reconcile this seed inventory against the authorized source
catalog and configuration. Record every discovered schema/table/service as included,
reconstructed or explicitly excluded with PO approval. Do not export only `public`.

| State | Required preservation and recovery check |
| --- | --- |
| Application PostgreSQL data | Profiles/timezones; Quests, recurrence rules, occurrences, events, archived/deleted tombstones; EXP ledger; Level policies/thresholds, assignments, milestones, rewards/unlocks/events; Calendar schedules, Goals/links and Library books where deployed. Preserve IDs, ownership, timestamps, revisions, history and idempotency relationships, not just visible active rows. |
| Internal application state | `system_internal` command receipts, completion aliases, operator grants and versioned timezone catalog/active release; `system_private.owner_configuration`; definitions in `profile_internal`, `exp_internal`, `progression_internal`. Derive the full list from the actual migration checkpoint; no fixed historical policy count is sufficient. Include later modules only if actually deployed; this does not authorize AO deployment. |
| Database definitions and security | Schemas, tables, sequences, types, constraints, indexes, views, functions, triggers, owners, custom roles/memberships, grants/default privileges, RLS and RPC guards. Record extension versions and database settings/publications needed to reconstruct behavior. A row-only export is insufficient. |
| Supabase Auth and Auth-related application data | Preserve supported Auth user/identity records and credential hashes, original user UUIDs and dependent application rows. Inventory sessions, refresh tokens, MFA/encrypted Auth state if present; require an explicit supported recovery/re-authentication policy. `public.profiles` alone cannot restore login. Never dump these records into evidence logs. |
| Auth configuration | Record disabled public/anonymous signup, provider settings, redirect/site URLs, SMTP and hooks as a private configuration inventory. Restore settings separately with target-specific endpoints and fresh credentials; preserve owner-only access. Existing sessions are not promised to survive. |
| Migration provenance | Exact deployed app commit, ordered applied migration versions and file hashes; immutable migration files and dependencies from Git; separate `supabase_migrations` history coverage. Git migrations reconstruct definitions, not user data or proof of Cloud application. Preserve an encrypted source release archive outside the primary project as well. |
| Storage metadata | Bucket configuration/privacy, object keys, sizes, content types, owner fields, references and policies. Keep a private object manifest tied to the database recovery point. Metadata restoration is not proof that a file is readable. |
| Storage actual object bytes | Separately retain the exact bytes required by each recovery point through a supported Storage API/S3-compatible interface. Preserve bucket/key mapping, lengths and content hashes. No recoverable source version history is assumed: an overwritten/deleted object's old bytes must already exist in a verified independent copy. Verify download after restore under intended owner permissions; see the retention mechanism below. |
| External configuration and secrets | Vercel environment names/settings, target app release, domain/DNS, Auth keys, database/Storage credentials, SMTP/integration credentials, encryption/key recovery material and account MFA recovery access where applicable. Secret values belong in a separately protected secret manager/recovery kit, never Markdown, Git, logs or screenshots. Record only opaque references. |
| Other state, if present | Inventory Edge Functions, webhooks, scheduled jobs, Realtime, Vault/encrypted columns and integrations. Preserve definitions and required key custody; keep external effects disabled in the drill. External linked files/services need their own recovery policy; a URL is not a copy. |
| Browser/PWA state | Static icons/manifest are rebuildable from Git. Cookies, pending commands in local/session storage and unsubmitted drafts are outside server backup coverage. Use a fresh browser profile for a drill; do not import old sessions or replay pending commands into a restored timeline. Reconcile uncertain commands against restored receipts before any separately approved resubmission. |

### Mechanism limits

The official provider references below were consulted on 2026-10-15. They describe
platform capabilities, not the configuration of SYSTEM's live project; recheck them
against the pinned tool/platform versions before implementation.

- A logical `pg_dump` captures a database snapshot; roles are separate cluster state.
  Separate exports do not automatically share a snapshot. Tool success must be paired
  with inventory reconciliation and recovery checks. [PostgreSQL SQL dump documentation](https://www.postgresql.org/docs/current/backup-dump.html).
- Supabase CLI defaults exclude managed schema definitions such as `auth`/`storage`,
  and the default dump lacks data and custom roles. Pin and inspect the chosen CLI's
  actual schema/data/role selection, including extension-owned state; never infer Auth
  coverage from an output filename. Target default privileges also require review to
  avoid accidentally broadening access. [Supabase CLI dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump).
- Managed daily backups/PITR protect database recovery points, not Storage object
  bytes. Availability/retention depend on the plan; project deletion also removes its
  associated managed backups. They cannot be the sole independent copy. Current
  guidance lists daily retention of 7/14/up to 30 days for Pro/Team/Enterprise;
  the live project's entitlement is unknown. [Supabase database backups](https://supabase.com/docs/guides/platform/backups).
- Manual logical recovery needs separate handling for migration history and custom
  Auth/Storage definitions. Vault or column encryption can require an encryption root
  key that a logical dump does not transfer. A restored encrypted row without its key
  is not recovered data. [Supabase CLI recovery guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
- Storage SQL metadata is not the object store; use supported APIs for object operations,
  not direct SQL edits to manufacture a successful restore. [Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design).

## 3. Proposed operating policy — PO approval pending

**Recommendation:** start with a scheduled, encrypted logical recovery bundle plus
separate Storage bytes and configuration/key recovery. Retain it in private storage
outside the primary Supabase project and preferably outside the same provider/account
failure domain. Use an already available trusted scheduler if suitable; its selection,
availability and monitoring must be approved and demonstrated before go-live. A laptop
that may be asleep is not evidence of a working recurring schedule.
This baseline is conditional on the consistency mechanism and Auth recovery choice
below. A manual backup success does not demonstrate an unattended backup capability.

This is an operational proposal, not an adopted architecture or implemented pipeline.
It preserves Supabase as the application source of truth. If implementation requires new
roles/grants, providers, dependencies or architecture changes, record the specific ADR,
alternatives and impact and obtain PO agreement before implementing them. Never relax
application RLS or expose privileged backup access through application clients.

| Option | Trade-off and decision proposal |
| --- | --- |
| Independent logical bundle + object copies | Recommended small-project baseline: portable, inspectable and cost-conscious; requires tested Auth compatibility, all-schema coverage and consistent DB/object capture. No operational readiness until the historical Auth restore problem is resolved. |
| Existing managed daily backups + independent bundle | Useful additional database recovery layer if already included in the selected plan. Verify restore-to-new-project support and external copy separately. |
| PITR + independent bundle/object history | Consider only if the PO needs materially lower database RPO. Adds recurring cost and does not reduce Storage RPO automatically. |
| Manual-only copies or managed-only copies | Insufficient as the proposed steady-state solution: manual copies can miss cadence; managed-only copies do not meet independent Storage/system recovery needs. |

### Consistency modes and operational blockers — R1

The following are proposed designs to validate, not existing SYSTEM controls. Inventory
all writers: app actions, reads that materialize Quests, direct PostgREST/RPC/SQL clients,
Auth login/refresh/admin changes, Storage uploads/overwrites/deletes (including in-flight
uploads), dashboards, cron, webhooks, Edge Functions, imports and external integrations.
Closing browser tabs, showing maintenance UI or observing equal row counts is **not**
proof that these writers have stopped.

| Mode | Proposed mechanism and required evidence |
| --- | --- |
| Manual controlled backup | Operator invokes a separately approved maintenance procedure with enforceable admission controls for every relevant write path, suspends jobs/imports/admin changes and drains in-flight operations. Verify controls with safe denied-write probes and service/transaction evidence throughout capture; a maintenance banner alone is insufficient. Capture DB/Auth, Storage and mutable configuration inside that verified boundary. If managed Auth/background writers cannot be frozen, use the shared database snapshot method below and record this as a hybrid capture, not a full write-freeze. |
| Unattended recurring backup, proposed every 12 hours | A scheduler must establish consistency automatically and fail closed when it cannot. Proposed baseline: one PostgreSQL snapshot covering application/internal data, required Auth data, migration history and Storage metadata, with a separate automated Storage write barrier held from before the snapshot until all referenced bytes are safely copied. Pin schema/roles/configuration to a controlled change window. The scheduler must prove barrier acquisition, drain, snapshot identity, full coverage and release; it cannot depend on the owner closing tabs or being awake. No such orchestration is implemented or verified here. |
| Concurrent Storage writes without a barrier | Alternative only after separate design approval: immutable object revisions, durable copy-before-overwrite/delete, and a manifest binding the database snapshot to exact retained bytes. Every writer, including direct API/admin paths, must honor the protocol. An after-the-fact poll or change notification alone can miss a replaced/deleted object. Until demonstrated, concurrent Storage capture is an operational blocker. |

For PostgreSQL/Auth, a single compatible export may cover all required rows in one
snapshot. If the recipe needs multiple exports, they must import the **same exported
snapshot** while its coordinating transaction remains open; source counts/digests must
use that snapshot too. Verify support in the pinned tool and authorized connection mode;
sequential CLI exports started near each other are not equivalent. Auth data in that
database shares the snapshot only when explicitly included; Auth service settings,
external keys, object bytes and other services do not. Snapshot support is documented
by [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

The proposed Storage barrier must cover supported upload/delete APIs, S3-compatible
access, signed upload paths, service/admin access and in-flight work, not just the app.
Evaluate supported access restrictions and job controls in a later authorized design;
do not assume a gateway blocks direct endpoints or that managed services can be paused.
Do not alter RLS or privileges in this task. Schema/role/configuration changes likewise
need an enforced operational change window; a DB snapshot alone does not freeze external
configuration or arbitrary cross-service workflows.

Before a set becomes `CAPTURE_VERIFIED`, its private manifest must identify the mode,
DB snapshot/recovery point, included Auth state, Storage barrier or revision protocol,
writer coverage, source consistency checks and controlled configuration revision. Fail
the set on unknown writers, barrier loss, snapshot expiry or missing bytes; retain the
last good set and alert. A DB-only snapshot may be useful evidence but must not be
reported as a complete SYSTEM backup. **Unproven unattended consistency blocks scheduled
backup acceptance and personal-use go-live**, even if a manual controlled backup passed.

### Exact Storage bytes for retained recovery points — R4

Do not assume Supabase Storage provides usable historical object versions. An object
key, timestamp, ETag or metadata row cannot recover bytes that were never retained.
Proposed simplest mechanism: while the verified barrier holds, copy each object into
an encrypted, independently retained **per-run snapshot**; never overwrite a previous
run's copy. Its private manifest binds the DB recovery point and bucket/key to the
copied length, SHA-256 content digest and backup location, plus required ownership and
bucket settings. Publish the manifest/set as complete only after all copies are verified.

If key K contained bytes A at point T1 and later becomes B or is deleted, the T1 set
must still retrieve A from its own retained copy. T2 maps K to B, or records K as absent;
it must not rewrite T1's manifest or delete A. Restore only the chosen point's objects.
Provider versioning, if separately verified, can support retention but is not a substitute
for demonstrated retrieval of those bytes. A manifest of hashes without retained content
does not suffice. Missing historical bytes cannot be recreated from a database backup.

Hold the barrier until all required bytes are copied, or use the separately approved
immutable-revision protocol above. Repeating list/download scans while writes continue
does not establish a common point in time. Rotation must preserve every blob, manifest
and decryption key referenced by any retained or pinned set; no source-delete mirroring.
If deduplication is later proposed, garbage collection needs reference-aware validation
before deleting a blob shared by recovery points. This task implements neither approach.

Acceptance requires a synthetic disposable test: capture A, overwrite with B, capture
again, delete K and capture a third point, then retrieve/restore the bytes or absence for each retained
point from independent storage. Verify content hashes and authorized downloads after
rotation as well. Failed historical retrieval blocks acceptance of affected recovery
points and triggers the missing-data response in section 7.

### Targets, schedule and retention

All values below are **proposals requiring PO approval**, not achieved guarantees.

| Item | Proposed value and rationale |
| --- | --- |
| RPO | At most **24 hours** of committed personal data lost, measured from the incident to the newest complete recoverable point across database, Auth and Storage. Unsubmitted browser drafts are excluded explicitly. Daily planning data can tolerate this only with PO acceptance; irreplaceable evidence may justify tighter targets. |
| RTO | At most **24 elapsed hours** from incident declaration to verified usable replacement service, including provisioning, download/decryption, restore, access checks and separately approved cutover. Drill time alone excludes cutover and cannot prove this end-to-end target. |
| Recurring capture | Unattended every **12 hours**, proposed 02:00 and 14:00 `Asia/Ho_Chi_Minh` (19:00 previous day and 07:00 UTC), only after the R1 mechanism is approved and verified. This leaves retry margin within a 24-hour RPO. Record recovery-point time and completion time separately, in UTC. A manual controlled backup is a separate operation and does not prove this schedule works. |
| Retention | Keep every successful 12-hour bundle for 14 days (up to 28), one weekly for 8 weeks and one monthly for 3 months. A bundle may serve multiple tiers. Keep each retained DB point's matching object versions, manifest, release and decryptable key reference. |
| Rotation | Delete only expired, unpinned sets after verifying a newer complete external set. Never replace the last known-good or last restore-proven set with an unverified run. Pin pre-migration sets for at least 30 days and until acceptance/incident closure, whichever is later. Pinning can increase cost and sensitive-data retention. |
| Review/drills | Operator reviews completion/freshness daily; verify independent retrieval and retained-version availability weekly. Full disposable restore before go-live, monthly thereafter, and after backup format, Auth/platform version, schema or access-control changes. Exercise an older retained set periodically. |
| Ownership | PO is accountable and approves risk/budget; a named operator runs checks and responds to alerts. PO may hold both roles for this personal project. Record an availability/recovery-access arrangement before go-live. |

No encryption keys may expire while dependent retained sets exist. Rotation of keys or
credentials requires a retrieval/decryption test; old key versions remain recoverable
for their retention period. Record failed deletion/rotation and review it with the PO.

### Security and cost assumptions

Use TLS for transfers and authenticated encryption before off-site upload (for example,
an approved tool using AES-256-GCM or an equivalent reviewed format), plus encrypted
local staging. Keep keys separately from backup files, with an independently recoverable
copy. Restrict private destination access to the PO and designated operator; require
MFA for administrative access. Prefer a backup writer without delete/retention-change
rights and separate recovery/rotation authority where the provider supports it. Retained
versions must survive source deletion and a compromised routine writer; do not use a
destructive mirror. Verify policies and any minimum retention/immutability feature.

Export requires explicitly authorized operator access sufficient for the complete
inventory. An owner-filtered API export may omit internal/Auth data. Do not disable RLS,
change grants or substitute service-role application calls to hide gaps. Document the
required administrative scope for review; keep credentials server/operator-side in a
secret manager, out of shell history, process arguments, transcripts and job output.

Budget illustration only: assume a **1 GiB encrypted DB bundle + 1 GiB object snapshot**
per set. Up to 39 distinct scheduled sets require about **78 GiB**, before pinned sets,
provider versions or local copies. At a hypothetical **USD 0.025/GiB-month**, that is
**USD 1.95/month** for stored bytes only; this is not a provider quote. Initial planning
allowance: **USD 5–10/month incremental off-site storage/requests**, excluding scheduler,
egress/downloads, tax, secret tooling and disposable project compute. Validate actual
volume, region, transfer charges and a full restore bill before selecting a provider.
Estimate total from retained GiB × quoted storage rate, API requests, egress, scheduler,
secret storage and drill compute; alert before exceeding the PO-approved cap.

PITR is not in the recommended baseline: current Supabase guidance lists approximately
**USD 100/month for 7-day PITR**, in addition to other applicable plan/compute costs.
Recheck pricing before purchase. [PITR pricing](https://supabase.com/docs/guides/platform/backups#pricing).

## 4. Backup runbook — future authorized execution only

This sequence is a planning runbook, not a tested executable script. Before first use,
the operator must attach a version-pinned command/API recipe with secret-safe parameter
injection, explicit schema coverage and safe source/target checks, validate it on
synthetic disposable resources, then obtain authorization for the actual source export.
No commands in this task are executed against a database.

1. **Authorize and identify.** Record PO authorization, operator, intended source alias,
   approved time window, destination alias, run ID and policy version. Independently
   verify the source identity via the authorized control plane; use explicit connection
   selection, never an inherited linked/default project. No credentials in the record.
   Stop if scope, identity, access or destination isolation is uncertain.
2. **Preflight coverage.** Reconcile section 2 with the live inventory under the separate
   authorization. Record versions, deployed commit/migration hashes, schema/table list,
   object count/size and configuration/key references in a restricted manifest. Confirm
   free staging/destination capacity, recoverable keys and a compatible restore target.
   Pin tool versions; review export exclusions. Unknown Auth coverage blocks the run.
3. **Establish a recovery point.** Select and record the approved section 3 consistency
   mode. For a manual controlled run, verify the enforced write-freeze and drained work;
   closing tabs is insufficient. For unattended capture, require the automatic shared
   PostgreSQL/Auth snapshot and verified Storage barrier/revision protocol; do not silently
   substitute a manual checklist. Record snapshot identity, all writer paths, boundary
   start/end and configuration revision. If a required control is unavailable or fails,
   stop, alert and mark the set incomplete. A DB snapshot cannot synchronize object bytes.
4. **Export the complete bundle.** Use the reviewed logical recipe for schema, data,
   custom role/security definitions and explicit managed Auth data/customizations.
   Include migration history and release provenance separately as needed. Validate that
   private schemas, sequences, receipts and tombstones are present. Preserve Auth UUIDs;
   exporting only user emails/Profile rows is insufficient. Treat hashes/tokens as secrets.
5. **Capture Storage and other state.** Enumerate all buckets and paginate through all
   objects, including private ones, using the approved read access and snapshot-bound
   inventory. Copy actual bytes to the independent per-run snapshot and build the
   bucket/key/owner/length/hash manifest. Never rely on unverified source version history.
   If Storage is unused, record a verified zero-object inventory and date, not an
   assumption. Include configuration inventory and confirm separate key recovery access.
6. **Check before publishing.** Require successful exit/status for every component;
   review warnings. Compare tables, row counts, schema/security definitions, migration
   list, object count/total bytes and per-object content hashes against the stable source
   manifest. Capture deterministic per-table content digests using the reviewed recipe's
   ordering/serialization and the same database snapshot (or verified freeze), keeping
   them private for restored-data comparison. Counts from a later changing source are
   not comparable. Verify the consistency evidence before checking archive
   readability and no missing/truncated sections. Zero rows require an explanation.
7. **Encrypt, transfer and retrieve.** Encrypt the complete bundle/manifest, compute a
   SHA-256 ciphertext checksum, upload under a unique run ID and retrieve it from the
   independent destination. Compare checksum, decrypt in protected staging and check
   archive/manifest contents. A checksum proves byte integrity, not semantic recovery.
   Mark only `CAPTURE_VERIFIED`; reserve `RESTORE_VERIFIED` for section 5. Expose no file
   contents, filenames containing personal information, keys or raw provider errors.
8. **Close and monitor.** Record recovery point, durations, private evidence reference,
   completeness result and next due time. Release acquired barriers under the reviewed
   procedure and verify normal operation. Unattended runs need tested failure cleanup,
   bounded timeouts and operator escalation if controls cannot be released safely; manual
   runs confirm closure with the PO. A partial run never replaces a good set.
   Apply retention only after checks pass. Remove temporary plaintext and revoke temporary
   access under the approved lifecycle; preserve failed evidence privately for diagnosis.

## 5. Restore runbook — disposable destination only

**Never restore over Production or the developer's existing Local database.** Every
drill restores into a newly created, explicitly disposable target with distinct project
identity, credentials and app endpoint. Target cleanup does not authorize deleting the
source or retained backups. Real-data copies still require private access controls.

### Auth recovery decision matrix — R2, PO decision pending

Neither route is operationally accepted. Resolve the historical Auth mismatch through a
tested logical recipe or demonstrate the managed route's eligibility and full recovery.
Selecting managed recovery does not prove the independent logical export recoverable or
remove Issue #60's external backup/storage requirement.

| Decision factor | Manual logical restore | Managed Restore to a new project |
| --- | --- | --- |
| Eligibility / dependency | Requires sufficient approved export access and a compatible target. Explicitly resolve source/target Auth schema and version differences; pin and test the recipe. No blanket claim that arbitrary Auth versions are portable. | Requires a paid plan and physical backups enabled on the source. SYSTEM eligibility and available recovery points are **unknown**; verify under future authorization before selecting. |
| Data supported by the route | Application schema/data and selected Auth records only to the extent included and proven by the recipe. Preserve users/identities, hashes, UUID relationships and required Auth state; managed schema defaults are not an inclusion guarantee. | Provider documents database schema/data/indexes, roles/permissions, Auth accounts/hashes/records and encryption root key transfer. |
| Separate/manual recovery | Explicit migration history and custom Auth/Storage definitions as needed; Storage bytes and settings; app/Auth configuration, external secrets and encryption keys. Test encrypted Auth/MFA state if present; define supported fresh-sign-in/session handling. | Storage objects/bucket settings, Auth settings/API keys, Edge Functions, Realtime, extensions/settings and replicas need manual reconfiguration. External app configuration and secrets also need a recovery plan. |
| Side effects / isolation | Inspect the logical restore plan before loading. Exclude execution of outbound jobs, hooks and real SMTP through reviewed target isolation; avoid duplicate Profile provisioning. Review all restore-time code and privileges. | Copied cron/webhook/extension jobs can run immediately; they cannot be paused/excluded during cloning. Require proven containment before starting, otherwise reject this route. Post-restore inspection alone is too late. |
| Cost | Operator work, encrypted external storage/transfer and compatible disposable compute; repeated compatibility trials add cost. Amount and provider remain unapproved. | Paid subscription plus a separately billed new project with mirrored compute/disk resources; PITR costs extra if chosen. Obtain a current estimate and PO budget approval before provisioning. |
| Acceptance evidence | Restore the retained independent export into a disposable target and prove complete Auth/application relationships, login, owner/non-owner checks, encryption recovery and Storage reconciliation. An Auth schema error fails this route. | Verify eligibility and selected point, prove side-effect containment and complete the same end-to-end data/Auth/security/Storage checks. A completed clone operation alone is not acceptance; independent backup recovery still needs evidence for its selected method. |

Provider capability sources: [logical recovery guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
and [managed restore-to-new-project guidance](https://supabase.com/docs/guides/platform/clone-project).
The acceptance conditions are SYSTEM proposals for PO review. Neither provider capability
nor the conditional documentation review establishes live availability or successful recovery.

### Execution sequence after separate authorization

Steps below describe the logical route. If the PO selects managed recovery, replace
the logical loading steps with a separately reviewed managed procedure **after** verifying
eligibility and pre-start side-effect containment; retain consistency, Storage, security,
application verification and cleanup checks. No in-place Production restore is permitted.

1. **Approve scope and timing.** Record PO authorization, chosen backup ID/recovery
   point, expected omissions, operator, source identity and disposable target identity.
   Start the recovery timer. For current readiness/incident recovery, assess the selected
   point against the approved RPO; report any breach instead of hiding it. An older-set
   retention drill tests recoverability only, not current RPO compliance. Download from
   external storage without relying on the source remaining available. Verify ciphertext
   checksum, decryption, manifest and release archive.
2. **Build a compatible isolated target.** Prefer a disposable Supabase project with
   compatible PostgreSQL/Auth/Storage versions for a full-service drill. A plain
   PostgreSQL container can validate SQL only, not prove Auth or Storage recovery.
   Confirm target identity differs from Production and existing Local before every write;
   stop on any mismatch. Disable external delivery/integrations/jobs before loading data;
   protect app/network access, restrict logs and block real SMTP/webhook side effects.
3. **Review the restore recipe.** Test the chosen export's Auth schema compatibility,
   extensions, ownership, grants and target default privileges before the real-data load.
   The 2026-09-28 Auth mismatch is an explicit blocker to resolve, not a warning to ignore.
   Choose snapshot restore to the captured checkpoint; do not apply all current migrations
   and then overlay that snapshot. Source migration history is evidence, not permission
   to mark missing migrations as applied or run migration repair.
4. **Restore in reviewed dependency order.** Establish compatible managed services and
   required custom roles/extensions, application definitions, supported Auth identities
   and dependent data, then remaining constraints/indexes/triggers/security definitions
   and migration history as dictated by the tested recipe. Preserve original UUIDs and
   owner configuration. Account explicitly for `auth_user_provision_profile`: bulk Auth
   import must not create duplicate Profiles over restored Profile rows. If a different
   rebuild-from-migrations route is proposed, stage-one owner setup and verified
   Auth/Profile/configuration must precede stage-two owner activation; obtain review first.
   Use fail-on-error and transactional restore where supported; stop on any unexpected
   error. Do not strip failing ownership/RLS/trigger statements to make a load appear green.
   Any temporary restore-only trigger handling must be reviewed, confined to the target
   and reversed/verified before tests. It must never weaken application RLS.
5. **Restore Storage and configuration.** Recreate buckets/privacy and transfer bytes
   through supported APIs, reconciling metadata with the captured manifest. Do not blindly
   insert object rows or assume uploads preserve ownership. Owner fields, policies and
   application references must agree; if the API cannot preserve required identity,
   stop for a reviewed mapping/recovery method. Set isolated Auth redirect/SMTP settings,
   disabled public/anonymous signup and target-only app credentials. The server-only
   `SYSTEM_OWNER_USER_ID`, database singleton and recovered Auth/Profile UUID must match.
   Recover encryption keys only via the approved private process if required; never copy
   Production app/API credentials into browser tests. Require fresh target sign-in and
   review token/session invalidation as part of any later cutover.
6. **Verify restored state before mutation tests.** Compare manifest row counts and
   content digests, relationships, sequences, constraints, applied migration provenance,
   role attributes/memberships, ACLs/default privileges, RLS, guarded RPCs and trigger
   presence. Check Auth/Profile completeness, EXP/event/receipt relationships, tombstones,
   policy assignments and timezone catalog. Compare all object counts/bytes/hashes and
   retrieve objects under intended access. Any unexplained omission fails the drill.
7. **Verify behavior only on the target.** Use a fresh browser profile and a copy of the
   captured compatible app release. Prove owner login, Profile/timezone reads, refresh
   and logout; anonymous/non-owner denial through both app and direct API; restricted
   write commands and private Storage isolation. Perform isolated synthetic fixture
   tests for Quest complete/reopen/retry idempotency and EXP consistency plus the deployed
   modules' relevant reads/commands. Ordinary app tests against fresh fixtures alone do
   not prove the backup restored. Do not run a test harness that resets the restored
   dataset; review its lifecycle first. No mutation test targets Production.
8. **Record outcome and clean up.** Capture elapsed recovery/drill time, measured data
   age, all verification results and unresolved issues. Mark `RESTORE_VERIFIED` only for
   the exact set and tested method after all required checks pass. Record target teardown,
   temporary-secret revocation and plaintext removal under the approved cleanup scope,
   retaining redacted evidence. Failure keeps go-live/migration gates closed.

An actual incident ends this runbook with a validated isolated recovery candidate.
Returning service requires a **separate PO-approved cutover plan**: final source-write
freeze, reconciliation of post-backup changes, explicit accepted loss, target-only app
configuration/DNS changes, session handling, verification and fallback. No automatic
merge, replay or traffic switch is authorized here. Include that work in the RTO estimate.

## 6. Mandatory pre-migration gate after personal-use go-live

Issue #60 requires this gate before **every** subsequent Production schema migration.
No migration is exempt because it is additive, small or previously tested.

### Minimum mandatory Issue #60 gate

- [ ] Obtain an **up-to-date verified pre-migration backup**. Record its recovery point,
      consistency/coverage/integrity and external retrieval/decryption evidence. Assess
      freshness against the exact migration start and intervening writes; a recent file
      timestamp alone is insufficient. A prior drill does not replace this fresh backup.
- [ ] Review a **scoped deployment plan** identifying target, deployed checkpoint, exact
      migration files/hashes, app versions, dependencies, SQL/RLS/grant impact, operator,
      window, ordering, timeouts, abort criteria and post-deployment checks.
- [ ] Provide a **recovery plan**: rollback of an uncommitted transaction where applicable,
      reviewed forward repair, or recovery to a new target followed by separate cutover.
      A code revert does not undo schema/data changes; destructive transforms may have
      no safe down migration. Account for writes after deployment and avoid split writers.
- [ ] Obtain **explicit PO approval** tied to the migration hashes, fresh backup evidence,
      deployment/recovery plans, target and window, including downtime/data-loss risk.
      Include drill evidence where applicable to the adopted policy. New changes,
      expired evidence or a missed window invalidate the approval until reviewed again.

Any missing minimum item means **STOP**. Issue #60 separately requires a successful
disposable restore drill before personal-use go-live and periodic backup verification.
Those obligations remain mandatory. It does **not** explicitly require a full restore of
each newly captured pre-migration backup before every migration.

### Proposed enhanced gate — not adopted; explicit PO decision required

- [ ] PO decides whether to require a **full disposable restore of the exact fresh
      pre-migration set before every migration**, including recovery/security validation.
- [ ] PO decides whether also to require rehearsal of that migration and compatible app
      on the isolated restored state before Production execution.
- [ ] PO approves detailed freshness/write-control and retention rules. Proposed rule:
      capture immediately before the verified freeze/drill window, no intervening writes,
      maximum age **24 hours at migration start**, otherwise recapture; retain through
      acceptance and the proposed section 3 pinning period. These numerical and workflow
      thresholds are not specified by Issue #60 and are not approved by this document.

The enhanced route gives stronger per-set evidence but adds downtime, operator effort
and disposable compute cost. PO may adopt it universally or specify a documented
risk-based drill/rehearsal policy. In either case the fresh verified backup, deployment
plan, recovery plan and explicit migration approval remain non-negotiable. Any enhanced
condition becomes binding only after PO adoption; until then mark its decision pending,
not PASS or an inferred waiver. No Production operation is authorized by this task.

Existing feature approvals, successful builds and the single test-stage Library
exception satisfy neither the minimum gate nor any subsequently adopted enhanced gate.

## 7. Failure and incident response

Proposed alert policy: notify the PO through an agreed private channel immediately on a
failed/incomplete run, checksum mismatch, inaccessible keys or suspected exposure. A
separate freshness check must detect missing runs even when the scheduler is silent:
alert if no new complete set arrives by two hours after a scheduled start. Escalate at
18 hours since the last usable recovery point; at 24 hours record an RPO breach. These
thresholds and channel coverage require approval and implementation, not just a job log.

| Incident | Operator response under separately granted authority |
| --- | --- |
| Backup failed/missed | Preserve last good sets; capture redacted error category and affected coverage. Check scheduler, network, capacity and credential validity without logging secrets. Retry after correcting the cause with a new run ID; do not relabel partial output as complete. Block migrations/go-live; agree a personal-write pause with the PO if protection cannot be restored within RPO. |
| Integrity/completeness failure | Quarantine the set, suspend rotation that could remove a good copy and compare inventory. An unexplained table/object omission fails the whole affected recovery point. Test a previous set and quantify additional loss; never invent missing history. |
| Restore/Auth compatibility failure | Stop writes to the disposable target, retain sanitized diagnostics and review version/schema/ownership differences. Rehearse a revised recipe on a new disposable target. Do not weaken RLS, ignore SQL errors or restore over Production to save time. |
| Missing objects or wrong recovery point | Compare manifest, object versions, Auth IDs, relationships and DB checkpoint. Attempt an older complete matched set; report the exact time/coverage gap privately. Unrecoverable data requires explicit PO acknowledgement and remediation, never a PASS. |
| Credentials/backup exposure | Restrict access and notify PO immediately; rotate/revoke affected access through an authorized response, preserve evidence securely and verify independent copies/keys. Treat Auth dumps as sensitive credentials, not ordinary logs. |
| RTO at risk/source unavailable | Notify PO with last known-good point, current recovery stage, expected delay and loss window. Continue isolated recovery; obtain separate cutover authorization. Availability pressure does not authorize in-place overwrite or unsafe access changes. |

Each notification records incident ID, detection time, last usable recovery-point time,
affected components, likely RPO/RTO impact, containment, operator and next update time.
Propose hourly updates while recovery is active; do not include personal rows, object
names, tokens or connection strings. Close only after a successful rerun/drill and PO
review of root cause, lost-data assessment and preventive action. Sending notifications
is future operational work, not an action performed by this documentation task.

## 8. Acceptance and evidence handoff

Issue checkbox order is mapped below for traceability; **all remain open**. Documentation
review, operational verification and go-live approval are separate decisions.

| Issue #60 criterion | Documentation prepared here | Evidence still required |
| --- | --- | --- |
| 1. Repeatable backup coverage/runbook | Sections 2, 4 and 5 | PO review; pinned executable recipe and verified live inventory, including Auth/Storage. |
| 2. Ongoing cadence, external storage, retention, access | Section 3 | Configured scheduler/destination; credential/access review; actual scheduled runs, retrieval and rotation evidence. |
| 3. Completed verified backup and separate restore drill | Sections 4–5 | Complete backup manifest/checks and successful full Auth/database/Storage drill; measured recovery, target isolation and cleanup. Historical SHA-256 alone does not meet this. |
| 4. Pre-migration gate | Section 6 | Fresh verified backup, scoped deployment plan, recovery plan and explicit PO approval for every subsequent Production migration. Full restore of that exact fresh set before every migration is a separate proposed enhanced gate, pending PO decision. |
| 5. Incident response and periodic verification | Sections 3 and 7 | Named operator/channel; tested failure and missed-run alerts; actual recurring verification/drill records. |
| 6. Operational/release docs in separate reviewed PR | This file and Personal Beta checklist | R1–R4 documentation review passed; final PO authorization permits a Draft documentation-only PR. Independent PR review remains pending and may precede provider, budget and implementation decisions. |

### Operational acceptance checklist — no PASS without evidence

- [ ] PO approves inventory coverage/exclusions, RPO/RTO, schedule, retention, operator,
      independent destination/provider/region, encryption/key custody and cost cap.
- [ ] Live plan, versions, migration checkpoint, Auth recovery method and all Storage/other
      state are verified under separate authorization; the selected R2 route proves Auth
      recovery (logical compatibility resolved, or managed eligibility and recovery proven).
- [ ] Version-pinned recipe is reviewed and tested on disposable synthetic resources;
      any access/architecture/dependency changes receive their required approval.
- [ ] Recurring automation, independent failure/freshness alerts and retention operate
      successfully; missed-run detection is tested without disrupting Production.
- [ ] Manual/hybrid and unattended consistency modes are distinguished; all writer paths,
      shared DB/Auth snapshot and Storage barrier/revision protocol have verified evidence.
      Unknown writers or unproven consistency remain operational blockers.
- [ ] Retained Storage bytes pass overwrite/delete/rotation retrieval tests for each
      tested recovery point; metadata or assumed source version history is insufficient.
- [ ] At least one complete external backup is retrieved/decrypted and reconciled to its
      manifest; evidence includes zero-object confirmation if Storage is unused.
- [ ] Full disposable restore proves data, Auth, RLS/grants, app behavior, objects and key
      recovery; measured results support the proposed targets, with cutover limits stated.
- [ ] Ongoing drill/review schedule and every-Production-migration approval gate are owned.
- [ ] PO records the enhanced pre-migration policy decision separately from the unchanged
      minimum Issue #60 requirements; no enhanced policy is silently treated as approved.
- [ ] Redacted records are reviewed by the PO; documentation-only PR is separately reviewed;
      PO explicitly accepts operational readiness before real personal data is stored.

### Private evidence template for a future run

Store the detailed manifest and results encrypted outside Git. A repository handoff may
contain only a redacted summary/opaque evidence reference. Never attach SQL dumps,
row samples, Auth data, object paths, secret values or unredacted command output.

| Field | To be completed by the future operator |
| --- | --- |
| Run / approval / operator | `<run-id>`, `<PO-approval-reference>`, `<operator>` |
| Policy / method / versions | `<reviewed-recipe-version>`, `<tool-and-platform-versions>` |
| Source / destination / disposable target | `<non-sensitive-aliases>`, `<identity-isolation-check-reference>` |
| Recovery point / start / finish | `<UTC-times>`, `<consistent-window-evidence>` |
| Consistency / retained bytes | `<manual-hybrid-or-unattended-mode>`, `<snapshot-and-writer-control-evidence>`, `<point-to-verified-object-copy-manifest>` |
| Auth route / migration policy | `<logical-or-managed-route-and-acceptance-evidence>`, `<minimum-gate-and-any-PO-adopted-enhancements>` |
| App / migrations / inventory | `<commit-and-private-manifest-reference>`, `<coverage-and-exclusions>` |
| Integrity / external retrieval | `<checksum-record-reference>`, `<decryption-and-reconciliation-results>` |
| Security / Auth / Storage / app tests | `<results-and-private-evidence-reference>` |
| RPO / RTO | `<measured-age-and-duration>`, `<unmeasured-cutover-components>` |
| Outcome / cleanup / follow-up | `NOT_RUN`, `FAILED`, `CAPTURE_VERIFIED` or `RESTORE_VERIFIED`; `<cleanup-and-next-review>` |

### Documentation-only validation and next action

Validation performed on 2026-10-15 and repeated for the R1–R4 documentation refinement:

| Check | Documentation-only result |
| --- | --- |
| `git diff --check` and separate new-file whitespace/final-newline inspection | Passed. |
| Relative Markdown links and heading anchors in both changed files | Passed: 15 references resolved. |
| Tracked diff and complete new-file review | Reviewed for scope, requirement coverage, unsupported operational claims and sensitive examples; no secrets or personal data included. |
| `git status --short` and staged-file check | Only this new Markdown file and the Personal Beta Markdown update; nothing staged. |
| Application lint/typecheck/build/E2E | Not run: no application change; no Markdown checker is configured in `package.json`. |
| Database/Cloud operations and operational backup/restore checks | Not run; outside authorization. No operational PASS claimed. |

The documentation-only PR may be reviewed before selecting a provider, approving a
budget or choosing the actual implementation approach. Final PO authorization permits
the two final documentation adjustments, staging exactly these two Markdown files,
commit, branch push and creation of a **Draft PR** into `main`; it supersedes the initial
planning-phase Git restrictions recorded above. It does not authorize merge or marking
the PR ready for review. Independent PR review is still required.

Operating-policy decisions and operational implementation require separate PO approval
and authorization. Later authorized work must implement and prove the operating controls
above; personal-use go-live requires explicit PO approval based on operational evidence.
Until then: **Documentation Prepared; Backup Operationally Verified: NO.**
