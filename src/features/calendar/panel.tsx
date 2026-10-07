"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { formatCalendarDate } from "@/features/quests/dates";
import { formatProfileLocal } from "@/features/quests/time";
import { useOnline } from "@/features/network/network-status";
import { useLocale } from "@/lib/localization/provider";
import { QuestDetailLink } from "./quest-detail";
import { saveScheduleEvent } from "./actions";
import { emptyDraft, entriesForDay, entryDraft, type CalendarEntry, type EventDraft, type EventRequest } from "./model";

const button = "ui-button";
const input = "ui-field";

export function CalendarPanel({ entries, days, selectedDate, today, timezone, userId, view }: {
  entries: CalendarEntry[]; days: string[]; selectedDate: string; today: string; timezone: string; userId: string; view: string;
}) {
  const router = useRouter();
  const { messages } = useLocale();
  const online = useOnline();
  const [draft, setDraft] = useState<EventDraft>(() => emptyDraft(selectedDate));
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savedRequest, setSavedRequest] = useState<EventRequest | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const locked = pending || !!savedRequest;

  function change<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function submit(mode: EventRequest["mode"], entry?: CalendarEntry) {
    if (inFlight.current || !online) return;
    inFlight.current = true;
    setPending(true); setMessage("");
    const request = savedRequest ?? { userId, timezone, mode,
      eventId: entry?.entry_id ?? editing ?? crypto.randomUUID(), draft: entry ? entryDraft(entry, timezone) : { ...draft } };
    try {
      const result = await saveScheduleEvent(request);
      setMessage(result.message); setFailed(result.outcome !== "success");
      setSavedRequest(result.outcome === "unknown" ? request : null);
      if (result.outcome === "success") {
        setEditing(null); setDraft(emptyDraft(selectedDate));
        if (request.mode !== "remove") router.push(`/calendar?date=${request.draft.start.slice(0, 10)}&view=${view}`);
        router.refresh();
      }
    } catch (error) {
      unstable_rethrow(error);
      setSavedRequest(request); setFailed(true);
      setMessage("The outcome is unknown. Retry the saved request before leaving this page.");
    } finally {
      inFlight.current = false; setPending(false);
    }
  }

  return <>
    <section aria-label={editing ? "Edit schedule event" : "Create schedule event"} className="calendar-event-form mt-6">
      <h2 className="text-lg font-semibold">{editing ? "Edit schedule event" : "Create schedule event"}</h2>
      <p className="mt-1 text-sm text-zinc-400">Times follow {timezone}. All-day events keep their calendar dates.</p>
      <form aria-busy={pending} className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(editing ? "update" : "create"); }}>
        <fieldset disabled={locked} className="min-w-0 space-y-4">
          <label className="block text-sm">Title<input ref={titleInput} className={input} required maxLength={120} value={draft.title} onChange={(e) => change("title", e.target.value)} /></label>
          <label className="calendar-all-day flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.allDay} onChange={(e) => {
            const allDay = e.target.checked;
            setDraft((d) => ({ ...d, allDay, start: allDay ? d.start.slice(0, 10) : `${d.start}T09:00`, end: "" }));
          }} />All day</label>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="block min-w-0 text-sm">{draft.allDay ? "First day" : "Start"}<input className={input} required type={draft.allDay ? "date" : "datetime-local"} value={draft.start} onChange={(e) => change("start", e.target.value)} /></label>
            <label className="block min-w-0 text-sm">{draft.allDay ? "Last day (optional)" : "End (optional)"}<input className={input} type={draft.allDay ? "date" : "datetime-local"} value={draft.end} onChange={(e) => change("end", e.target.value)} /></label>
          </div>
          <label className="block text-sm">Category (optional)<input className={input} maxLength={40} value={draft.category} onChange={(e) => change("category", e.target.value)} /></label>
          <label className="block text-sm">Notes (optional)<textarea className={input} rows={3} maxLength={4000} value={draft.notes} onChange={(e) => change("notes", e.target.value)} /></label>
        </fieldset>
        {message && <p role={failed ? "alert" : "status"} className="text-sm wrap-anywhere text-zinc-300">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={button} type="submit" disabled={pending || !online}>{pending ? "Saving…" : savedRequest ? "Retry saved request" : editing ? "Save changes" : "Create event"}</button>
          {editing && !savedRequest && <button className={button} type="button" disabled={pending} onClick={() => { setEditing(null); setDraft(emptyDraft(selectedDate)); setMessage(""); }}>Discard edit</button>}
        </div>
      </form>
    </section>
    <div className="mt-6 space-y-4">
      {days.map((day) => {
        const items = entriesForDay(entries, day, timezone);
        return <section key={day} aria-label={formatCalendarDate(day)} className={`calendar-agenda-day ${day === today ? "calendar-agenda-day-today" : ""}`}>
          <h2 className="font-semibold">{formatCalendarDate(day)}{day === today && <span className="ml-2 text-sm text-sky-300">Today</span>}</h2>
          {!items.length ? <p className="mt-3 text-sm text-zinc-400">No calendar entries.</p> : <ul aria-label={`Entries for ${day}`} className="mt-4 space-y-4">
            {items.map((entry) => <li key={`${entry.source}:${entry.entry_id}`} className={`calendar-agenda-item ${entry.source === "quest_occurrence" ? "calendar-agenda-quest" : "calendar-agenda-event"}`}>
              <p className="text-xs text-zinc-400">{entry.source === "quest_occurrence" ? entry.source_slot_date ? "Recurring Quest" : "Quest" : "Schedule event"}{entry.category ? ` · ${entry.category}` : ""}</p>
              <h3 className="mt-1 font-medium wrap-anywhere">{entry.title}</h3>
              <p className="mt-1 text-sm text-zinc-300">{entry.all_day ? "All day" : entry.start_at ? `${formatProfileLocal(entry.start_at, timezone)}${entry.end_at ? ` – ${formatProfileLocal(entry.end_at, timezone)}` : ""}` : "Untimed occurrence"}</p>
              {entry.source === "quest_occurrence" && <>
                {entry.start_at && !entry.end_at && <p className="text-sm text-zinc-400">{messages.questDetail.endNotSet}</p>}
                {entry.deadline_at && <p className="text-sm text-zinc-400">{messages.questDetail.deadline}: {formatProfileLocal(entry.deadline_at, timezone)}</p>}
                <QuestDetailLink id={entry.entry_id}/>
              </>}
              {entry.notes && <p className="mt-2 whitespace-pre-wrap text-sm wrap-anywhere text-zinc-400">{entry.notes}</p>}
              {entry.source === "quest_occurrence" ? <p className="mt-2 text-sm text-violet-300">Status: {entry.status} · <a className="inline-flex min-h-11 items-center underline" href={`/dashboard?date=${day}`}>Open in Quests</a></p> : <div className="mt-3 flex flex-wrap gap-2">
                <button className={button} disabled={locked} onClick={() => {
                  setEditing(entry.entry_id); setDraft(entryDraft(entry, timezone)); setMessage("");
                  titleInput.current?.focus(); titleInput.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                }}>Edit</button>
                <button className={button} disabled={locked || !online} onClick={() => { if (window.confirm(`Remove “${entry.title}” from your calendar?`)) void submit("remove", entry); }}>Remove</button>
              </div>}
            </li>)}
          </ul>}
        </section>;
      })}
    </div>
  </>;
}
