"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Button, Notice, Panel, SectionHeader } from "@/components/ui/primitives";
import { useLocale } from "@/lib/localization/provider";
import { createBook, resolveBookCreate } from "./actions";
import { createBookWorkflow } from "./create-workflow";
import { blankBookFields, BookFieldInputs } from "./book-fields";
import { BookContent } from "./book-content";
import { LibraryFeedback } from "./feedback";

export function LibraryCreateForm({ userId }: { userId: string }) {
  const { messages: { library: t } } = useLocale();
  const router = useRouter();
  const [workflow] = useState(() => createBookWorkflow(userId, {
    storage: () => window.sessionStorage, generateId: () => crypto.randomUUID(), create: createBook,
    resolve: resolveBookCreate, rethrow: unstable_rethrow, refresh: () => router.refresh(), navigate: id => router.push(`/library/${id}`),
  }));
  const state = useSyncExternalStore(workflow.subscribe, workflow.snapshot, workflow.initial);
  const [draft, setDraft] = useState(blankBookFields);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { void workflow.initialize(); }, [workflow]);
  const pending = state.phase === "pending";
  return <Panel className="library-create" aria-label={t.newTitle} aria-busy={state.busy}>
    <SectionHeader title={t.newTitle} description={t.draftHint} />
    <div className="library-feedback">
      {state.notice && <Notice role={state.phase === "saved" || state.notice === "pending" ? "status" : "alert"}
        tone={state.phase === "saved" ? "success" : state.notice === "pending" ? "info" : "warning"}>{t[state.notice]}</Notice>}
      {state.saved?.refreshRequired && state.notice !== "savedRefresh" && <Notice tone="success" role="status">{t.savedRefresh}</Notice>}
      <LibraryFeedback failure={state.failure} copy={t} />
      {state.phase === "blocked" && <div className="library-actions">
        {(state.notice === "invalidIdentity" || state.notice === "accountChanged") && <Button disabled={state.busy} onClick={() => void workflow.clearBlocked()}>{t.resetBlocked}</Button>}
        <Button disabled={state.busy} onClick={() => void workflow.initialize()}>{t.retry}</Button>
      </div>}
      {pending && <div className="library-actions">
        <Button disabled={state.busy} onClick={() => void workflow.check()}>{t.check}</Button>
        {state.notice === "absent" && <Button disabled={state.busy} onClick={workflow.continueSame}>{t.continueSame}</Button>}
        {(state.notice === "absent" || state.notice === "collision") && <Button disabled={state.busy} onClick={() => setConfirmReset(true)}>{t.resetAttempt}</Button>}
      </div>}
      {confirmReset && pending && <Notice tone="warning" role="status"><p>{t.resetPrompt}</p><div className="library-actions">
        <Button disabled={state.busy} onClick={() => { workflow.resetAttempt(); setConfirmReset(false); }}>{t.confirmReset}</Button>
        <Button disabled={state.busy} onClick={() => setConfirmReset(false)}>{t.cancel}</Button>
      </div></Notice>}
      {state.phase === "saved" && <div className="library-actions">
        <a className="ui-button ui-button-primary" href={`/library/${state.saved!.bookId}`}>{t.open}</a>
        {state.notice === "cleanupFailed" && <Button onClick={workflow.retryCleanup}>{t.cleanup}</Button>}
      </div>}
    </div>
    {state.book && <BookContent book={state.book} copy={t} />}
    {state.phase !== "loading" && state.phase !== "saved" && <form noValidate onSubmit={event => { event.preventDefault(); void workflow.submit(draft); }}>
      <BookFieldInputs prefix="library-create" value={draft} onChange={setDraft} disabled={state.busy || state.phase !== "form"} failure={state.failure} copy={t} />
      <div className="library-actions">
        <Button type="submit" variant="primary" disabled={state.busy || state.phase !== "form"}>{state.busy ? t.working : t.add}</Button>
        <Link prefetch={false} className="ui-button" href="/library">{t.cancel}</Link>
      </div>
    </form>}
  </Panel>;
}
