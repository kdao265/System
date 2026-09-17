# Testing and verification

Validate against agreed acceptance criteria and business rules. Choose checks proportional to the change and record actual results in the PR or handoff.

## Intended coverage when implementation exists

- Domain tests: state transitions, EXP/money separation, penalty waiver rules, no recursive escalation, criteria evaluation, and evidence verification boundaries.
- Integration tests: persistence and access enforcement, including RLS; external adapter mapping, retries, duplicates and conflicts once specified.
- UI tests/manual review: critical user journeys, error/empty/loading states, accessibility, and correct distinction between estimates and verified data.
- Deployment review: Vercel preview before production merge when available; report when unavailable.

Use synthetic or redacted fixtures. Do not use production secrets or perform destructive operations against live data for testing.

## Available checks

| Check | Current status |
| --- | --- |
| Lint | Not configured; fill in from actual repository scripts later |
| Typecheck | Not configured; fill in from actual repository scripts later |
| Automated tests | Not configured; fill in from actual repository scripts later |
| Build | Not configured; fill in from actual repository scripts later |

For documentation-only changes, inspect required content, relative links, templates and the file tree. Run `git diff --check`, `git status`, and `git diff --stat`; ordinary diffs do not include untracked files, so read those separately. No application tests are warranted for this initial documentation setup.

Report the checks performed, results, unavailable checks and unresolved risks. A planned test or unavailable tool must never be reported as a pass.
