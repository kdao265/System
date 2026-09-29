// Server-rendered Calendar views: Month grid, Week schedule and the shared day cell.
// They present the entries the single projection returned for the current window and
// never fetch, reorder or copy them: Quest occurrences stay Quest occurrences and
// Schedule Events stay Schedule Events (CS-04). The visual kind comes from the entry's
// source, all-day flag and status — never a stored color.
import Link from "next/link";
import { formatCalendarDate } from "@/features/quests/dates";
import { formatProfileClock } from "@/features/quests/time";
import { entriesForDay, type CalendarEntry } from "./model";
import { weekdayLabel, TIMELINE_END, TIMELINE_HEIGHT, TIMELINE_HOUR, TIMELINE_START, timelineLanes, timelineNow, timelineSpan, type MonthCell, type MonthGrid, type TimelineSpan } from "./view";

// The gutter and every day column repeat the same two heights (h-8 heading, h-12 band)
// so their hour rules line up; they are Tailwind classes, not measured values.
/**
 * Timeline geometry is authored in design pixels at the default root size (one hour is
 * 44px) and written out in rem, so the hour rules drawn by CSS, the Tailwind blocks above
 * the timeline and the absolutely positioned items all scale together at any font size.
 */
function rem(designPixels: number) {
  return `${designPixels / 16}rem`;
}

/** The two Calendar kinds: a Schedule Event, or a Quest occurrence projected in. */
export function entryKind(entry: CalendarEntry): "quest" | "event" {
  return entry.source === "quest_occurrence" ? "quest" : "event";
}

export function entryKindLabel(entry: CalendarEntry) {
  if (entry.source === "quest_occurrence") return entry.source_slot_date ? "Recurring Quest" : "Quest";
  return "Schedule Event";
}

function chipLabel(entry: CalendarEntry, timezone: string) {
  if (entry.all_day) return "All day";
  if (entry.start_at) return formatProfileClock(entry.start_at, timezone);
  return "Untimed";
}

function chipTone(entry: CalendarEntry) {
  const quest = entryKind(entry) === "quest";
  return { quest, done: quest && entry.status === "completed" };
}

