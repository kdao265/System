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
