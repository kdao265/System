"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";
import { createQuest } from "./create-action";
import { QuestCreationLifecycle } from "./create-lifecycle";
import { PENDING_PREFIX } from "./create-pending";
import { formatProfileLocal } from "./time";
import type { QuestDraft } from "./create-draft";

const control = "mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60";

// The key isolates draft, pending state and subscriptions before the new account renders.
export function QuestCreationForm(props: { timezone: string; userId: string }) {
  return <AccountQuestCreationForm key={props.userId} {...props} />;
}

function AccountQuestCreationForm({ timezone, userId }: { timezone: string; userId: string }) {
  const router = useRouter();
  const [controller] = useState(() => new QuestCreationLifecycle(userId, timezone, {
    storage: () => window.localStorage,
    lock: async (_account, work) => {
      if (!navigator.locks) throw new Error("Cross-tab coordination is unavailable");
      // localStorage enumeration is origin-wide, including across account changes.
      return navigator.locks.request("system.quest-creation", work);
    },
    uuid: () => crypto.randomUUID(),
    send: createQuest,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const draft = state.draft;

  useEffect(() => {
    controller.changeAccount(userId, controller.getSnapshot().profileTimezone);
    void controller.recover();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(`${PENDING_PREFIX}${userId}:`)) void controller.recover();
    };
    const onFocus = () => { void controller.recover(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    let unsubscribe = () => {};
    try {
      const { data } = createSupabaseClient().auth.onAuthStateChange((_event, session) => {
        if (session?.user.id !== userId) {
          controller.deactivate();
          router.refresh();
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { controller.deactivate(); }
    return () => {
      controller.deactivate();
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [controller, router, userId]);
  useEffect(() => { controller.profileChanged(timezone); }, [controller, timezone]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.submit();
  }
  function update<K extends keyof QuestDraft>(name: K, value: QuestDraft[K]) { controller.updateDraft(name, value); }
  const locked = state.phase !== "ready";
  const active = state.phase === "sending" || state.phase === "recovering";

  return (
    <section aria-label="Create Quest" className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 sm:p-6">
      <h2 className="text-xs font-medium tracking-[0.3em] text-zinc-400">CREATE QUEST</h2>
      <p className="mt-2 text-sm text-zinc-400">Form times use: {state.draftTimezone}</p>
      <p className="mt-1 text-sm text-zinc-400">Current Profile timezone: {state.profileTimezone}</p>
      {state.phase === "ready" && state.draftTimezone !== state.profileTimezone && <div className="mt-3 text-sm text-amber-200">
        <p>Review these wall-clock values before interpreting them in your current Profile timezone.</p>
        <button type="button" onClick={() => controller.reviewTimezone()} className="mt-2 underline">Use current Profile timezone for this draft</button>
      </div>}
      {state.phase === "recovering" && <p role="status" className="mt-3">Checking saved requests; another tab may be finishing a request.</p>}
      {!state.accountChanged && state.operations.map((operation) => <div key={operation.commandId} className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-100">
        <p>Awaiting confirmation: {operation.request.title}</p>
        <p>Original timezone: {operation.timezone}. The exact request and absolute times are preserved.</p>
        {operation.request.scheduled_at && <p>Planned start: {formatProfileLocal(operation.request.scheduled_at, operation.timezone)}</p>}
        {operation.request.deadline_at && <p>Deadline: {formatProfileLocal(operation.request.deadline_at, operation.timezone)}</p>}
        <button type="button" onClick={() => { void controller.retry(operation.commandId); }} disabled={state.phase !== "uncertain"} className="mt-3 rounded-md border border-amber-500 px-3 py-2 disabled:opacity-50">Retry exact request</button>
      </div>)}
      {state.phase === "blocked" && !state.accountChanged && <button type="button" onClick={() => { void controller.recover(); }} className="mt-3 underline">Check recovery again</button>}
      {(state.accountChanged || state.draftTimezone !== state.profileTimezone) && <a href="/dashboard" className="mt-3 block underline">Refresh account and Profile</a>}
      <form onSubmit={submit} className="mt-5 space-y-4" aria-busy={active}>
        <div><label htmlFor="quest-title">Title</label><input id="quest-title" value={draft.title} onChange={(event) => update("title", event.target.value)} disabled={locked} className={control} /></div>
        <div><label htmlFor="quest-description">Description <span className="text-sm text-zinc-400">(optional)</span></label><textarea id="quest-description" value={draft.description} onChange={(event) => update("description", event.target.value)} disabled={locked} rows={3} className={control} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="quest-scheduled-at">Planned start (optional)</label><input id="quest-scheduled-at" type="datetime-local" value={draft.scheduled_at} onChange={(event) => update("scheduled_at", event.target.value)} disabled={locked} className={control} /></div>
          <div><label htmlFor="quest-deadline-at">Deadline (optional)</label><input id="quest-deadline-at" type="datetime-local" value={draft.deadline_at} onChange={(event) => update("deadline_at", event.target.value)} disabled={locked} className={control} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label htmlFor="quest-reward">Reward EXP</label><input id="quest-reward" type="number" min="0" max="2147483647" step="1" value={draft.default_reward_exp} onChange={(event) => update("default_reward_exp", event.target.value)} disabled={locked} className={control} /></div>
          <div><label htmlFor="quest-importance">Importance</label><select id="quest-importance" value={draft.importance} onChange={(event) => update("importance", event.target.value as QuestDraft["importance"])} disabled={locked} className={control}><option value="side">Side</option><option value="main">Main</option></select></div>
          <div><label htmlFor="quest-priority">Priority (optional)</label><select id="quest-priority" value={draft.priority} onChange={(event) => update("priority", event.target.value as QuestDraft["priority"])} disabled={locked} className={control}><option value="">Unspecified</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
        </div>
        <div aria-live="polite" aria-atomic="true">{state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}{state.message && <p role="status" className="text-sm text-emerald-300">{state.message}</p>}</div>
        <button type="submit" disabled={locked} className="w-full rounded-md bg-zinc-100 px-4 py-2 font-medium text-zinc-950 disabled:opacity-50">{state.phase === "sending" ? "Confirming request…" : "Schedule Quest"}</button>
      </form>
    </section>
  );
}
