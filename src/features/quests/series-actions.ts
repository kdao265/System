"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { UUID } from "./create-pending";
import { getRecurringSeriesDetail, ScheduleCommandError, setRecurringScheduleDefaults } from "./recurring-data";
import { validScheduleDefaults, type ScheduleDefaults } from "./schedule-model";

export type ScheduleSaveResult = {
  outcome: "success" | "rejected" | "unknown";
  reason?: "stale" | "retired" | "invalid" | "conflict";
  error?: string;
};

/** Quest-ID series detail; any read failure is null, never a partial series state. */
export async function readRecurringSeriesDetail(userId: string, questId: string) {
  const user = await requireUser();
  if (user.id !== userId || !UUID.test(questId)) return null;
  try {
    return await getRecurringSeriesDetail(questId);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/** One schedule-defaults command: validate identity and tuple before any dispatch. */
export async function saveScheduleDefaults(input: {
  userId: string; commandId: string; questId: string; expectedRevision: number; defaults: ScheduleDefaults;
}): Promise<ScheduleSaveResult> {
  const user = await requireUser();
  if (!input || input.userId !== user.id) {
    return { outcome: "unknown", error: "Your account changed. The exact saved schedule request remains pending." };
  }
  const defaults = input.defaults;
  if (typeof input.commandId !== "string" || !UUID.test(input.commandId) ||
      typeof input.questId !== "string" || !UUID.test(input.questId) ||
      !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || !defaults ||
      !validScheduleDefaults(defaults.local_start_time, defaults.local_end_time, defaults.planned_end_day_offset)) {
    // Do not certify non-settlement before the authoritative RPC boundary.
    return {
      outcome: "unknown",
      error: "The saved schedule request could not be verified before dispatch. Preserve it and check recovery before continuing.",
    };
  }
  try {
    await setRecurringScheduleDefaults(input.commandId, input.questId, input.expectedRevision, defaults);
    revalidatePath("/dashboard");
    return { outcome: "success" };
  } catch (error) {
    if (!(error instanceof ScheduleCommandError)) {
      return { outcome: "unknown", error: "The schedule defaults outcome is unknown. Retry the exact saved request." };
    }
    const known: Record<string, { reason: "stale" | "retired" | "invalid" | "conflict"; error: string }> = {
      "23514:Stale recurring rule revision": { reason: "stale", error: "The recurrence rule changed. Reload the series, then save again." },
      "23514:Recurring Quest is not editable": { reason: "retired", error: "This series is no longer editable. Reload before continuing." },
      "23514:Recurring rule not found": { reason: "retired", error: "This series is no longer editable. Reload before continuing." },
      "P0002:Recurring Quest not found": { reason: "retired", error: "This series is no longer editable. Reload before continuing." },
      "22023:Invalid recurring schedule defaults": { reason: "invalid", error: "The schedule defaults are invalid. Review the times and try again." },
      "23505:Conflicting schedule defaults command reuse": { reason: "conflict", error: "This command conflicts with recorded history. Reload before editing." },
    };
    const match = known[`${error.code}:${error.message}`];
    if (match) {
      // The RPC resolves command replay before every business rejection, so a
      // mapped rejection proves the command never committed: safe to discard.
      return { outcome: "rejected", ...match };
    }
    return { outcome: "unknown", error: "The schedule defaults outcome is unknown. Retry the exact saved request." };
  }
}
