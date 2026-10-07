"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/features/network/network-status";
import { mutateGoal } from "./actions";
import { validRequest, unknownOutcome, type GoalDetail, type GoalPage, type GoalRequest, type GoalResult } from "./model";
import type { CandidatePage } from "./data";
import { goalButton, goalInput, GoalProgress } from "./components";

type Props = { userId: string; page: GoalPage | null; detail: GoalDetail | null; selected: string | null;
  scope: "unarchived" | "archived"; candidates: CandidatePage | null; candidateAfter: string | null; children?: ReactNode };
const DetachContext = createContext<{ disabled: boolean; detach: (linkId: string) => void } | null>(null);

export function GoalDetachControl({ linkId, title }: { linkId: string; title: string }) {
  const context = useContext(DetachContext);
  if (!context) return null;
  return <button className={`${goalButton} mt-4`} aria-label={`Detach ${title}`} disabled={context.disabled}
    onClick={() => context.detach(linkId)}>Detach Sub Quest</button>;
}

export function GoalsPanel({ userId, page, detail, selected, scope, candidates, candidateAfter, children }: Props) {
  const router = useRouter();
  const online = useOnline();
  const key = `system:goal-request:v1:${userId}`;
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<GoalRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoalResult | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const sending = useRef(false);
  const creationForm = useRef<HTMLFormElement>(null);
  const goal = detail?.goal;
  const href = (id?: string, after?: string | null, candidate?: string | null) => {
    const params = new URLSearchParams({ scope });
    if (id) params.set("id", id);
    if (after) params.set("after", after);
    if (candidate) params.set("candidateAfter", candidate);
    return `/goals?${params}`;
  };
  useEffect(() => {
    // Restore without submitting. An unknown request requires an explicit exact retry.
    queueMicrotask(() => {
      try {
        const saved = sessionStorage.getItem(key);
        if (saved) {
          const request: unknown = JSON.parse(saved);
          if (!validRequest(request) || request.userId !== userId) throw new Error("Invalid saved request");
          setPending(request); setResult(unknownOutcome);
        }
        setReady(true);
      } catch { setStorageBlocked(true); setResult({ outcome: "rejected", message: "Saved request storage is unavailable or invalid. Restore browser storage before making changes; no request was sent." }); }
    });
  }, [key, userId]);
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [router]);
  const disabled = !ready || busy || !!pending || storageBlocked || !online;
  async function send(request: GoalRequest, retry = false) {
    if (sending.current || storageBlocked || !navigator.onLine || (!retry && disabled)) return;
    sending.current = true; setBusy(true); setResult(null);
    try {
      // Save BEFORE transport, including revision and both identities; reload preserves intent.
      sessionStorage.setItem(key, JSON.stringify(request));
      setPending(request);
    } catch {
      sending.current = false; setBusy(false); setStorageBlocked(true);
      setResult({ outcome: "rejected", message: "Browser storage is unavailable. No request was sent. Restore storage before continuing." }); return;
    }
    let response: GoalResult;
    try { response = await mutateGoal(request); } catch { response = unknownOutcome; }
    setResult(response);
    if (response.outcome !== "unknown") {
      try { sessionStorage.removeItem(key); setPending(null); }
      catch { setStorageBlocked(true); }
      if (response.outcome === "success") {
        if (request.kind === "create") { creationForm.current?.reset(); router.push(`/goals?id=${request.goalId}`); }
        router.refresh();
      }
    }
    sending.current = false; setBusy(false);
  }
  function metadata(form: HTMLFormElement, editing: boolean) {
    const fields = new FormData(form);
    const base = { userId, commandId: crypto.randomUUID(), title: String(fields.get("title")), description: String(fields.get("description")) };
    void send(editing && goal ? { ...base, kind: "update_metadata", goalId: goal.id, revision: goal.revision } : { ...base, kind: "create", goalId: crypto.randomUUID() });
  }
  return <DetachContext.Provider value={{ disabled: disabled || !!goal?.archived_at, detach: (linkId) => {
    if (goal && !goal.archived_at) void send({ userId, commandId: crypto.randomUUID(), goalId: goal.id, revision: goal.revision, kind: "detach", linkId });
  } }}><div className="goals-workspace mt-6 min-w-0 space-y-6 [overflow-wrap:anywhere]">
    {!online && <p role="status" className="text-sm text-amber-200">Offline. Displayed progress may be out of date. Reconnect and refresh Goals before continuing.</p>}
    <div className="goals-scope-controls">
      <Link prefetch={false} className={goalButton} aria-current={scope === "unarchived" ? "page" : undefined} href="/goals">Active Main Quests</Link>
      <Link prefetch={false} className={goalButton} aria-current={scope === "archived" ? "page" : undefined} href="/goals?scope=archived">Archived Main Quests</Link>
      <button type="button" className={goalButton} onClick={() => router.refresh()}>Refresh Goals</button>
    </div>
    <section aria-label="Main Quest changes" aria-busy={busy} className="goals-feedback space-y-3">
      {result && <p role={result.outcome === "success" ? "status" : "alert"} className="text-sm text-amber-200">{result.message}</p>}
      {pending && <div className="goals-pending-change">
        <p className="text-sm">Saved Main Quest change: {pending.kind.replaceAll("_", " ")}. Resolve it before making another change.</p>
        <button type="button" className={`${goalButton} mt-2`} disabled={busy || storageBlocked || !online} onClick={() => send(pending, true)}>{busy ? "Saving…" : "Retry saved request"}</button>
      </div>}
    </section>
    {selected && !detail && <p role="alert">This Main Quest is unavailable. Refresh Goals to try again. Progress could not be read.</p>}
    {goal && detail && <section aria-label="Main Quest detail" className={`goals-detail min-w-0 ${goal.archived_at ? "goals-detail-archived" : ""}`}>
      <p className="text-xs tracking-widest text-sky-300">MAIN QUEST</p>
      <h2 className="goals-detail-title mt-2">{goal.title}</h2>
      {goal.description && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{goal.description}</p>}
      <GoalProgress goal={goal} />
      <p className="mt-3 text-xs text-zinc-500">Created {goal.created_at.slice(0, 10)} · Updated {goal.updated_at.slice(0, 10)}</p>
      {goal.archived_at && <p className="mt-4 text-sm text-amber-200">This Main Quest is read-only until restored. Sub Quest progress stays live; ordinary Quest actions remain available.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={goalButton} disabled={disabled} onClick={() => send({ userId, commandId: crypto.randomUUID(), goalId: goal.id, revision: goal.revision, kind: "set_archived", archived: !goal.archived_at })}>
          {goal.archived_at ? "Restore Main Quest" : "Archive Main Quest"}
        </button>
      </div>
      {!goal.archived_at && <details className="mt-4">
        <summary className={`${goalButton} cursor-pointer`}>Edit Main Quest</summary>
        <form key={`${goal.id}:${goal.revision}`} className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); metadata(event.currentTarget, true); }}>
          <fieldset disabled={disabled} className="min-w-0 space-y-3">
            <label className="block text-sm">Title<input className={goalInput} name="title" defaultValue={goal.title} maxLength={120} required /></label>
            <label className="block text-sm">Description (optional)<textarea className={goalInput} name="description" defaultValue={goal.description ?? ""} maxLength={4000} rows={3} /></label>
            <button className={goalButton}>Save Main Quest</button>
          </fieldset>
        </form>
      </details>}
      <h3 className="goals-subquests-heading mt-6">Sub Quests</h3>
      <p className="mt-1 text-sm text-zinc-400">In attach order. Complete or reopen through the existing Quest controls below.</p>
      {children}
      {detail.subquests.length === 0 && <p className="mt-3 text-sm text-zinc-400">No Sub Quests yet. Attach existing one-off Quests to start tracking progress.</p>}
      {!goal.archived_at && <>
        <details className="mt-5" key={goal.id}>
          <summary className={`${goalButton} cursor-pointer`}>Attach Sub Quest</summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-400">Choose an existing, unattached one-off Quest. Recurring Quests cannot be Sub Quests.</p>
            {candidates === null ? <p role="alert">Candidates are unavailable. Refresh Goals to try again.</p> : <>
              {candidates.candidates.length ? <form onSubmit={(event) => {
                event.preventDefault(); const questId = String(new FormData(event.currentTarget).get("quest"));
                void send({ userId, commandId: crypto.randomUUID(), goalId: goal.id, revision: goal.revision, kind: "attach", questId });
              }}><fieldset disabled={disabled} className="min-w-0 space-y-3">
                <div>
                  <label className="block text-sm" htmlFor="goal-eligible-quest">Eligible Quest</label>
                  <select id="goal-eligible-quest" className={goalInput} name="quest" required defaultValue=""><option value="" disabled>Choose a Quest</option>{candidates.candidates.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}</select>
                </div>
                <button className={goalButton}>Attach selected Quest</button>
              </fieldset></form> : <p className="text-sm">No eligible Quests on this page.</p>}
              <div className="flex flex-wrap gap-2">
                {candidateAfter && <Link prefetch={false} className={goalButton} href={href(goal.id)}>First candidates</Link>}
                {candidates.next && <Link prefetch={false} className={goalButton} href={href(goal.id, null, candidates.next)}>More candidates</Link>}
              </div>
            </>}
            <Link prefetch={false} className={goalButton} href="/dashboard">Create a normal Quest in Dashboard</Link>
          </div>
        </details>
      </>}
    </section>}
    <section aria-label="Create Main Quest" className="goals-create">
      <h2 className="text-lg font-semibold">Create Main Quest</h2>
      <form ref={creationForm} className="mt-3" onSubmit={(event) => { event.preventDefault(); metadata(event.currentTarget, false); }}>
        <fieldset disabled={disabled} className="min-w-0 space-y-3">
          <label className="block text-sm">Title<input className={goalInput} name="title" maxLength={120} required /></label>
          <label className="block text-sm">Description (optional)<textarea className={goalInput} name="description" maxLength={4000} rows={3} /></label>
          <button className={`${goalButton} border-sky-700 text-sky-200`}>Create Main Quest</button>
        </fieldset>
      </form>
    </section>
    <section aria-label="Main Quest list" className="goals-list">
      <h2 className="text-xl font-semibold">{scope === "archived" ? "Archived Main Quests" : "Active Main Quests"}</h2>
      {page === null ? <p role="alert" className="mt-3">Goals are unavailable. Refresh Goals to try again. Progress could not be read.</p> : <>
        {!page.goals.length && <p className="mt-3 text-zinc-400">{scope === "archived" ? "No archived Main Quests." : "No Main Quests yet. Create one above."}</p>}
        <ul className="mt-4 grid min-w-0 gap-4">
          {page.goals.map((item) => <li key={item.id} className={`goals-list-item ${item.is_complete ? "goals-list-item-complete" : ""}`}>
            <h3 className="text-lg font-medium"><Link prefetch={false} href={href(item.id)} className="inline-flex min-h-11 items-center underline decoration-zinc-600 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{item.title}</Link></h3>
            {item.description && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-400">{item.description}</p>}
            <GoalProgress goal={item} />
          </li>)}
        </ul>
        {page.next_after_id && <Link prefetch={false} className={`${goalButton} mt-4`} href={href(undefined, page.next_after_id)}>Next Main Quests</Link>}
      </>}
    </section>
  </div></DetachContext.Provider>;
}
