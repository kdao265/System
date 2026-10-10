# SYSTEM AO V1 — R-01–R-05 offline repair handoff

**Status: REVIEW-ONLY; NOT DEPLOYABLE.** Prepared as a separate local snapshot against the L1 consolidated review candidate. No changes to GitHub, local user working tree, SQL database or Docker. The SQL retains the unconditional `SQLSTATE 0A000` abort at the top; it must never be used as an active migration.

## Authorized work and applied changes

- **R-01:** SQL Opportunity `closed_note` CHECK now uses canonical multiline rules. `ao_fields_v1` normalizes CRLF/CR to LF. `set_opportunity_stage_v1` also normalizes Closed-stage notes *before* detecting effective change and updating the row; whitespace-only notes become `NULL`. Does not weaken the `other` reason note requirement.
- **R-02:** SQL Activity `confirmation_note` CHECK accepts canonical LF multiline text; create/update normalization remains consistent with the pure TypeScript model.
- **R-03:** `ao_derived_activities_v1` remains a bounded owner-scoped preview (up to 50). It now observes up to 51 to compute `has_more`; returns `{items,has_more,continuation}`. When truncated, continuation explicitly points to `list_activities_v1` filtered by `source_opportunity_id` with **separate `active` and `archived` scopes** (each must paginate by its own keyset; never reuse the mixed-preview cursor). Added strict TypeScript preview DTO parser.
- **R-04:** Validate `source_opportunity_id` against a canonical UUID pattern **before casting** in activity lists; invalid text/wrong types return SQLSTATE `22023` rather than leaking cast details. JSON null retains optional-filter semantics.
- **R-05:** `ao_cursor_v1` now declares PostgreSQL `STABLE` (not `IMMUTABLE`) because `timestamptz` string interpretation is session/rules-dependent. Added UUID-shape guard and normalized invalid civil timestamps to SQLSTATE `22023` with a scoped exception handler. Other R-05 ACL/RLS, deleted Quest output, replay and concurrency aspects remain blocked pending disposable PostgreSQL verification.

## Source boundaries

- Source: `/mnt/data/.ao_l1_review/` snapshot of prior `SYSTEM_AO_V1_F01_F02_QA_HANDOFF`.
- Review-only candidate SQL is `review/sql/REVIEW_ONLY_create_activities_opportunities_v1.sql`. **Do not copy it into active migration directory**, run with `psql`, or remove the guard based on offline tests.
- Pure model changes are proposed relative to the L1-01 committed source; check the actual branch head before applying.
- Exactly 10 AO tables, 13 mutation + 7 read public RPCs; no new tables or new public RPCs. `derived_activities` response shape changed from a bare array to the explicit preview object: L2 client must consume this new form.

## Offline checks actually performed

1. `node --test review/static-preflight.test.mjs` — **27/27 PASS**, including negative mutation tests.
2. `node --experimental-strip-types --test tests/activities-opportunities-domain.test.mjs` — **13/13 PASS**, including canonical LF and preview parser cases.
3. `python review/g01-static-audit.py` — **24/24 PASS**.
4. `tsc --noEmit --strict --target ES2017 --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler --skipLibCheck src/features/activities-opportunities/model.ts` — PASS.
5. `node --check supabase/tests/helpers/ao-wire.mjs` — PASS.
6. Unified patch `review/R01_R05_offline_repair.patch` — `git apply --check`, `git apply` in a scratch tree, and exact byte comparison for all seven changed files — PASS.

Toolchain: Node 22.16.0 and TypeScript 5.8.3; repository specifies Node 24 and TS 6. These are **not** CI-equivalent checks. Detailed outputs in `review/validation-log.txt`.

## Unfinished release gates

No PostgreSQL compilation/application, Auth/PostgREST, SQL catalog/RLS role matrix, actual UTC/DST parity, >50 derived Activity SQL integration, duplicate receipt replay, deleted Quest privacy, two-session race, historical checkpoint regression or deployment tests have been run. Wire and SQL corpora are **prepared, NOT RUN**. The unconditional SQL `0A000` gate remains mandatory.

**Next permission gate:** review the offline corrections. GitHub commit, PR, removal of the SQL abort, any database operation, or deployment requires separate explicit PO authorization.
