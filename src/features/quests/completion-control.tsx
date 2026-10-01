"use client";

import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { useOnline } from "@/features/network/network-status";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useCompletionCoordinator } from "./completion-provider";
import { QuestCompletionLifecycle } from "./completion-lifecycle";
import { getCompletionServerSnapshot } from "./completion-recovery";
import { useReopenCoordinator } from "./completion-provider";
import { QuestReopenLifecycle } from "./reopen-lifecycle";
import { getReopenServerSnapshot } from "./reopen-recovery";

export function QuestCompletionControl({ occurrenceId, executionCycle, locale = "en" }: { userId: string; occurrenceId: string; executionCycle: number; locale?: Locale; selectedDate: string }) {
  return <OccurrenceCompletionControl key={`${occurrenceId}:${executionCycle}`} occurrenceId={occurrenceId} executionCycle={executionCycle} locale={locale} />;
}

export function QuestReopenControl({ occurrenceId, executionCycle, locale = "en" }: { occurrenceId: string; executionCycle: number; locale?: Locale }) {
  return <OccurrenceReopenControl key={`${occurrenceId}:${executionCycle}`} occurrenceId={occurrenceId} executionCycle={executionCycle} locale={locale} />;
}

function OccurrenceReopenControl({ occurrenceId, executionCycle, locale = "en" }: { occurrenceId: string; executionCycle: number; locale?: Locale }) {
  const t = getDictionary(locale).questControl;
  const online = useOnline();
  const coordinator = useReopenCoordinator();
  const [row] = useState(() => new QuestReopenLifecycle(coordinator, occurrenceId, executionCycle));
  const [confirming, setConfirming] = useState(false);
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, getReopenServerSnapshot);
  useEffect(() => { row.activate(); return () => row.deactivate(); }, [row]);
  const operation = state.operations.find((item) => item.occurrenceId === occurrenceId && item.executionCycle === executionCycle);
  const confirmation = state.confirmations.find((item) => item.operation.occurrenceId === occurrenceId && item.operation.executionCycle === executionCycle);
  if (state.accountChanged || state.phase === "blocked") return <p lang="en" role="alert" className="mt-4 text-sm text-amber-200">{state.error}</p>;
  if (state.phase === "awaiting-refresh") return <p lang="en" role="status" className="mt-4 text-sm text-amber-200">{state.error}</p>;
  if (confirmation) return <p role="status" className="mt-4 text-sm text-emerald-300">{t.reopened}</p>;
  const disabled = !online || state.busy || state.phase === "recovering";
  if (confirming) return <div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-sm text-amber-200">{t.confirmPrompt}</span><button type="button" onClick={() => { if (!navigator.onLine) return; setConfirming(false); void (operation ? row.retry() : row.submit()); }} disabled={disabled} className="rounded-md bg-amber-300 px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-wait disabled:opacity-60 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{state.busy ? t.reopening : operation ? t.retryReopen : t.confirmReopen}</button><button type="button" onClick={() => setConfirming(false)} disabled={state.busy || state.phase === "recovering"} className="rounded-md border border-zinc-600 px-3 py-2 text-sm pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{t.cancel}</button></div>;
  return <button type="button" onClick={() => setConfirming(true)} disabled={disabled} aria-busy={state.busy} className="mt-4 rounded-md border border-amber-500 px-3 py-2 text-sm text-amber-200 disabled:cursor-wait disabled:opacity-60 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{state.busy || state.phase === "recovering" ? t.checkingReopen : operation ? t.retryReopen : t.reopen}</button>;
}

function OccurrenceCompletionControl({ occurrenceId, executionCycle, locale = "en" }: { occurrenceId: string; executionCycle: number; locale?: Locale }) {
  const t = getDictionary(locale).questControl;
  const online = useOnline();
  const coordinator = useCompletionCoordinator();
  const [row] = useState(() => new QuestCompletionLifecycle(coordinator, occurrenceId, executionCycle));
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, getCompletionServerSnapshot);
  useEffect(() => { row.activate(); return () => row.deactivate(); }, [row]);
  const operation = state.operations.find((item) => item.occurrenceId === occurrenceId && item.executionCycle === executionCycle);
  const confirmation = state.confirmations.find((item) => item.operation.occurrenceId === occurrenceId && item.operation.executionCycle === executionCycle);
  const disposition = state.dispositions.find((item) => item.operation.occurrenceId === occurrenceId && item.operation.executionCycle === executionCycle);
  if (state.accountChanged || state.phase === "blocked") return <p lang="en" role="alert" className="mt-4 text-sm text-amber-200">{state.error}</p>;
  if (confirmation) return <p role="status" className="mt-4 text-sm text-emerald-300">{t.earlier}</p>;
  if (disposition) return <p role="status" className="mt-4 text-sm text-amber-200">{t.disposition}</p>;
  const disabled = !online || state.busy || state.phase === "recovering";
  return <button type="button" onClick={() => { if (navigator.onLine) return operation ? row.retry() : row.submit(); }} disabled={disabled} aria-busy={state.busy} className="mt-4 rounded-md bg-amber-300 px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-wait disabled:opacity-60 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
    {state.busy ? t.confirming : state.phase === "recovering" ? t.checking : operation ? t.resolution : t.complete}
  </button>;
}
