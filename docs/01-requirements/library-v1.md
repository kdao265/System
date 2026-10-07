# Library V1 requirements

## 1. Status and ownership

- Date: 2026-10-07. Owner: Product Owner.
- Status: approved product decisions recorded for L0 sign-off; not implemented.
- Authority: Product Owner's Library V1 L0 request on `feat/library-v1`. This
  request includes manual covers, a separate summary and responsive BookCards;
  it supersedes the discovery audit's suggestions to defer covers/summary and use rows.
- Related issue: not supplied. Decision: ADR-023 in [decisions](../02-architecture/decisions.md).
- Related: [architecture contract](../02-architecture/library-v1.md),
  [development handoff](../04-development/library-v1.md),
  [V1 scope](../00-product/scope-v1.md), [agent workflow](../04-development/ai-agent-workflow.md).

L0 creates documentation only. It authorizes no application code, tests, migration,
database access, dependency changes, commit, push or deployment. L1 requires a
separate implementation instruction after contract sign-off.

## 2. Purpose and boundary

Library is a private personal knowledge library: books the owner wants to read,
is reading or has finished, together with the owner's understanding and lessons.
It is not a Goodreads clone, a reading analytics system or another Quest domain.
Supabase remains authoritative. Library never changes Quest, EXP or reward state.

## 3. Terminology

- Book: one owner-created record, identified by an immutable UUID. Duplicate
  titles, editions and copies are permitted; title/author are not identifiers.
- Reading status: exactly `want_to_read`, `reading` or `finished`.
- Active: not archived, regardless of reading status. Finished books can be active.
- Archived: retained and readable, with editing blocked until restored.
- Summary: short user-written explanation of what the book is about.
- Content notes: longer user-written understanding of the content.
- Lessons: personal lessons or takeaways, separate from the content notes.
- Revision: database-owned optimistic-concurrency token, not reading progress.

## 4. User stories

- As the owner, I can capture a book quickly with a title and optional metadata.
- As the owner, I can distinguish intended, current and finished reading.
- As the owner, I can preserve and revise my own summary, notes and lessons.
- As the owner, I can archive a book without losing it and restore it later.
- As the owner, I can use the same collection and detail workspace on desktop or
  mobile, in English or Vietnamese, without exposing my books to another user.

## 5. Functional requirements

| ID | Requirement |
| --- | --- |
| LIB-01 | Create a book with required title and optional author, manual cover URL, summary, content notes and lessons. Default omitted status to `want_to_read`. |
| LIB-02 | List active books by default, offer an explicit archived scope, and filter either scope by any reading status or all statuses. Use bounded pagination. |
| LIB-03 | Read a book and explicitly save edits on a separate detail route; collection payloads exclude summary, content notes and lessons. |
| LIB-04 | Permit any valid reading status to change directly to any other valid reading status. Re-selecting the same value is a no-op when the revision is current. |
| LIB-05 | Archive/restore independently of reading status, preserving every content field. Archived books remain readable; restore is required before edits, including status edits. |
| LIB-06 | Expose no hard-delete API, UI or Library runtime DELETE grant. |
| LIB-07 | Every edit, status change, archive and restore checks expected revision atomically. Reject stale writes without overwriting current data. |
| LIB-08 | Create retries after uncertain transport reuse the same UUID and never duplicate or overwrite an existing book. Preserve the attempt identity until resolved. |
| LIB-09 | Enforce both owner isolation and SYSTEM's configured-single-owner restriction in the application and database boundaries. |
| LIB-10 | Validate optional manual HTTPS covers without server-side fetching/proxying/content inspection. Missing/broken covers have local/CSS fallback; title and author remain readable. |
| LIB-11 | Provide only `/library`, `/library/new` and `/library/[id]`; Library is the fourth real SYSTEM shell destination, active on nested routes. |
| LIB-12 | Use one semantic responsive BookCard: cover-led desktop/tablet grid and compact mobile layout, wrapping titles, reachable actions, no horizontal overflow and controls at least 44px. |
| LIB-13 | Reuse PR #54 SystemShell, Panel, SectionHeader, Button, Badge, EmptyState, Notice, ui-field, semantic tokens and reduced-motion behavior. |
| LIB-14 | Provide a typed Library copy group in the existing EN/VI dictionaries, including errors, status labels, accessible labels and empty/loading states. Never translate stored status values or user content. |
| LIB-15 | Distinguish rejected, uncertain and saved outcomes. Confirmed save followed by failed UI invalidation is saved/refresh-required, not unsaved. |

