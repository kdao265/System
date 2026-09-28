# Architecture and product decisions

These lightweight ADRs record the Product Owner's supplied decisions. Accepted means agreed direction, not implemented functionality. Initial date: 2026-09-17.

For future ADRs use: ID/title, date, status (proposed / accepted / superseded), context, decision, consequences, alternatives, and related issue or requirement. Preserve superseded decisions and link their replacements. Architectural proposals require Product Owner agreement before implementation.

## ADR-001 — Supabase owns application data

**Status:** Accepted.

**Context:** Multiple systems will read and update personal information.

**Decision:** Supabase/PostgreSQL is the application's primary source of truth.

**Consequences:** Persistence and data ownership decisions must preserve this authority. No schema is prescribed here.

## ADR-002 — External services are integrations

**Status:** Accepted.

**Context:** Google Calendar and potentially Notion provide external capabilities.

**Decision:** Treat them as integrations behind an explicit integration layer, not as the primary application database.

**Consequences:** Specify mapping, synchronization and conflict policies before implementation; see [the boundary](integrations.md).

## ADR-003 — EXP and money are separate

**Status:** Accepted.

**Context:** Both gamification and finance track quantities.

**Decision:** EXP progression and financial money are distinct concepts and systems.

**Consequences:** Do not conflate balances, rewards, or penalties. Any relationship requires explicit requirements rather than an implicit conversion.

## ADR-004 — Health means recovery estimates

**Status:** Accepted.

**Context:** Sustainable productivity requires awareness of workload and energy.

**Decision:** Health represents workload, energy and recovery estimates, not medical diagnosis.

**Consequences:** UI language and future algorithms must communicate estimates and avoid diagnostic claims. Estimation formulas remain undecided.

## ADR-005 — Failure does not mandate punishment

**Status:** Accepted.

**Context:** Failure may reflect overload or another justified reason.

**Decision:** Failure need not trigger a penalty. Health/workload can justify waivers. Penalties must not recursively escalate.

**Consequences:** Requirements must distinguish failure, penalty decisions, and waivers. Physical/custom, savings-allocation, and EXP penalties require defined policies; no automatic financial execution is implied.

## ADR-006 — Separate Quest, Activity, Criterion and Evidence

**Status:** Accepted.

**Context:** Doing work, participating in an event, meeting a requirement, and proving it are different concepts.

**Decision:** Quest is something to do; Activity is a real event/activity/project participated in; Criterion is a requirement; Evidence is proof of satisfaction. One activity may satisfy multiple criteria.

**Consequences:** Model their relationships explicitly; do not collapse them into one interchangeable entity.

## ADR-007 — Evidence verification is distinct from progress

**Status:** Accepted.

**Context:** Estimated progress alone cannot prove a requirement was satisfied.

**Decision:** Distinguish verified evidence from estimated progress.

**Consequences:** Specify verification policy and display these concepts distinctly. Completion or an estimate must not silently imply evidence verification.

## ADR-008 — Requirement systems are data-driven

**Status:** Accepted.

**Context:** University training scores, scholarships, Sinh viên 5 tốt and other application criteria can differ.

**Decision:** Represent requirements as data; do not hard-code university or scholarship criteria into UI logic.

**Consequences:** Domain services evaluate configured criteria. Configuration structure and change handling require later specification.

## ADR-009 — Capture ideas before expanding V1

**Status:** Accepted.

**Context:** A broad personal Life OS can continually attract new ideas.

**Decision:** New ideas normally enter the backlog. The Product Owner explicitly decides scope changes.

**Consequences:** An idea or issue is not an automatic V1 commitment; link accepted changes to scope and requirements.

## ADR-010 — Business logic stays outside UI components

**Status:** Accepted.

**Context:** Rules must remain consistent across screens and integrations.

**Decision:** Keep application business logic in domain/application services, not directly in UI components.

**Consequences:** UI renders state and collects input; services own calculations and transitions. Concrete interfaces remain undecided.

## ADR-011 — Propose architecture changes explicitly

**Status:** Accepted.

**Context:** Multiple agents assist a human Product Owner without shared memory.

**Decision:** Agents must document and propose architectural changes before implementing them.

**Consequences:** Record context, alternatives and impact in a proposed ADR; obtain Product Owner agreement, then update requirements and implementation. A conversation alone is not a durable handoff.

## ADR-012 — Quest reopen V2 cycle guard

**Date:** 2026-09-25.

**Status:** Accepted.

**Context:** The historical `reopen_quest_occurrence(command_id, occurrence_id, origin)` command resolves the occurrence's current completed cycle on the server. A delayed request can therefore undo a newer completion after the occurrence has been reopened and completed again. Reopen effects must remain atomic, replayable and compatible with the existing event, EXP ledger and receipt model.

