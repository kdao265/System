# Coding agent instructions

1. Read [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) first, then the relevant requirements and architecture decisions before coding.
2. Inspect the existing implementation and repository status before modifying files. Preserve unrelated work.
3. Work on a focused branch; do not develop features on or push directly to `main`. Open a PR before merge.
4. Never expose secrets in code, documentation, logs, issues, screenshots, or tool output. Use redacted examples.
5. Do not bypass Supabase row-level security (RLS). Keep privileged credentials out of client code; document and review access-control changes.
6. Do not silently change architecture. Record a proposed ADR, explain alternatives and impact, and obtain Product Owner agreement before implementation.
7. Do not add dependencies without documented justification. Respect task-specific prohibitions on dependencies.
8. Make narrow changes. Avoid unrelated refactoring or changes to other modules merely because improvements are possible.
9. Keep application business rules in domain/application services, outside UI components. Keep requirement systems data-driven.
10. Run available lint, typecheck, and tests appropriate to the change. Report results and unavailable checks honestly. No project commands exist yet; fill them in from repository configuration when available. Do not invent commands.
11. Review `git diff` before reporting completion and before committing. Inspect new, untracked files separately because ordinary diffs omit them.
12. Report changed files, validation, assumptions, and unresolved problems. Do not claim planned behavior is implemented.
13. Use repository artifacts for handoffs: requirements, ADRs, issues, tests, code, and git history. Never rely on another agent remembering a conversation.
14. Put new ideas in the backlog unless the Product Owner explicitly brings them into scope. Follow [the agent workflow](docs/04-development/ai-agent-workflow.md).

For this initial governance task: documentation and templates only; no application implementation, business-logic changes, dependencies, database schema changes, deletions, commits, or pushes.
