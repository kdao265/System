"use server";

import { requireUser } from "@/features/auth/session";
import { UUID } from "./create-pending";
import { getQuestCompletionResolution } from "./completion-resolution-data";
import type { CompletionResolution } from "./completion-resolution";

export type CompletionResolutionState =
  | { outcome: "resolved"; resolution: CompletionResolution }
  | { outcome: "rejected"; reason: "account" | "validation"; error: string }
  | { outcome: "unknown"; error: string };

export async function resolveQuestCompletion(_previous: unknown, form: FormData): Promise<CompletionResolutionState> {
  const user = await requireUser();
  if (form.get("expected_account") !== user.id) return { outcome: "rejected", reason: "account", error: "Your signed-in account changed. Refresh before continuing." };
  const commandId = form.get("command_id"); const occurrenceId = form.get("occurrence_id"); const cycle = form.get("execution_cycle");
  if (typeof commandId !== "string" || !UUID.test(commandId) || typeof occurrenceId !== "string" || !UUID.test(occurrenceId) || typeof cycle !== "string" || !/^[1-9][0-9]*$/.test(cycle) || Number(cycle) > 2147483647) return { outcome: "rejected", reason: "validation", error: "The saved completion request is invalid. Preserve it for reconciliation." };
  try {
    return { outcome: "resolved", resolution: await getQuestCompletionResolution(commandId, occurrenceId, Number(cycle)) };
  } catch {
    // Even a definitive resolver error says nothing about an earlier mutation's outcome.
    return { outcome: "unknown", error: "Completion resolution is unavailable or could not be verified. Your original request is preserved. Check resolution again." };
  }
}
