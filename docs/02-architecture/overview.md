# Architecture overview

## Status

This describes intended boundaries. The application foundation uses Next.js App Router in `src/app` and a lazy Supabase client factory in `src/lib/supabase`. Shared components, domain features and shared types will gain directories when needed. Existing Quest schema documentation and migration remain separate from application behavior; no authentication, domain services or deployment configuration are implemented. See the [setup guide](../../README.md).

## Intended stack and responsibilities

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
