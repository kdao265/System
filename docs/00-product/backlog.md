# Product backlog

Capture ideas here without automatically adding them to V1. The Product Owner decides priority and scope; promotion requires a linked issue or requirement and an explicit scope update.

| ID | Idea / problem | Module | Value | Status | Decision / requirement link |
| --- | --- | --- | --- | --- | --- |
| IDEA-001 | Evaluate a Notion integration | Integrations | Connect selected external workflows | Captured; future | Boundary in [integrations](../02-architecture/integrations.md); behavior undecided |
| IDEA-002 | Define later CV, portfolio and application reuse workflows | Evidence Vault | Reuse retained achievement evidence | Captured; future | Output format and workflow undecided |
| IDEA-003 | Update the Completion Recovery V2 wire harness migration set | Completion Recovery V2 | Keep the on-demand migration-ten integration harness runnable | Captured; future | [quest-completion-resolution-wire.mjs](../../supabase/tests/quest-completion-resolution-wire.mjs) asserts exactly migrations one to ten and copies all of `supabase/migrations`; stale since migration eleven, needs the private-owner stages excluded. Not part of CI or [testing.md](../04-development/testing.md) |
| IDEA-004 | Initial dashboard navigation feedback preserving HTTP Auth/Profile/EXP redirects | Dashboard | Explain slow initial reads without changing session behavior | Deferred | [PR #38 audit and constraints](../04-development/daily-use-hardening-v1.md) |
| IDEA-005 | Physical Android/iOS install, keyboard and safe-area verification | PWA / QA | Validate behavior beyond Chromium phone emulation | Deferred; requires devices | [PR #38 limitations](../04-development/daily-use-hardening-v1.md) |
| IDEA-006 | Surface recurring Quest creation, pause/resume and day materialization in the app | Quest Engine | Make the recurrence contract reachable by the owner | Resolved in PR #39 working tree; validated 2026-09-29 | [ADR-018](../02-architecture/decisions.md) and [implementation/validation](../04-development/recurring-quests-v1.md). Existing create form, additive v3 recovery with v2 compatibility, server materialization and Dashboard pause/resume are implemented; no deployment performed |

## Entry format

- ID and short title:
- Problem / intended value:
- Module:
- Proposed idea:
- Constraints / dependencies:
- Status: captured / investigating / accepted / deferred / declined.
- Product Owner decision and date:
- Linked issue, requirement, and scope update if accepted:

An accepted idea is not automatically a V1 commitment; record its target scope explicitly.
