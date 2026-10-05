"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useOnline } from "@/features/network/network-status";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { createQuest } from "./create-action";
import { QuestCreationLifecycle } from "./create-lifecycle";
import { PENDING_PREFIX, RECURRING_PENDING_PREFIX, RECURRING_SCHEDULE_PENDING_PREFIX } from "./create-pending";
import { formatProfileLocal } from "./time";
import { isRecurring } from "./recurring-model";
import { partialScheduleDefaults, validScheduleDefaults } from "./schedule-model";
import type { QuestDraft } from "./create-draft";

const control = "mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:py-3";

// The key isolates draft, pending state and subscriptions before the new account renders.
export function QuestCreationForm(props: { timezone: string; userId: string; locale?: Locale }) {
  return <AccountQuestCreationForm key={props.userId} {...props} />;
}

function AccountQuestCreationForm({ timezone, userId, locale = "en" }: { timezone: string; userId: string; locale?: Locale }) {
  const router = useRouter();
  const online = useOnline();
  const dictionary = getDictionary(locale);
  const t = dictionary.questCreate;
  const sd = dictionary.scheduleDefaults;
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
      if (event.key === null || [PENDING_PREFIX, RECURRING_PENDING_PREFIX, RECURRING_SCHEDULE_PENDING_PREFIX].some((prefix) => event.key?.startsWith(`${prefix}${userId}:`))) void controller.recover();
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
    if (navigator.onLine) void controller.submit();
  }
  function update<K extends keyof QuestDraft>(name: K, value: QuestDraft[K]) { controller.updateDraft(name, value); }
  const locked = state.phase !== "ready";
  const active = state.phase === "sending" || state.phase === "recovering";
  const errorText = state.error ? t.feedback[state.error] : null;
  const successText = state.message
    ? state.message.kind === "recurring_created"
      ? `${t.success.recurringCreated}${state.message.replay ? ` ${t.success.replay}` : ""}`
      : `${[
          t.success.oneOffCreated,
          state.message.scheduledAt
            ? `${t.plannedStart}: ${formatProfileLocal(state.message.scheduledAt, state.message.timezone)}`
            : null,
          state.message.deadlineAt
            ? `${t.deadline}: ${formatProfileLocal(state.message.deadlineAt, state.message.timezone)}`
            : null,
        ].filter(Boolean).join(" \u00b7 ")} (${state.message.timezone}).${state.message.belongsToday ? "" : ` ${t.success.todayOnly}`}${state.message.replay ? ` ${t.success.replay}` : ""}`
    : null;
  // Live schedule guidance mirrors the submit-time rule; the server remains authoritative.
  const schedulePartial = partialScheduleDefaults(draft.local_start_time, draft.local_end_time);
  const scheduleOutOfOrder = !schedulePartial && draft.local_start_time !== "" &&
    !validScheduleDefaults(draft.local_start_time, draft.local_end_time, draft.ends_next_day ? 1 : 0);
  const scheduleHint = schedulePartial ? t.feedback.schedule_partial
    : scheduleOutOfOrder ? t.feedback.schedule_order
    : null;

  return (
    <section lang={locale} aria-label={t.aria} className="min-w-0 [overflow-wrap:anywhere] rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 sm:p-6">
      <h2 className="text-xs font-medium tracking-[0.3em] text-zinc-400">{t.heading}</h2>
      <p className="mt-2 text-sm text-zinc-400">{t.formTimesUse}: {state.draftTimezone}</p>
      <p className="mt-1 text-sm text-zinc-400">{t.currentProfileTimezone}: {state.profileTimezone}</p>
      {state.phase === "ready" && state.draftTimezone !== state.profileTimezone && <div className="mt-3 text-sm text-amber-200">
        <p>{t.reviewTimezone}</p>
        <button type="button" onClick={() => controller.reviewTimezone()} className="mt-2 underline">{t.useCurrentProfileTimezone}</button>
      </div>}
      {state.phase === "recovering" && <p role="status" className="mt-3">{t.checkingSaved}</p>}
      {!state.accountChanged && state.operations.map((operation) => <div key={operation.commandId} className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-100">
        <p>{t.awaitingConfirmation}: {operation.request.title}</p>
        <p>{t.originalTimezone}: {operation.timezone}. {t.exactPreserved}</p>
        {!isRecurring(operation.request) && operation.request.scheduled_at && <p>{t.plannedStart}: {formatProfileLocal(operation.request.scheduled_at, operation.timezone)}</p>}
        {!isRecurring(operation.request) && operation.request.deadline_at && <p>{t.deadline}: {formatProfileLocal(operation.request.deadline_at, operation.timezone)}</p>}
        {isRecurring(operation.request) && <p>{t.recurring}: {operation.request.recurrence_mode === "daily" ? t.daily : operation.request.recurrence_mode === "weekly" ? t.weekly : t.monthly}, {t.starting} {operation.request.start_date}. {t.datesProfileTimezone}</p>}
        <button type="button" onClick={() => { if (navigator.onLine) void controller.retry(operation.commandId); }} disabled={!online || state.phase !== "uncertain"} className="mt-3 rounded-md border border-amber-500 px-3 py-2 disabled:opacity-50 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{t.retryExact}</button>
      </div>)}
      {state.phase === "blocked" && !state.accountChanged && <button type="button" onClick={() => { void controller.recover(); }} className="mt-3 underline">{t.checkRecovery}</button>}
      {(state.accountChanged || state.draftTimezone !== state.profileTimezone) && <a href="/dashboard" className="mt-3 block underline">{t.refreshAccountProfile}</a>}
      <form onSubmit={submit} className="mt-5 space-y-4" aria-busy={active}>
        <div><label htmlFor="quest-cadence">{t.questType}</label><select id="quest-cadence" value={draft.recurrence_mode} onChange={(event) => update("recurrence_mode", event.target.value as QuestDraft["recurrence_mode"])} disabled={locked} className={control}><option value="one_off">{t.oneOff}</option><option value="daily">{t.daily}</option><option value="weekly">{t.weekly}</option><option value="monthly">{t.monthly}</option></select></div>
        <div><label htmlFor="quest-title">{t.title}</label><input id="quest-title" value={draft.title} onChange={(event) => update("title", event.target.value)} disabled={locked} className={control} /></div>
        <div><label htmlFor="quest-description">{t.description} <span className="text-sm text-zinc-400">({t.optional})</span></label><textarea id="quest-description" value={draft.description} onChange={(event) => update("description", event.target.value)} disabled={locked} rows={3} className={control} /></div>
        {draft.recurrence_mode === "one_off" ? <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="quest-scheduled-at">{t.plannedStart} ({t.optional})</label><input id="quest-scheduled-at" type="datetime-local" value={draft.scheduled_at} onChange={(event) => update("scheduled_at", event.target.value)} disabled={locked} className={control} /></div>
          <div><label htmlFor="quest-deadline-at">{t.deadline} ({t.optional})</label><input id="quest-deadline-at" type="datetime-local" value={draft.deadline_at} onChange={(event) => update("deadline_at", event.target.value)} disabled={locked} className={control} /></div>
        </div>
        : <fieldset disabled={locked} className="space-y-4">
          <legend className="text-sm text-zinc-400">{t.recurrenceProfileTimezone}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="quest-start-date">{t.startDate}</label><input id="quest-start-date" type="date" min="0001-01-01" max="9999-12-31" value={draft.start_date} onChange={(event) => update("start_date", event.target.value)} className={control} /></div>
            <div><label htmlFor="quest-end-date">{t.endDate} ({t.optional})</label><input id="quest-end-date" type="date" min={draft.start_date || "0001-01-01"} max="9999-12-31" value={draft.end_date} onChange={(event) => update("end_date", event.target.value)} className={control} /></div>
          </div>
          {draft.recurrence_mode === "weekly" && <fieldset><legend>{t.selectWeekdays}</legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{t.weekdays.map((day, index) => <label key={day} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-3 py-2"><input type="checkbox" checked={draft.weekdays.includes(index + 1)} onChange={(event) => update("weekdays", event.target.checked ? [...draft.weekdays, index + 1] : draft.weekdays.filter((value) => value !== index + 1))} className="size-5 accent-zinc-100" />{day}</label>)}</div></fieldset>}
          {draft.recurrence_mode === "monthly" && <div><label htmlFor="quest-month-day">{t.dayOfMonth}</label><input id="quest-month-day" type="number" min="1" max="31" step="1" value={draft.month_day} onChange={(event) => update("month_day", event.target.value)} className={control} /><p className="mt-2 text-sm text-zinc-400">{t.shorterMonths}</p></div>}
          <fieldset>
            <legend>{sd.heading} ({t.optional})</legend>
            <p className="mt-1 text-sm text-zinc-400">{sd.hint} {sd.timezone}: {timezone}.</p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="quest-local-start-time">{sd.start}</label><input id="quest-local-start-time" type="time" value={draft.local_start_time} onChange={(event) => update("local_start_time", event.target.value)} className={control} /></div>
              <div><label htmlFor="quest-local-end-time">{sd.end}</label><input id="quest-local-end-time" type="time" value={draft.local_end_time} onChange={(event) => update("local_end_time", event.target.value)} className={control} /></div>
            </div>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-3 py-2"><input type="checkbox" checked={draft.ends_next_day} onChange={(event) => update("ends_next_day", event.target.checked)} className="size-5 accent-zinc-100" />{sd.nextDay}</label>
            <p className="mt-2 text-sm text-zinc-400">{draft.ends_next_day ? sd.nextDayHint : sd.sameDayHint}</p>
            {scheduleHint && <p role="status" className="mt-2 text-sm text-amber-300">{scheduleHint}</p>}
          </fieldset>
        </fieldset>}
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label htmlFor="quest-reward">{t.rewardExp}</label><input id="quest-reward" type="number" min="0" max="2147483647" step="1" value={draft.default_reward_exp} onChange={(event) => update("default_reward_exp", event.target.value)} disabled={locked} className={control} /></div>
          <div><label htmlFor="quest-importance">{t.importance}</label><select id="quest-importance" value={draft.importance} onChange={(event) => update("importance", event.target.value as QuestDraft["importance"])} disabled={locked} className={control}><option value="side">{t.side}</option><option value="main">{t.main}</option></select></div>
          <div><label htmlFor="quest-priority">{t.priority} ({t.optional})</label><select id="quest-priority" value={draft.priority} onChange={(event) => update("priority", event.target.value as QuestDraft["priority"])} disabled={locked} className={control}><option value="">{t.unspecified}</option><option value="low">{t.low}</option><option value="medium">{t.medium}</option><option value="high">{t.high}</option><option value="critical">{t.critical}</option></select></div>
        </div>
        <div aria-live="polite" aria-atomic="true">{errorText && <p role="alert" className="text-sm text-red-300">{errorText}</p>}{successText && <p role="status" className="text-sm text-emerald-300">{successText}</p>}</div>
        <button type="submit" disabled={locked || !online} className="w-full rounded-md bg-zinc-100 px-4 py-2 font-medium text-zinc-950 disabled:opacity-50 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{state.phase === "sending" ? t.confirming : draft.recurrence_mode === "one_off" ? t.scheduleQuest : t.createRecurringQuest}</button>
      </form>
    </section>
  );
}
