"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";
import { useOnline } from "@/features/network/network-status";
import { changeRecurrencePause } from "./recurrence-action";
import { PAUSE_PREFIX, RecurrencePauseLifecycle } from "./recurrence-pending";
import { cadenceLabel } from "./recurring-model";
import type { RecurringQuest } from "./recurring-list";

const buttonClass = "mt-3 min-h-11 rounded-md border border-zinc-600 px-4 py-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
function RecurringControl({ userId, quest }: { userId: string; quest: RecurringQuest }) {
  const router = useRouter();
  const online = useOnline();
  const [controller] = useState(() => new RecurrencePauseLifecycle(userId, quest.quest_id, {
    storage: () => window.localStorage,
    lock: async (work) => {
      if (!navigator.locks) throw new Error("Tab coordination unavailable");
      return navigator.locks.request("system.quest-recurrence", work);
    }, uuid: () => crypto.randomUUID(), send: changeRecurrencePause,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.activate();
    void controller.recover();
    const recover = () => { void controller.recover(); };
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(`${PAUSE_PREFIX}${userId}:`)) recover(); };
    window.addEventListener("storage", onStorage); window.addEventListener("focus", recover);
    let unsubscribe = () => {};
    try {
      const { data } = createSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (session?.user.id !== userId) { controller.deactivate(); router.refresh(); }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { controller.deactivate(); }
    return () => { controller.deactivate(); unsubscribe(); window.removeEventListener("storage", onStorage); window.removeEventListener("focus", recover); };
  }, [controller, router, userId]);
  async function execute(retry: boolean) {
    if (!navigator.onLine) return;
    if (await (retry ? controller.retry() : controller.submit(!quest.paused))) router.refresh();
  }
  return <li className="rounded-md border border-zinc-800 p-4" aria-busy={state.phase === "sending"}>
    <h3 className="font-medium">{quest.title}</h3>
    <p className="mt-1 text-sm text-zinc-300">Recurring · {cadenceLabel(quest)} · {quest.paused ? "Paused" : "Active"}</p>
    <p className="mt-1 text-sm text-zinc-400">From {quest.anchor_date}{quest.end_date ? ` through ${quest.end_date}` : ""}</p>
    {state.operation && <p className="mt-2 text-sm text-amber-200">Awaiting confirmation: {state.operation.paused ? "Pause" : "Resume"}</p>}
    {state.phase === "uncertain" ? <button type="button" disabled={!online} onClick={() => { void execute(true); }} className={buttonClass}>Retry exact pause/resume request</button> :
      <button type="button" disabled={!online || state.phase !== "ready"} onClick={() => { void execute(false); }} className={buttonClass}>{state.phase === "sending" ? "Confirming…" : quest.paused ? "Resume" : "Pause"}</button>}
    {state.phase === "blocked" && <button type="button" onClick={() => { void controller.recover(); }} className={`${buttonClass} ml-2`}>Check recurrence recovery</button>}
    <div aria-live="polite">{state.error && <p role="alert" className="mt-2 text-sm text-red-300">{state.error}</p>}{state.message && <p role="status" className="mt-2 text-sm text-emerald-300">{state.message}</p>}</div>
  </li>;
}
export function RecurringQuestControls({ userId, quests }: { userId: string; quests: RecurringQuest[] }) {
  return <ul aria-label="Recurring definitions" className="mt-4 space-y-3">{quests.map((quest) => <RecurringControl key={quest.quest_id} userId={userId} quest={quest} />)}</ul>;
}