/** One titled entry in a Month cell, a Week band or a Week timeline column. */
export function EntryChip({ entry, timezone, timeClassName = "hidden min-[560px]:inline" }: {
  entry: CalendarEntry; timezone: string; timeClassName?: string;
}) {
  const { quest, done } = chipTone(entry);
  return <li data-cal-entry={quest ? "quest" : "event"}
    className={`flex min-w-0 items-center gap-1 border-l-2 px-1 ${quest ? "border-cal-quest bg-cal-quest/15" : "border-cal-event bg-cal-event/15"} ${done ? "opacity-50" : ""}`}>
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${quest ? "bg-cal-quest" : "bg-cal-event"}`} />
    <span className={`shrink-0 text-[10px] tabular-nums text-zinc-400 ${timeClassName}`}>{chipLabel(entry, timezone)}</span>
    <span className={`min-w-0 truncate text-[11px] leading-[15px] ${quest ? "text-violet-100" : "text-sky-100"}`}>{entry.title}</span>
  </li>;
}

/** One entry as a kind-colored dot: the compact Month tier, where text cannot fit. */
export function EntryDot({ entry }: { entry: CalendarEntry }) {
  const { quest, done } = chipTone(entry);
  return <li data-cal-entry={quest ? "quest" : "event"} aria-hidden="true"
    className={`h-1.5 w-1.5 rounded-full ${quest ? "bg-cal-quest" : "bg-cal-event"} ${done ? "opacity-40" : ""}`} />;
}

function cellLabel(cell: MonthCell, isToday: boolean) {
  const total = cell.chips.length + cell.more;
  const detail = total === 0 ? "no entries"
    : `${cell.chips.map((entry) => entry.title).join(", ")}${cell.more > 0 ? `, and ${cell.more} more` : ""}`;
  return `${formatCalendarDate(cell.day)}${isToday ? " — today" : ""}${cell.outside ? " (outside the shown month)" : ""}: `
    + `${total} ${total === 1 ? "entry" : "entries"} — ${detail}`;
}

/**
 * One Month cell. Two content tiers are rendered and CSS picks one from the viewport it
 * was given: titled chips with a "+N more" line once a cell is wide enough for text,
 * kind dots plus a short remainder count while it is not. The whole cell is a link to
 * that day, and its accessible name carries the day's real titles either way.
 */
export function MonthDayCell({ cell, selected, isToday, timezone, href }: {
  cell: MonthCell; selected: boolean; isToday: boolean; timezone: string; href: (day: string) => string;
}) {
  return <Link prefetch={false} href={href(cell.day)} data-cal-cell={cell.day} aria-label={cellLabel(cell, isToday)}
    aria-current={selected ? "date" : undefined}
    className={`flex h-[58px] min-h-0 min-w-0 flex-col gap-1 p-1 text-left min-[420px]:h-[84px] min-[720px]:h-[104px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white ${
      cell.outside ? "bg-cal-outside" : "bg-cal-cell"} ${
      selected ? "bg-zinc-800/70 shadow-[inset_0_0_0_2px_#fafafa]"
        : isToday ? "bg-sky-400/5 shadow-[inset_0_0_0_1px_#0ea5e9]" : ""}`}>
    <span className="flex items-center gap-1">
      <span aria-hidden="true" className={`text-[11px] leading-none tabular-nums min-[420px]:hidden ${cell.outside ? "text-zinc-600" : "text-zinc-500"}`}>
        {weekdayLabel(cell.day).slice(0, 1)}
      </span>
      <span className={`text-xs leading-none tabular-nums ${isToday ? "rounded-full bg-sky-400/25 px-1.5 py-0.5 font-semibold text-sky-200" : cell.outside ? "text-zinc-600" : "text-zinc-200"}`}>
        {Number(cell.day.slice(8))}
      </span>
      {isToday && <span className="hidden text-[9px] uppercase tracking-[0.08em] text-sky-300 min-[420px]:inline">Today</span>}
    </span>
    <ul className="hidden min-w-0 flex-col gap-[3px] min-[420px]:flex">
      {cell.chips.map((entry) => <EntryChip key={`${entry.source}:${entry.entry_id}`} entry={entry} timezone={timezone} />)}
    </ul>
    <ul className="flex flex-wrap gap-[3px] min-[420px]:hidden">
      {cell.dots.map((entry) => <EntryDot key={`${entry.source}:${entry.entry_id}`} entry={entry} />)}
    </ul>
    {cell.more > 0 && <span data-cal-more="wide" className="hidden text-[10px] font-semibold leading-none text-zinc-400 min-[420px]:inline">+{cell.more} more</span>}
    {cell.dotMore > 0 && <span data-cal-more="compact" className="text-[10px] font-semibold leading-none text-zinc-400 min-[420px]:hidden">+{cell.dotMore}</span>}
  </Link>;
}

/** Weekday column headings; the single-letter form is the compact tier. */
export function WeekdayHeader({ days }: { days: string[] }) {
  return <div aria-hidden="true" className="grid grid-cols-7 gap-px rounded-t-lg border border-cal-line bg-cal-line">
    {days.slice(0, 7).map((day) => <div key={day} className="bg-zinc-900/90 py-1.5 text-center text-[10px] uppercase tracking-[0.08em] text-zinc-500">
      <span className="hidden min-[420px]:inline">{weekdayLabel(day)}</span>
      <span className="min-[420px]:hidden">{weekdayLabel(day).slice(0, 1)}</span>
    </div>)}
  </div>;
}


/**
 * One day of the Week View: heading, all-day band and the timed timeline column. The
 * column is one cell of the shared seven-column row, so nothing scrolls sideways; a
 * narrow screen simply shows fewer characters, and that day's agenda is the readable
 * source of truth for its full titles and times.
 */
function WeekColumn({ day, entries, timezone, today, nowTop, href, selected }: {
  day: string; entries: CalendarEntry[]; timezone: string; today: string; nowTop: number | null;
  href: (day: string) => string; selected: boolean;
}) {
  const isToday = day === today;
  const timed = entries.map((entry) => ({ entry, span: timelineSpan(entry, [day], timezone) }))
    .filter((item): item is { entry: CalendarEntry; span: TimelineSpan } => !!item.span)
    .sort((a, b) => a.span.top - b.span.top);
  const lanes = timelineLanes(timed.map((item) => item.span));
  const banded = entries.filter((entry) => !timelineSpan(entry, [day], timezone));
  return <div className={`flex min-w-0 flex-1 flex-col ${isToday ? "bg-sky-400/[0.05]" : "bg-cal-cell"}`}>
    <Link prefetch={false} href={href(day)} aria-current={selected ? "date" : undefined}
      aria-label={`${weekdayLabel(day)} ${Number(day.slice(8))}: ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
      className={`h-8 border-b border-cal-line text-center text-[11px] leading-8 tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white ${
        isToday ? "bg-sky-400/15 font-semibold text-sky-200" : selected ? "bg-zinc-800/70 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50"}`}>
      <span className="min-[420px]:hidden">{Number(day.slice(8))}</span>
      <span className="hidden min-[420px]:inline">{weekdayLabel(day).slice(0, 3)} {Number(day.slice(8))}</span>
    </Link>
    <ul aria-label={`All-day, untimed and off-hours entries on ${formatCalendarDate(day)}`}
      className="h-12 min-w-0 space-y-[2px] overflow-hidden border-b border-cal-line px-px py-px">
      {banded.slice(0, 3).map((entry) => <EntryChip key={`${entry.source}:${entry.entry_id}`} entry={entry} timezone={timezone} timeClassName="hidden min-[420px]:inline" />)}
      {banded.length > 3 && <li className="px-1 text-[10px] leading-[13px] text-zinc-400">+{banded.length - 3} more</li>}
    </ul>
    <div className="cal-timeline relative" style={{ height: rem(TIMELINE_HEIGHT) }}>
      {timed.map(({ entry, span }, index) => <ul key={`${entry.source}:${entry.entry_id}`} data-cal-timed=""
        style={{ top: rem(span.top), height: rem(span.height), left: `${(lanes.lanes[index] / lanes.count) * 55}%` }}
        className="absolute right-0 min-w-0 overflow-hidden">
        <EntryChip entry={entry} timezone={timezone} />
      </ul>)}
      {nowTop !== null && <div aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-amber-400/70" style={{ top: rem(nowTop) }} />}
    </div>
  </div>;
}

/**
 * The Week View as one real weekly schedule: every timed entry sits at its
 * Profile-local clock position on a shared hour rule, all-day and untimed entries share
 * the band above it, and a dashed rule marks "now" when today is inside the week. Items
 * that overlap in time keep separate lanes so both stay visible.
 */
export function WeekView({ days, entries, today, now, timezone, href, selected }: {
  days: string[]; entries: CalendarEntry[]; today: string; now: string; timezone: string;
  href: (day: string) => string; selected: string;
}) {
  const hours = Array.from({ length: (TIMELINE_END - TIMELINE_START) / 60 }, (_, index) => TIMELINE_START / 60 + index);
  return <div role="group" aria-label={`Week of ${formatCalendarDate(days[0])}`}
    className="mt-1 flex gap-px overflow-hidden rounded-lg border border-cal-line bg-cal-line">
    <div aria-hidden="true" className="w-9 shrink-0 bg-cal-cell min-[420px]:w-12">
      <div className="h-8 border-b border-cal-line" />
      <div className="h-12 border-b border-cal-line" />
      <div className="relative" style={{ height: rem(TIMELINE_HEIGHT) }}>
        {hours.map((hour) => <span key={hour} style={{ top: rem((hour - TIMELINE_START / 60) * TIMELINE_HOUR - 4) }}
          className="absolute inset-x-0 pr-1 text-right text-[9px] leading-none tabular-nums text-zinc-600">{String(hour).padStart(2, "0")}:00</span>)}
      </div>
    </div>
    {days.map((day) => <WeekColumn key={day} day={day} timezone={timezone} today={today} href={href}
      selected={day === selected} entries={entriesForDay(entries, day, timezone)}
      nowTop={day === today ? timelineNow(now, today, days, timezone) : null} />)}
  </div>;
}

export function MonthView({ grid, cells, selected, today, timezone, href }: {
  grid: MonthGrid; cells: MonthCell[][]; selected: string; today: string; timezone: string; href: (day: string) => string;
}) {
  return <div role="group" aria-label={`${grid.label} calendar`} className="mt-1">
    <WeekdayHeader days={grid.days} />
    {cells.map((week, index) => <div key={index} data-cal-row className="grid grid-cols-7 gap-px border-x border-cal-line bg-cal-line">
      {week.map((cell) => <MonthDayCell key={cell.day} cell={cell} selected={cell.day === selected} isToday={cell.day === today} timezone={timezone} href={href} />)}
    </div>)}
    <div aria-hidden="true" className="h-1 rounded-b-lg bg-cal-line" />
  </div>;
}
