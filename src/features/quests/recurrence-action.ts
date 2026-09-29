"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { UUID } from "./create-pending";
import { setRecurrencePause } from "./recurring-data";

export type PauseResult = { outcome: "success" | "rejected" | "unknown"; error?: string };
export async function changeRecurrencePause(input: { userId: string; commandId: string; questId: string; paused: boolean }): Promise<PauseResult> {
  const user = await requireUser();
  if (!input || input.userId !== user.id) return { outcome: "rejected", error: "Your account changed. Refresh before continuing." };
  if (typeof input.commandId !== "string" || !UUID.test(input.commandId) ||
      typeof input.questId !== "string" || !UUID.test(input.questId) || typeof input.paused !== "boolean") {
    return { outcome: "rejected", error: "Invalid recurrence request. Refresh before continuing." };
  }
  try {
    await setRecurrencePause(input.commandId, input.questId, input.paused);
    revalidatePath("/dashboard");
    return { outcome: "success" };
  } catch {
    return { outcome: "unknown", error: "The pause/resume outcome is unknown. Retry the exact saved request." };
  }
}