## 6. Field requirements

One book owns the following fields. Storage constraints and command boundaries are
specified in the architecture document. All text is plain text, never executable HTML.

| Field | Requirement |
| --- | --- |
| `id` | Required immutable UUID; primary key and stable creation identity. |
| `user_id` | Required immutable owner UUID derived from verified request identity. |
| `title` | Required text; trim, reject blank; maximum 240 Unicode characters. |
| `author` | Nullable text; trim, normalize blank to null; maximum 240 characters. |
| `cover_url` | Nullable manual absolute HTTPS URL; no credentials/userinfo or unsupported schemes; bounded length. L0 proposes a 2,048-character ceiling. |
| `status` | Required text; default `want_to_read`; allow only `want_to_read`, `reading`, `finished`. |
| `summary` | Nullable short description of the book; proposed maximum 4,000 characters. |
| `content_notes` | Nullable long-form notes; proposed maximum 20,000 characters. |
| `lessons` | Nullable lessons/takeaways; proposed maximum 10,000 characters. |
| `archived_at` | Nullable database-set timestamp, independent of status. |
| `revision` | Required positive bigint, initially 1; increases only for an actual mutation. |
| `created_at` | Required database-owned creation timestamp; immutable. |
| `updated_at` | Required database-owned timestamp; changes only on actual mutation. |

The three note limits are the Product Owner's proposed values, carried forward
for L0 sign-off. They and the 2,048-character URL ceiling are contract parameters,
not evidence of implemented validation.

Count Unicode code points consistently with PostgreSQL `char_length`, not UTF-16
code units. Do not silently truncate. Normalize blank nullable text to null;
preserve meaningful line breaks and spacing in nonblank summary/notes/lessons.
Define identical normalization at application/database boundaries and verify it
with shared examples, including Vietnamese, emoji and Unicode whitespace.

No title uniqueness, title-plus-author uniqueness, ISBN field, author entity,
note child table or provider metadata is part of V1.

## 7. Business rules and states

| Current state | Operation | Result/guard |
| --- | --- | --- |
| Active, any reading status | Edit or status change | Requires current revision; changes only submitted editable fields. |
| Active, any reading status | Archive | Set `archived_at` using database time; preserve content/status. |
| Archived, any reading status | Read | Allowed through the same owner boundary. |
| Archived, any reading status | Edit/status change | Reject, including would-be no-op edits; restore first. |
| Archived, any reading status | Restore | Clear `archived_at`; preserve content/status. |
| Already in desired archive state | Set that state | No-op only if expected revision is current. |
| Any state | Mutation with stale revision | Reject before no-op handling; no write. |
| Any state | Hard delete | Unavailable and denied. |

Archive/restore are explicit desired state, never toggles. They change only
`archived_at` plus `revision`/`updated_at` on an actual transition. They do not
clear covers/notes, finish a book, grant EXP or create a Quest. Initial creation
uses revision 1, null archival, and database timestamps. `finished` is reversible
and never implies archival. There are no reading dates, sessions or time-zone
calculations in this domain; existing application onboarding remains in force.

## 8. Edge cases and failure behavior

- Valid duplicate titles/authors produce separate records when given different IDs.
- A repeated create ID never becomes an upsert. An existing owned record is
  reported as existing and read afresh; that does not claim the submitted fields
  were applied. Never disclose a different owner's colliding record.
- A stale revision cannot be bypassed because the requested values happen to
  equal current values. Revision checks protect intervening intent.
- A lost response does not prove failure. Keep the draft while the page remains
  mounted; read authoritative state and resolve before starting a replacement.
- Reload recovery, when supplied, stores only minimum identity metadata, never
  title, author, cover URL, summary, content notes or lessons. No persistent drafts.
- Missing or wrong-owner IDs produce the same not-found behavior within an
  authorized session. Anonymous/non-configured-owner visitors fail the common
  authorization gate. Service unavailability is not disguised as an empty list.
- Cover failures do not block reading/saving a valid book. Validation checks URL
  syntax only, not remote availability; it must not cause network access.
- Long content wraps and remains usable at narrow widths. Drafts remain visible
  after validation/conflict/transport errors; no autosave or offline queue exists.
- Notes are displayed as text. No HTML rendering, external link previews or AI
  interpretation of user content is introduced.

## 9. Acceptance criteria

