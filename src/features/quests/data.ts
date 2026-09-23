import { unstable_rethrow } from "next/navigation";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSessionFailure } from "@/features/progression/numbers";
import { parseDayQuests, type DayQuestResult } from "./model";

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code : undefined;
}

async function readFailure(error: unknown): Promise<DayQuestResult> {
  const code = errorCode(error);
  if (code === "PZ001") return { status: "timezone-required" };
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
export async function getDayQuests(selectedDate: string): Promise<DayQuestResult> {
  try {
    if (!await getAuthenticatedUser()) return { status: "session-expired" };
    const supabase = await createServerSupabaseClient(true);
    const { data, error } = await supabase.rpc("list_day_quest_occurrences", { p_day: selectedDate });
    return error ? readFailure(error) : parseDayQuests(data);
  } catch (caught) {
    unstable_rethrow(caught);
    return readFailure(caught);
  }
}
