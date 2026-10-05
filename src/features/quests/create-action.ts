"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { getProfileContext } from "@/features/profile/session";
import { isSupportedTimezone } from "@/features/profile/timezones";
import { createOneOffQuest } from "./create-data";
import { validateQuestCreationRequest } from "./create-model";
import { validateRecurringRequestV3, validateRecurringRequestV4 } from "./recurring-model";
import { createRecurringQuest, createRecurringQuestV2 } from "./recurring-data";
import { UUID } from "./create-pending";
import { oneOffCreationSuccess, type OneOffCreationSuccess } from "./create-message";

export type QuestCreationErrorCode =
  | "account_changed"
  | "invalid_details"
  | "timezone_changed"
  | "outcome_unknown"
  | "transport_unknown";

export type QuestCreationSuccess =
  | OneOffCreationSuccess
  | {
      kind: "recurring_created";
      replay: boolean;
    };

export type QuestCreationState = {
  outcome: "success" | "rejected" | "unknown";
  error?: QuestCreationErrorCode;
  reason?: "account" | "timezone" | "validation";
  currentTimezone?: string;
  success?: QuestCreationSuccess;
};

export async function createQuest(_previous: unknown, formData: FormData): Promise<QuestCreationState> {
  const user = await requireUser();
  // This is a consistency check, never an owner argument to SQL.
  if (formData.get("expected_account") !== user.id) {
    return { outcome: "rejected", reason: "account", error: "account_changed" };
  }
  const commandId = formData.get("command_id");
  const timezone = formData.get("timezone");
  const mode = formData.get("mode");
  const pendingVersion = Number(formData.get("pending_version"));
  let request: unknown;
  try {
    const raw = formData.get("request_json");
    request = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch { request = null; }
  // Each pending record dispatches to the exact command contract that created it.
  // A frozen v2/v3 record is never translated into a newer request shape.
  const validRequest = pendingVersion === 2 ? validateQuestCreationRequest(request)
    : pendingVersion === 3 ? validateRecurringRequestV3(request)
    : pendingVersion === 4 ? validateRecurringRequestV4(request) : false;
  if (typeof commandId !== "string" || !UUID.test(commandId) ||
      !isSupportedTimezone(timezone) || (mode !== "new" && mode !== "retry") || !validRequest) {
    return { outcome: "rejected", reason: "validation", error: "invalid_details" };
  }
  const { profile } = await getProfileContext();
  if (mode === "new" && (!isSupportedTimezone(profile?.timezone) || timezone !== profile.timezone)) {
    return { outcome: "rejected", reason: "timezone",
      currentTimezone: isSupportedTimezone(profile?.timezone) ? profile.timezone : undefined,
      error: "timezone_changed" };
  }
  // Retry one-off instants and recurring calendar dates exactly as submitted.
  // Future recurring slots use the current Profile timezone, as defined by SQL.
  try {
    if (pendingVersion !== 2) {
      const receipt = pendingVersion === 4
        ? await createRecurringQuestV2(commandId, request as Parameters<typeof createRecurringQuestV2>[1])
        : await createRecurringQuest(commandId, request as Parameters<typeof createRecurringQuest>[1]);
      revalidatePath("/dashboard");
      return {
        outcome: "success",
        success: {
          kind: "recurring_created",
          replay: receipt.replay,
        },
      };
    }
    const receipt = await createOneOffQuest(commandId, request as Parameters<typeof createOneOffQuest>[1]);
    revalidatePath("/dashboard");
    const displayTimezone = isSupportedTimezone(profile?.timezone) ? profile.timezone : timezone;
    return {
      outcome: "success",
      success: oneOffCreationSuccess(receipt, displayTimezone),
    };
  } catch {
    // Even a returned RPC error on a retry says nothing about an earlier commit.
    return { outcome: "unknown", error: "outcome_unknown" };
  }
}
