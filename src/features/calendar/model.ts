import { addCalendarDays, isCalendarDate, todayInTimezone } from "@/features/quests/dates";
import { localTimeToUtc, utcToLocalInput } from "@/features/quests/time";
import { UUID } from "@/features/quests/create-pending";

export type CalendarEntry = {
  source: "schedule_event" | "quest_occurrence";
  entry_id: string; quest_id: string | null; title: string; status: string | null;
  start_at: string | null; end_at: string | null; all_day: boolean;
  start_date: string | null; end_date: string | null;
  category: string | null; notes: string | null; source_slot_date: string | null;
};
export type EventDraft = { title: string; start: string; end: string; allDay: boolean; category: string; notes: string };
export type EventRequest = { userId: string; eventId: string; mode: "create" | "update" | "remove"; timezone: string; draft: EventDraft };
export type EventResult = { outcome: "success" | "rejected" | "unknown"; message: string };

export function parseCalendar(data: unknown): CalendarEntry[] | null {
  if (!Array.isArray(data)) return null;
  const textOrNull = (v: unknown) => v === null || typeof v === "string";
  const instant = (v: unknown) => v === null || (typeof v === "string" && Number.isFinite(Date.parse(v)));
  const date = (v: unknown) => v === null || isCalendarDate(v);
  for (const e of data) {
    if (!e || !["schedule_event", "quest_occurrence"].includes(e.source) || !UUID.test(e.entry_id) ||
        typeof e.title !== "string" || typeof e.all_day !== "boolean" ||
        ![e.quest_id, e.status, e.category, e.notes].every(textOrNull) ||
        ![e.start_at, e.end_at].every(instant) || ![e.start_date, e.end_date, e.source_slot_date].every(date)) return null;
    if (e.all_day ? !e.start_date || !e.end_date || e.end_date <= e.start_date
      : !e.start_at && !(e.source === "quest_occurrence" && e.source_slot_date)) return null;
  }
  return data;
}

export function calendarWeek(day: string) {
  const offset = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  // At the supported date limits use the remaining valid dates instead of throwing.
  const days: string[] = [];
  for (let i = -offset; i < 7 - offset; i++) {
    try { days.push(addCalendarDays(day, i)); } catch { /* outside calendar */ }
  }
  return days;
}

export function entriesForDay(entries: CalendarEntry[], day: string, timezone: string) {
  return entries.filter((entry) => {
    if (entry.all_day) return entry.start_date! <= day && entry.end_date! > day;
    if (!entry.start_at) return entry.source_slot_date === day;
    const first = todayInTimezone(timezone, new Date(entry.start_at));
    if (entry.source === "quest_occurrence" || !entry.end_at) return first === day;
    // Exclusive end: subtract one millisecond before grouping, including DST boundaries.
    const last = todayInTimezone(timezone, new Date(Date.parse(entry.end_at) - 1));
    return first <= day && last >= day;
  });
}

export function emptyDraft(day: string): EventDraft {
  return { title: "", start: `${day}T09:00`, end: "", allDay: false, category: "", notes: "" };
}
export function entryDraft(entry: CalendarEntry, timezone: string): EventDraft {
  return { title: entry.title, allDay: entry.all_day, category: entry.category ?? "", notes: entry.notes ?? "",
    start: entry.all_day ? entry.start_date! : utcToLocalInput(entry.start_at!, timezone),
    end: entry.all_day ? addCalendarDays(entry.end_date!, -1) : entry.end_at ? utcToLocalInput(entry.end_at, timezone) : "" };
}

export function eventArguments(draft: EventDraft, timezone: string, eventId: string) {
  if (!draft || typeof draft.allDay !== "boolean" ||
      ![draft.title, draft.start, draft.end, draft.category, draft.notes].every((v) => typeof v === "string") || !UUID.test(eventId)) {
    return { error: "Invalid event. Refresh and try again." } as const;
  }
  const title = draft.title.trim(), category = draft.category.trim();
  if (!title || title.length > 120) return { error: "Enter a title of 1–120 characters." } as const;
  if (category.length > 40 || draft.notes.length > 4000) return { error: "Category allows 40 characters and notes allow 4,000." } as const;
  if (draft.allDay && (!isCalendarDate(draft.start) || (draft.end && !isCalendarDate(draft.end)) || (draft.end && draft.end < draft.start))) {
    return { error: "Choose valid dates, with the last day on or after the first day." } as const;
  }
  // Existing RPCs accept instants. Noon transports the date in the Profile zone;
  // SQL stores authoritative date columns and returns no all-day clock times.
  const start = localTimeToUtc(draft.allDay ? `${draft.start}T12:00` : draft.start, timezone);
  const end = draft.end ? localTimeToUtc(draft.allDay ? `${draft.end}T12:00` : draft.end, timezone) : null;
  if (!start.ok || (end && !end.ok)) return { error: "Choose a valid, unambiguous time in your Profile timezone. Daylight-saving gaps and repeated times cannot be used." } as const;
  if (!draft.allDay && end?.ok && end.value <= start.value) return { error: "End must be after start." } as const;
  const span = draft.allDay && draft.end
    ? Date.parse(`${draft.end}T00:00:00Z`) - Date.parse(`${draft.start}T00:00:00Z`)
    : end?.ok ? Date.parse(end.value) - Date.parse(start.value) : 0;
  if (span > (draft.allDay ? 365 : 366) * 86400000) return { error: "An event can cover at most 366 days." } as const;
  return { args: { p_event_id: eventId, p_title: title, p_start_at: start.value,
    p_end_at: end?.ok ? end.value : null, p_all_day: draft.allDay, p_category: category || null, p_notes: draft.notes || null } } as const;
}
