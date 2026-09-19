# SYSTEM V1 — project context

SYSTEM V1 is a personal Life OS: planning, productivity, growth, and recovery supported by gamification. Game/anime System interfaces are inspiration; the product must develop its own visual identity.

## Current state and conceptual modules

The repository contains governance and Quest design documentation, Quest and Profile database migrations and local Supabase development files. The Next.js App Router application uses strict TypeScript, Tailwind CSS and ESLint, with email/password signup, login, current-session logout and a minimal protected dashboard. Cookie-aware Supabase clients and Next.js Proxy handle sessions; database triggers own Profile provisioning. Profile onboarding now collects an optional display name and explicit required timezone before dashboard access; other domain workflows remain deferred. Run `npm run lint` and `npm run build`; see the [setup guide](../README.md) and [Auth handoff](04-development/auth-application-layer.md). Validation uses local Supabase only. These are product concepts, not shipped functionality:

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

The [Player/EXP requirements](01-requirements/player-exp.md) and [physical design](02-architecture/player-exp-database-schema.md) propose the minimal append-only ledger needed for atomic Quest completion. This is documentation only: no Player ledger or Quest completion/reopen command is implemented by the design.

The [canonical Quest event V1 EXP envelope](02-architecture/quest-event-payload-v1.md) closes the Player/EXP migration preflight gap: exact completion/undo JSON paths, types and receipt mappings are defined. Existing Quest storage supports the contract without historical migration changes; guard/ledger/command implementation remains future work.

## Read next

The approved [Level/reward requirements](01-requirements/level-rewards.md), [domain model](02-architecture/level-reward-domain-model.md) and [physical design](02-architecture/level-reward-database-schema.md) extend that deferred progression boundary with versioned thresholds, permanent milestones and manual real-life reward claims. They preserve EXP reversal semantics and use shared UI/AI application commands. Documentation only; no Level/reward behavior is implemented. The approved initial `level_policy_v1` publishes explicit thresholds for Levels 1 through 100, generated from `100 * (L - 1)^2`. Runtime reads persisted thresholds only. Level 100 is the highest published V1 Level, not a permanent SYSTEM cap.

The [Auth/Profile requirements](01-requirements/auth-profile.md) and [physical design](02-architecture/auth-profile-database-schema.md) specify the email/password identity foundation, automatic private profiles and the existing Quest timezone dependency. The Profile migration and basic Auth application layer now exist; the Profile onboarding layer now implements explicit timezone setup; Quest application behavior remains deferred.

1. [Agent instructions](../AGENTS.md) and [V1 scope](00-product/scope-v1.md).
2. [Requirements format](01-requirements/README.md) and relevant module requirements when created.
3. [Architecture](02-architecture/overview.md), [decisions](02-architecture/decisions.md), and [integration boundary](02-architecture/integrations.md).
4. [Agent workflow](04-development/ai-agent-workflow.md), [coding guidelines](04-development/coding-guidelines.md), and [testing](04-development/testing.md).

Record new ideas in the [backlog](00-product/backlog.md); propose and document architectural changes before implementing them.

The [operator authorization contract](02-architecture/operator-authorization-v1.md) resolves the Level Policy assignment permission boundary: private active `level_policy_assign` grants authorize the request actor, independently of identity. Fresh deployments have zero grants; trusted administrative data bootstrap and explicit policy assignment are separate. This contract is documentation, not an implemented authorization table or command.

The Player/EXP migration introduces the private SYSTEM request-identity helper for the existing command role, preserving JWT ownership checks without managed-auth schema access. See the [Player/EXP boundary](02-architecture/player-exp-database-schema.md#7-rls-grants-and-routine-boundary); no public Quest completion/reopen command is enabled.
