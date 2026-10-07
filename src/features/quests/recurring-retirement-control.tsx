"use client";

import { useState, useSyncExternalStore } from "react";
import { useOnline } from "@/features/network/network-status";
import type { Locale } from "@/lib/localization/dictionaries";
import type { QuestManagementOperation } from "./management-action";
import { useRecurringRetirement } from "./recurring-retirement-provider";
import { recurringRetirementCopy } from "./recurring-retirement-copy";
import { useScheduleController } from "./schedule-provider";
import { getScheduleServerSnapshot } from "./schedule-pending";

export function RecurringRetirementControl({ questId, title, archived = false, disabled = false, locale = "en", archiveLabel }: {
  questId: string; title: string; archived?: boolean; disabled?: boolean; locale?: Locale; archiveLabel?: string;
}) {
  const { controller, state } = useRecurringRetirement();
  const t = recurringRetirementCopy(locale), online = useOnline();

  const scheduleController = useScheduleController(questId);
  const schedule = useSyncExternalStore(
    scheduleController.subscribe,
    scheduleController.getSnapshot,
    getScheduleServerSnapshot,
  );

  const [confirming, setConfirming] = useState<QuestManagementOperation | null>(null);
  const locked = disabled || !online || state.phase !== "ready" || schedule.phase !== "ready";
  const result = state.questId === questId ? state.result : undefined;
  const button = "ui-button";
  async function submit() {
    if (locked || !confirming) return;
    await controller.submit(questId, confirming, title);
    if (controller.getSnapshot().result?.outcome === "success") setConfirming(null);
  }
  return <div className="dashboard-recurring-retirement">
    {confirming ? <div className="quest-management-confirm quest-management-confirm-danger">
      <p>{confirming === "delete" ? t.deletePrompt : confirming === "archive" ? t.archivePrompt : t.restorePrompt}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={locked} onClick={() => { void submit(); }} className={button}>
          {confirming === "delete" ? t.confirmDelete : confirming === "archive" ? t.confirmArchive : t.confirmRestore}
        </button>
        <button type="button" disabled={state.phase === "sending"} onClick={() => setConfirming(null)} className={button}>{t.cancel}</button>
      </div>
    </div> : <div className="dashboard-recurring-tertiary">
      <button type="button" disabled={locked} onClick={() => setConfirming(archived ? "restore" : "archive")} className={button}>{archived ? t.restore : archiveLabel ?? t.archive}</button>
      {archived && <button type="button" disabled={locked} onClick={() => setConfirming("delete")} className={`${button} ui-button-danger`}>{t.delete}</button>}
    </div>}
    {result && result.outcome !== "idle" && <p role={result.outcome === "success" ? "status" : "alert"} className="mt-2 text-sm">
      {result.outcome === "success" ? t.success : result.outcome === "unknown" ? t.unknown : t.rejected}
    </p>}
  </div>;
}
