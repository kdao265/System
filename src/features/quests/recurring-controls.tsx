"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/features/network/network-status";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import type { RecurringQuest } from "./recurring-list";
import { RecurringRetirementControl } from "./recurring-retirement-control";
import { RecurringSeriesManageButton } from "./recurring-series-trigger";
import { useRecurringRetirement } from "./recurring-retirement-provider";
import { usePauseController } from "./recurrence-pause-provider";
import { getPauseServerSnapshot } from "./recurrence-pending";
import { useScheduleController } from "./schedule-provider";
import { getScheduleServerSnapshot } from "./schedule-pending";

const buttonClass = "mt-3 min-h-11 rounded-md border border-zinc-600 px-4 py-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
function RecurringControl({ quest, locale }: { quest: RecurringQuest; locale: Locale }) {
  const { recurringControl: t, dashboard: d } = getDictionary(locale);
  const weekdays = quest.weekdays?.map((day) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day)))).join(", ");
  const cadence = d[quest.recurrence_mode] + (quest.recurrence_mode === "weekly" ? ` · ${weekdays}` : quest.recurrence_mode === "monthly" ? ` · ${t.monthDay} ${quest.month_day}` : "");
  const router = useRouter();
  const online = useOnline();
  const retirement = useRecurringRetirement();
  // One shared controller per questId (dashboard-level registry); the series modal consumes the same instance.
  const controller = usePauseController(quest.quest_id);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, getPauseServerSnapshot);

  const scheduleController = useScheduleController(quest.quest_id);
  const schedule = useSyncExternalStore(
    scheduleController.subscribe,
    scheduleController.getSnapshot,
    getScheduleServerSnapshot,
  );

  useEffect(() => {
    void controller.recover();
    void scheduleController.recover();
  }, [controller, scheduleController]);
  async function execute(retry: boolean) {
    if (!navigator.onLine) return;
    if (!retry && schedule.phase !== "ready") return;
    if (await (retry ? controller.retry() : controller.submit(!quest.paused))) router.refresh();
  }
  return <li className="rounded-md border border-zinc-800 p-4" aria-busy={state.phase === "sending"}>
    <h3 className="font-medium">{quest.title}</h3>
    <p className="mt-1 text-sm text-muted">{t.recurring} · {cadence} · {quest.paused ? d.paused : d.active}</p>
    <p className="mt-1 type-metadata text-muted">{t.from} {quest.anchor_date}{quest.end_date ? ` ${t.through} ${quest.end_date}` : ""}</p>
    {state.operation && <p className="mt-2 text-sm text-exp">{t.awaiting}: {state.operation.paused ? t.pause : t.resume}</p>}
    {state.phase === "uncertain" ? <button type="button" disabled={!online} onClick={() => { void execute(true); }} className={buttonClass}>{t.retry}</button> :
      <button type="button" disabled={!online || state.phase !== "ready" || retirement.state.phase !== "ready" || schedule.phase !== "ready"} onClick={() => { void execute(false); }} className={buttonClass}>{state.phase === "sending" ? t.confirming : quest.paused ? t.resume : t.pause}</button>}
    {state.phase === "blocked" && <button type="button" onClick={() => { void controller.recover(); }} className={`${buttonClass} ml-2`}>{t.check}</button>}
    <div lang="en" aria-live="polite">{state.error && <p role="alert" className="mt-2 text-sm text-red-300">{state.error}</p>}{state.message && <p role="status" className="mt-2 text-sm text-emerald-300">{state.message}</p>}</div>
    {/* A recurring definition is reachable even with zero materialized occurrences,
        so its schedule defaults can still be read, set, cleared or corrected. This
        opens the SAME shared Quest-ID manager the occurrence card uses. */}
    <RecurringSeriesManageButton questId={quest.quest_id} title={quest.title} locale={locale} className={buttonClass} />
    <RecurringRetirementControl questId={quest.quest_id} title={quest.title} locale={locale} disabled={state.phase !== "ready"} />
  </li>;
}
export function RecurringQuestControls({ userId, quests, locale = "en" }: { userId: string; quests: RecurringQuest[]; locale?: Locale }) {
  return <ul aria-label={getDictionary(locale).recurringControl.definitions} className="mt-4 space-y-3">{quests.map((quest) => <RecurringControl key={`${userId}:${quest.quest_id}`} quest={quest} locale={locale} />)}</ul>;
}
