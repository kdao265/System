"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { completeQuestOccurrence } from "./completion-data";
import { UUID } from "./create-pending";

export type CompletionState =
  | { outcome: "success"; success: { message: string; replay: boolean }; refreshRequired: boolean }
  | { outcome: "rejected"; error: string; reason: "account" | "validation" | "stale" }
  | { outcome: "unknown"; error: string };

export async function completeQuest(_previous: unknown, formData: FormData): Promise<CompletionState> {
  const user = await requireUser();
  if (formData.get("expected_account") !== user.id) return { outcome: "rejected", reason: "account", error: "Your signed-in account changed. Refresh before continuing." };
  const commandId = formData.get("command_id"); const occurrenceId = formData.get("occurrence_id"); const cycle = formData.get("execution_cycle");
  if (typeof commandId !== "string" || !UUID.test(commandId) || typeof occurrenceId !== "string" || !UUID.test(occurrenceId) || typeof cycle !== "string" || !/^[1-9][0-9]*$/.test(cycle) || Number(cycle) > 2147483647) return { outcome: "rejected", reason: "validation", error: "The completion request is invalid. Refresh Daily Quests and try again." };
  try {
    const receipt = await completeQuestOccurrence(commandId, occurrenceId, Number(cycle));
    let refreshRequired = false;
    try { revalidatePath("/dashboard"); }
    catch { refreshRequired = true; }
    return { outcome: "success", refreshRequired, success: { message: `${receipt.replay ? "Completion confirmed from an earlier request." : "Quest completed."} ${String(receipt.exp_amount)} EXP awarded.`, replay: receipt.replay } };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23514") return { outcome: "rejected", reason: "stale", error: "This Quest changed before completion. Refresh Daily Quests to get the current cycle." };
    return { outcome: "unknown", error: "The completion outcome is unknown. Retry the exact saved request to confirm it." };
  }
}
