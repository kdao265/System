"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/features/network/network-status";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { readRecurringSeriesDetail } from "./series-actions";
import { OccurrenceReadGeneration } from "./plan-model";
import type { SeriesDetail } from "./series-detail-model";
import { getScheduleServerSnapshot, type ScheduleView } from "./schedule-pending";
import { NO_SCHEDULE_DEFAULTS, partialScheduleDefaults, scheduleDefaultsFromDraft, type ScheduleDefaults } from "./schedule-model";
import {
  beginScheduleDraft, editScheduleDraft, markScheduleDraftConflicted,
  reconcileScheduleDraft, reloadScheduleDraft, type ScheduleDraft,
} from "./schedule-draft";
import { useRecurringRetirement } from "./recurring-retirement-provider";
import { RecurringRetirementControl } from "./recurring-retirement-control";
import { usePauseController } from "./recurrence-pause-provider";
import { getPauseServerSnapshot } from "./recurrence-pending";
import { isFreshSeriesArchive } from "./recurring-series-state";
import { useScheduleController } from "./schedule-provider";

/**
 * One selection shape for the whole Dashboard. `occurrenceId` is present only for
 * occurrence-card triggers; a recurring DEFINITION row (including one with zero
 * materialized occurrences) passes null, because management is keyed by Quest ID
 * and never requires an occurrence to exist.
 */
export type SeriesSelection = { occurrenceId: string | null; questId: string; title: string };
/** A settled schedule command: whether it saved, and the certified rejection reason if not. */
export type ScheduleSaveOutcome = {
  saved: boolean;
  pending?: boolean;
  commandId?: string;
  reason?: "stale" | "retired" | "invalid" | "conflict";
};
type OpenSeries = (selection: SeriesSelection, opener: HTMLElement) => void;

const Selection = createContext<OpenSeries | null>(null);
export function useSeriesSelection() {
  return useContext(Selection);
}

const buttonClass = "min-h-11 rounded-md border border-zinc-600 px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:py-3";

/**
 * One selection/manager for the whole Dashboard: every recurring occurrence card
 * triggers the single shared series dialog instead of mounting one per card.
 */
export function RecurringSeriesManager({ userId, locale, children }: { userId: string; locale: Locale; children: ReactNode }) {
  const [selected, setSelected] = useState<SeriesSelection | null>(null);
  const { controller: retirement } = useRecurringRetirement();
  const opener = useRef<HTMLElement | null>(null);
  const archivedClose = useRef(false);
  const open = useCallback((selection: SeriesSelection, element: HTMLElement) => {
    opener.current = element;
    archivedClose.current = false;
    setSelected(selection);
  }, []);
  const close = useCallback((archived: boolean) => {
    // A pending retirement may remove the opener after this dialog has gone.
    const pending = retirement.getSnapshot().pending;
    archivedClose.current = archived || (selected !== null && pending?.questId === selected.questId);
    setSelected(null);
  }, [retirement, selected]);
  useEffect(() => {
    if (selected !== null) return;
    const element = opener.current;
    const archived = archivedClose.current;
    archivedClose.current = false;
    opener.current = null;
    if (!element && !archived) return; // initial mount: nothing was opened
    if (!archived && element?.isConnected) { element.focus(); return; }
    // The occurrence trigger is gone after a successful archive: focus a stable target instead.
    const fallback = document.getElementById("archived-recurring-quests") ?? document.getElementById("quest-tools");
    fallback?.focus();
  }, [selected]);
  return <Selection.Provider value={open}>
    {children}
    {selected !== null && <RecurringSeriesModal key={`${userId}:${selected.questId}`}
      userId={userId} locale={locale} selection={selected}
      onClose={() => close(false)} onArchived={() => close(true)} />}
  </Selection.Provider>;
}

