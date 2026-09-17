# Module requirements

Create a focused Markdown document per module or feature when it is ready for specification, using a descriptive filename such as `<module>-<feature>.md`. Link it from the implementation issue and PR. No full Quest specification is part of this setup.

Requirements describe agreed behavior independently of UI or database choices. Use stable identifiers for functional requirements and acceptance criteria so tests and reviews can trace them. Mark unresolved behavior as an open question instead of inventing a rule.

## Required document structure

1. **Status and ownership:** draft / agreed / superseded, owner, date, related issue and ADRs.
2. **Purpose:** problem, intended outcome, module boundary.
3. **Terminology:** domain entities and precise meanings.
4. **User stories:** actor, need, and value.
5. **Functional requirements:** identifiable and testable behavior.
6. **Business rules:** invariants, calculations, waivers, and configuration ownership.
7. **States / state machine:** states, allowed transitions, triggers, guards, and invalid transitions; explicitly explain if not applicable.
8. **Edge cases:** missing or conflicting data, retries, time boundaries, failures, and permissions where relevant.
9. **Acceptance criteria:** observable outcomes linked to requirements; Given/When/Then where useful.
10. **Out of scope:** explicit exclusions and deferred ideas.
11. **Open questions:** decision owner and blockers to implementation.

## Shared terminology

- **Quest:** something the user must do.
- **Activity:** a real event, activity, or project participated in.
- **Criterion:** a requirement that may be satisfied.
- **Evidence:** proof that a criterion has been satisfied.

These are separate entities. One activity may satisfy multiple criteria. Record how evidence becomes verified separately from estimated progress; verification policy is still to be specified. University, scholarship, and similar criteria must be represented as data, not hard-coded UI rules.

Before coding, resolve behavior that blocks acceptance and have the Product Owner agree on the requirement scope. Update requirements when agreed behavior changes.