**Decision:** Add the versioned command `reopen_quest_occurrence_v2(command_id, occurrence_id, expected_execution_cycle, origin)`. Under the existing owner, Quest-definition and occurrence row locks, a fresh request must match the locked occurrence cycle or reject with `23514` before mutation. A recorded command replays its historical receipt after later cycles, but its supplied cycle must match the originally recorded cycle; when a valid positive cycle and an accessible subject reach replay validation, a different cycle or subject rejects with `23505`. Invalid cycles or inaccessible subjects may be rejected earlier by input and ownership validation.

Revoke `authenticated` EXECUTE on the historical V1 function while retaining its database definition and historical receipts. Grant `authenticated` EXECUTE only on V2. V2 preserves the existing exact EXP reversal, event ordering, cycle advancement, projection reset and `quest_reopen_receipt` shape.

**Consequences:** Browser callers must use V2 and provide the cycle observed from the occurrence read. Historical V1 migrations remain unchanged; the additive migration owns the new function and the V1 permission hardening. Accepted command receipts remain valid across later cycles without reapplying their effects.

**Alternatives:** Keeping V1 browser execution would preserve compatibility but leave stale requests unsafe. Replacing or editing the historical migration would alter already-applied deployment history. A server-side current-cycle lookup without a caller expectation would not distinguish a delayed request from an intentional current request.

**Related:** [Quest command API V1 and V2 appendix](quest-command-api-v1.md), [Quest Reopen V2 migration](../../supabase/migrations/20260926000000_quest_reopen_v2.sql).

## ADR-013 — Durable completion aliases

**Date:** 2026-09-26. **Status:** Accepted by the Product Owner's backend implementation request.

**Context:** Completion returns the alternate caller command ID for a same-cycle
replay without recording that identity. A lost response followed by reopen leaves
that caller unable to replay. The historical contract's original-command wording
also differs from deployed SQL, tests and receipt validation.

**Decision:** Preserve the deployed RPC signature and ten-field caller-ID receipt.
Atomically register alternate command IDs in a private, immutable, owner-scoped
alias relation referencing the canonical completed event. Resolve recorded bindings
before live-cycle validation. Creation and Reopen V2 reserve the same Quest command
namespace. Add an authenticated, business-data-read-only resolution RPC distinguishing
recorded, unrecorded_superseded, unrecorded_current and conflict outcomes. Never
backfill unrecorded historical identities or claim they previously succeeded.

**Alternatives:** Definitive rejection plus reconciliation avoids alias storage but
changes successful deployed behavior and makes duplicate submissions user-visible.
Returning the original command ID alone breaks existing receipt validators and
does not recover a lost alternate response. Durable aliases preserve compatibility.

**Consequences:** New private storage and narrow collision checks are required;
accepted Quest/EXP history and progression behavior remain unchanged. Legacy
uncertainty requires future frontend reconciliation. Database migration survives
application rollback. This accepted amendment supersedes only the conflicting
same-cycle command-ID wording; the historical text remains for traceability.

