# Git workflow

Use a lightweight solo-development workflow with human review of AI-assisted changes.

| Branch | Purpose |
| --- | --- |
| `main` | Deployable baseline |
| `feature/*` | One feature |
| `fix/*` | One bug fix |
| `refactor/*` | One behavior-preserving structural change |
| `chore/*` | Maintenance and documentation |

## Working sequence

1. Inspect working-tree status and preserve existing changes.
2. Pull the latest `main` before branching when a remote and committed `main` exist. Resolve divergence deliberately.
3. Create the appropriate branch. Do not develop features directly on `main`; keep one logical change per branch.
4. Read the requirements, inspect implementation, and make the focused change.
5. Run relevant available checks and inspect the complete diff, including new files, before committing.
6. Open a PR before merge. Include requirements, validation and limitations using the repository template.
7. Complete QA/review; use a Vercel preview before production merge when available.
8. Merge only when `main` will remain deployable. Do not push directly to `main`.

Recommended commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`. Use a short description of the logical change.

## Bootstrap state

At setup, this repository has no commits and is on `chore/project-governance`. Pulling a committed `main` is not yet applicable. Remote setup, initial commit, PR and merge remain separate actions subject to the active task's authorization. This governance task explicitly prohibits commits and pushes.