function RecurringSeriesModal({ userId, locale, selection, onClose, onArchived }: {
  userId: string; locale: Locale; selection: SeriesSelection;
  onClose: () => void; onArchived: () => void;
}) {
  const { questId, title } = selection;
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const t = getDictionary(locale).seriesManage;
  const { state: retirementState } = useRecurringRetirement();
  const pauseController = usePauseController(questId);
  const pause = useSyncExternalStore(pauseController.subscribe, pauseController.getSnapshot, getPauseServerSnapshot);
  // Schedule recovery is account-owned, so this modal consumes the same
  // lifecycle that remains alive after the modal closes.
  const schedule = useScheduleController(questId);
  const scheduleState = useSyncExternalStore(
    schedule.subscribe,
    schedule.getSnapshot,
    getScheduleServerSnapshot,
  );
  const [generation] = useState(() => new OccurrenceReadGeneration());
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ detail: SeriesDetail | null; nonce: number; version: number; scheduleVersion: number } | null>(null);
  const commandAtOpen = useRef(retirementState.resultCommandId);
  const reconciling = pause.phase === "recovering" || pause.phase === "sending" ||
    scheduleState.phase === "recovering" || scheduleState.phase === "sending";
  useEffect(() => {
    void schedule.recover();
  }, [schedule]);
  useEffect(() => { void pauseController.recover(); }, [pauseController]);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    closeButton.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    if (reconciling) return;
    const token = generation.begin();
    void readRecurringSeriesDetail(userId, questId)
      .then((detail) => { if (generation.accepts(token)) setLoaded({ detail, nonce, version: pause.version, scheduleVersion: scheduleState.version }); })
      .catch(() => { if (generation.accepts(token)) setLoaded({ detail: null, nonce, version: pause.version, scheduleVersion: scheduleState.version }); });
    return () => generation.cancel();
  }, [generation, questId, userId, nonce, pause.version, scheduleState.version, reconciling]);
  // A fresh successful archive of THIS series closes the dialog; focus falls back to the archived panel.
  useEffect(() => {
    if (isFreshSeriesArchive(retirementState, questId, commandAtOpen.current)) onArchived();
  }, [retirementState, questId, onArchived]);
  const loading = reconciling || !loaded || loaded.nonce !== nonce || loaded.version !== pause.version ||
    loaded.scheduleVersion !== scheduleState.version;
  return <dialog ref={dialog} lang={locale} aria-labelledby="recurring-series-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const targets = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]')).filter((element) => element.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    className="m-auto max-h-[calc(100dvh-1rem)] min-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl overflow-y-auto rounded-xl border border-violet-400/40 bg-zinc-950 p-4 text-zinc-100 shadow-2xl backdrop:bg-black/75 sm:min-h-0 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <h2 id="recurring-series-title" className="text-lg font-semibold">{t.title}</h2>
      <button ref={closeButton} type="button" className={buttonClass} onClick={onClose}>{t.close}</button>
    </div>
    <SeriesModalContent locale={locale} questId={questId} title={title}
      detail={loading ? null : loaded!.detail} detailVersion={loaded?.version} loading={loading}
      onRetry={() => setNonce((value) => value + 1)} onReload={() => router.refresh()}
      schedule={scheduleState}
      onScheduleSave={async (defaults, expectedRevision) => {
        const saved = await schedule.submit(defaults, expectedRevision);
        // Report the certified rejection reason so only a STALE rejection forces the
        // draft conflict state; other rejections keep their existing inline error.
        const snapshot = schedule.getSnapshot();
        return {
          saved,
          pending: snapshot.phase === "uncertain",
          commandId: snapshot.operation?.commandId ?? snapshot.settlement?.commandId,
          reason: snapshot.reason,
        };
      }}
      onScheduleRetry={() => schedule.retry()}
      onScheduleStale={() => setNonce((value) => value + 1)} />
  </dialog>;
}

