# SYSTEM operator authorization — V1

Status: Approved direction and V1 contract, documentation only. No schema, SQL, grants, commands or bootstrap data are implemented by this document.

Sources: [project context](../PROJECT_CONTEXT.md), [architecture](overview.md), [Level/reward requirements](../01-requirements/level-rewards.md), [Level/reward domain](level-reward-domain-model.md), [Level/reward physical design](level-reward-database-schema.md), [Player/EXP boundary](player-exp-database-schema.md#7-rls-grants-and-routine-boundary) and [Quest security boundary](quest-database-schema.md).

## 1. Decision and scope

**ADR-OA-01 — Private operator capabilities. Status: Accepted, per Product Owner direction.** Identity remains `system_internal.request_user_id()`; authorization comes from current SYSTEM-owned capability data. V1 defines only `level_policy_assign`. A new capability requires its own reviewed operation/privilege contract; no organizations, teams, groups, role hierarchy, inheritance or general ACL engine is introduced.

This closes the Level Policy assignment authorization gap without changing Level, reward, Quest or EXP semantics. Alternatives rejected are Profile `is_admin`, authoritative JWT/app_metadata roles, treating a command role or integration channel as an administrator, and application service-role/BYPASSRLS access. Private capability data separates authorization from identity and permits database-state revocation without waiting for token refresh.

This task creates this contract and minimal cross-references only. Later implementation must verify the acceptance cases below. No migration, SQL edit, application change, remote access, staging, commit or push belongs to this task.

## 2. Caller identity

Resolve the actor only through `system_internal.request_user_id()`, which reads the authenticated request's JWT subject. Missing/empty identity is unauthorized; an invalid UUID fails closed under the existing helper contract. An Auth UUID identifies a caller but grants no administrative authority by itself.

The authenticated gateway/controlled command establishes request context. Browser input, a target `user_id`, channel labels, AI tool arguments or caller-supplied actor fields cannot replace that identity. No custom command role requires direct `auth.uid()` execution or managed-auth schema access.

## 3. Private grant record

Use `system_internal.operator_grants`, outside Data API schema exposure. It is authorization state, not public user/profile data. The minimal physical contract is:

| Field | Type and meaning |
| --- | --- |
| `id` | UUID primary key, database-generated grant identity |
| `user_id` | Required UUID referencing the Auth user receiving the capability |
| `capability` | Required text; closed V1 value `level_policy_assign` |
| `granted_at` | Required server-generated timezone-aware grant timestamp |
| `revoked_at` | Nullable server-generated timezone-aware revocation timestamp; null means active |

Use an Auth FK with DELETE RESTRICT and UPDATE RESTRICT. Retained grant history, including revoked grants, prevents silent Auth deletion; it neither cascades nor nulls ownership. No Profile dependency or administrator flag is added. Capability state is not copied to Auth metadata or a token.

Enforce at most one active grant per `(user_id, capability)` with partial uniqueness where `revoked_at` is null. Duplicate active insertion rejects. Revocation makes the existing grant inactive while preserving its identity, recipient, capability and grant time. Regranting after revocation inserts a new grant row; never clear a prior revocation. A revocation time cannot precede its grant time. Repeated revocation leaves the original revocation timestamp intact.

Grant identity, user, capability and grant time are immutable after insertion. Only the trusted administrative path may change `revoked_at` from null to the current server time. No normal hard-delete, TRUNCATE, historical rewrite, expiration schedule or application repair API is provided. Privileges and guards must enforce these rules. Database-administrator emergency repair remains a separately reviewed operational matter.

## 4. Bootstrap and grant management

A fresh deployment has **zero operator grants**. Schema migration creates no recipient grant, embeds no user UUID, promotes neither the first signup nor existing users, and infers nothing from Profile or JWT/app_metadata. Policy seeding and operator bootstrap are separate from owner policy assignment.

For V1, a separately trusted database administrator explicitly selects an existing Auth identity and inserts its `level_policy_assign` grant through an administrative database operation outside normal application/browser flows. The same trusted path performs revocation and later regranting. This is **data bootstrap**, not per-installation schema customization. No new application credential, exposed grant-management endpoint or service-role workflow is prescribed.

Holding `level_policy_assign` does not permit granting, revoking or managing capabilities. The first operator therefore cannot bootstrap additional operators through assignment commands. Administrative UI and delegated grant management are future work requiring their own protected boundary, not implied V1 permissions.

## 5. Capability check and execution privileges

Define private `system_internal.has_capability(capability text)`, returning a boolean. It has no user-ID parameter. It resolves the current actor through `request_user_id()` and checks for that actor's active database grant. Missing identity, missing/revoked grant, null capability or an unsupported capability returns false. Invalid request UUID fails closed. Use a fixed safe search path, qualified references, no dynamic SQL and no cached/JWT authorization result.

The helper executes as **SECURITY INVOKER** inside the future controlled assignment command. It is not a browser-readable authorization directory. Revoke default PUBLIC execution; no direct browser, anon, integration or service-role EXECUTE/grant-table access is supplied. A successful check means only that the actor may request the specified operation; all policy, target, idempotency and transaction validations still apply.

Freeze a narrowly scoped non-login executor role, `level_policy_assignment_owner`, for that future assignment command. It is non-superuser, NOBYPASSRLS and not a table owner. Do not grant its membership to authenticated, anon, authenticator, service_role, quest_command_owner or progression_command_owner. Its ability to execute the command is not itself a capability grant to an Auth actor.

Enable RLS on the grant table. This executor receives only private schema USAGE, request-identity/capability helper EXECUTE and grant-table SELECT. Its grant-table SELECT policy requires a nonnull request identity equal to `operator_grants.user_id`; the capability check then restricts capability and active status. The grant-table policy must not call `has_capability()` recursively. It receives no grant-table INSERT/UPDATE/DELETE/TRUNCATE, schema CREATE, table ownership or role-administration powers. Ordinary authenticated users receive no grant-table SELECT or mutations.

The future exposed assignment command may use SECURITY DEFINER owned by this limited executor, following the existing SYSTEM command pattern, with fixed search path, qualified references and explicit EXECUTE grants. This permits controlled cross-owner work while keeping direct table writes closed and RLS active. The helper itself requires no definer escalation or access to the managed Auth schema.

For assignment execution only, future role-specific RLS policies permit the necessary published-policy reads, target EXP/assignment/milestone/definition/configuration-evidence reads and assignment/milestone/unlock inserts **only when the current actor has active `level_policy_assign`**. The command must restrict every operation to its validated target owner and the assignment-derived effects. These policies are separate from ordinary owner policies. Do not replace owner predicates, grant general reward mutation, expose arbitrary table reads, or give the executor EXP writes, redemption insertion or history mutation. Existing `progression_command_owner` and `quest_command_owner` retain their separate roles; neither becomes an administrator.

## 6. Assignment command contract

The future assignment command requires both authenticated actor identity and active `level_policy_assign`. The target Auth owner is a separately validated command argument, not the request actor. The operator may assign themselves or another owner only through this command; a normal user cannot assign even themselves. No automatic enrollment is introduced for current or future users.

In the same transaction, resolve the actor, acquire the existing progression lock for the target owner, then check capability against current committed database state before accessing/disclosing target history or changing it. Use the documented fresh-statement READ COMMITTED discipline after waiting for the lock. Reject unauthorized requests without exposing another owner's records.

After authorization, preserve all existing assignment rules: published policy only; stable command ID; latest owner assignment sequence; same-command/same-policy replay; conflicting reuse rejection; exact derived EXP; atomic assignment, first-reached milestones and eligible reward unlocks; retained history across reversals/reassignment. Record the actual request actor and verified origin in assignment history. Do not substitute the target owner as operator or accept an arbitrary claimed actor. Replays also require current capability before returning a cross-owner receipt.

### Revocation boundary

Authorization is evaluated from current database state inside each command, never a stale token or a previously cached check. A revocation committed before that authorization statement denies the operation. Missing grants behave the same way. A command authorized before a concurrent revocation may finish; revocation does not retroactively cancel an in-flight transaction or reverse accepted assignments, milestones or unlocks. Any later RLS denial aborts the whole command, never a partial assignment. Every subsequent command/replay must check again. This states the concurrency boundary without promising instantaneous cancellation of already-authorized work.

## 7. AI and integration callers

Web UI, web assistant, Telegram, n8n and mobile use the same future assignment command and the authority of the authenticated actor represented by request context. Calling the application layer, selecting an `internal` origin or being an automation confers no capability. Origin remains verified attribution only. No direct table-write or service-role shortcut is permitted. Future delegated credentials and confirmation UX remain separate work.

## 8. Frozen decisions and verification

| Question | V1 decision |
| --- | --- |
| 1. What identifies the caller? | `system_internal.request_user_id()` |
| 2. What authorizes assignment? | Active `level_policy_assign` grant for that actor |
| 3. Where is authorization stored? | Private `system_internal.operator_grants` |
| 4. Automatic capability for authenticated users? | None, including first signup and existing users |
| 5. Cross-owner assignment? | Allowed only through capability-checked assignment command |
| 6. First operator bootstrap? | Explicit trusted database-administrator data operation |
| 7. Revocation? | One-way server timestamp on the grant; subsequent checks deny |
| 8. Revoked grant history? | Retained, immutable except initial revocation; regrant creates a new row |
| 9. JWT/app_metadata authoritative? | No; JWT identifies actor, database grants authorize |
| 10. Profile administrator state? | None; no `is_admin` |
| 11. Browser grant mutations? | Forbidden, including for capability holders |
| 12. Future command check? | Private invoker helper under the restricted assignment executor, inside the transaction |
| 13. AI/integration authority? | Authenticated actor's active capability only |
| 14. Policy assignment explicit? | Yes; neither policy publication nor grant bootstrap enrolls users |

Later database tests must verify zero bootstrap grants; no default promotion; missing/invalid identity denial; unknown/revoked capability denial; duplicate-active rejection; retained revoked history and restrictive Auth deletion; blocked client grant reads/writes and role membership; successful authorized cross-owner assignment; rejected unauthorized self/cross-owner assignment; actor/target distinction; unchanged ordinary owner isolation; no mutation powers on grants/EXP for the assignment executor; retry/revocation behavior; and atomic rollback of failed assignment effects. Tests are specified here, not run by this documentation task.

This contract resolves the operator authorization blocker for Level/Reward migration preparation. It authorizes no actual bootstrap operation, deployment or public command enablement in this task. The seven Level/Reward domain responsibilities remain unchanged; the private capability relation is SYSTEM security infrastructure, not an additional Player identity or reward domain.
