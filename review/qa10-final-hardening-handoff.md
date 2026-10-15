# QA-10 final hardening handoff (MAJOR-2 / MINOR-1 closure)

Date: 2026-10-16 (Asia/Saigon). Worktree `D:\System\qa10-review`, branch
`fix/qa10-provenance-root-cause`, base PR #59 HEAD `c553ca4`. This handoff
records the independent-review follow-up on top of Codex's uncommitted QA-10
root-cause fix ([qa10-root-cause-review.md](qa10-root-cause-review.md)).
Nothing was committed, pushed, merged or deployed; PR #59 remains Draft; no
Production, Local or Cloud database was contacted at any point.

## MAJOR-2 — original-build ELF verification in the production observer

Codex's `capture()` verified the live postmaster ELF against the SQL backend
ELF and procfs, and recorded the PATH-bindir `postgres` launcher hash only as
`cliDiagnostic` — but it never compared the live ELF to the original-build
executable named by the server's compiled `--prefix`. The independently tested
`qa10-diagnose.mjs` check is now integrated into
`supabase/tests/helpers/qa10-capture.mjs`:

- `buildPrefix(configure)` (exported, fail-closed) extracts exactly one
  `--prefix` from the running backend's own `pg_catalog.pg_config` CONFIGURE
  string; missing, duplicate, relative or traversal values block.
- `capture()` runs one read-only, sanitized, `--user postgres` container exec
  (wrapped in the existing fail-closed `stage('original-build-elf', …)` so no
  stderr leaks) that prints the ELF magic of `$prefix/bin/postgres`, its
  `readlink -f` path and its SHA-256.
- `originalBuildElf(prefix, live, output)` (exported, unit-testable) requires
  magic `7f454c46` — a `#!` shell launcher can never pass — requires the hash
  to be exactly for `$prefix/bin/postgres`, and requires byte equality with the
  live postmaster ELF SHA-256. Any mismatch fails closed with the diagnostic
  already retained in `identity`.
- Evidence is recorded truthfully as `identity.originalBuild`
  (`{prefix, executable, sha256}`) before `diagnostic(identity)`. The PATH
  bindir launcher hash stays in `cliDiagnostic`, explicitly labeled as
  packaging diagnostics, never acceptance evidence.

Local disposable-fixture run reproduces the review's independently measured
values: live/original-build ELF
`3794a95bd1c4b8224bb7b0af1aa5ff5f0ed16e61dd911fc82a1249739c7f4463` at
`/nix/store/d43fya852vmrp5hws2lrw47ccq1ngakz-postgresql-17.6/bin/postgres`,
launcher (diagnostics only)
`56494d67bdb27fc568de4ca3caf2ce47df0eeba930cf8a04c3c1bb10ae35142b`.

## MINOR-1 — test registration in the disposable workflow

`.github/workflows/ao-l1-06-disposable.yml` (the only workflow edited):

- Path triggers added: `supabase/tests/helpers/qa10-capture.test.mjs`,
  `supabase/tests/helpers/qa10-disposable.test.mjs`.
- Step `QA-10 observer unit tests (offline, no Docker)` runs
  `node --test supabase/tests/helpers/qa10-capture.test.mjs` after the existing
  offline preflight.
- Step `QA-10 disposable observer integration (owned fixture only)` runs
  `node --test supabase/tests/helpers/qa10-disposable.test.mjs` with
  `AO_DISPOSABLE_QA_APPROVED=YES`, and first fails closed if
  `SUPABASE_DB_URL`, `DATABASE_URL`, `SUPABASE_URL` or
  `NEXT_PUBLIC_SUPABASE_URL` were ever present in the job environment.

Production isolation: the job passes no secrets and `permissions: contents: read`;
the test refuses `DOCKER_CONTEXT`/non-local `DOCKER_HOST`, creates only its own
label-matched (`system.test=private-auth-v1`, `system.run=<uuid>`) `--internal`
network and tmpfs-only pinned-image container, takes no external DB target in
any code path, asserts ownership before removing only its own resources, and
is skipped unless the explicit approval env var is `YES`.