| ID | Observable acceptance | Requirements |
| --- | --- | --- |
| LIB-AC-01 | Given a valid title alone, create produces one owned active book at revision 1 with `want_to_read` and database timestamps. | LIB-01, 09 |
| LIB-AC-02 | Optional author/cover/summary/content notes/lessons save and survive a fresh detail read and reload; blank nullable text becomes null. | LIB-01, 03 |
| LIB-AC-03 | At and beyond every text limit, Unicode-aware validation agrees in UI/application/database; invalid values reject without truncation or partial writes. | LIB-01, 10 |
| LIB-AC-04 | HTTPS covers work; relative URLs, non-HTTPS schemes, userinfo and overlong URLs reject. Missing/broken covers render fallback with book identity still available. No server fetch occurs. | LIB-10, 12 |
| LIB-AC-05 | Active/archived scopes and all three status filters return the correct bounded collection; no long-form fields occur in its payload. | LIB-02, 03 |
| LIB-AC-06 | Every pair of distinct valid statuses can transition both directions; invalid status rejects. Finished remains active unless explicitly archived. | LIB-04, 05 |
| LIB-AC-07 | Archive preserves all content/status; archived detail remains readable; metadata/status edits reject; restore clears archival and preserves all other content. | LIB-05 |
| LIB-AC-08 | Concurrent edits from the same base revision allow at most one differing write; stale edits retain the losing draft and require review. | LIB-07 |
| LIB-AC-09 | Current-revision no-ops change neither revision nor updated time. Actual writes increment revision once. Identity, owner and creation time cannot be changed. | LIB-07, 09 |
| LIB-AC-10 | Duplicate submits and a committed create with a lost response reuse one UUID, produce one row and never overwrite that row through create. | LIB-08, 15 |
| LIB-AC-11 | Unknown edit/archive/restore outcomes are resolved by a fresh read; stale retries cannot overwrite intervening changes. Failed UI invalidation after confirmed commit reports saved/refresh-required. | LIB-07, 15 |
| LIB-AC-12 | Anonymous and authenticated non-owner access fails; owner reads cannot see another user's book; forged ownership, direct unauthorized writes and DELETE are denied. | LIB-06, 09 |
| LIB-AC-13 | Missing/wrong-owner detail IDs are indistinguishable; malformed IDs fail safely; network/database failures show an error rather than false emptiness. | LIB-03, 09, 15 |
| LIB-AC-14 | All three approved routes work, Library remains active on nested routes, and Dashboard's selected-date Calendar link and Quest shortcut still behave correctly. | LIB-11 |
| LIB-AC-15 | One BookCard supports desktop/tablet grid and 360/390/412px mobile layouts; long titles wrap, controls are at least 44px and there is no horizontal document overflow. | LIB-12, 13 |
| LIB-AC-16 | Detail forms support long notes, visible labels/focus, keyboard use, accessible feedback and reachable Save/Cancel/Restore actions at mobile widths. Reduced motion remains supported. | LIB-03, 12, 13 |
| LIB-AC-17 | EN/VI copy is complete and typed; initial server/client locale agrees; user content/status storage is unchanged by locale switches. | LIB-14 |
| LIB-AC-18 | Any pending-create reload metadata contains identity only; reload never auto-resubmits or claims unsaved text recovery. Library introduces no prohibited subsystem. | LIB-08, 15 |

## 10. Explicit non-goals

Google Books API; Open Library API; ISBN lookup; automatic cover fetching;
server-side cover fetching/proxying; AI summaries; AI lessons; recommendations;
social sharing; ratings/reviews; reading streaks; page-count progress; reading
sessions; analytics; quote entities; tags/categories; rich-text editor; multiple
note entities; full-text search; EXP; Quest integration; chatbot integration;
autosave; persistent note drafts; offline editing; hard delete.

Also excluded: a Quest command ledger, durable receipts, cycles, aliases,
EXP/progression locks, a generic recovery coordinator, broad Next Image remote
wildcards, uploaded covers and a second visual/localization system.

## 11. Open questions and sign-off boundary

The approved product scope has no unresolved contradiction with the inspected
repository. Do not reopen covers, summary, cards, routes or status/archive rules.
L0 sign-off accepts the detailed architecture refinements and proposed text/URL
limits recorded here. The image component's exact native/unoptimized rendering
choice is an L3 implementation detail within the fixed no-server-fetch contract.
No separate approval is inferred for routine implementation details, but any
change to this contract requires a recorded Product Owner decision. L1 has not
started and is not authorized by completion of this document.
