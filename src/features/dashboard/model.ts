import { addCalendarDays, MAX_CALENDAR_DATE } from "@/features/quests/dates";
import { entriesForDay, type CalendarEntry } from "@/features/calendar/model";

export function snapshotEnd(day: string) {
  try { return addCalendarDays(day, 6); } catch { return MAX_CALENDAR_DATE; }
}

/** Reuse Calendar membership and source order; show each entry on its first visible day. */
export function calendarSnapshot(entries: CalendarEntry[], day: string, timezone: string) {
  const seen = new Set<string>();
  const items: { entry: CalendarEntry; day: string }[] = [];
  const end = snapshotEnd(day);
  for (let date = day; date <= end;) {
    for (const entry of entriesForDay(entries, date, timezone)) {
      const key = entry.source + entry.entry_id;
      if (!seen.has(key)) { seen.add(key); items.push({ entry, day: date }); }
    }
    if (date === end) break;
    date = addCalendarDays(date, 1);
  }
  return items.slice(0, 3);
}
