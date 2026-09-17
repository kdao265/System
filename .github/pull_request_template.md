## Summary

Describe the problem and resulting behavior or documentation outcome.

## Related issue

Link the issue, requirements and relevant ADRs.

## Changes

- List focused changes and affected modules.

## Screenshots

Attach relevant before/after UI images or state Not applicable. Remove sensitive information.

## Tests

List actual checks and results, manual verification, and unavailable checks. Include a Vercel preview link when available.

## Database changes

State None or describe schema/migration/RLS changes, validation and rollback considerations.

## Environment-variable changes

State None or list variable names and setup requirements. Never include secret values.

## Checklist

- [ ] Scope matches the issue and requirements; unrelated changes are excluded.
- [ ] Relevant documentation is updated; architecture changes have an agreed ADR.
- [ ] Business rules remain outside UI components and requirement systems remain data-driven.
- [ ] No secrets are exposed and Supabase RLS is not bypassed.
- [ ] New dependencies, if any, have documented justification.
- [ ] Available lint/typecheck/tests appropriate to the change were run; unavailable checks are explained.
- [ ] Complete diff, including new files, was inspected.
- [ ] QA/review is complete and Vercel preview was checked when available.
- [ ] The change preserves deployability of main.

## Known limitations

List unresolved problems, assumptions and deferred work, or state None. Explain any checklist item that does not apply.
