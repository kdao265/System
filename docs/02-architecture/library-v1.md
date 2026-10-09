# Library V1 architecture contract

## 1. Status, authority and repository evidence

Date: 2026-10-07. Branch: `feat/library-v1`. Status: L0 contract for sign-off;
approved product decisions recorded, implementation absent. Authority: Product
Owner's Library V1 L0 request. See [requirements](../01-requirements/library-v1.md),
ADR-023 in [decisions](decisions.md), and [handoff](../04-development/library-v1.md).
The approved covers/summary/BookCard scope replaces earlier audit recommendations.
The detailed technical choices below are the proposed implementation contract;
L0 creates no SQL, code, tests, dependencies or deployed objects.

Successful origin fetch verified HEAD and origin/main at `c7f1e72` (PR #54), with
`git rev-list --left-right --count HEAD...origin/main` reporting `0 0`. No Library
implementation exists in the inspected source/migration/test tree. Existing
Knowledge references are product intentions rather than reusable book storage.

| Existing evidence | Convention reused |
| --- | --- |
| [Goals migration](../../supabase/migrations/20260930120000_create_goals_main_quest.sql) | UUID ownership, archived_at, revisions, owner RLS, restricted executor and guarded RPCs. |
| [Calendar migration](../../supabase/migrations/20260929120000_create_schedule_events.sql) | Small independent domain and stable creation identity without the Quest lifecycle. |
| [Private owner activation](../../supabase/migrations/20260928100000_activate_private_owner.sql) and ADR-015 | Configured-owner restriction in addition to row ownership; immutable historical activation. |
| [Goals model](../../src/features/goals/model.ts), [data](../../src/features/goals/data.ts), [actions](../../src/features/goals/actions.ts) | Feature-local validation/adapters, exact bigint strings, Server Actions, saved/refresh-required distinction. |
| [Profile session](../../src/features/profile/session.ts), [server client](../../src/lib/supabase/server.ts), [proxy](../../src/proxy.ts) | Verified owner, onboarding, request-local Supabase session and private responses. |
| [SystemShell](../../src/components/system-shell.tsx), [AppHeader](../../src/components/app-header.tsx), [primitives](../../src/components/ui/primitives.tsx) | PR #54 shell, real routes and native semantic controls. |
| [Dictionaries](../../src/lib/localization/dictionaries.ts), [provider](../../src/lib/localization/provider.tsx) | Typed EN/VI presentation and cookie-based locale. |
| [Disposable harness](../../tests/helpers/auth-environment.mjs), [CI](../../.github/workflows/playwright-e2e.yml) | Migration checkpoints, SQL/security, Node, auth and desktop/mobile verification. |

Goals' durable command journal is not inherited. Calendar's last-write-wins
editing is not inherited either: Library's long text requires revision guards.

## 2. Data model

Introduce exactly one domain table, `public.books`, in a future additive migration.
No Library journal, receipt, author, note or cover table is required.

| Field | Type/nullability | Database/application contract |
| --- | --- | --- |
| id | uuid, not null | Primary key, caller-retained create identity; immutable; command requires a valid ID. |
| user_id | uuid, not null | Derived from verified request identity; immutable; FK to auth.users(id), ON UPDATE/DELETE RESTRICT, following Goals. |
| title | text, not null | Trimmed nonblank text, at most 240 code points. |
| author | text, nullable | Trimmed; blank becomes null; at most 240 code points. |
| cover_url | text, nullable | Trimmed; blank becomes null; validated absolute HTTPS URL without userinfo; proposed limit 2,048 code points. |
| status | text, not null | Default want_to_read; CHECK allowlist want_to_read/reading/finished. |
| summary | text, nullable | Proposed limit 4,000 code points; blank becomes null. |
| content_notes | text, nullable | Proposed limit 20,000 code points; blank becomes null. |
| lessons | text, nullable | Proposed limit 10,000 code points; blank becomes null. |
| archived_at | timestamptz, nullable | Null on create; database time on actual archive; null on restore. |
| revision | bigint, not null | Default 1; positive CHECK; increment exactly once per actual mutation; reject exhaustion rather than overflow/wrap. |
| created_at | timestamptz, not null | Database default now(); immutable. |
| updated_at | timestamptz, not null | Database default now(); commands change it only when content/archive state actually changes. |

Use named row-local constraints, consistent with existing migrations. Commands
maintain timestamps and identity invariants; there is no repository-wide update
trigger to assume. Runtime UPDATE grants exclude id, user_id and created_at.
No caller can supply database timestamps or revision replacements as editable data.

Optional nonblank long text retains meaningful whitespace/line breaks; normalize
CRLF/CR input to LF before comparison/storage so platform line endings do not
cause false changes. Use the same trim/blank set across TypeScript and SQL:
U+0009..U+000D, U+0020, U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029,
U+202F, U+205F, U+3000 and U+FEFF. Strip this set only at the edges of title,
author and cover_url; for long text, use it to detect an all-blank value without
stripping meaningful nonblank content. Do not rely on different default trim
implementations. Count normalized text by Unicode code point/PostgreSQL char_length,
not JavaScript string.length. Do not apply silent truncation or Unicode composition
rewrites. L1 must test agreed normalization examples and reject invalid text encoding.

No uniqueness constraint on title, title+author or an external identifier. Add the
repository-established unique (id, user_id) key for future same-owner child FKs.
Do not create those children now.

### List shape and indexes

Default scope is active (`archived_at IS NULL`). Archived scope uses IS NOT NULL;
status is a separate optional allowlisted filter in either scope. Unknown query
parameters are normalized safely at the page boundary; the RPC rejects invalid
scope/status/limit/cursor input rather than broadening access.

Proposed list limit: 50 by default, range 1..100. Use deterministic descending
created_at then id ordering with a cursor carrying both values and a limit+1
read. Reset the cursor on scope/filter changes. No expensive total count is required.
The list returns id, title, author, cover_url, status, archived_at, revision,
created_at and updated_at only, plus a next cursor. Never project summary,
content_notes or lessons for the collection. Detail reads return all book fields
needed by the owner workspace. Bigint revisions cross JSON boundaries as decimal
strings and are validated exactly, following Goals; never coerce them to Number.

Begin with owner-leading created_at/id indexes for active and archived scopes
(partial predicates matching the scopes). Avoid a speculative status index or
full-text index; validate actual list/filter plans in L1. Pagination is a fresh
read, not a snapshot spanning concurrent archive/filter changes.

## 3. Security and RLS

Follow ADR-014/015 and the Goals/Calendar command boundary. App checks are not a
replacement for database isolation or configured-single-owner enforcement.

- Enable books RLS before grants. Revoke inherited/default access from PUBLIC,
  anon, authenticated, service_role and existing domain executors before granting
  the intended minimum. Do not add service-role credentials to application code.
- Use a dedicated `library_command_owner`: NOLOGIN, NOSUPERUSER, NOCREATEDB,
  NOCREATEROLE, NOINHERIT, NOREPLICATION, NOBYPASSRLS. It owns write functions,
  never the books table. Clients receive no role membership or SET ROLE ability.
- Give authenticated and the Library executor owner-scoped SELECT. Give the
  executor only necessary INSERT and column-limited UPDATE; no DELETE/TRUNCATE,
  no Quest/EXP/progression access and no general schema CREATE privilege.
- Owner SELECT uses verified `system_internal.request_user_id()` equality.
  INSERT WITH CHECK enforces that identity. UPDATE uses both owner USING and
  WITH CHECK; identity columns cannot be transferred.
- Add `system_single_owner` AS RESTRICTIVE FOR ALL for authenticated and the
  executor, combining `system_private.is_owner()` with request-identity equality
  in USING and WITH CHECK. Missing owner configuration fails closed.
- There is no DELETE policy, runtime DELETE grant or public delete RPC. Archive
  is an UPDATE. Administrators retain their platform authority; V1 adds no
  application deletion path or claim that RLS constrains database superusers.
- Grant only necessary helper/schema usage to the executor, following existing
  helper ownership rules. Return any temporary migration membership/CREATE
  privileges to their prior state. Never reuse the Quest executor.

Every public Library RPC explicitly checks authenticated request identity and
calls `system_private.require_owner()` before business processing. Functions use
a fixed safe search_path and qualified objects. Read functions are SECURITY
INVOKER; mutation functions are SECURITY DEFINER owned by the restricted
non-table-owning executor, so RLS remains effective. Revoke default function
EXECUTE and grant public entries only to authenticated. Private helpers are not
public endpoints. No user_id argument is an ownership authority.

Reads/mutations for inaccessible IDs use the same unavailable/not-found contract
as absent IDs after authorization. Global primary-key collision handling must not
return foreign rows, raw unique-constraint details or another owner's existence.
Direct owner table reads remain RLS-bound as in Goals; normal application reads
use bounded Library RPC projections.

## 4. Application command boundary

Proposed public names and logical inputs below are contract proposals, not SQL
definitions. Keep five focused entries rather than a generic command endpoint.

| Entry | Logical input | Behavior/output |
| --- | --- | --- |
| list_books_v1 | scope, optional status, cursor, limit | Owner-guarded bounded metadata page and next cursor. |
| get_book_v1 | book ID | Current owned detail, including archived records, or uniform not-found. |
| create_book_v1 | retained book ID and editable fields | Insert one new active row or report existing owned identity without applying submitted fields. |
| update_book_v1 | book ID, expected revision, explicit editable changes | Atomic validated metadata/text/status changes; archived/stale edits reject. |
| set_book_archived_v1 | book ID, expected revision, desired archived boolean | Atomic archive/restore, preserving all other content. |

The update allowlist is title, author, cover_url, status, summary, content_notes
and lessons. Omitted fields are unchanged; explicit null clears nullable fields;
title/status cannot be cleared. Reject unknown keys. A status-only control sends
only status, not stale copies of long text. The full editor can submit all editable
fields. An empty update is invalid; a nonempty update equal to normalized current
values is a no-op when the book is active and the revision is current.

No mutation accepts a new owner, identity, created_at, updated_at or raw
archived_at. Expected revision is a guard, not a replacement value. The archive
command accepts a boolean rather than a timestamp or toggle.

Return ordinary versioned response envelopes identifying the current book ID,
revision and whether this call changed a row; create distinguishes created from
already-existing identity. These are immediate acknowledgements/current-state
results, not durable receipts, replay claims or command-history records. Parsers
check field types, identity, status and exact revision representation. Map errors
to typed application outcomes and localized copy, not raw SQL messages.

## 5. Atomic concurrency and no-op semantics

For update/archive/restore, authenticate, locate the owned row and acquire its row
lock in the same transaction. Check expected revision against the locked row
before considering a no-op. For edits, then reject archived books even when the
proposed edit would otherwise change nothing. Validate/normalize requested state,
compare null-safely and write only if something actually differs.

An actual mutation increments revision once and updates updated_at with database
time. Archive sets archived_at once; repeating archive with the current revision
does not replace that timestamp. Restore clears it. Matching-revision no-ops
change neither revision nor updated_at. Concurrent changes based on one revision
cannot both overwrite the row. No owner-wide progression/advisory lock is needed
for this one-row domain.

This check ordering deliberately rejects a stale request even if current values
match it. With no journal, a stale retry cannot be identified as an accepted
historical command and must not be advertised as one.

## 6. Create identity and uncertain outcomes

### Create

Generate one UUID per create attempt and retain it until resolved. Concurrent
requests for that ID rely on the primary key and atomic insert behavior to yield
at most one row. There is no ON CONFLICT UPDATE behavior. If the same owner already
has that ID, create returns the existing-identity outcome and applies no fields,
even after subsequent edits or archival. Fetch current detail for review. Do not
claim that the new payload matched or replaced the original create payload: no
historical payload/receipt is retained. Different IDs may have identical metadata.

The proposed L2 reload design retains only `{version, userId, bookId}` in a
Library-specific sessionStorage entry before dispatch. It stores no title, cover,
author or long text. A failed metadata write stops dispatch with an actionable
message; the in-memory form remains available. Scope by verified account and
validate restored metadata. Do not scan or share Quest recovery namespaces.

On reload, read that owned ID first; never auto-submit. If present, open the saved
record and clear the pending identity after resolution. If absent, keep the same
ID and allow explicit re-entry/retry; unsaved text was not persisted. If a previous
in-flight request later wins, the existing-identity outcome still cannot overwrite
it. Read failure leaves the outcome unknown. Clear identity on confirmed resolution,
not merely because transport failed; account changes must not dispatch old intent.
This is a small local create concern, not a generic recovery coordinator.

### Edit, status, archive and restore

Keep form state in memory, disable duplicate dispatch and preserve the submitted
base revision. A network failure is uncertain, not evidence of rollback. Read
current state: if desired fields match, describe the current saved state without
asserting historical command execution. If they differ and revision advanced,
show a conflict and retain the local draft for explicit review/reapplication. If
revision is unchanged, an explicit retry can use the original revision; the
database guard still decides. Never substitute a fresh revision automatically.

A committed archive followed by a later restore must not be reversed by an old
archive retry. The old revision rejects. The same applies to status and notes.
No receipt table, alias, execution cycle or durable note draft is introduced.

Server Actions distinguish validation/access rejection, stale/archived conflict,
unknown transport/result and saved acknowledgement. Handle invalidation separately
after confirmed success: revalidation failure means saved/refresh-required. A
later read error must not erase that acknowledgement or imply the save failed.
No autosave, offline editing, background replay or persistent note content.

## 7. Server/client ownership and routes

Use `src/features/library/model.ts` for types, pure normalization/validation,
status/archive rules and response parsing; `data.ts` for server-side reads and
RPC adapters; `actions.ts` for authenticated Server Actions and invalidation.
Separate a validation file only if size warrants it; add no generic repository
framework. UI components collect/present data, not authoritative business rules.

| Route | Server composition | Client behavior |
| --- | --- | --- |
| /library | Owner/profile gate, locale, scope/status/cursor, metadata read, SystemShell | Filters/navigation and small image-fallback/control islands. |
| /library/new | Owner/profile gate, locale, shell and creation form | Draft, stable ID, validation feedback, explicit create. |
| /library/[id] | Validate ID, owner/profile gate, current detail, shell | Explicit edits/status/archive/restore and draft/conflict feedback. |

Use dynamic authenticated rendering, existing request-local Supabase clients and
profile onboarding gates. No privileged browser client or new API-route layer.
Keep server-only persistence out of client imports. Reads do not mutate books.
After writes invalidate the Library collection and relevant detail; do not refresh
Quest/Calendar/progression as a side effect. Server-auth redirects remain control
flow, not generic network errors. Missing and wrong-owner detail are uniformly
not-found; unavailable reads produce a retryable error state.

## 8. UI, covers, navigation and localization

Use Anime SYSTEM HUD x Personal Life OS through the existing PR #54 tokens and
primitives. Do not build a second visual system. One semantic BookCard renders a
desktop/tablet cover-led grid and a compact stacked/horizontal mobile arrangement
through CSS; no separate desktop/mobile data models or duplicated interactive DOM.
Keep cover, wrapping title, optional author, textual status and concise actions in
the card. Long text belongs only to the separate detail/edit route.

The collection has Add Book, active/archived scope, status filters, pagination and
distinct empty/filtered-empty/loading/error states. Detail offers labelled summary,
content notes and lessons fields with explicit Save/Cancel. Archived detail is
readable with Restore, and editing remains blocked at both UI and command layers.
Preserve draft text on save errors/conflicts. Avoid a modal or split-only workspace
for long text. Test keyboard focus, feedback, contrast, zoom/wrapping, reduced
motion, mobile keyboard space and at least 44px controls from the beginning of L3.

### Manual covers

Cover validation is syntactic and never dereferences the URL. Require an absolute
HTTPS URL with a nonempty valid host, no credentials/userinfo (including an empty
userinfo marker before @ in the authority), and the agreed
length bound. Reject relative/protocol-relative input, other schemes, control
characters, internal whitespace and backslash forms that browser URL parsing might
repair. Application and database command validation must agree on the accepted
syntax and edge cases; no DNS/HEAD/GET request or remote content inspection is a
validator. Cover URLs are user data and should not be logged with note content.

Later UI may use a resilient native img or a narrowly designed unoptimized wrapper.
The optimizer must not fetch the URL server-side. Current next.config.ts has no
image remote-host configuration; no broad wildcard or proxy is added. A native
img choice must account for the existing zero-warning Next ESLint rules with a
documented narrow exception, not a global lint weakening.

Give covers stable dimensions/aspect ratio, contained scaling, lazy loading and
local/CSS missing/broken fallback. Reset broken-image state on URL change. Keep
title/author outside the image. Use appropriate alt text (empty when adjacent
identity makes the image redundant) and no-referrer image requests. Browser loading
still contacts the third-party host; V1 promises no server fetch, not anonymous
external delivery. Do not add cover uploads, fetching services or PWA caching.

### Shared shell and language

Add the fourth route key and real /library link to SystemShell/AppHeader, with
Library active for /library/new and /library/[id]. Extend the proxy matcher to
/library/:path* while retaining independent page/action auth checks and private
response handling. Preserve Dashboard's selected-date Calendar link and compact
Quest shortcut. No /books, /reading or /notes routes.

Add typed Library copy and EN/VI navigation/tagline keys using existing dictionaries
and cookie locale. Include field labels, status names, actions, errors, conflict/
unknown/saved-refresh messages, alt/fallback text and accessibility labels. Server
and client use the same validated locale; unsupported values retain the existing
Vietnamese fallback. Do not translate persisted values, identifiers or user text.
Feature CSS belongs in src/styles/library.css imported by globals.css. Extend
system-shell.css only if demonstrated fourth-link layout issues require it.

## 9. Testing and migration architecture

Trace future tests to LIB-AC identifiers in the requirements. Use current Node
tests and mocked adapters/TSX rendering, SQL behavior/catalog suites and actual
Auth/PostgREST wire calls in the disposable harness. E2E runs the real application
and database boundary on desktop and mobile; mocking authorization is insufficient.
See the [handoff test matrix](../04-development/library-v1.md) for required scenarios.

Create a new timestamped additive migration only in L1. Do not edit any historical
migration, checksum, old policy, Quest function or activation list. New books
policies and every public entry guard install immediately in that new migration.
No data backfill or external database inspection is required for an empty domain.

Register Library tests at a new checkpoint without changing what historical
checkpoints assert. The disposable harness currently defers owner activation and
several later migrations to preserve the checksum/order contract. Explicitly audit
where the new migration and its post-activation security tests run; do not assume
the filename loop alone gives a correct test order. Add new Library-specific
catalog/wire assertions instead of rewriting frozen old counts to accommodate it.

Verify against disposable resources only. A future rollout applies and verifies
the migration before code invokes its RPCs. Roll back a frontend by disabling its
surface while retaining book data; never use a destructive down migration as an
automatic rollback. Repair schema issues with reviewed forward migrations. Any
environment rollout requires separate authorization, absent from L0.

## 10. Alternatives and extension paths

| Alternative | Reason rejected for V1 |
| --- | --- |
| PostgreSQL status enum | Text + CHECK follows the existing domain convention and keeps additive status changes straightforward. |
| Separate summary/note/lesson entities | No entry history, ordering or per-note lifecycle is required; three bounded columns suffice. |
| Title/author uniqueness or ISBN identity | Prevents legitimate copies/editions and adds catalog semantics outside scope. |
| Cover/provider table or external catalog API | Manual nullable URL meets the approved requirement without integration infrastructure. |
| Direct authenticated writes | New-domain Goals/Calendar command boundary better centralizes archive/concurrency/owner invariants. |
| Quest executor, ledger or recovery coordinator | Unnecessary permissions, coupling and historical-command semantics for a single book row. |
| Calendar-style last-write-wins | Can silently erase long user notes; expected revision is required. |
| Receipt-based exact historical replay | Explicitly excluded; refresh/review and stale rejection provide the approved simpler behavior. |
| Hard deletion | Removes knowledge irreversibly and complicates late create retries; archive-only is approved. |
| Modal/inline expansion/split-only editor | Less comfortable for long notes and mobile; separate detail route is approved. |
| Independent mobile cards/list-only collection | Approved design uses one responsive cover-led BookCard across breakpoints. |

Stable book/owner identity leaves future progress, quotes, tags, note entries,
sessions, provider identifiers and book-goal links possible through additive
fields or same-owner child relations. None is reserved as unused V1 data. Moving
text into note entries later requires an explicit migration retaining existing
content, not replacing book identities. Library does not promise future Quest/EXP
integration without a separately approved boundary.
