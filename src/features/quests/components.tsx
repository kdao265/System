import type { DayQuestResult } from "./model";
import { addCalendarDays, formatCalendarDate, MAX_CALENDAR_DATE, MIN_CALENDAR_DATE } from "./dates";
import { QuestCompletionControl, QuestReopenControl } from "./completion-control";

const linkClass = "mt-4 inline-block rounded-md border border-zinc-600 px-4 py-2 text-sm underline-offset-4 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const statusLabels = {
  draft: "Draft", scheduled: "Scheduled", active: "Active",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

function QuestCard({ timezone, selectedDate, children, loading = false }: {
  timezone: string; selectedDate: string; children: React.ReactNode; loading?: boolean;
}) {
  const atMinimum = selectedDate === MIN_CALENDAR_DATE;
  const atMaximum = selectedDate === MAX_CALENDAR_DATE;
  const previousDate = atMinimum ? selectedDate : addCalendarDays(selectedDate, -1);
  const nextDate = atMaximum ? selectedDate : addCalendarDays(selectedDate, 1);
  return (
    <section aria-label="Daily Quests" aria-busy={loading}
      className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 [overflow-wrap:anywhere] sm:p-6">
      <h2 className="text-xs font-medium tracking-[0.3em] text-zinc-400">DAILY QUESTS</h2>
      <p className="mt-2 text-sm text-zinc-300">Selected day: {formatCalendarDate(selectedDate)}</p>
      <p className="mt-1 text-sm text-zinc-400">Profile timezone: {timezone}</p>
      <nav aria-label="Quest day navigation" className="mt-4 flex flex-wrap items-center gap-2">
        {atMinimum ? <span aria-disabled="true" aria-label="Previous day unavailable"
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-600">Previous day</span> :
          <a href={`/dashboard?date=${previousDate}`} aria-label="View previous day"
            className="rounded-md border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Previous day</a>}
        <a href="/dashboard" aria-label="View today"
          className="rounded-md border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Today</a>
        {atMaximum ? <span aria-disabled="true" aria-label="Next day unavailable"
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-600">Next day</span> :
          <a href={`/dashboard?date=${nextDate}`} aria-label="View next day"
            className="rounded-md border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Next day</a>}
        <form action="/dashboard" className="flex items-center gap-2">
          <label htmlFor="quest-date" className="text-sm text-zinc-300">Choose date</label>
          <input id="quest-date" name="date" type="date" min={MIN_CALENDAR_DATE} max={MAX_CALENDAR_DATE} defaultValue={selectedDate}
            className="rounded-md border border-zinc-600 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" />
          <button type="submit"
            className="rounded-md border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">View</button>
        </form>
      </nav>
      {children}
    </section>
  );
}

export function DailyQuestLoading({ timezone, selectedDate }: { timezone: string; selectedDate: string }) {
  return <QuestCard timezone={timezone} selectedDate={selectedDate} loading><p role="status" className="mt-4 text-zinc-400">Loading Daily Quests...</p></QuestCard>;
}

export function DailyQuestList({ result, timezone, selectedDate, userId }: { result: DayQuestResult; timezone: string; selectedDate: string; userId?: string }) {
  let content: React.ReactNode;
  if (result.status === "timezone-required") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">Daily Quests need a valid profile timezone. Select and save your timezone to continue.</p>
      <a href="/onboarding?repair=timezone" className={linkClass}>Repair timezone</a>
    </>;
  } else if (result.status === "session-expired") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">Your session has expired. Sign in again to load Daily Quests.</p>
      <a href="/login" className={linkClass}>Sign in again</a>
    </>;
  } else if (result.status !== "ok") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">{result.status === "invalid"
        ? "Daily Quest data could not be read safely. Please try again."
        : "Daily Quests are unavailable right now. Please try again."}</p>
      {/* A full navigation reruns the server reads, including after cached client navigation. */}
      <a href={`/dashboard?date=${selectedDate}`} className={linkClass}>Retry Daily Quests</a>
    </>;
  } else if (result.quests.length === 0) {
    content = <p role="status" className="mt-4 text-zinc-300">No Quests for this day.</p>;
  } else {
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone, year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
    });
    content = <>
      <ul aria-label="Quest occurrences" className="mt-5 space-y-3">
        {result.quests.map((quest) => (
          <li key={quest.occurrence_id} className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <h3 className="min-w-0 flex-1 basis-40 font-medium text-zinc-100">{quest.quest_title}</h3>
              <p className="text-sm text-zinc-300">Status: {statusLabels[quest.status]}</p>
            </div>
            <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
              {([
                ["Scheduled", quest.scheduled_at], ["Deadline", quest.deadline_at],
              ] as const).map(([label, value]) => value !== null && (
                <div key={label} className="min-w-0">
                  <dt className="text-zinc-400">{label}</dt>
                  <dd className="mt-1 text-zinc-200"><time dateTime={value}>{formatter.format(new Date(value))}</time></dd>
                </div>
              ))}
              <div className="min-w-0">
                <dt className="text-zinc-400">Reward EXP snapshot</dt>
                <dd className="mt-1 font-mono text-amber-300">{quest.reward_exp_snapshot === null ? "Not set" : `${quest.reward_exp_snapshot} EXP`}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-zinc-400">Completion readiness (server)</dt>
                <dd className="mt-1 text-zinc-200">{quest.completable ? "Ready to complete" : "Not ready to complete"}</dd>
                {!quest.progression_ready && <dd className="mt-1 text-zinc-400">Level system setup required.</dd>}
              </div>
            </dl>
            {quest.completable && userId && <QuestCompletionControl userId={userId} occurrenceId={quest.occurrence_id} executionCycle={quest.execution_cycle} selectedDate={selectedDate} />}
            {quest.status === "completed" && quest.already_completed_cycle === quest.execution_cycle && userId && <QuestReopenControl occurrenceId={quest.occurrence_id} executionCycle={quest.execution_cycle} />}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-zinc-500">Readiness reflects the latest server read.</p>
    </>;
  }
  return <QuestCard timezone={timezone} selectedDate={selectedDate}>{content}</QuestCard>;
}
