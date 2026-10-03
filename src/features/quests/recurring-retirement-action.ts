"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { UUID } from "./create-pending";
import type { QuestManagementState, QuestManagementReason } from "./management-action";
import { retireRecurringQuest } from "./recurring-retirement-data";

export async function manageRecurringQuest(_previous: QuestManagementState, form: FormData): Promise<QuestManagementState> {
  const user = await requireUser();
  const operation = form.get("operation"), command = form.get("command_id"), quest = form.get("quest_id"), mode = form.get("mode");
  if (form.get("expected_account") !== user.id) return { outcome: "rejected", operation: "archive", reason: "account" };
  if ((operation !== "archive" && operation !== "restore" && operation !== "delete") ||
      typeof command !== "string" || !UUID.test(command) || typeof quest !== "string" || !UUID.test(quest) ||
      (mode !== "new" && mode !== "retry")) return { outcome: "rejected", operation: "archive", reason: "validation" };
  try {
    const receipt = await retireRecurringQuest(command, quest, operation);
    for (const path of ["/dashboard", "/calendar", "/goals"]) revalidatePath(path);
    return { outcome: "success", operation, replay: receipt.replay };
  } catch (error) {
    let reason: QuestManagementReason | undefined;
    // A current rejection never proves that an earlier uncertain attempt did not commit.
    if (mode === "new" && error && typeof error === "object" && "code" in error && "message" in error) {
      if (error.code === "23514" && error.message === "Recurring Quest is permanently deleted") reason = "deleted";
      if (error.code === "23505") reason = "conflict";
      if (error.code === "P0002" || (error.code === "23514" && [
        "Archive recurring Quest before permanent deletion", "Recurring retirement requires a recurring Quest and rule",
      ].includes(String(error.message)))) reason = "stale";
    }
    return reason ? { outcome: "rejected", operation, reason } : { outcome: "unknown", operation };
  }
}
