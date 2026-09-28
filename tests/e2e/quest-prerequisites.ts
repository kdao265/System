import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { startAuthEnvironment } from "../helpers/auth-environment.mjs";
import { requireE2ERuntime } from "../helpers/e2e-boundary.mjs";

type DisposableEnvironment = Awaited<ReturnType<typeof startAuthEnvironment>> & { app: string };

/** Approved E2E prerequisite provisioning, never Quest-state or EXP seeding. */
export async function provisionE2ELevelPolicyPrerequisite(environment: DisposableEnvironment) {
  requireE2ERuntime(environment);
  const ownerId = environment.owner.id;
  const grantId = randomUUID();
  const client = createClient(environment.url, environment.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const login = await client.auth.signInWithPassword({
      email: environment.owner.email, password: environment.owner.password,
    });
    assert(!login.error && login.data.user?.id === ownerId, "Disposable prerequisite owner authentication failed");
    const policy = await client.from("level_policies").select("id")
      .eq("policy_key", "level_policy_v1").eq("version", 1).eq("status", "published").single();
    assert(!policy.error && policy.data, "Expected the existing published level_policy_v1");
    const policyId: string = policy.data.id;
    assert.match(policyId, /^[a-f0-9-]{36}$/);
    const request = { target_user_id: ownerId, policy_id: policyId, command_id: randomUUID(), origin: "internal" };

    assert.equal(await environment.sql(`SELECT count(*) FROM system_internal.operator_grants
      WHERE user_id = '${ownerId}' AND revoked_at IS NULL;`), "0", "Prerequisite requires an unprivileged owner");
    try {
      // The existing helper verifies the immutable ID, run labels, mounts and
      // network of its own tmpfs database before either administrative statement.
      await environment.sql(`INSERT INTO system_internal.operator_grants(id, user_id, capability)
        VALUES ('${grantId}', '${ownerId}', 'level_policy_assign');`);
      const assigned = await client.rpc("assign_level_policy", request);
      assert(!assigned.error, "Guarded disposable policy assignment failed");
    } finally {
      // Preallocated ID also covers an INSERT whose response failed after commit.
      // Grant history is immutable: revoke the capability, retain its audit row.
      await environment.sql(`UPDATE system_internal.operator_grants SET revoked_at = now()
        WHERE id = '${grantId}' AND user_id = '${ownerId}'
          AND capability = 'level_policy_assign' AND revoked_at IS NULL;`);
    }

    const proof = JSON.parse(await environment.sql(`SELECT json_build_object(
      'currentPolicy', (SELECT policy_id::text FROM public.progression_policy_assignments
        WHERE user_id = '${ownerId}' ORDER BY assignment_sequence DESC LIMIT 1),
      'assignments', (SELECT count(*) FROM public.progression_policy_assignments WHERE user_id = '${ownerId}'),
      'activeGrants', (SELECT count(*) FROM system_internal.operator_grants WHERE user_id = '${ownerId}' AND revoked_at IS NULL),
      'revokedTemporaryGrant', (SELECT count(*) FROM system_internal.operator_grants WHERE id = '${grantId}' AND revoked_at IS NOT NULL),
      'quests', (SELECT count(*) FROM public.quests WHERE user_id = '${ownerId}'),
      'questEvents', (SELECT count(*) FROM public.quest_events WHERE user_id = '${ownerId}'),
      'expEntries', (SELECT count(*) FROM public.exp_ledger WHERE user_id = '${ownerId}')
    );`));
    assert.deepEqual(proof, {
      currentPolicy: policyId, assignments: 1, activeGrants: 0,
      revokedTemporaryGrant: 1, quests: 0, questEvents: 0, expEntries: 0,
    }, "E2E prerequisite must leave only the policy assignment and no active capability or Quest/EXP state");
    // A still-authenticated owner cannot even replay assignment after revocation.
    const denied = await client.rpc("assign_level_policy", request);
    assert.equal(denied.error?.code, "42501", "Revoked policy-assignment capability must be denied by the real RPC");
    console.log("PASS: E2E policy prerequisite assigned; active grants=0, assignment replay denied, Quest/EXP history empty");
  } finally {
    const logout = await client.auth.signOut({ scope: "local" });
    assert(!logout.error, "Disposable prerequisite session cleanup failed");
  }
}
