"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { UUID } from "./create-pending";
import { reopenQuestOccurrence } from "./reopen-data";

export type ReopenState =
  | { outcome: "success"; success: { message: string; replay: boolean }; refreshRequired: boolean }
  | { outcome: "rejected"; error: string; reason: "account" | "validation" | "stale" | "conflict"; refreshRequired: boolean }
  | { outcome: "unknown"; error: string };
export async function reopenQuest(_previous: unknown, formData: FormData): Promise<ReopenState> {
  const user = await requireUser();
  if (formData.get("expected_account") !== user.id) return { outcome: "rejected", reason: "account", refreshRequired: false, error: "Your signed-in account changed. Refresh before continuing." };
  const commandId = formData.get("command_id"); const occurrenceId = formData.get("occurrence_id"); const cycle = formData.get("execution_cycle");
  if (typeof commandId !== "string" || !UUID.test(commandId) || typeof occurrenceId !== "string" || !UUID.test(occurrenceId) || typeof cycle !== "string" || !/^[1-9][0-9]*$/.test(cycle) || Number(cycle) > 2147483647) return { outcome: "rejected", reason: "validation", refreshRequired: false, error: "The reopen request is invalid. Refresh Daily Quests and try again." };
  try {
    const receipt = await reopenQuestOccurrence(commandId, occurrenceId, Number(cycle)); let refreshRequired = false;
    try { revalidatePath("/dashboard"); } catch { refreshRequired = true; }
    return { outcome: "success", refreshRequired, success: { replay: receipt.replay, message: receipt.replay ? "Reopen confirmed from an earlier request." : "Quest reopened." } };
  } catch (error) {
    // These exact pairs are raised by V2 before mutation. Other constraints and
    // receipt-integrity errors with the same SQLSTATE do not prove this outcome.
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      if (error.code === "23514" && error.message === "Stale quest reopen cycle") return { outcome: "rejected", reason: "stale", refreshRequired: true, error: "This Quest changed before reopen. A fresh Dashboard read is required." };
      if (error.code === "23505" && error.message === "Conflicting quest command reuse") return { outcome: "rejected", reason: "conflict", refreshRequired: false, error: "This reopen command conflicts with recorded history. Its request is preserved for reconciliation; identical retries are blocked." };
    }
    return { outcome: "unknown", error: "The reopen outcome is unknown. Retry the exact saved request to confirm it." };
  }
}
