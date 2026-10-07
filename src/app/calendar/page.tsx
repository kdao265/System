import { SystemShell } from "@/components/system-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { ProfileError } from "@/features/profile/profile-error";
import { formatCalendarDate, resolveSelectedDate, todayInTimezone } from "@/features/quests/dates";
import { getCalendar } from "@/features/calendar/data";
import { calendarWeek } from "@/features/calendar/model";
import { CalendarPanel } from "@/features/calendar/panel";
import { CalendarQuestDetails } from "@/features/calendar/quest-detail";
import { MonthView, WeekView } from "@/features/calendar/views";
import { CALENDAR_VIEWS, calendarMonth, calendarView, daySummaries, monthCells, shiftPeriod, viewWindow, weekdayLabel } from "@/features/calendar/view";

export const dynamic = "force-dynamic";
const link = "ui-button calendar-toolbar-button";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string | string[]; view?: string | string[] }> }) {
  const { user, profile, error } = await getProfileContext();
  if (!profile) return <ProfileError missing={error === "missing"} />;
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
  const timezone = profile.timezone!;
  const params = await searchParams;
  const date = resolveSelectedDate(params.date, timezone);
  const today = todayInTimezone(timezone);
  const view = calendarView(params.view);
  // One range read per view: only the window grows, never a second projection (CS-10).
  const { from, to } = viewWindow(view, date);
  const entries = await getCalendar(from, to);
  const grid = calendarMonth(date);
  const days = view === "day" ? [date] : view === "week" ? calendarWeek(date) : grid.days;
  // The Month grid is the agenda for its whole window, so the list below it stays useful
  // by holding the chosen day instead of repeating forty-two sections.
  const agendaDays = view === "month" ? [date] : days;
  const previous = shiftPeriod(view, date, -1), next = shiftPeriod(view, date, 1);
  const href = (day: string, mode = view) => `/calendar?date=${day}&view=${mode}`;
  const month = entries === null ? null : monthCells(grid, daySummaries(entries, grid.days, timezone));
  return <SystemShell current="calendar" lang="en">
    <header className="calendar-page-header">
      <p className="calendar-kicker">CALENDAR</p>
      <p className="mt-2 text-sm text-zinc-400">Your time, alongside existing Quest occurrences. Timezone: {timezone}.</p>
    </header>
    <div className="calendar-toolbar">
    <nav aria-label="Calendar navigation" className="calendar-toolbar-group">
      {previous && <Link prefetch={false} className={link} href={href(previous)}>Previous {view}</Link>}
      <Link prefetch={false} className={link} href={href(today)}>Today</Link>
      {next && <Link prefetch={false} className={link} href={href(next)}>Next {view}</Link>}
    </nav>
    <nav aria-label="Calendar view" className="calendar-toolbar-group">
      {CALENDAR_VIEWS.map((mode) => <Link prefetch={false} key={mode} className={link} aria-current={mode === view ? "page" : undefined} href={href(date, mode)}>{mode[0].toUpperCase() + mode.slice(1)}</Link>)}
    </nav>
    <form action="/calendar" className="calendar-date-form">
      <input type="hidden" name="view" value={view} />
      <label className="min-w-0 text-sm">Choose date<input key={date} className="ui-field mt-1 calendar-date-field" name="date" type="date" defaultValue={date} required /></label>
      <button className={link}>View</button>
    </form>
    </div>
    {view !== "month" && <nav aria-label="Days of the week" className="calendar-day-strip">
      {calendarWeek(date).map((day) => <Link prefetch={false} key={day} href={href(day, "day")} aria-label={formatCalendarDate(day)} aria-current={day === date ? "date" : undefined}
        className={`${link} flex-col ${day === today ? "border-sky-500 text-sky-300" : ""} ${day === date ? "bg-zinc-800" : ""}`}>
        <span>{weekdayLabel(day)}</span><span>{Number(day.slice(-2))}</span>
      </Link>)}
    </nav>}
    {entries === null ? <section className="calendar-error mt-6"><p role="alert">Calendar is unavailable right now. Please try again.</p><a className={`${link} mt-3`} href={href(date)}>Retry calendar</a></section>
      : <CalendarQuestDetails userId={user.id} timezone={timezone}>
        {view === "month" && <>
          <MonthView grid={grid} cells={month!} selected={date} today={today} timezone={timezone} href={(day) => href(day)} />
          <p aria-hidden="true" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cal-event" />Schedule Event</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cal-quest" />Quest</span>
            <span>Choose a day to see its entries below.</span>
          </p>
        </>}
        {view !== "month" && <WeekView days={days} entries={entries} today={today} now={new Date().toISOString()} timezone={timezone} href={(day) => href(day, "day")} selected={date} />}
        <CalendarPanel key={`${date}:${view}:${timezone}`} entries={entries} days={agendaDays} selectedDate={date} today={today} timezone={timezone} userId={user.id} view={view} />
      </CalendarQuestDetails>}
    <p className="mt-4 text-xs text-zinc-500">Recurring slots appear once generated by the Quest engine. Open a Quest detail to plan that occurrence; use Quests to complete work.</p>
  </SystemShell>;
}
