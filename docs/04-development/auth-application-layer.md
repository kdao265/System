# Email/password application layer

This records the Auth milestone. The subsequent [Profile onboarding layer](profile-onboarding.md)
now adds owner Profile reads/updates and timezone gating after authentication. Its
validation extends the existing HTTP test; historical results below remain unchanged.

## Task contract

Branch: `feat/auth-application-layer`. Implement signup, password login, current-session
logout and a protected minimal dashboard against local Supabase. Sources:
[Auth/Profile requirements](../01-requirements/auth-profile.md),
[physical design](../02-architecture/auth-profile-database-schema.md) and
[architecture](../02-architecture/overview.md).

Use the existing Next.js 16 App Router application and public Supabase configuration.
Do not change migrations, database semantics or Auth configuration, contact remote
Supabase, implement onboarding/other domains, or stage/commit/push.

Dependency: add the official `@supabase/ssr` adapter for cookie storage and refresh
shared by browser and server clients. This avoids maintaining custom token storage
or using deprecated auth helpers; it adds a small runtime dependency alongside the
existing Supabase JS SDK. Follow the [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
and [Next.js Proxy convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).

Acceptance: server-verified route access, safe form feedback, correct session/no-session
signup behavior, logout cookie clearing, and no application Profile writes. Run
`npm install`, `npm run lint`, `npm run build`, local smoke checks when configured,
and Git status/stat/whitespace review. Record actual results below at handoff.

## Implementation and boundaries

- `@supabase/ssr` 0.12.7 uses the existing Supabase JS 2.116.0 client (compatible
  peer range). Its only new transitive dependency is `cookie` 1.1.1; nothing removed.
- `next.config.ts` validates the two public environment variables at dev/build/start.
  Configuration errors name variables, never their values. `.env.local` is ignored;
  `.env.example` remains the only tracked environment file.
- Browser and per-request server factories share SSR cookie storage. Proxy refreshes
  with `getClaims()`, preserving cookies on the request and response. Auth paths are
  private/no-store; Server Components use read-only cookie access after Proxy.
- `/dashboard` independently resolves the user through Auth `getUser()`. It redirects
  unauthenticated requests to `/login`. Authenticated `/login` and `/signup` visits
  redirect to `/dashboard`. Only the verified email is passed into rendered identity UI.
- Server Actions validate required credentials and password confirmation, then call
  `signUp` or `signInWithPassword`. Errors are generic and no credential state is
  returned to the form. Supabase owns the configured password policy.
- Signup redirects only when a session is returned. Otherwise it displays a generic
  request-received state with confirmation instructions and a sign-in link. The user
  confirms email, when required, then signs in with a password; automatic code exchange
  is not included. Duplicate signup responses are not treated as proof of a new account.
- Logout uses `signOut({ scope: "local" })`, writes cookie removals, invalidates the
  Next.js layout cache and redirects to `/login`. Other sessions are not revoked.
- The existing database trigger alone provisions Profile; application code performs
  no Profile reads/writes or onboarding. No migrations or local Auth settings changed.

## Validation performed

On Node.js 24.18.1 / npm 11.16.0:

| Check | Result |
| --- | --- |
| `npm install` | Passed; zero vulnerabilities |
| `npm run lint` | Passed, including the integration script; zero warnings |
| `npm run build` | Passed, including strict TypeScript; three dynamic Auth pages and Proxy registered |
| Missing configuration at `next start` | Rejected with the expected safe configuration error |
| `node --env-file=.env.local tests/auth-smoke.mjs` | Passed against the production server and existing local Supabase |
| Git whitespace check | Passed; no migrations/config changes, no staged files |

HTTP smoke checks exercised the actual server-rendered forms/Server Actions without
JavaScript: public access; unauthenticated dashboard redirect; server-required and
matching-password validation; generic invalid-login feedback; signup with a real
session; dashboard email; authenticated login/signup redirects; no-store headers;
exactly one owner-visible trigger-created Profile with null optional fields; forced
stored-expiry refresh and a subsequent authenticated request; logout cookie removal
and denied dashboard access; successful password login and a second logout.

One synthetic Auth user/Profile remains in local Supabase. No privileged credentials
were used, no database reset or cleanup was performed, and no remote Supabase was
contacted. The temporary application server was stopped after validation; the
pre-existing local Supabase stack was left running.

Limitations: local email confirmation is already disabled, so the no-session branch
was code-reviewed but not exercised live. No Auth configuration was changed to force
a result. The HTTP test does not verify hydrated browser interactions or visual
layout. Deployment, email-delivery configuration and Profile onboarding remain deferred.
An initial start attempted before build completion failed due to the absent generated
manifest; after the build finished, the production server and smoke test passed.

npm retains the existing optional `unrs-resolver` pending install-script warning;
lint/build work without approving it. Git may report LF-to-CRLF normalization notices
under the repository's Windows Git configuration. No staging, commit or push performed.
