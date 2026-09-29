"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { getProfileContext } from "@/features/profile/session";
import { isSupportedTimezone } from "@/features/profile/timezones";
import { createOneOffQuest } from "./create-data";
import { validateCreationRequest, isRecurring } from "./recurring-model";
import { createRecurringQuest } from "./recurring-data";
import { UUID } from "./create-pending";
import { creationSuccessMessage } from "./create-message";

export type QuestCreationState = {
  outcome: "success" | "rejected" | "unknown";
  error?: string;
  reason?: "account" | "timezone" | "validation";
  currentTimezone?: string;
  success?: { message: string; replay: boolean };
};

export async function createQuest(_previous: unknown, formData: FormData): Promise<QuestCreationState> {
  const user = await requireUser();
  // This is a consistency check, never an owner argument to SQL.
  if (formData.get("expected_account") !== user.id) {
    return { outcome: "rejected", reason: "account", error: "Your signed-in account changed. Refresh before continuing." };
  }
  const commandId = formData.get("command_id");
  const timezone = formData.get("timezone");
  const mode = formData.get("mode");
  let request: unknown;
  try {
    const raw = formData.get("request_json");
    request = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch { request = null; }
  if (typeof commandId !== "string" || !UUID.test(commandId) ||
      !isSupportedTimezone(timezone) || (mode !== "new" && mode !== "retry") ||
      !validateCreationRequest(request)) {
    return { outcome: "rejected", reason: "validation", error: "The Quest details are invalid. Review the form and try again." };
  }
  const { profile } = await getProfileContext();
  if (mode === "new" && (!isSupportedTimezone(profile?.timezone) || timezone !== profile.timezone)) {
    return { outcome: "rejected", reason: "timezone",
      currentTimezone: isSupportedTimezone(profile?.timezone) ? profile.timezone : undefined,
      error: "Your Profile timezone changed. Review the original timing before using the current Profile timezone." };
  }
  // Retry one-off instants and recurring calendar dates exactly as submitted.
  // Future recurring slots use the current Profile timezone, as defined by SQL.
  try {
    if (isRecurring(request)) {
      const receipt = await createRecurringQuest(commandId, request);
      revalidatePath("/dashboard");
      return { outcome: "success", success: { replay: receipt.replay,
        message: "Recurring Quest created. Eligible occurrences appear when you view their day, using your current Profile timezone." } };
    }
    const receipt = await createOneOffQuest(commandId, request);
    revalidatePath("/dashboard");
    const displayTimezone = isSupportedTimezone(profile?.timezone) ? profile.timezone : timezone;
    return { outcome: "success", success: {
      message: creationSuccessMessage(receipt, displayTimezone),
      replay: receipt.replay,
    } };
  } catch {
    // Even a returned RPC error on a retry says nothing about an earlier commit.
    return { outcome: "unknown", error: "The creation outcome is unknown. Retry the exact saved request to confirm it." };
  }
}
