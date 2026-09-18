"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupportedTimezone } from "./timezones";

export type ProfileFormState = { error?: string };

export async function saveProfile(_previous: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await requireUser();
  const displayName = formData.get("display_name");
  const timezone = formData.get("timezone");
  if (typeof displayName !== "string") return { error: "Enter a display name or leave it blank." };
  if (!isSupportedTimezone(timezone)) return { error: "Select a valid IANA timezone to continue." };

  try {
    const supabase = await createServerSupabaseClient();
    // Explicit field allowlist; ownership is a server-derived filter, never payload.
    const { data, error } = await supabase.from("profiles")
      .update({ display_name: displayName.trim() || null, timezone })
      .eq("user_id", user.id).select("timezone").maybeSingle();
    if (error) {
      return { error: "Unable to save your profile. Check the timezone selection and try again." };
    }
    if (!data) {
      return { error: "Your profile is unavailable. Ask the administrator to check your account; no profile was created." };
    }
    if (!isSupportedTimezone(data.timezone)) {
      return { error: "Your saved timezone is not supported. Please select another timezone." };
    }
  } catch {
    return { error: "Unable to save your profile right now. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
