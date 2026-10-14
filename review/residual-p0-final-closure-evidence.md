# Residual P0 final closure — review-only evidence draft

Status: **T23-09 RUNTIME NOT VERIFIED; QA-10 runtime linkage PENDING RUNTIME.**
Date: 2026-10-14. Baseline: `codex/ao-batch-b`,
`eb2ea89248c6e733976d39cbb7e231a9052eacd7` plus the existing uncommitted helpers.
Authority: PO's Residual P0 Final Closure Implementation request.
Contract: [requirements §9](../docs/01-requirements/activities-opportunities-v1.md),
[architecture §6.3](../docs/02-architecture/activities-opportunities-v1.md),
[ADR-024](../docs/02-architecture/decisions.md), [closure plan](nine-p0-closure-plan.md).

Scope: one bounded archive-retention family in the existing Batch A helper and this
provenance procedure. No dependency, business SQL, migration, app, runner isolation,
QA Matrix or QA-status change. Runtime, CI, deployment and Git writes are not
authorized by this implementation task. Offline syntax/static checks only.

## T23-09 contract

For each of Opportunity and Activity, create an eligible one-off Quest and two
fresh unarchived AO roots through existing owner RPC fixtures. Attach to the first
root, capture full scoped AO storage and owner projection, then archive through
`set_one_off_quest_archived_v1` with a fresh UUID and `web_ui` origin.
Compare all scoped AO snapshot keys across archive (root/revision, histories,
receipts, both context kinds and source links); exclude external-table keys from
this comparison because Quest Archive legitimately writes Quest state/events.
Require one identical retained link with unchanged source/target and NULL detach;
the live label keeps the Quest title and `deleted:false`, changing only
`archived:false` to `true`. The archive command must create no AO receipt.
Candidate search must exclude the archived Quest. Fresh attach from the second
root must return `23514 / AO contextual target not eligible`, with complete
post-archive AO/external rollback snapshots and the original link still intact.
The existing runner invokes this family via `exerciseAoBatchA`; no new runner.

## Collected observations, with limits

- Image tag: `public.ecr.aws/supabase/postgres:17.6.1.166`.
- PO-reported image ID: `sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86`.
  Its Docker image-ID / registry-index / platform-manifest role must be recorded
  separately in the linked capture; do not substitute one digest kind for another.
- PostgreSQL 17.6; configure source:
  `--with-system-tzdata=/nix/store/q42y30akm86ph3pzzdrp5qyrm7pg6sqy-tzdata-2025b/share/zoneinfo`.
- System tzdb 2025b; 1,807 files; reported deterministic tree SHA-256:
  `f202d73a294aaf2d4b538524f1ca61573c93cd8ab72df71b38c1f1b6bc828d91`.
- Local runtime: Node 24.18.1 / ICU 78.3 / Node tzdb 2026b.
  Prior CI recorded Node tzdb 2026c; this is a separate runtime.
- Local retained sources: `E:\Temp\SYSTEM-AO-QA10-tz-provenance.log`,
  `E:\Temp\SYSTEM-AO-QA10-tz-provenance-fixed.log`, and
  `E:\Temp\SYSTEM-AO-QA12-final-runtime-20261014-181511.log`.
  The first provenance log's fingerprint attempt failed; only the corrected log
  supplies the tree digest. The old runtime log predates T23-09.
- These observations do not identify the platform or prove that an earlier test
  used the externally inspected filesystem. **Same-run linkage is PENDING RUNTIME.**

## Next authorized disposable run: capture procedure

This is a prepared procedure, not executed evidence. Use the existing local-only
Docker endpoint selected by `tests/helpers/auth-environment.mjs` (Windows:
`npipe:////./pipe/dockerDesktopLinuxEngine`; Linux: `unix:///var/run/docker.sock`).
No caller database URL, existing developer database, remote daemon, credentials
dump, additional container, package installation or isolation change is needed.

1. Under new runtime authorization, retain branch/HEAD, dirty status and SHA-256
   of the review SQL, runner, harness, AO SQL suites, all imported AO helpers,
   model/fixtures and lockfile. Include untracked `ao-residual-evidence.mjs`;
   HEAD alone cannot identify this worktree. Preserve `preflight-qa0608.mjs`.
   Require review SQL hash
   `409aef907f98887bd2a1486d412db2609f24dce611615fc33ee95c2cceac2772`.
2. Run the existing `supabase/tests/ao-review-disposable-wire.mjs` with
   `AO_DISPOSABLE_QA_APPROVED=YES`, capturing stdout/stderr and the actual process
   exit code. From the repository, the prepared PowerShell launch is:
   `$env:AO_DISPOSABLE_QA_APPROVED = 'YES'`, then
   `node --inspect-brk=127.0.0.1:9229 supabase/tests/ao-review-disposable-wire.mjs`.
   Save `$LASTEXITCODE` immediately after completion; use a new authorized log
   destination for stdout/stderr. Attach the local debugger before continuing.
   For same-run inspection, use that loopback-only debugger and pause
   at the final return in `startAuthEnvironment`, after fixture setup and before
   returning to the AO runner. This preserves the runner and cleanup code.
   Evaluate only the local scalar `db` (immutable container ID), `runId`, and
   selected `process.versions.node/icu/tz`. Never dump locals, `env`,
   `process.env`, passwords, JWTs or client objects. Resume promptly after capture;
   do not disable existing timeouts or suppress failures.
