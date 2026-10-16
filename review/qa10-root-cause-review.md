# QA-10 root cause and local review contract

Date: 2026-10-16 (Asia/Saigon). Base: `c553ca49fb6e287d17c0fb75df8cc3b6072d9b46`,
Draft PR #59. Local branch: `fix/qa10-provenance-root-cause`.

Scope: QA-10 helpers and directly necessary tests/evidence only. No business SQL,
guard, pin, migration, production configuration, RLS, QA Matrix status, dependency,
commit, push, merge or deployment changes. The task requires reproducible diagnosis,
fail-closed executable/build/timezone linkage and independent Cline review.
G-01 / QA-10 requirements and ADR-024 remain unchanged; this is test instrumentation,
not an application architecture change.

## Reproduced diagnosis

`AO_DISPOSABLE_QA_APPROVED=YES node supabase/tests/helpers/qa10-diagnose.mjs`
creates one network-none, tmpfs-only container and removes only that owned fixture.
Docker Desktop was initially stopped; it was started for this task. No existing
database was accessed. Linux/amd64 local image content ID:
`sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86`.
The CI pull log prints this digest too, but a registry digest is not independently
assumed to be the same kind of identity as Docker's local image content ID.

- Postmaster PID 1, UID 100; `/proc/1/comm` is `.postgres-wrapp`.
- Live `/proc/1/exe` resolves to
  `/nix/store/av4y728s5j85wbb583k26f9slqq8hh54-postgresql-and-plugins-17.6/bin/.postgres-wrapped`.
- The observer's sanitized PATH selects `/usr/bin/pg_config`, which resolves to
  the same plugin package's `bin/pg_config`. The image's default PATH instead
  selects `/nix/var/nix/profiles/default/bin/pg_config`, resolving to that same file.
- CLI `pg_config --bindir` returns `/usr/bin` under the observer's PATH and
  `/nix/var/nix/profiles/default/bin` under the default PATH. The server's compiled
  view reports the latter. BINDIR is invocation-path-sensitive in this packaging.
  Its `postgres` is a bash wrapper setting `NIX_PGLIBDIR` and executing the above
  `.postgres-wrapped`. This is a legitimate launcher/ELF distinction, not observed
  multiple PostgreSQL installations or mistaken postmaster selection.
- Live ELF SHA-256:
  `3794a95bd1c4b8224bb7b0af1aa5ff5f0ed16e61dd911fc82a1249739c7f4463`.
  Launcher SHA-256:
  `56494d67bdb27fc568de4ca3caf2ce47df0eeba930cf8a04c3c1bb10ae35142b`.
- The live ELF is byte-identical to the original configure-prefix executable
  `/nix/store/d43fya852vmrp5hws2lrw47ccq1ngakz-postgresql-17.6/bin/postgres`.
  Both the PATH pg_config and original-prefix pg_config hash to
  `f07cdd70c924ff2c3a6c4e637b0829f9ffd686b190f513be4067432146135a3e`;
  CLI CONFIGURE equals the running backend's CONFIGURE. Thus the reproduced
  binaries are copies from the same original build, not just equal version strings.
- Root's procfs executable read is denied in this Docker configuration. Reading as
  OS user `postgres` succeeds. No added capability or privilege change is needed.
- Existing `supabase_admin` over the isolated local socket can read `pg_config`
  and hash `/proc/self/exe`. Its SQL backend hash equals the postmaster ELF hash.
  The backend's proc stat parent PID is 1. No grants or business-data reads occur.
- Compiled `--with-system-tzdata` names
  `/nix/store/q42y30akm86ph3pzzdrp5qyrm7pg6sqy-tzdata-2025b/share/zoneinfo`.

