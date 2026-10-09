"use client";

import { useState, useSyncExternalStore } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Button, Notice, Panel, SectionHeader } from "@/components/ui/primitives";
import { useLocale } from "@/lib/localization/provider";
import { archiveBook, editBook, restoreBook, setBookStatus } from "./actions";
import { refreshLibraryBook } from "./read-book";
import { createDetailWorkflow } from "./detail-workflow";
import { BOOK_STATUSES, canEditBook, type Book, type BookStatus } from "./model";
import { BookContent } from "./book-content";
import { BookFieldInputs } from "./book-fields";
import { LibraryFeedback } from "./feedback";

export function BookWorkspace({ book }: { book: Book }) {
  const { messages: { library: t } } = useLocale();
  const router = useRouter();
  const [workflow] = useState(() => createDetailWorkflow(book, {
    edit: editBook, status: setBookStatus, archive: archiveBook, restore: restoreBook,
    read: refreshLibraryBook, refresh: () => router.refresh(), rethrow: unstable_rethrow,
  }));
  const state = useSyncExternalStore(workflow.subscribe, workflow.snapshot, workflow.initial);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const locked = state.busy || state.review || state.needsRefresh;
  return <div className="library-workspace" aria-busy={state.busy}>
    <div className="library-feedback">
      <LibraryFeedback failure={state.failure} saved={state.saved} copy={t} />
      {state.readFailed && <Notice role="alert" tone="warning">{state.saved ? t.savedRefresh : t.unavailable}</Notice>}
      {(state.review || state.needsRefresh || state.readFailed) && <div className="library-actions"><Button disabled={state.busy} onClick={() => void workflow.check()}>{state.saved ? t.refresh : t.check}</Button></div>}
    </div>
    <Panel aria-label={t.detail} className="library-detail">
      <BookContent book={state.book} copy={t} />
      {!canEditBook(state.book) && <Notice role="status">{t.readOnly}</Notice>}
      {!state.editing && <div className="library-actions">
        {canEditBook(state.book) ? <Button variant="primary" disabled={locked} onClick={workflow.edit}>{t.edit}</Button>
          : <Button variant="primary" disabled={locked} onClick={() => void workflow.restore()}>{t.restore}</Button>}
      </div>}
      {!state.editing && canEditBook(state.book) && <form className="library-status-form" onSubmit={event => {
        event.preventDefault(); const status = new FormData(event.currentTarget).get("status") as BookStatus;
        void workflow.status(status);
      }}>
        <div><label htmlFor="library-status">{t.fields.status}</label>
          <select key={`${state.book.revision}:${state.book.status}`} id="library-status" name="status" className="ui-field" defaultValue={state.book.status} disabled={locked}>
            {BOOK_STATUSES.map(status => <option key={status} value={status}>{t.statuses[status]}</option>)}
          </select></div><Button type="submit" disabled={locked}>{t.statusSave}</Button>
      </form>}
    </Panel>
    {state.editing && <Panel aria-label={t.editTitle} className="library-editor">
      <SectionHeader title={t.editTitle} description={t.draftHint} />
      <form noValidate onSubmit={event => { event.preventDefault(); void workflow.save(); }}>
        <BookFieldInputs prefix="library-edit" value={state.draft} onChange={workflow.draft} disabled={state.busy} failure={state.failure} copy={t} />
        <div className="library-actions"><Button type="submit" variant="primary" disabled={locked}>{state.busy ? t.working : t.save}</Button>
          <Button disabled={state.busy || state.review} onClick={workflow.cancel}>{t.cancel}</Button></div>
      </form>
    </Panel>}
    {state.review && state.latest && <Panel aria-label={t.review} className="library-review">
      <SectionHeader title={t.review} description={t.reviewHint} />
      <BookContent book={state.latest} copy={t} />
      {!canEditBook(state.latest) && <Notice role="status">{t.readOnly}</Notice>}
      <div className="library-actions">
        {state.editing && canEditBook(state.latest) && <Button disabled={state.busy} onClick={() => workflow.acceptLatest(true)}>{t.keepDraft}</Button>}
        <Button disabled={state.busy} onClick={() => workflow.acceptLatest(false)}>{state.editing ? t.discardDraft : t.useSaved}</Button>
      </div>
    </Panel>}
    {!state.editing && canEditBook(state.book) && <section className="library-lifecycle" aria-label={t.archive}>
      <p className="text-muted">{t.archiveHint}</p>
      {!confirmArchive ? <Button disabled={locked} onClick={() => setConfirmArchive(true)}>{t.archive}</Button>
        : <Notice role="status" tone="warning"><p>{t.archivePrompt}</p><div className="library-actions">
          <Button disabled={locked} onClick={() => { setConfirmArchive(false); void workflow.archive(); }}>{t.confirmArchive}</Button>
          <Button disabled={state.busy} onClick={() => setConfirmArchive(false)}>{t.cancel}</Button>
        </div></Notice>}
    </section>}
  </div>;
}