**Related:** [Completion Alias contract](quest-command-api-v1.md#11-completion-alias-v1-amendment),
[backend task and rollout](../04-development/completion-alias-v1.md).

## ADR-014 - Private Auth V1 application boundary

**Date:** 2026-09-28. **Status:** Accepted by the Product Owner's PR #35 implementation request.

**Context:** SYSTEM is a private single-owner application. Existing SSR Auth accepts
any valid Auth user, and the original signup flow is public.

**Decision:** Preserve Supabase Auth, SSR cookie refresh and RLS. Add a server-only
`SYSTEM_OWNER_USER_ID` UUID allowlist at the shared server identity boundary and
password login. Fail closed on absent/invalid configuration; all protected actions
use that boundary. Disable website signup and its action, and keep operational
Supabase public/anonymous signup disabled. Buffer login cookies until identity is
accepted. Logout and owner timezone onboarding retain their current behavior.

**Alternatives:** Email matching, UI-only checks and proxy-only gates cannot enforce
server authorization. A new identity provider is unnecessary. A database singleton
is not part of the approved application implementation; see ADR-015.

**Consequences:** Every environment needs the server UUID. Existing database RLS
still isolates users rather than enforcing one SYSTEM owner. No domain rule or
privileged browser credential is introduced. [Scope, audit and validation](../04-development/private-auth-v1.md).

## ADR-015 - Single-owner database enforcement

**Date:** 2026-09-28. **Status:** Accepted and implemented. Both stages are applied to
Cloud (Production) on 2026-09-28: Local/Remote migration history is synchronized, 15
restrictive single-owner policies and 14 public-RPC entry guards are active, exactly one
configured owner remains, and final Production smoke testing passed.

**Context:** Valid non-owner tokens can bypass Next.js and invoke permitted Supabase
queries/RPCs on their own data. Disabling signup does not remove this access.
PostgreSQL cannot read the server environment variable.

**Decision:** Add an administrator-controlled private singleton owner configuration
and narrow authorization predicate. Add restrictive policies to existing RLS,
plus public-RPC entry guards (including owner-only assignment actor and target).
Preserve the current identity helper, ownership isolation, capabilities, provisioning
and business rules. See the [migration scope and test plan](../04-development/private-auth-v1.md#database-hardening-follow-up)
and the [database hardening record](../04-development/private-auth-database.md).

**Alternatives:** Application-only checks leave direct APIs accessible. Deleting or
banning all other users does not establish a durable database invariant or instantly
revoke issued access tokens. A gateway hook alone does not cover other SQL entry
paths. Rewriting every business routine or managed Auth helper creates wider risk.

**Impact:** Two additive migrations (`20260928090000_install_private_owner.sql` for
stage one and the promoted `20260928100000_activate_private_owner.sql` for stage two
activation) plus a separately approved environment-specific bootstrap; missing
bootstrap deliberately denies application database access. App and database UUIDs must
agree. The Product Owner authorized implementation, the stage-two promotion and the
Production rollout on 2026-09-28. The hardening is implemented, promoted into the
migration path, fully validated on disposable resources, and applied to Production
(Cloud) on 2026-09-28 with Local/Remote migration history synchronized and the final
Production smoke testing passed. See the
[database hardening record](../04-development/private-auth-database.md).

## ADR-016 - Disposable Playwright browser foundation

**Date:** 2026-09-28. **Status:** Accepted within the Product Owner's explicit
Playwright implementation request; no application architecture change.

**Context:** Browser coverage must exercise Private Auth V1 without contacting
Production or the developer's existing Local project. Shared owner mutations must
be deterministic.

**Decision:** Extend the existing disposable auth helper with an opt-in isolated
application copy/build. Playwright worker fixtures own that same verified tmpfs
Supabase lifecycle. Use real UI authentication, one worker, no saved session state,
and separate desktop lifecycle/mobile anonymous specs. Add `@playwright/test` as
a development dependency for real browser assertions and failure diagnostics.

**Alternatives:** Reusing a running app/Local Supabase risks real data; a second
Supabase CLI environment duplicates existing safety logic; API-created browser
sessions would omit the requested login flow. Parallel shared-owner mutations and
retries against dirty state would hide ordering defects.

**Impact:** Each project worker builds its own application and provisions fresh
fixtures, increasing runtime but preserving isolation. No production dependency,
RLS, schema or domain rule changes. The existing checkpoint workflow is preserved;
a separate browser workflow adds coverage. See [lifecycle and task contract](../04-development/playwright-e2e.md).

## ADR-017 - Personal Beta PWA installability and static-only cache strategy

**Date:** 2026-09-28. **Status:** Accepted within the Product Owner's explicit PR #37
(Personal Beta / PWA V1) implementation request. Authentication, RLS and domain
semantics are unchanged.

**Context:** SYSTEM is a private single-owner app that should be usable daily from a
phone as an installed web app. Current Chromium/Android installability expects a web app
manifest with suitable icons *and* a registered service worker that handles fetches.
The usual PWA pattern (app-shell cache, offline fallbacks, background sync) conflicts
with an authenticated private app whose HTML, Server Action/RPC responses, session
cookies and Supabase traffic are user-specific and must stay network-authoritative.

**Decision:** Add the Next.js-native installability layer only: `app/manifest.ts`,
root-layout metadata/viewport (`viewport-fit: "cover"`, theme color, Apple tags), an
original committed icon set, and one deliberately minimal service worker. The worker
caches nothing except an explicit allowlist of versioned static assets (the manifest and
the icon set), lets every other request fall through untouched, activates immediately
(`skipWaiting` plus `clients.claim`), deletes superseded caches on activation, and is
served `no-store` so a new revision is always fetched. No offline shell, no offline
Quest/EXP mutation, no background sync, no push and no external analytics.

**Alternatives:** Shipping no service worker reduces Android installability to a
bookmark/shortcut, which does not meet the goal. Cache-first HTML or an offline app
shell would serve stale authenticated UI and stale data to a single-owner app. A generic
PWA/Workbox plugin adds a dependency and broad default cache rules beyond SYSTEM's
needs. Caching Supabase/API responses would persist user data in device Cache Storage
and break network-authoritative reads.

**Impact:** Security boundaries are untouched and no code path branches on display mode,
so RLS, owner authorization and session handling behave identically in a browser tab and
an installed app. Because application code, HTML and data are never cached, an installed
app cannot be stranded on stale code and a revision bump discards old static caches;
users may still see the previous icon/manifest for one navigation until the worker
updates. Offline use is not supported and shows the browser's normal offline error,
which the Product Owner accepted for V1. The existing disposable Playwright harness is
extended rather than duplicated with installability and phone-layout checks. See the
[Personal Beta PWA guide](../04-development/personal-beta-pwa.md).
