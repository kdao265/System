"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useCompletionCoordinator } from "./completion-provider";
import { QuestCompletionLifecycle } from "./completion-lifecycle";

export function QuestCompletionControl({ occurrenceId, executionCycle }: { userId: string; occurrenceId: string; executionCycle: number; selectedDate: string }) {
  return <OccurrenceCompletionControl key={`${occurrenceId}:${executionCycle}`} occurrenceId={occurrenceId} executionCycle={executionCycle} />;
}

function OccurrenceCompletionControl({ occurrenceId, executionCycle }: { occurrenceId: string; executionCycle: number }) {
  const coordinator = useCompletionCoordinator();
  const [row] = useState(() => new QuestCompletionLifecycle(coordinator, occurrenceId, executionCycle));
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  useEffect(() => { row.activate(); return () => row.deactivate(); }, [row]);
  const operation = state.operations.find((item) => item.occurrenceId === occurrenceId && item.executionCycle === executionCycle);
  const confirmation = state.confirmations.find((item) => item.operation.occurrenceId === occurrenceId && item.operation.executionCycle === executionCycle);
  if (state.accountChanged || state.phase === "blocked") return <p role="alert" className="mt-4 text-sm text-amber-200">{state.error}</p>;
  if (confirmation) return <p role="status" className="mt-4 text-sm text-emerald-300">An earlier completion request is confirmed. Check Dashboard recovery for refresh or cleanup.</p>;
  const disabled = state.busy || state.phase === "recovering";
  return <button type="button" onClick={() => operation ? row.retry() : row.submit()} disabled={disabled} aria-busy={state.busy} className="mt-4 rounded-md bg-amber-300 px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-wait disabled:opacity-60">
    {state.busy ? "Confirming completion..." : state.phase === "recovering" ? "Checking completion..." : operation ? "Retry exact completion" : "Complete"}
  </button>;
}
