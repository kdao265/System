# AI-assisted development workflow

```text
Human Product Owner
    ↓
Orchestrator / Product / Architecture
    ↓
Specialized agents
    ↓
Feature branch (or fix/refactor/chore branch)
    ↓
QA / Review
    ↓
Pull Request
    ↓
main
```

The Product Owner owns priorities, scope and acceptance. The orchestrator translates agreed work into bounded tasks, resolves dependencies and coordinates architectural proposals. Specialized roles may include UI/UX, research, frontend, backend/database, Codex implementation, QA and code review. Roles need not be separate simultaneous agents.

## Task contract

Before work, record the problem, linked requirements, allowed scope, prohibited changes, acceptance criteria, dependencies and expected output in an issue or repository artifact. Architectural changes require a proposed ADR and Product Owner agreement before implementation. Research tasks must explicitly state whether implementation is prohibited.

Agents read `docs/PROJECT_CONTEXT.md`, relevant requirements, ADRs and existing implementation. They make narrow changes and must not modify unrelated modules merely because they see an improvement opportunity. Put extra ideas in the backlog.

Agents communicate through repository artifacts, not assumed shared memory. Code, docs, issues, tests and git history provide the durable record. Record decisions reached in conversation before another agent depends on them. If agents work concurrently, assign non-overlapping ownership and coordinate shared files explicitly.

## Handoff and review

Every handoff includes:

- Task/issue, branch, scope and linked requirements or ADRs.
- Changed files and behavior, or research findings with sources.
- Checks actually run and their results; unavailable checks.
- Assumptions, unresolved questions, limitations and next action.

QA checks acceptance criteria and relevant edge cases. Review checks scope, business-rule placement, access controls, secrets, dependencies and architecture consistency. Open a PR before merge; review may continue on the PR. Use Vercel preview when available and preserve deployability of `main`.

Do not commit, push, merge or deploy when the active task prohibits it. This initial task ends with uncommitted documentation, a file tree, status, diff statistics and assumptions.
