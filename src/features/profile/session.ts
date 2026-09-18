import { cache } from "react";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupportedTimezone } from "./timezones";

export type Profile = { display_name: string | null; timezone: string | null };
export type ProfileResult =
  | { profile: Profile; error: null }
  | { profile: null; error: "missing" | "unavailable" };

// Identity comes only from server Auth verification; cache is render-scoped.
export const getProfileContext = cache(async () => {
  const user = await requireUser();
  const supabase = await createServerSupabaseClient(true);
  let result: ProfileResult;
  try {
    const { data, error } = await supabase.from("profiles")
      .select("display_name,timezone").eq("user_id", user.id).maybeSingle();
    result = error ? { profile: null, error: "unavailable" }
      : data ? { profile: data, error: null }
      : { profile: null, error: "missing" };
  } catch {
    result = { profile: null, error: "unavailable" };
  }
  return { user, ...result };
});

export function isOnboardingComplete(profile: Profile | null) {
  // Stored values have passed database validation; also require runtime support.
  return isSupportedTimezone(profile?.timezone);
}

export async function authenticatedDestination() {
  const { profile } = await getProfileContext();
  return isOnboardingComplete(profile) ? "/dashboard" : "/onboarding";
}
