# SYSTEM V1

A personal Life OS for purposeful action, growth, and recovery.

## Application foundation

This milestone adds a minimal dark home page using Next.js App Router, React,
TypeScript, Tailwind CSS and ESLint, following the existing
[architecture](docs/02-architecture/overview.md) and
[product vision](docs/00-product/vision.md). Acceptance checks are dependency
installation, lint and a production build on the installed Node.js 24 runtime.
No domain behavior, authentication flows or remote Supabase operations are part
of this foundation. Existing database migrations retain their semantics.

## Local development

Use Node.js 24 LTS and npm. From the repository root:

```sh
npm install
npm run dev
```

Open http://localhost:3000. The placeholder page works without Supabase environment
variables and does not initialize a Supabase client.

```sh
npm run lint
npm run build
npm run start
```

The production build checks TypeScript. Lint runs separately through ESLint.
No automated application test suite is configured yet.

## Structure

```text
src/
  app/                  # App Router layout, home page and global styles
  lib/supabase/         # Lazy Supabase client factory
docs/                   # Product, requirements and architecture documentation
supabase/               # Existing local configuration and migrations
```

Add shared components to `src/components`, domain code to `src/features`, and
shared types to `src/types` when needed; empty scaffolding is intentionally absent.
Business rules belong in domain/application services, outside UI components.

## Supabase environment

`.env.example` lists `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both are public client configuration, never
service-role credentials. Configure them locally only when integration work is
authorized; secret environment files are Git-ignored. This milestone creates no
real `.env.local` and makes no Supabase requests.

`createSupabaseClient` validates configuration when called. It has no module-load
side effects, session persistence, automatic token refresh or auth callback
handling. It is infrastructure for future use, not an authentication solution.
RLS remains the database access boundary. Cookie-aware server authentication and
generated database types are deferred to their respective milestones.

## Dependency rationale

Next.js and React provide the requested App Router runtime; TypeScript and its
Node/React declarations support strict type checking. Tailwind CSS and its
PostCSS integration provide the requested styling pipeline. ESLint and Next's
configuration supply framework and TypeScript checks. The official
`@supabase/supabase-js` package provides future database client infrastructure.
The existing Supabase CLI development dependency is retained. These packages
bring build/runtime weight but avoid bespoke framework, styling and API-client
implementations; no UI kit, state library or auth package is added.

Next.js 16.3.5, React 19.3.0, Tailwind 4.3.3 and Supabase JS 2.116.0 were
selected from npm stable releases. ESLint 9.39.5 and TypeScript 6.0.3 satisfy
the current lint plugins' peer ranges: `eslint-plugin-react` excludes ESLint 10,
and the TypeScript parser requires TypeScript below 6.1. npm marks ESLint 9 as
unsupported; upgrading it requires a compatible framework lint dependency set.

## Foundation validation

On Node.js 24.18.1 with npm 11.16.0: `npm install`, `npm run lint` and
`npm run build` passed, including TypeScript checking. npm reported zero
vulnerabilities and a pending optional `unrs-resolver` install-script warning;
no additional script approval was needed for lint or build. A local production
server smoke check returned HTTP 200 with the SYSTEM V1 heading and compiled
dark stylesheet. The temporary server was stopped afterward. No remote
Supabase connection or deployment was performed.