Pinned upstream [packaging source](https://github.com/supabase/postgres/blob/17.6.1.166/nix/postgresql/generic.nix)
copies postgres/pg_config into the plugin package and wraps postgres. PostgreSQL
17.6 [timezone source](https://github.com/postgres/postgres/blob/REL_17_6/src/timezone/pgtz.c)
uses compiled `SYSTEMTZDIR` when configured; it does not choose that directory from
client PATH. These sources explain the observations; they are not substitutes for
the runtime binary hashes. Exact failed CI process paths were not retained by the
old observer; the paths above are from the reproduced local image.

## Why previous patches failed

1. `17c05bf`: hard-coded `comm == postgres` rejects this wrapped executable name;
   root procfs permission is an additional reproduced failure. Old CI suppressed
   stderr, so its exact failing subcommand cannot be recovered from that log.
2. `f587e37`: same-user retry fixes access, but pathname equality compares the ELF
   to its launcher. Both are legitimately different files.
3. `c553ca4`: replacing path equality with byte equality retains the same incorrect
   comparison. A launcher cannot have its target ELF's hash. The latest
   [CI run](https://github.com/kdao265/System/actions/runs/38792667195) records this
   observer failure while the functional runner exits 0.

Additional defects: CLI-first per-field fallbacks can mix build sources; failures
discard partial diagnostics; manifest pipelines omit pipefail; symlink records omit
resolved targets; restart checking ends before the timezone manifest; initial SQL
readiness can see the entrypoint's temporary server. A version, tag, zone count,
pathname or successful SQL query alone proves none of the required byte identity.

## Implemented solution and review boundary

The observer uses one server query for compiled pg_config settings, backend PID/parent and backend
ELF SHA-256. Bind these to SQL postmaster start time, data-directory PID file,
procfs executable hash and process start ticks. Keep CLI discovery as diagnostics,
never authoritative build evidence. Require stable identity before/after manifest
capture and monitor it while the functional runner remains active. Denied procfs,
restart, ambiguity or inconsistent evidence fails closed, with selected partial
diagnostics retained. Read-only metadata uses the fixture's already-existing admin;
no permissions or RLS changes and no arbitrary SQL input.

Hash the configured timezone tree with checked pipeline exits, strict raw-byte
manifest validation and resolved aliases. Retain baseline entry-count gate, compare
independent server-side file hashes, and repeat manifest/alias capture for stability.
Unknown/bundled timezone builds remain blockers. Cross-upgrade retention is still a
separate unverified QA-10 requirement. No QA Matrix statuses may change.

The identity artifact schema is now `system.ao.qa10.same-run.v2`; the raw manifest
format remains v1. Alias records now explicitly include three tab-separated columns
(relative alias, link target, resolved path). No existing artifact consumer was found
in the repository. The original 1,807-entry baseline check remains fail-closed.

## Exact changed files

| File | Change |
| --- | --- |
| `supabase/tests/helpers/qa10-capture.mjs` | Backend/self-hash build linkage, verified postmaster identity, selected diagnostics, checked and repeated manifest/aliases, server-side timezone file hash cross-checks; local endpoint selection for Windows diagnostic tests |
| `supabase/tests/helpers/qa10-run.mjs` | Final-start readiness, partial evidence on failure, observer source integrity hashes, sampled continuity until owned removal, cleanup verification even when capture fails |
| `supabase/tests/helpers/qa10-diagnose.mjs` | Reproducible image-only diagnosis, original-build copy checks, owned cleanup |
| `supabase/tests/helpers/qa10-capture.test.mjs` | 21 offline negative/positive identity and serialization tests |
| `supabase/tests/helpers/qa10-disposable.test.mjs` | Opt-in owned image integration, wrapper mismatch reproduction, inaccessible-procfs rejection, traversal/cycle/dangling/external-alias tests and retained raw evidence |
| `review/qa10-root-cause-review.md` | Task contract, root cause, evidence, checks and independent-review handoff |

Workflow, existing evidence draft, QA Matrix, AO SQL, guard, pinned hash, migrations,
production configuration, RLS and dependencies are unchanged. No Git commit or push.

## Validation

Run from `D:\System\qa10-review` unless otherwise indicated:

- `node --check` on capture, runner and diagnosis helpers: PASS.
- `node --test supabase/tests/helpers/qa10-capture.test.mjs`: **21/21 PASS**.
- `AO_DISPOSABLE_QA_APPROVED=YES node supabase/tests/helpers/qa10-diagnose.mjs`:
  PASS on the controlled Linux/amd64 image; original-build copies verified by hash.
- `AO_DISPOSABLE_QA_APPROVED=YES node --test supabase/tests/helpers/qa10-disposable.test.mjs`:
  **1/1 integration test PASS**, including real manifest capture and fault cases.
  On PowerShell set `$env:AO_DISPOSABLE_QA_APPROVED='YES'` before the Node command.
- Targeted ESLint over `supabase/tests/helpers/qa10-*.mjs`, zero warnings: PASS.
- `npx --no-install tsc --noEmit --incremental false`: PASS.
- `git diff --check`: PASS. Tracked diffs and each new untracked file reviewed.

Validation reused existing `D:\System\node_modules`; its adjacent package-lock is
byte-identical to this branch's package-lock. No install or dependency change.
Local runtime: Node 24.18.1, ICU 78.3, Node tzdb 2026b (different from failed CI's
Node 24.21.0 / tzdb 2026c; no universal cross-version parity claim).

The Windows checkout has `core.autocrlf=true`. An initial existing static test failed
because its literal LF mutation did not match CRLF; checked-out SQL also differed
from the frozen byte hash. No SQL/pin edit was made. A separate validation snapshot
was exported with `git -c core.autocrlf=false archive HEAD`, then overlaid with the
QA-10 helpers. In `D:\System\qa10-validation`, SQL hashes to the unchanged approved
`409aef907f98887bd2a1486d412db2609f24dce611615fc33ee95c2cceac2772`.

- `node --test review/static-preflight.test.mjs`: **35/35 PASS** on LF snapshot.
- `node --experimental-strip-types --test tests/activities-opportunities-domain.test.mjs`:
  **15/15 PASS**.
- Existing Python `review/g01-static-audit.py`: **24/24 PASS**, using Ubuntu's
  Python 3.12.3 through WSL (Windows has no `python` command).
- `AO_DISPOSABLE_QA_APPROVED=YES node supabase/tests/ao-review-disposable-wire.mjs`
  from the LF snapshot: **PASS, exit 0**, including migration checkpoints,
  L1-07/08/09/10/11, residual suites, Batch A and Batch B. Final group markers:
  QA-06 30 checks, QA-08 103, QA-19 4, QA-11 100, QA-20 11. The existing release
  migration gate remains CLOSED. This functional run and the standalone observer
  integration were separate executions; they are not represented as one CI run.
- Post-run Docker metadata check found no resources created by this task remaining.
  Six exited test containers and thirteen labeled networks predate this task
  (2026-10-01 through 2026-10-08); they were left untouched. No existing DB was queried.

## Retained provenance and limits

Final standalone capture files are in `D:\System\qa10-review-evidence` (copied as
raw bytes from `E:\Temp\system-qa10-evidence-NyOtPL`): `identity.json`,
`timezone-manifest-v1.sha256`, `timezone-aliases.tsv`.
Manifest: 1,807 entries, tzdata **2025b**, raw-byte v1 SHA-256
`edc41e645141d79255f87aa52196390c5edbbd7253d19396d1f4b73e79d35687`.
Do not substitute the earlier unlinked `f202...` fingerprint in the historical
evidence draft. Both complete captures and the six selected server-side file hashes
agreed. This is a standalone observer integration artifact, **not a GitHub same-run
PASS artifact** and not a retained-data cross-upgrade rehearsal.

The Linux/CI-only `qa10-run.mjs` orchestration has not been executed end to end here:
Windows runs the tests; Ubuntu lacks Node and a connected local Docker socket.
Its guard was not bypassed and GitHub environment/run IDs were not fabricated.
After independent review and separate commit/push authorization, run the unchanged
PR workflow on the reviewed head. Require runtime exit 0, provenance v2 PASS,
cleanup/integrity PASS, identity/manifest/aliases/progress files, and verify their
hashes and exact PR-head/merge-SHA distinction. Run the two new test files explicitly
as well; the existing workflow was not edited to register them.

Continuity sampling detects persistent restarts by full SQL start time, kernel start
ticks, executable hash and Docker restart state. It is **not continuous tracing**:
the final sample-to-removal interval and file changes outside the two manifest reads
are not independently observed. Assertion contradictions always fail even if cleanup
then removes the container; only a failed read plus confirmed absence is classified
as a cleanup race. Inaccessible metadata has no CLI/guessed-path fallback.

The existing disposable `supabase_admin` is needed for compiled catalog metadata and
fixed filesystem reads. This is an explicit test-only privilege dependency, already
present in the fixture; no role grants or RLS behavior changed. If another image
removes this access, provenance blocks. Unsupported builds without one unambiguous
system timezone root also block. Exact failed CI procfs details remain unavailable
because its old artifact discarded them; diagnosis is reproduced on the local image.

Recommendation: **GO for independent Cline review of the local diff; NO-GO for
claiming CI provenance closure, QA-10 acceptance, merge or release** until the
remaining CI and separate cross-upgrade evidence requirements are satisfied.