3. With that exact `db` ID on that endpoint, retain selected formatted
   `docker inspect` fields: `.Id`, `.Image`, `.Config.Image`,
   `.Config.Labels["system.test"]`, `.Config.Labels["system.run"]`,
   `.HostConfig.NetworkMode` and `.State.StartedAt`.
   Require labels `private-auth-v1` and the captured `runId`, and matching
   `system-private-auth-<runId>` network. Do not select a container by tag alone.
4. Inspect the exact `.Image` content ID, recording only image `.Id`,
   `.RepoDigests`, `.Os`, `.Architecture` and `.Variant`.
   Record the Linux OS/architecture/variant explicitly; assert image ID equals
   container `.Image`. Record the registry index and selected platform-manifest
   digest separately when available. If registry mapping is unavailable, report
   it pending; local image content ID still binds this local execution.
5. While paused, run a read-only query in that exact container using the same
   local socket/database as the harness SQL helper: `docker --host <endpoint>
   exec -i <cid> env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
   psql -X -Atq -h /var/run/postgresql -p 5432 -U postgres -d postgres
   -v ON_ERROR_STOP=1 -f -`. Feed only this SQL on stdin:
   `SELECT jsonb_build_object('version',version(),'server_version',current_setting('server_version'),'TimeZone',current_setting('TimeZone'),'log_timezone',current_setting('log_timezone'),'zones',(SELECT count(*) FROM pg_catalog.pg_timezone_names),'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()))::text;`
   Retain the result with runId/container ID. The captured harness `db` identity
   binds this inspection to its SQL target; the normal Batch A log separately
   records the test session's server/timezone provenance.
6. Read the postmaster PID from `/var/lib/postgresql/data/postmaster.pid`, then
   the active server executable via `/proc/<server-pid>/exe` in this
   exact container. Record resolved executable, `postgres --version`, matching
   `pg_config --version --configure --sharedir --bindir`, and resolved paths.
   Confirm matching server/build, not an unrelated client pg_config.
   Inspect only TZ/TZDIR overrides if needed; never print a full environment.
   Resolve `--with-system-tzdata` to the actual tree; otherwise determine the
   matching bundled timezone directory. Record tzdata.zi header, its hash, and
   symlink mappings/resolved roots. Stop the provenance conclusion on ambiguity.
7. Capture the manifest below from that same container, then resume the runner.
   Retain all run logs, manifest, selected identity/build records and exit codes
   together. Compare source hashes after completion. A failed capture, incomplete
   manifest or failed parity assertion leaves the corresponding evidence pending.

### Stable timezone manifest format v1

Use existing GNU-compatible tools only. Paths must be conventional zone paths
without newline/backslash; otherwise stop and review serialization. From the
resolved timezone root, traverse symlinks with `find -L`, include each alias path,
sort relative paths bytewise in C locale, and hash resolved file bytes. Each line
is lowercase SHA-256, two spaces, `./relative/path`, LF; final LF is mandatory.
Retain symlink mappings separately, including any resolved root outside the tree.
No timestamp, absolute root, locale-dependent order or host newline conversion.

Future POSIX-shell recipe (`endpoint`, `cid`, `tzroot` must be verified above;
output files are in a newly authorized host evidence directory, never the DB):
```sh
set -euo pipefail
docker --host "$endpoint" exec "$cid" bash -c '
  set -euo pipefail
  cd -- "$1"
  LC_ALL=C find -L . -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum
' bash "$tzroot" > timezone-manifest.sha256
wc -l < timezone-manifest.sha256
sha256sum timezone-manifest.sha256
```
Check every command exit status; a partial file is not evidence. On Windows retain
raw stdout bytes (for example with Node child_process Buffer capture), avoiding
PowerShell text redirection that changes encoding/newlines. Do not assume the
old digest matches until recipe v1 actually reproduces it. Retain individual
entries for America/New_York, Europe/Berlin, Asia/Ho_Chi_Minh, Pacific/Auckland and UTC.

## Bounded revalidation and accepted UTC

Rerun on any PostgreSQL image/content/platform/build/tzdb/fingerprint change, or
Node/ICU/tzdb change, including a CI image change. Record both prior and new runtime
identities. Reuse Batch A's 12 cases (four IANA zones, 2026), T10-01/02, and existing
G-01/L1-08/09/11 offset, unresolved, fold/gap, supported UTC-boundary and
Profile-timezone/unrelated-edit invariance assertions. Run the unchanged full
disposable entrypoint once; it includes these and T23-09 without a new framework.
Require equal acceptance/rejection and exact accepted UTC on this finite corpus.
It is not all-zone/all-year or cross-version universal parity.

Retain accepted synthetic source specs, UTC values and temporal history under the
old runtime. An explicitly authorized upgrade rehearsal must carry those retained
rows/history to the new runtime and compare them before/after reads, Profile
timezone changes and unrelated edits. Do not regenerate the baseline using new
rules, bulk-recalculate stored UTC or manufacture trigger-disabled state.
Only an intentional source edit may resolve a new UTC instant and append history.
The current runner creates a fresh database; it does NOT perform this cross-upgrade
retention rehearsal. That evidence remains PENDING until separately authorized.

## Acceptance handoff

T23-09 needs successful logs for both source kinds plus the final runner exit
code; existing QA-10/12/23 suites must remain passing. QA-10 needs the same-run
identity/build/manifest linkage and PO acceptance of this bounded revalidation
contract. Review collected evidence before any separate QA Matrix/status action.
Neither this draft nor offline syntax checks constitute release readiness.
