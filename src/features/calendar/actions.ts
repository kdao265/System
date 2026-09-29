"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { UUID } from "@/features/quests/create-pending";
import { eventArguments, type EventRequest, type EventResult } from "./model";

export async function saveScheduleEvent(input: EventRequest): Promise<EventResult> {
  const { user, profile } = await getProfileContext();
  if (!input || input.userId !== user.id || !UUID.test(input.eventId) ||
      !["create", "update", "remove"].includes(input.mode)) {
    return { outcome: "rejected", message: "Your account or event changed. Refresh before continuing." };
  }
  if (!isOnboardingComplete(profile) || profile!.timezone !== input.timezone) {
    return { outcome: "rejected", message: "Your Profile timezone changed or is unavailable. Refresh before continuing." };
  }
  const prepared = eventArguments(input.draft, profile!.timezone!, input.eventId);
  if (input.mode !== "remove" && prepared.error) return { outcome: "rejected", message: prepared.error };
  try {
    const client = await createServerSupabaseClient();
    const name = input.mode === "remove" ? "delete_schedule_event" : input.mode === "create" ? "create_schedule_event" : "update_schedule_event";
    const { data, error } = await client.rpc(name, input.mode === "remove" ? { p_event_id: input.eventId } : prepared.args!);
    if (error) {
      if (["22023", "23514", "23505", "PZ001", "PZ002", "42501"].includes(error.code)) {
        return { outcome: "rejected", message: "The event could not be saved. Check its dates and refresh if it was removed or your session changed." };
      }
      return { outcome: "unknown", message: "The outcome is unknown. Retry the saved request before leaving this page." };
    }
    if (input.mode === "remove" ? typeof data !== "boolean" : !data || data.event_id !== input.eventId) {
      return { outcome: "unknown", message: "The outcome is unknown. Retry the saved request before leaving this page." };
    }
    revalidatePath("/calendar");
    return { outcome: "success", message: input.mode === "remove" ? "Event removed." : "Event saved." };
  } catch (error) {
    unstable_rethrow(error);
    return { outcome: "unknown", message: "The outcome is unknown. Retry the saved request before leaving this page." };
  }
}
