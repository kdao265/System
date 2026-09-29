// Pure Calendar view-model: which window each view shows and how the Month grid is laid
// out. It reads nothing and stores nothing; every value is derived from the single
// get_calendar_events range read, so switching views changes the window only (CS-10).
import { addCalendarDays, formatCalendarMonth, isCalendarDate } from "@/features/quests/dates";
import { utcToLocalInput } from "@/features/quests/time";
import { calendarWeek, entriesForDay, type CalendarEntry } from "./model";

export const CALENDAR_VIEWS = ["day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** Absent or unknown input keeps the shipped default window: the week. */
export function calendarView(value: unknown): CalendarView {
  return value === "day" || value === "month" ? value : "week";
}

export function weekdayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

/** Monday-first index: 0 = Monday … 6 = Sunday. */
function mondayIndex(day: string) {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function monthEdges(day: string) {
  const key = day.slice(0, 7);
  const [year, month] = key.split("-").map(Number);
  const last = new Date(`${key}-01T00:00:00Z`);
  last.setUTCFullYear(year, month, 0);
  return { key, first: `${key}-01`, lastDay: last.getUTCDate() };
}

export type MonthGrid = {
  month: string; label: string;
  weeks: string[][]; days: string[];
  previous: string | null; next: string | null;
};

/**
 * Whole Monday-first weeks covering the containing month, so every column keeps one
 * weekday. Days before/after the month are returned too: the caller mutes them.
 */
export function calendarMonth(day: string): MonthGrid {
  const { key, first, lastDay } = monthEdges(day);
  const lead = mondayIndex(first);
  const cells = Math.ceil((lead + lastDay) / 7) * 7;
  let start = first;
  try { start = addCalendarDays(first, -lead); } catch { /* month begins at the supported range edge */ }
  const days: string[] = [];
  for (let i = 0; i < cells; i++) {
    try { const value = addCalendarDays(start, i); if (isCalendarDate(value)) days.push(value); } catch { /* clamp at the range edge */ }
  }
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return { month: key, label: formatCalendarMonth(first), weeks, days, previous: shiftMonth(day, -1), next: shiftMonth(day, 1) };
}

/** The same day-of-month in an adjacent month, clamped to that month's last day. */
export function shiftMonth(day: string, amount: number): string | null {
  if (!isCalendarDate(day) || !Number.isInteger(amount)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const index = year * 12 + (month - 1) + amount;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  if (targetYear < 1 || targetYear > 9999) return null;
  const key = `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}`;
  const { lastDay } = monthEdges(`${key}-01`);
  const candidate = `${key}-${String(Math.min(date, lastDay)).padStart(2, "0")}`;
  return isCalendarDate(candidate) ? candidate : null;
}

/** Inclusive first/last day of the window one read must cover for a view. */
export function viewWindow(view: CalendarView, date: string) {
  if (view === "day") return { from: date, to: date };
  if (view === "month") {
    const { days } = calendarMonth(date);
    return { from: days[0], to: days.at(-1)! };
  }
  const week = calendarWeek(date);
  return { from: week[0], to: week.at(-1)! };
}

/** Steps the selected date by one period, and keeps Month jumps on the same day-of-month. */
export function shiftPeriod(view: CalendarView, date: string, amount: number): string | null {
  if (view === "month") return shiftMonth(date, amount);
  try { return addCalendarDays(date, amount * (view === "week" ? 7 : 1)); } catch { return null; }
}

export type DaySummary = { items: CalendarEntry[]; total: number };

/**
 * Profile-local calendar day and minutes from local midnight for an absolute instant.
 * The Week timeline positions items by wall-clock time, which is what the Profile
 * timezone means for the owner, so this is the only place the timeline reads a clock.
 */
export function profileDayMinutes(value: string, timezone: string) {
  const [day, clock] = utcToLocalInput(value, timezone).split("T");
  const [hour, minute] = clock.split(":").map(Number);
  return { day, minutes: hour * 60 + minute };
}

/** Timeline window: 06:00 to midnight of the Profile-local day, 44px per hour. */
export const TIMELINE_START = 6 * 60;
export const TIMELINE_END = 24 * 60;
export const TIMELINE_HOUR = 44;
export const TIMELINE_HEIGHT = (TIMELINE_END - TIMELINE_START) / 60 * TIMELINE_HOUR;

export type TimelineSpan = { column: number; top: number; height: number; starts: boolean };

/**
 * First visible day slice of a timed entry. Date-only, untimed and wholly off-hours
 * entries return null and remain in the day's band/agenda. Membership comes from the
 * existing projection rules: Schedule Events can continue onto subsequent days,
 * while Quest occurrences belong only to their scheduled day. Geometry is clipped
 * to the working window; a minimum display height never invents a stored end time.
 */
export function timelineSpan(entry: CalendarEntry, days: string[], timezone: string): TimelineSpan | null {
  if (!entry.start_at || entry.all_day) return null;
  const start = profileDayMinutes(entry.start_at, timezone);
  const end = entry.end_at ? profileDayMinutes(entry.end_at, timezone) : null;
  for (const [column, day] of days.entries()) {
    if (!entriesForDay([entry], day, timezone).length) continue;
    const from = start.day === day ? start.minutes : 0;
    const to = end ? end.day > day ? TIMELINE_END : end.minutes : from + 45;
    if (to <= TIMELINE_START || from >= TIMELINE_END) continue;
    const top = (Math.max(from, TIMELINE_START) - TIMELINE_START) / 60 * TIMELINE_HOUR;
    const bottom = (Math.min(Math.max(to, from + 30), TIMELINE_END) - TIMELINE_START) / 60 * TIMELINE_HOUR;
    const height = Math.min(Math.max(bottom - top, TIMELINE_HOUR / 3), TIMELINE_HEIGHT - top);
    return { column, top, height, starts: start.day === day && from >= TIMELINE_START };
  }
  return null;
}

/** Pixels from the top of the timeline for "now", or null when it is outside the window. */
export function timelineNow(now: string, today: string, days: string[], timezone: string): number | null {
  if (!days.includes(today)) return null;
  const at = profileDayMinutes(now, timezone);
  if (at.day !== today || at.minutes < TIMELINE_START || at.minutes > TIMELINE_END) return null;
  return (at.minutes - TIMELINE_START) / 60 * TIMELINE_HOUR;
}

/**
 * Which side-by-side lane each timeline item needs so overlapping items stay visible:
 * lane one for the first item in a cluster, two for the next item that begins before the
 * first has finished, and so on. `count` is how many lanes the busiest moment needs.
 */
export function timelineLanes(spans: { top: number; height: number }[]) {
  const lanes: number[] = [];
  const busy: number[] = [];
  for (const span of spans) {
    const free = busy.findIndex((bottom) => bottom <= span.top);
    const lane = free === -1 ? busy.length : free;
    busy[lane] = span.top + span.height;
    lanes.push(lane);
  }
  return { lanes, count: Math.max(1, busy.length) };
}



/**
 * Per-day entries for the Month grid. Every day of the rendered grid is present, even
 * when empty, so the server does no truncation and the client can decide how much room
 * the current viewport has: `items` carries the ordered day slice and `total` its size.
 */
export function daySummaries(entries: CalendarEntry[], days: string[], timezone: string): Record<string, DaySummary> {
  const summaries: Record<string, DaySummary> = {};
  for (const day of days) {
    const items = entriesForDay(entries, day, timezone);
    summaries[day] = { items, total: items.length };
  }
  return summaries;
}

/**
 * Cell budget for the Month grid: at most `perDay` entries per day, and at most
 * `perWeek` in one row. When a row is fuller than its budget, the entries it can show
 * are spread over the days that hold work instead of filling the first day and leaving
 * the rest of the row empty. Counts hidden by either limit are what the cell reports
 * as its remaining count, so nothing shown is silently dropped.
 */
export function cellBudget(days: string[], summaries: Record<string, DaySummary>, perDay: number, perWeek: number) {
  const shown: Record<string, number> = {};
  for (let row = 0; row * 7 < days.length; row++) {
    const week = days.slice(row * 7, row * 7 + 7);
    const busy = week.filter((day) => (summaries[day]?.total ?? 0) > 0);
    const total = busy.reduce((sum, day) => sum + (summaries[day]?.total ?? 0), 0);
    const share = total <= perWeek ? perDay : Math.max(1, Math.floor(perWeek / busy.length));
    for (const day of week) {
      const summary = summaries[day];
      shown[day] = summary ? Math.min(summary.items.length, perDay, share) : 0;
    }
  }
  return shown;
}

/** Wide tier: at most this many titled chips per cell, and per row of seven cells. */
export const MONTH_CHIPS_PER_DAY = 3;
export const MONTH_CHIPS_PER_WEEK = 8;
/**
 * Compact tier: one small dot per entry up to this many. Dots replace the titled chips
 * when a cell is too narrow for text, and they still carry the entry kind as a color.
 */
export const MONTH_DOTS_PER_DAY = 4;

export type MonthCell = {
  day: string; outside: boolean;
  chips: CalendarEntry[]; more: number;
  dots: CalendarEntry[]; dotMore: number;
};

/**
 * The Month grid as fully decided cells, one row per week. Two tiers are computed for
 * every cell so the same markup serves any width and CSS picks the one that fits the
 * viewport the page was given — no script runs to lay the Month View out. `more` is the
 * count behind the titled chips, `dotMore` the count behind the dots; the day's agenda
 * always holds everything.
 */
export function monthCells(grid: MonthGrid, summaries: Record<string, DaySummary>): MonthCell[][] {
  const shown = cellBudget(grid.days, summaries, MONTH_CHIPS_PER_DAY, MONTH_CHIPS_PER_WEEK);
  const cell = (day: string): MonthCell => {
    const summary = summaries[day] ?? { items: [], total: 0 };
    const chips = summary.items.slice(0, shown[day] ?? 0);
    const dots = summary.items.slice(0, MONTH_DOTS_PER_DAY);
    return {
      day, outside: day.slice(0, 7) !== grid.month,
      chips, more: summary.total - chips.length,
      dots, dotMore: summary.total - dots.length,
    };
  };
  return grid.weeks.map((week) => week.map(cell));
}
