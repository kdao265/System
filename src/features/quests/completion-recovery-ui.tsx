"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useCompletionCoordinator } from "./completion-provider";
import { useReopenCoordinator } from "./completion-provider";

const buttonClass = "mt-2 rounded-md border border-amber-500 px-3 py-2 text-sm disabled:opacity-60";

/** The provider owns recovery even when this view has no requests to render. */
export function QuestCompletionRecovery({ selectedDate }: { selectedDate: string }) {
  const coordinator = useCompletionCoordinator();
  const reopenCoordinator = useReopenCoordinator();
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const reopenState = useSyncExternalStore(reopenCoordinator.subscribe, reopenCoordinator.getSnapshot, reopenCoordinator.getSnapshot);
  const router = useRouter();
  const refreshHref = `/dashboard?date=${selectedDate}`;
  const staleCount = reopenState.blocks.filter((item) => item.reason === "stale").length;
  useEffect(() => {
    if (reopenState.confirmations.length > 0 || staleCount > 0) void reopenCoordinator.refreshDashboard(() => router.refresh());
  }, [reopenCoordinator, reopenState.confirmations.length, staleCount, router]);
  if (state.accountChanged || reopenState.accountChanged) return <section aria-label="Quest recovery"><p role="alert">{state.error ?? reopenState.error}</p><a href={refreshHref}>Refresh account and Profile</a></section>;
  if (!state.operations.length && !state.confirmations.length && !state.error && !reopenState.operations.length && !reopenState.confirmations.length && !reopenState.blocks.length && !reopenState.refreshRequired && !reopenState.error) return null;
  return (
    <section aria-label="Quest recovery" aria-busy={state.busy || state.refreshing || reopenState.busy || reopenState.refreshing} className="rounded-lg border border-amber-800 bg-zinc-950/80 p-4 [overflow-wrap:anywhere] sm:p-6">
      <h2 className="text-xs font-medium tracking-[0.3em] text-amber-300">QUEST RECOVERY</h2>
      {state.error && <p role="alert" className="mt-2 text-sm text-amber-200">{state.error}</p>}
      {state.operations.map((operation) => (
        <div key={operation.commandId} className="mt-3 rounded-md border border-amber-800 p-3">
          <p className="text-sm">A completion is awaiting confirmation. Its original request is preserved.</p>
          <button type="button" data-command-id={operation.commandId} onClick={() => coordinator.retry(operation.commandId)} disabled={state.busy || state.phase === "blocked"} className={buttonClass}>Retry exact completion</button>
        </div>
      ))}
      {state.confirmations.map((confirmation) => (
        <div key={confirmation.operation.commandId} className="mt-3 rounded-md border border-emerald-800 p-3">
          <p role="status" className="text-sm text-emerald-300">{confirmation.message}</p>
          <p className="mt-1 text-xs text-zinc-400">This confirms the historical request, not the Quest&apos;s current status.</p>
          {confirmation.cleanupPending && <>
            <p className="mt-2 text-sm text-amber-200">Confirmation is saved here; browser recovery cleanup still needs to finish.</p>
            <button type="button" data-command-id={confirmation.operation.commandId} onClick={() => coordinator.retryConfirmation(confirmation.operation.commandId)} disabled={state.busy} className={buttonClass}>Retry recovery confirmation</button>
          </>}
        </div>
      ))}
      {state.phase === "blocked" && <button type="button" onClick={() => coordinator.recover()} disabled={state.busy} className={buttonClass}>Check recovery again</button>}
      {state.confirmations.length > 0 && <div className="mt-3">
        {state.refreshRequired && <p role="status" className="text-sm text-amber-200">Completion is confirmed. Refresh the Dashboard to read the latest state.</p>}
        {state.refreshError && <p role="alert">{state.refreshError}</p>}
        <button type="button" onClick={() => coordinator.refreshDashboard(() => router.refresh())} disabled={state.refreshing} className={buttonClass}>Refresh Dashboard</button>
        <a href={refreshHref} className="ml-3 text-sm underline">Reload selected day</a>
      </div>}
      {reopenState.error && <p role="alert" className="mt-4 text-sm text-amber-200">{reopenState.error}</p>}
      {reopenState.blocks.map(({ operation, reason }) => <div key={operation.commandId} className="mt-3 rounded-md border border-amber-800 p-3"><p className="text-sm">{reason === "conflict" ? "Reopen conflict: the original request is preserved for reconciliation against command history. Identical retries are blocked." : "This stale reopen request is preserved until a fresh Dashboard read shows the changed Quest cycle."}</p></div>)}
      {reopenState.operations.map((operation) => <div key={operation.commandId} className="mt-3 rounded-md border border-amber-800 p-3"><p className="text-sm">A reopen is awaiting confirmation. Its original request is preserved.</p><button type="button" data-command-id={operation.commandId} onClick={() => reopenCoordinator.retry(operation.commandId)} disabled={reopenState.busy || reopenState.phase === "blocked"} className={buttonClass}>Retry exact reopen</button></div>)}
      {reopenState.confirmations.map((confirmation) => <div key={confirmation.operation.commandId} className="mt-3 rounded-md border border-emerald-800 p-3"><p role="status" className="text-sm text-emerald-300">{confirmation.message}</p><p className="mt-1 text-xs text-zinc-400">This confirms the historical request; the Dashboard must reread the current Quest and EXP state.</p>{confirmation.cleanupPending && <><p className="mt-2 text-sm text-amber-200">Confirmation is saved here; browser recovery cleanup still needs to finish.</p><button type="button" data-command-id={confirmation.operation.commandId} onClick={() => reopenCoordinator.retryConfirmation(confirmation.operation.commandId)} disabled={reopenState.busy} className={buttonClass}>Retry reopen recovery confirmation</button></>}</div>)}
      {reopenState.phase === "blocked" && <button type="button" onClick={() => reopenCoordinator.recover()} disabled={reopenState.busy} className={buttonClass}>Check reopen recovery again</button>}
      {(reopenState.confirmations.length > 0 || reopenState.refreshRequired) && <div className="mt-3"><>{reopenState.refreshRequired && <p role="status" className="text-sm text-amber-200">Reopen requires a fresh Dashboard read before any further action.</p>}{reopenState.refreshError && <p role="alert">{reopenState.refreshError}</p>}<button type="button" onClick={() => reopenCoordinator.refreshDashboard(() => router.refresh())} disabled={reopenState.refreshing} className={buttonClass}>Refresh Dashboard</button><a href={refreshHref} className="ml-3 text-sm underline">Reload selected day</a></></div>}
    </section>
  );
}
