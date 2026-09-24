"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useCompletionCoordinator } from "./completion-provider";

const buttonClass = "mt-2 rounded-md border border-amber-500 px-3 py-2 text-sm disabled:opacity-60";

/** The provider owns recovery even when this view has no requests to render. */
export function QuestCompletionRecovery({ selectedDate }: { selectedDate: string }) {
  const coordinator = useCompletionCoordinator();
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const router = useRouter();
  const refreshHref = `/dashboard?date=${selectedDate}`;
  if (state.accountChanged) return <section aria-label="Completion recovery"><p role="alert">{state.error}</p><a href={refreshHref}>Refresh account and Profile</a></section>;
  if (!state.operations.length && !state.confirmations.length && !state.error) return null;
  return (
    <section aria-label="Completion recovery" aria-busy={state.busy || state.refreshing} className="rounded-lg border border-amber-800 bg-zinc-950/80 p-4 [overflow-wrap:anywhere] sm:p-6">
      <h2 className="text-xs font-medium tracking-[0.3em] text-amber-300">COMPLETION RECOVERY</h2>
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
    </section>
  );
}
