# Architecture overview

## Status

This describes intended boundaries. The application uses Next.js App Router in `src/app`, cookie-aware browser/server Supabase clients in `src/lib/supabase`, and email/password actions and forms in `src/features/auth`. Next.js 16 `src/proxy.ts` refreshes sessions before rendering; server pages independently verify identity with Supabase Auth. Existing Profile provisioning and Quest migrations remain unchanged. Profile onboarding in `src/features/profile` loads the verified owner through RLS, updates only display name/timezone, and gates dashboard access on a saved supported timezone. Missing profiles fail safely without application provisioning. Quest domain services and deployment configuration are deferred. See the [setup guide](../../README.md) and [Auth application handoff](../04-development/auth-application-layer.md).

The proposed [Player/EXP foundation](player-exp-database-schema.md), with its [requirements](../01-requirements/player-exp.md), uses Auth ownership, one append-only ledger and derived current EXP. It specifies future atomic Quest credit/reversal integration; production completion remains disabled until the ledger and coordinated commands are implemented and verified.

## Intended stack and responsibilities

The approved [Level/reward domain](level-reward-domain-model.md), [requirements](../01-requirements/level-rewards.md) and [physical design](level-reward-database-schema.md) derive current Level from EXP while retaining first-reached milestones and reward snapshots. Future Quest credit, milestone recognition and unlocks share one transaction; UI and AI use the same controlled application commands. No Level/reward behavior is implemented. The approved initial `level_policy_v1` publishes explicit thresholds for Levels 1 through 100, generated from `100 * (L - 1)^2`. Runtime reads persisted thresholds only. Level 100 is the highest published V1 Level, not a permanent SYSTEM cap.

| Technology / layer | Responsibility |
| --- | --- |
| Next.js, TypeScript | Application presentation and execution platform |
| Tailwind CSS | UI styling using an eventual shared design system |
| Application/domain services | Use cases, business rules, state transitions, and orchestration |
| Supabase / PostgreSQL | Primary persistent application data and enforced access boundaries |
| Integration layer | External-service adapters and translation into application use cases |
| Vercel | Intended hosting and preview deployments |

UI components present state and collect input; domain/application services own behavior. Persistence and external-service concerns should have explicit boundaries so business rules can be checked independently.

Quest, Activity, Criterion, and Evidence remain separate domain concepts even when a workflow links them. EXP progression and finance are separate systems. Recovery estimates can inform penalty waivers without medical claims. Detailed relationships and policies belong in requirements before schema design.

Supabase is the application data source of truth. Integrations must not create an alternative authoritative database or bypass application validation. Supabase RLS must not be bypassed; privileged credentials must stay out of clients.

See [ADRs](decisions.md) for agreed constraints and [integrations](integrations.md) for external boundaries. Propose architectural changes in an ADR before implementation. Do not treat this overview as approval for schema, dependency, or API changes.

The Player/EXP migration uses private SYSTEM-owned `system_internal.request_user_id()` for command-role identity, reading the request JWT sub as UUID with invoker security. Quest, Profile timezone-reader and EXP policies retain owner isolation without requiring the custom role to access the managed Auth schema. The helper is not a client-supplied identity or an authorization bypass.
