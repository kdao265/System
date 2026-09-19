# SYSTEM operator authorization — V1

Status: Approved direction and V1 contract, documentation only. No schema, SQL, grants, commands or bootstrap data are implemented by this document.

Sources: [project context](../PROJECT_CONTEXT.md), [architecture](overview.md), [Level/reward requirements](../01-requirements/level-rewards.md), [Level/reward domain](level-reward-domain-model.md), [Level/reward physical design](level-reward-database-schema.md), [Player/EXP boundary](player-exp-database-schema.md#7-rls-grants-and-routine-boundary) and [Quest security boundary](quest-database-schema.md).

## 1. Decision and scope

**ADR-OA-01 — Private operator capabilities. Status: Accepted, per Product Owner direction.** Identity remains `system_internal.request_user_id()`; authorization comes from current SYSTEM-owned capability data. V1 defines only `level_policy_assign`. A new capability requires its own reviewed operation/privilege contract; no organizations, teams, groups, role hierarchy, inheritance or general ACL engine is introduced.

The approved executor decision below distinguishes internal cross-owner assignment privileges from caller-facing access and preserves atomic assignment-time progression recognition. Alternatives rejected are Profile `is_admin`, authoritative JWT/app_metadata roles, treating a command role or integration channel as an administrator, and application service-role/BYPASSRLS access. Private capability data separates authorization from identity and permits database-state revocation without waiting for token refresh.

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

**Approved executor boundary:** one `SECURITY DEFINER` assignment command, conceptually `assign_level_policy(target_user_id, policy_id, command_id, ...)`, is owned by `level_policy_assignment_owner`. The role owns the routine, not any table. Use a fixed safe search path, qualified references, static statements and explicit EXECUTE grants. Revoke PUBLIC/anon/service-role execution; authenticated callers receive only command EXECUTE when the command is enabled. They cannot SET ROLE into its owner, inherit its table permissions, or supply arbitrary statements, identifiers, filters or return projections. No caller-settable target session variable/GUC or other target-session state is used.

| Object | Exact executor privileges and RLS scope |
| --- | --- |
| `public.progression_policy_assignments` | SELECT and INSERT only. Dedicated policies applying only to `level_policy_assignment_owner` permit cross-owner assignment rows internally. No UPDATE is needed for append-only history; no DELETE/TRUNCATE. Every command query and inserted `user_id` is explicitly bound to its validated `target_user_id` |
| `public.level_policies`, `public.level_thresholds` | SELECT only, restricted to published policies and their thresholds, for policy validation and progression evaluation; no configuration mutation |
| `public.exp_ledger` | SELECT only to derive the validated target's exact authoritative EXP; no INSERT/UPDATE/DELETE/TRUNCATE |
| `public.level_milestones`, `public.level_reward_unlocks` | SELECT and INSERT only for the validated target's existing history, missing reached-Level milestones and newly eligible immutable unlocks; no history mutation |
| `public.level_reward_definitions` | SELECT only for applicable target definitions; no definition mutation |
| `public.level_reward_events` | SELECT only of target configured/updated/archived configuration evidence required to validate unlock snapshots and their `definition_event_id`; no redemption reads or event writes |
| `system_internal.operator_grants` | SELECT only under the actor-equality policy above; no cross-owner grant reads or grant management |
| Schemas and routines | USAGE on `public` and `system_internal`; EXECUTE on `request_user_id()` and `has_capability(text)`; no schema CREATE or managed-auth schema privileges |

This is an intentional internal privilege boundary: dedicated policies applying only to `level_policy_assignment_owner` permit the enumerated cross-owner SELECT/INSERT operations internally; they do not themselves authorize a caller. The command must check the actual actor's active capability before accessing any target history. No policy applicable to authenticated callers means “has capability, therefore access every owner's rows.” Ordinary owner RLS stays unchanged. The isolated executor's assignment and recognition privileges are not an application-facing arbitrary read/write API. “No arbitrary cross-owner reads” means no such access exposed to callers and no privileges outside the enumerated assignment-command scope. Every owner-scoped read and insert, including recognition and snapshot validation, explicitly restricts `user_id = target_user_id`.

The executor receives no EXP INSERT/UPDATE/DELETE/TRUNCATE authority and cannot mint or reverse EXP. It cannot redeem rewards, edit definitions, mutate retained history, manage operator grants or perform unrelated cross-owner operations. It receives no service_role membership, BYPASSRLS, Auth schema privileges or role administration. Do not add indirect privileged helpers to evade these restrictions. Existing `progression_command_owner` and `quest_command_owner` retain their separate roles; neither becomes an administrator.

## 6. Assignment command contract

The future assignment command requires both authenticated actor identity and active `level_policy_assign`. The target Auth owner is a separately validated command argument, not the request actor. The operator may assign themselves or another owner only through this command; a normal user cannot assign even themselves. No automatic enrollment is introduced for current or future users.

In the same transaction, resolve the actual actor from `request_user_id()` and reject null/invalid identity. Require active capability before target access, validate the published policy and nonnull UUID target, and acquire the existing progression lock for that target owner. Recheck capability against a fresh committed statement snapshot after waiting for the lock, before target-history access or mutation. The target's Auth existence is enforced by the assignment's restrictive Auth FK, without SELECT privileges on `auth.users`. Reject unauthorized requests without exposing another owner's records.

The validated target is a routine argument retained in local command scope. Every owner-specific SELECT and INSERT explicitly restricts `user_id` to that target; there are no assignment UPDATE operations. Request identity remains the actual actor throughout. The caller can request a target but cannot bypass capability validation, replace the actor, alter the routine body, assume its role or cause a statement to address a different target. Only the target's assignment receipt is returned, with no arbitrary row-query interface. Record actual actor and target separately, with verified origin.

Preserve published-policy validation, stable command ID, latest owner assignment sequence, same-command/same-policy replay and conflicting reuse rejection. Replays require current capability before returning a target receipt. The approval does not authorize fabricated evaluated EXP, automatic enrollment, historical repair or a new recognition trigger.

**Approved atomic recognition:** under the target owner lock and fresh-statement snapshot discipline, derive that target's exact EXP, read its current assignment and retained milestones/unlocks, validate the requested published policy, and record the new assignment with historical `evaluated_exp`. Insert every missing reached-Level milestone and newly eligible immutable reward unlock from applicable target definitions and retained configuration evidence. All effects commit in the SAME transaction as assignment; any failure rolls back all effects. Initial assignment recognizes current-state thresholds including the baseline, not pre-policy historical peaks. Reassignment retains prior history and recognizes only missing milestones/unlocks. Record the actual actor separately from the target in assignment and milestone attribution. A later EXP reversal may reduce current Level but never removes milestones or unlocks. This resolves the prior assignment-recognition conflict without deferring recognition or changing reward-event semantics.

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

The executor privilege and assignment-recognition decisions are resolved by sections 5–6. No blocker remains from this authorization contract for Level/Reward migration preparation. This contract authorizes no actual bootstrap operation, deployment or public command enablement. The private capability relation remains SYSTEM security infrastructure, not an additional Player identity or reward domain.
