# SYSTEM V1

A personal Life OS for purposeful action, growth, and recovery.

## Application foundation

This milestone adds a minimal dark home page using Next.js App Router, React,
TypeScript, Tailwind CSS and ESLint, following the existing
[architecture](docs/02-architecture/overview.md) and
[product vision](docs/00-product/vision.md). Acceptance checks are dependency
installation, lint and a production build on the installed Node.js 24 runtime.
The subsequent [Auth application milestone](docs/04-development/auth-application-layer.md)
adds email/password signup, login, logout and a protected minimal dashboard.
The [Profile onboarding milestone](docs/04-development/profile-onboarding.md) adds
optional display name and explicit required timezone setup before dashboard access.
Other domain workflows remain deferred. Existing database
migrations retain their semantics; development validation uses only local Supabase.

## Local development

Use Node.js 24 LTS and npm. From the repository root:

```sh
npm install
# Configure the two public Supabase values in a Git-ignored .env.local first.
npm run dev
```

Open http://localhost:3000. The home page remains public; `/login` and `/signup`
lead through `/onboarding` when timezone is unset, then to the protected `/dashboard`.
Startup and builds validate required Supabase
configuration and fail with a safe, explicit message if it is missing.

```sh
npm run lint
npm run build
npm run start
```

The production build checks TypeScript. Lint runs separately through ESLint.
The local HTTP integration test can be run with a production server on port 3100:

```sh
npm run start -- --port 3100
# In another terminal:
node --env-file=.env.local tests/auth-smoke.mjs
node --test tests/timezones.test.mjs
```

It requires running local Supabase with the existing migrations applied. It refuses
remote Supabase URLs and creates two synthetic local Auth users/profiles per full run,
which it leaves in place. It never prints credentials or resets the database.

## Structure

```text
src/
  app/                  # Public home, Auth pages, onboarding and protected dashboard
  features/auth/        # Auth actions, server identity checks and form components
  features/profile/     # Profile reads/updates, timezone validation and onboarding
  lib/supabase/         # Cookie-aware browser/server clients and config validation
  proxy.ts              # Session refresh before auth-route rendering
tests/auth-smoke.mjs     # Local Auth/onboarding/owner isolation integration checks
tests/timezones.test.mjs # Runtime timezone validation tests
docs/                   # Product, requirements and architecture documentation
supabase/               # Existing local configuration and migrations
```

Add shared components to `src/components`, domain code to `src/features`, and
shared types to `src/types` when needed; empty scaffolding is intentionally absent.
Business rules belong in domain/application services, outside UI components.

## Supabase environment

`.env.example` lists `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both are public client configuration, never
service-role credentials. Configure them for your local Supabase instance in
`.env.local`; secret environment files are Git-ignored and must never be committed.
Do not point local tests at a remote instance.

Browser and request-scoped server helpers use `@supabase/ssr` cookie storage.
`src/proxy.ts` refreshes sessions and forwards cookies to both rendering and the
browser. Server pages verify identity using Auth `getUser()`; browser-provided IDs
and unverified session contents do not authorize access. Auth responses are private
and uncached. RLS remains the database access boundary.

Signup uses Auth only: the existing database trigger provisions Profile. With an
immediate session it redirects to `/dashboard`; otherwise it asks the user to
confirm email if required, then sign in with their password. It does not promise
that a generic signup response created an account. No automatic confirmation-code
exchange, password recovery or OAuth is included. Logout ends
the current session, clears its cookies and returns to `/login`.

The dashboard gate loads the verified owner's Profile through RLS. A null or
runtime-unsupported timezone directs the user to `/onboarding`; a saved supported
timezone grants dashboard access. Display name is optional and blank names become
null. Updates send only `display_name` and `timezone`; database validation, timestamps
and provisioning remain authoritative. Missing/unreadable profiles show a controlled
error with retry/sign-out, never an application INSERT or redirect loop.

## Dependency rationale

Next.js and React provide the requested App Router runtime; TypeScript and its
Node/React declarations support strict type checking. Tailwind CSS and its
PostCSS integration provide the requested styling pipeline. ESLint and Next's
configuration supply framework and TypeScript checks. The official
`@supabase/supabase-js` package provides the official Auth/data client.
The existing Supabase CLI development dependency is retained. These packages
bring build/runtime weight but avoid bespoke framework, styling and API-client
implementations. `@supabase/ssr` supplies the official cookie/session adapter instead
of custom token storage or deprecated auth helpers. No UI kit or state library is added.

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
