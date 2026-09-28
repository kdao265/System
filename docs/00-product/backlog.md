# Product backlog

Capture ideas here without automatically adding them to V1. The Product Owner decides priority and scope; promotion requires a linked issue or requirement and an explicit scope update.

| ID | Idea / problem | Module | Value | Status | Decision / requirement link |
| --- | --- | --- | --- | --- | --- |
| IDEA-001 | Evaluate a Notion integration | Integrations | Connect selected external workflows | Captured; future | Boundary in [integrations](../02-architecture/integrations.md); behavior undecided |
| IDEA-002 | Define later CV, portfolio and application reuse workflows | Evidence Vault | Reuse retained achievement evidence | Captured; future | Output format and workflow undecided |
| IDEA-003 | Update the Completion Recovery V2 wire harness migration set | Completion Recovery V2 | Keep the on-demand migration-ten integration harness runnable | Captured; future | [quest-completion-resolution-wire.mjs](../../supabase/tests/quest-completion-resolution-wire.mjs) asserts exactly migrations one to ten and copies all of `supabase/migrations`; stale since migration eleven, needs the private-owner stages excluded. Not part of CI or [testing.md](../04-development/testing.md) |

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
