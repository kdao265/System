# SYSTEM V1 — project context

SYSTEM V1 is a personal Life OS: planning, productivity, growth, and recovery supported by gamification. Game/anime System interfaces are inspiration; the product must develop its own visual identity.

## Current state and conceptual modules

The repository starts with governance documentation only. No application, schema, or executable checks have been established. These are product concepts, not shipped functionality:

- Player: level, EXP, stats, achievements.
- Quest Engine: main, side, daily/weekly and recurring quests, rewards, deadlines, completion, failure, penalties.
- Planning: goals, projects, calendar, deadlines.
- Health / Recovery: workload and energy estimates, check-ins, recommendations, recovery quests, overload-based penalty waivers.
- Penalties: physical/custom, savings allocations, EXP deductions, justified waivers; no recursive escalation.
- Growth / Criteria: activities, configurable requirements, evidence, university training scores, scholarships, Sinh viên 5 tốt, other applications.
- Achievement Ledger / Evidence Vault: certificates, proof, awards, projects, activities reusable for CVs, portfolios, applications.
- Knowledge: books, book notes, general notes, Video Lab, journal.
- Finance: income, expenses, savings and dedicated funds.
- Life: recurring chores, issues requiring action, routines, personal tasks.
- Integrations: Google Calendar, potentially Notion and future services.

## Principles and sources of truth

The intended stack is Next.js, TypeScript, Tailwind CSS, Supabase/PostgreSQL, and Vercel. Supabase is the intended application data source of truth; external services are integrations. Keep domain rules out of UI components. EXP and money are separate. Health means productivity/recovery estimates, never medical diagnosis. Failure need not be punished, and overload may justify a waiver.

Quest, Activity, Criterion, and Evidence are distinct. One activity may satisfy multiple criteria. Estimated progress is not verified evidence. Requirements must be data-driven, not embedded in UI logic.

For development, use repository code, docs, issues, tests, and git history as shared evidence. Docs describe intent; code/tests describe current implementation. Surface conflicts to the Product Owner instead of silently choosing a new architecture. Agents do not share assumed conversational memory.

## Read next

1. [Agent instructions](../AGENTS.md) and [V1 scope](00-product/scope-v1.md).
2. [Requirements format](01-requirements/README.md) and relevant module requirements when created.
3. [Architecture](02-architecture/overview.md), [decisions](02-architecture/decisions.md), and [integration boundary](02-architecture/integrations.md).
4. [Agent workflow](04-development/ai-agent-workflow.md), [coding guidelines](04-development/coding-guidelines.md), and [testing](04-development/testing.md).

Record new ideas in the [backlog](00-product/backlog.md); propose and document architectural changes before implementing them.