Both new steps run before the same-run provenance step so a broken observer
fails fast without producing a misleading provenance artifact. Steps are
sequential; the disposable fixture is fully removed before `qa10-run.mjs`
establishes its container baseline.

## Exact changed files

| File | Change |
| --- | --- |
| `supabase/tests/helpers/qa10-capture.mjs` | + `buildPrefix`, + `originalBuildElf`, + fail-closed `original-build-elf` stage and `identity.originalBuild` evidence in `capture()` (MAJOR-2); all prior Codex changes preserved |
| `supabase/tests/helpers/qa10-capture.test.mjs` | + 8 offline tests (prefix selection/rejection; ELF-magic, launcher, deleted-file, wrong-path, traversal and truncation rejection) — now 29 tests |
| `supabase/tests/helpers/qa10-disposable.test.mjs` | + real-image assertion that `originalBuild.sha256` equals the live ELF hash; + fail-closed fault injection returning launcher bytes for the prefix path |
| `.github/workflows/ao-l1-06-disposable.yml` | + 2 path triggers, + 2 test steps with no-production-endpoint guard (MINOR-1) |
| `supabase/tests/helpers/qa10-run.mjs` | Modified by Codex only (unchanged in this pass) |
| `review/qa10-root-cause-review.md` | Codex's review contract (unchanged in this pass) |
| `review/qa10-final-hardening-handoff.md` | This handoff |

## Validation actually executed (Windows local, 2026-10-16)

- `node --test supabase/tests/helpers/qa10-capture.test.mjs`: **29/29 PASS**.
- `AO_DISPOSABLE_QA_APPROVED=YES node --test supabase/tests/helpers/qa10-disposable.test.mjs`:
  **1/1 PASS** against the real pinned image `17.6.1.166`, including the new
  ELF/original-build equality and the launcher-bytes rejection
  (`Original-build postgres is not an ELF executable`). One earlier iteration
  failed closed on a malformed `od`/`tr` pipeline (2≠3 evidence lines) and was
  fixed before the passing run; no assertion was weakened.
- `node --test review/static-preflight.test.mjs`: 34/35; only the documented
  pre-existing R-05 CRLF working-tree artifact fails locally (identical to
  Codex's record; unrelated to these files, passes on LF/Linux checkout).
- `node --experimental-strip-types --test tests/activities-opportunities-domain.test.mjs`:
  15/15 PASS.
- ESLint over all five `qa10-*.mjs` helpers: zero warnings.
- `node --check` on every touched/created `.mjs`: PASS.
- Workflow YAML parsed with js-yaml; steps and paths verified programmatically.
- `git diff --check`: clean. Full tracked diff and all untracked files reviewed.
- Post-test Docker inspection: the test's own container/network removed; only
  the pre-existing (2026-10-01…10-08) labeled fixtures remain untouched.
- `qa10-run.mjs` itself was not executed: it is Linux/CI-only and its
  GitHub-event guards cannot be satisfied locally; nothing was fabricated.

## Remaining assumptions, risks and blockers

1. The workflow job `if:` and `qa10-run.mjs` require
   `GITHUB_HEAD_REF == 'test/ao-l1-06-disposable-qa'`. A PR from
   `fix/qa10-provenance-root-cause` alone would not run this workflow; the
   reviewed commit must land on the approved PR #59 head branch for CI
   evidence. Deliberately not relaxed.
2. No CI run has been performed or claimed for these changes; CI provenance
   closure, QA-10 acceptance, cross-upgrade retention rehearsal, merge and
   release all remain OPEN, per the root-cause review.
3. The disposable integration test's 180 s per-test timeout assumes warm
   cached images (the workflow's cache step precedes it). If CI proves slow,
   raising the timeout is a safe, assertion-neutral follow-up.
4. `od` availability is assumed in the pinned image; verified locally on the
   exact image, and the fail-closed stage turns absence into a blocked run.
5. The observer still depends on the fixture's existing `supabase_admin`
   privilege for fixed read-only metadata SQL and on an unambiguous single
   compiled system-tzdata root; both are pre-existing, documented limits.
