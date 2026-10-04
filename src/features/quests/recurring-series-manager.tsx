"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/features/network/network-status";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { readOccurrenceDetail } from "./plan-actions";
import { OccurrenceReadGeneration, type OccurrenceDetail } from "./plan-model";
import { useRecurringRetirement } from "./recurring-retirement-provider";
import { RecurringRetirementControl } from "./recurring-retirement-control";
import { usePauseController } from "./recurrence-pause-provider";
import { getPauseServerSnapshot } from "./recurrence-pending";
import { isFreshSeriesArchive } from "./recurring-series-state";

export type SeriesSelection = { occurrenceId: string; questId: string; title: string };
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
    {selected !== null && <RecurringSeriesModal key={`${userId}:${selected.occurrenceId}`}
      userId={userId} locale={locale} selection={selected}
      onClose={() => close(false)} onArchived={() => close(true)} />}
  </Selection.Provider>;
}

function RecurringSeriesModal({ userId, locale, selection, onClose, onArchived }: {
  userId: string; locale: Locale; selection: SeriesSelection;
  onClose: () => void; onArchived: () => void;
}) {
  const { occurrenceId, questId, title } = selection;
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const t = getDictionary(locale).seriesManage;
  const { state: retirementState } = useRecurringRetirement();
  const pauseController = usePauseController(questId);
  const pause = useSyncExternalStore(pauseController.subscribe, pauseController.getSnapshot, getPauseServerSnapshot);
  const [generation] = useState(() => new OccurrenceReadGeneration());
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ detail: OccurrenceDetail | null; nonce: number; version: number } | null>(null);
  const commandAtOpen = useRef(retirementState.resultCommandId);
  const reconciling = pause.phase === "recovering" || pause.phase === "sending";
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
    void readOccurrenceDetail(userId, occurrenceId)
      .then((detail) => { if (generation.accepts(token)) setLoaded({ detail, nonce, version: pause.version }); })
      .catch(() => { if (generation.accepts(token)) setLoaded({ detail: null, nonce, version: pause.version }); });
    return () => generation.cancel();
  }, [generation, occurrenceId, userId, nonce, pause.version, reconciling]);
  // A fresh successful archive of THIS series closes the dialog; focus falls back to the archived panel.
  useEffect(() => {
    if (isFreshSeriesArchive(retirementState, questId, commandAtOpen.current)) onArchived();
  }, [retirementState, questId, onArchived]);
  const loading = reconciling || !loaded || loaded.nonce !== nonce || loaded.version !== pause.version;
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
      onRetry={() => setNonce((value) => value + 1)} onReload={() => router.refresh()} />
  </dialog>;
}

/** The modal body, exported for server-rendered tests; dialog/focus/fetch wiring stays in the modal. */
export function SeriesModalContent({ locale, questId, title, detail, detailVersion, loading, onRetry, onReload }: {
  locale: Locale; questId: string; title: string;
  detail: OccurrenceDetail | null; detailVersion: number | undefined; loading: boolean;
  onRetry: () => void; onReload: () => void;
}) {
  const t = getDictionary(locale).seriesManage;
  const rc = getDictionary(locale).recurringControl;
  const qd = getDictionary(locale).questDetail;
  const dash = getDictionary(locale).dashboard;
  const online = useOnline();
  // The same single pause controller instance the recurring definitions rows use.
  const controller = usePauseController(questId);
  const pause = useSyncExternalStore(controller.subscribe, controller.getSnapshot, getPauseServerSnapshot);
  const retirement = useRecurringRetirement();
  async function togglePause(retry: boolean) {
    if (!navigator.onLine || !detail?.rule) return;
    if (!retry && (loading || controller.getSnapshot().version !== detailVersion)) return;
    if (await (retry ? controller.retry() : controller.submit(!detail.rule.paused))) onReload();
  }
  if (loading) return <p role="status" className="mt-4 text-sm">{t.loading}</p>;
  if (!detail || !detail.rule) return <div className="mt-4">
    <p role="alert" className="text-sm text-amber-200">{t.error}</p>
    <button type="button" className={`${buttonClass} mt-3`} onClick={onRetry}>{t.retry}</button>
  </div>;
  const rule = detail.rule;
  const cadence = detail.recurrence_mode === "daily" || detail.recurrence_mode === "weekly" || detail.recurrence_mode === "monthly"
    ? dash[detail.recurrence_mode] : qd[rule.recurrence_type as keyof typeof qd];
  const weekdays = rule.weekdays?.map((day) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day)))).join(", ");
  return <>
    <h3 className="mt-4 text-xl font-semibold wrap-anywhere">{title}</h3>
    <p className="mt-2 text-sm font-medium text-amber-200">{t.affects}</p>
    <dl className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-3 gap-y-2 text-sm [&_dd]:wrap-anywhere [&_dt]:text-zinc-400">
      <dt>{t.cadence}</dt><dd>{cadence}</dd>
      <dt>{t.state}</dt><dd>{rule.paused ? t.paused : t.running}</dd>
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
        : <button type="button" disabled={!online || pause.phase !== "ready" || retirement.state.phase !== "ready"}
            onClick={() => { void togglePause(false); }} className={buttonClass}>
            {pause.phase === "sending" ? rc.confirming : rule.paused ? t.resume : t.pause}
          </button>}
      {pause.phase === "blocked" && <button type="button" onClick={() => { void controller.recover(); }} className={`${buttonClass} ml-2`}>{rc.check}</button>}
      <div lang="en" aria-live="polite">
        {pause.error && <p role="alert" className="mt-2 text-sm text-red-300">{pause.error}</p>}
        {pause.message && <p role="status" className="mt-2 text-sm text-emerald-300">{pause.message}</p>}
      </div>
    </div>
    <div className="mt-5 border-t border-zinc-800 pt-4">
      <RecurringRetirementControl questId={questId} title={title} locale={locale}
        archiveLabel={t.archive} disabled={pause.phase !== "ready"} />
    </div>
  </>;
}


