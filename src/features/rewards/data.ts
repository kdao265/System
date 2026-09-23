import { unstable_rethrow } from "next/navigation";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSessionFailure } from "@/features/progression/numbers";
import { parseRewards, REWARD_PROJECTION, type RewardsResult } from "./model";

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code : undefined;
}

async function readFailure(error: unknown): Promise<RewardsResult> {
  const code = errorCode(error);

  if (isAuthSessionMissingError(error) || isSessionFailure(error) ||
      ["42501", "PGRST301", "PGRST302", "PGRST303"].includes(String(code))) {
    // An RPC permission error does not establish session expiry. Recheck Auth
    // without the render cache, using the same client as the existing SSR flow.
    try {
      const supabase = await createServerSupabaseClient(true);
      const { data, error: authError } = await supabase.auth.getUser();
      if ((!authError && !data.user) || isAuthSessionMissingError(authError) || isSessionFailure(authError)) {
        return { status: "session-expired" };
      }
    } catch (caught) {
      unstable_rethrow(caught);
      if (isAuthSessionMissingError(caught) || isSessionFailure(caught)) return { status: "session-expired" };
    }
  }
  return { status: "unavailable" };
}

/** Server-rendered feature boundary. No privileged client, cross-user cache or writes. */
export async function getRewards(): Promise<RewardsResult> {
  try {
    // The shared cached helper also returns null for transient Auth errors.
    // Verify freshly before offering expiry recovery; never issue an anonymous RPC.
    if (!await getAuthenticatedUser()) return readFailure({ code: "42501" });
    const supabase = await createServerSupabaseClient(true);
    // Default public schema; identity and lifecycle remain owned by SQL.
    const { data, error } = await supabase.rpc("list_level_rewards").select(REWARD_PROJECTION);
    return error ? readFailure(error) : parseRewards(data);
  } catch (caught) {
    unstable_rethrow(caught);
    return readFailure(caught);
  }
}