/** The modal body, exported for server-rendered tests; dialog/focus/fetch wiring stays in the modal. */
export function SeriesModalContent({ locale, questId, title, detail, detailVersion, loading, onRetry, onReload,
  schedule, onScheduleSave, onScheduleRetry, onScheduleStale }: {
  locale: Locale; questId: string; title: string;
  detail: SeriesDetail | null; detailVersion: number | undefined; loading: boolean;
  onRetry: () => void; onReload: () => void;
  schedule: ScheduleView;
  onScheduleSave: (defaults: ScheduleDefaults, expectedRevision: number) => Promise<ScheduleSaveOutcome>;
  onScheduleRetry: () => Promise<boolean>;
  onScheduleStale: () => void;
}) {
  const t = getDictionary(locale).seriesManage;
  const rc = getDictionary(locale).recurringControl;
  const qd = getDictionary(locale).questDetail;
  const dash = getDictionary(locale).dashboard;
  const sd = getDictionary(locale).scheduleDefaults;
  const online = useOnline();
  // The same single pause controller instance the recurring definitions rows use.
  const controller = usePauseController(questId);
  const pause = useSyncExternalStore(controller.subscribe, controller.getSnapshot, getPauseServerSnapshot);
  const retirement = useRecurringRetirement();
  // A null draft means "not editing". An open draft OWNS its base revision; the
  // newest authoritative revision is never substituted at submit time.
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [scheduleValidation, setScheduleValidation] = useState<string | null>(null);
  const [pendingScheduleCommandId, setPendingScheduleCommandId] = useState<string | null>(null);
  const editing = draft !== null;
  // Reconciliation against authoritative detail is DERIVED during render, not applied in
  // an effect: a pristine draft synchronizes its values and base revision, while a
  // dirty draft whose base revision no longer matches is preserved verbatim and marked
  // conflicted. Nothing is merged and the expected revision never silently advances.
  const effectiveDraft = draft === null || !detail ? draft : reconcileScheduleDraft(draft, detail.rule);
  const startInput = effectiveDraft?.values.start ?? "";
  const endInput = effectiveDraft?.values.end ?? "";
  const nextDayInput = effectiveDraft?.values.nextDay ?? false;
  const scheduleConflicted = effectiveDraft?.conflicted ?? false;
  const scheduleSettlement = schedule.settlement;

  useEffect(() => {
    if (
      pendingScheduleCommandId === null ||
      !scheduleSettlement ||
      scheduleSettlement.commandId !== pendingScheduleCommandId
    ) {
      return;
    }

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setPendingScheduleCommandId(null);

      if (scheduleSettlement.outcome === "success") {
        setDraft(null);
        setScheduleValidation(null);
        onReload();
        return;
      }

      if (scheduleSettlement.reason === "stale") {
        setDraft((current) =>
          current === null ? null : markScheduleDraftConflicted(current)
        );
        onScheduleStale();
      }

      onReload();
    });

    return () => {
      cancelled = true;
    };
  }, [
    scheduleSettlement,
    pendingScheduleCommandId,
    onReload,
    onScheduleStale,
  ]);
  // Every user edit is applied to the reconciled draft, so a synchronized pristine
  // draft becomes the base for all subsequent input.
  function updateDraft(patch: Partial<ScheduleDraft["values"]>) {
    if (effectiveDraft === null) return;
    setDraft(editScheduleDraft(effectiveDraft, patch));
  }
  async function togglePause(retry: boolean) {
    if (!navigator.onLine || !detail?.rule) return;
    if (!retry && (loading || schedule.phase !== "ready" || controller.getSnapshot().version !== detailVersion)) return;
    if (await (retry ? controller.retry() : controller.submit(!detail.paused))) onReload();
  }
  if (loading) return <p role="status" className="mt-4 text-sm">{t.loading}</p>;
  if (!detail) return <div className="mt-4">
    <p role="alert" className="text-sm text-amber-200">{t.error}</p>
    <button type="button" className={`${buttonClass} mt-3`} onClick={onRetry}>{t.retry}</button>
  </div>;
  const rule = detail.rule;
  const hasDefaults = rule.local_start_time !== null;
  const scheduleLocked = loading || retirement.state.phase !== "ready" || pause.phase === "sending";
  function beginScheduleEdit() {
    // The draft is bound to the revision it was loaded from, not to whatever the
    // newest read happens to carry when the user finally presses Save.
    setDraft(beginScheduleDraft(rule));
    setScheduleValidation(null);
  }
  function reloadAuthoritativeDraft() {
    // Explicit recovery only: authoritative values replace local values and the
    // base revision advances. Nothing is merged.
    setDraft(reloadScheduleDraft(rule));
    setScheduleValidation(null);
    onScheduleStale();
  }
  async function persistSchedule(defaults: ScheduleDefaults, expectedRevision: number) {
    setScheduleValidation(null);
    const outcome = await onScheduleSave(defaults, expectedRevision);
    if (outcome.saved) {
      setPendingScheduleCommandId(null);
      setDraft(null);
    } else if (outcome.pending && outcome.commandId) {
      // The local draft now owns this exact durable command until recovery settles it.
      setPendingScheduleCommandId(outcome.commandId);
    } else {
      setPendingScheduleCommandId(null);

      // Only a certified STALE rejection freezes the draft against the newer rule.
      if (outcome.reason === "stale") {
        setDraft((current) =>
          current === null ? null : markScheduleDraftConflicted(current)
        );
        onScheduleStale();
      }
    }

    onReload();
  }
  function saveSchedule() {
    if (effectiveDraft === null || effectiveDraft.conflicted) return;
    if (partialScheduleDefaults(startInput, endInput)) { setScheduleValidation(sd.partial); return; }
    const defaults = scheduleDefaultsFromDraft(startInput, endInput, nextDayInput);
    if (!defaults) { setScheduleValidation(sd.ordering); return; }
    void persistSchedule(defaults, effectiveDraft.baseRevision);
  }
  // Clearing is a command against the rule the user is looking at, so it owns the
  // same explicit expected revision rather than an implicit current one.
  function clearSchedule() { void persistSchedule({ ...NO_SCHEDULE_DEFAULTS }, rule.revision); }
  const cadence = detail.recurrence_mode === "daily" || detail.recurrence_mode === "weekly" || detail.recurrence_mode === "monthly"
    ? dash[detail.recurrence_mode] : qd[rule.recurrence_type as keyof typeof qd];
  const weekdays = rule.weekdays?.map((day) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day)))).join(", ");
  return <>
    <h3 className="mt-4 text-xl font-semibold wrap-anywhere">{title}</h3>
    <p className="mt-2 text-sm font-medium text-amber-200">{t.affects}</p>
    <dl className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-3 gap-y-2 text-sm [&_dd]:wrap-anywhere [&_dt]:text-zinc-400">
      <dt>{t.cadence}</dt><dd>{cadence}</dd>
      <dt>{t.state}</dt><dd>{detail.paused ? t.paused : t.running}</dd>
      <dt>{qd.anchor}</dt><dd>{rule.anchor_date}</dd>
      {rule.end_date && <><dt>{qd.seriesEnd}</dt><dd>{rule.end_date}</dd></>}
      {weekdays && <><dt>{qd.weekdays}</dt><dd>{weekdays}</dd></>}
      {rule.month_day !== null && <><dt>{qd.monthDay}</dt><dd>{rule.month_day}</dd></>}
      {rule.interval_count !== null && <><dt>{qd.interval}</dt><dd>{rule.interval_count}</dd></>}
      {rule.occurrence_limit !== null && <><dt>{qd.limit}</dt><dd>{rule.occurrence_limit}</dd></>}
    </dl>
    <div className="mt-5">
      {pause.operation && <p className="text-sm text-exp">{rc.awaiting}: {pause.operation.paused ? rc.pause : rc.resume}</p>}
      {pause.phase === "uncertain"
        ? <button type="button" disabled={!online} onClick={() => { void togglePause(true); }} className={buttonClass}>{rc.retry}</button>
        : <button type="button" disabled={!online || pause.phase !== "ready" || retirement.state.phase !== "ready" || schedule.phase !== "ready"}
            onClick={() => { void togglePause(false); }} className={buttonClass}>
            {pause.phase === "sending" ? rc.confirming : detail.paused ? t.resume : t.pause}
          </button>}
      {pause.phase === "blocked" && <button type="button" onClick={() => { void controller.recover(); }} className={`${buttonClass} ml-2`}>{rc.check}</button>}
      <div lang="en" aria-live="polite">
        {pause.error && <p role="alert" className="mt-2 text-sm text-red-300">{pause.error}</p>}
        {pause.message && <p role="status" className="mt-2 text-sm text-emerald-300">{pause.message}</p>}
        {schedule.error && <p role="alert" className="mt-2 text-sm text-red-300">{schedule.error}</p>}
        {schedule.message && <p role="status" className="mt-2 text-sm text-emerald-300">{schedule.message}</p>}
      </div>
    </div>
    <div className="mt-5 border-t border-zinc-800 pt-4" lang={locale}>
      <h4 className="text-sm font-semibold">{sd.heading}</h4>
      <p className="mt-1 text-sm text-zinc-400">{sd.hint}</p>
      <dl className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-3 gap-y-2 text-sm [&_dd]:wrap-anywhere [&_dt]:text-zinc-400">
        {hasDefaults ? <>
          <dt>{sd.start}</dt><dd>{rule.local_start_time}</dd>
          <dt>{sd.end}</dt><dd>{rule.local_end_time}{rule.planned_end_day_offset === 1 ? ` (${sd.nextDay})` : ""}</dd>
        </> : <>
          <dt>{sd.heading}</dt><dd>{sd.none}</dd>
        </>}
        <dt>{sd.timezone}</dt><dd>{detail.timezone}</dd>
        <dt>{qd.revision}</dt><dd>{rule.revision}</dd>
      </dl>
      {schedule.operation && <p className="mt-2 text-sm text-zinc-300">{sd.awaiting}</p>}
      {editing && <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="series-schedule-start" className="text-sm text-zinc-300">{sd.start}</label>
          <input id="series-schedule-start" type="time" value={startInput} aria-describedby={scheduleConflicted ? "series-schedule-conflict" : undefined}
            onChange={(event) => updateDraft({ start: event.target.value })}
            disabled={scheduleLocked} className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 pointer-coarse:py-3" /></div>
        <div><label htmlFor="series-schedule-end" className="text-sm text-zinc-300">{sd.end}</label>
          <input id="series-schedule-end" type="time" value={endInput} aria-describedby={scheduleConflicted ? "series-schedule-conflict" : undefined}
            onChange={(event) => updateDraft({ end: event.target.value })}
            disabled={scheduleLocked} className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 pointer-coarse:py-3" /></div>
      </div>}
      {editing && <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm">
        <input type="checkbox" checked={nextDayInput}
          onChange={(event) => updateDraft({ nextDay: event.target.checked })}
          disabled={scheduleLocked} className="size-5 accent-zinc-100" />{sd.nextDay}
      </label>}
      {scheduleConflicted && <div id="series-schedule-conflict" role="alert" className="mt-3 rounded-md border border-amber-700 bg-amber-950/30 p-3">
        <p className="text-sm text-amber-200">{sd.conflict}</p>
        <button type="button" onClick={reloadAuthoritativeDraft} className={`${buttonClass} mt-2`}>{sd.reload}</button>
      </div>}
      {editing && <p className="mt-2 text-sm text-zinc-400">{nextDayInput ? sd.nextDayHint : sd.sameDayHint}</p>}
      {scheduleValidation && <p role="alert" className="mt-2 text-sm text-amber-300">{scheduleValidation}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {schedule.phase === "uncertain"
          ? <button type="button" disabled={!online} onClick={() => { void onScheduleRetry(); }} className={buttonClass}>{sd.retry}</button>
          : editing ? <>
              <button type="button" disabled={scheduleLocked || !online || schedule.phase !== "ready" || scheduleConflicted}
                onClick={saveSchedule} className={buttonClass}>{schedule.phase === "sending" ? sd.saving : sd.save}</button>
              <button type="button" onClick={() => { setDraft(null); setScheduleValidation(null); }} className={buttonClass}>{sd.cancel}</button>
            </> : <>
              <button type="button" disabled={scheduleLocked} onClick={beginScheduleEdit} className={buttonClass}>{sd.edit}</button>
              {hasDefaults && <button type="button" disabled={scheduleLocked || !online || schedule.phase !== "ready"}
                onClick={clearSchedule} className={buttonClass}>{sd.clear}</button>}
            </>}
      </div>
    </div>
    <div className="mt-5 border-t border-zinc-800 pt-4">
      <RecurringRetirementControl questId={questId} title={title} locale={locale}
        archiveLabel={t.archive} disabled={pause.phase !== "ready"} />
    </div>
  </>;
}


