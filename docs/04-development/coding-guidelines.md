# Coding guidelines

- Read context, relevant requirements and accepted ADRs before implementation. Inspect existing code and follow established conventions.
- Use the intended Next.js / TypeScript / Tailwind stack when implementation begins; versions and project layout are not selected here.
- Keep business rules, calculations and state transitions outside UI components. Use explicit application/domain boundaries for persistence and integrations.
- Preserve distinct Quest, Activity, Criterion and Evidence concepts. Keep EXP separate from money and verified evidence separate from estimates.
- Represent university, scholarship and other requirements as configurable data, not hard-coded UI conditions.
- Validate input at appropriate boundaries and handle errors explicitly. Avoid leaking credentials or personal information in diagnostics.
- Do not bypass Supabase RLS or expose privileged credentials in the client. Propose and review database/access-policy changes separately.
- Make focused changes; avoid unrelated refactoring. Explain a new dependency's purpose, alternatives and cost before adding it, and obey task-specific restrictions.
- Document architectural proposals and secure Product Owner agreement before implementation.
- Update relevant docs when agreed behavior changes and run checks appropriate to the change.

## Repository commands

The application foundation uses `npm run dev`, `npm run lint`, `npm run build` and `npm run start`. The production build includes TypeScript checking; lint is a separate check. No automated test suite is configured yet. See the [root README](../../README.md) for setup and dependency rationale.
