import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { Badge } from "@/components/ui/primitives";
import type { DayQuestResult } from "./model";
import { addCalendarDays, MAX_CALENDAR_DATE, MIN_CALENDAR_DATE } from "./dates";
import { QuestCompletionControl, QuestReopenControl } from "./completion-control";
import { QuestManagementControl } from "./management-control";
import { RecurringSeriesTrigger } from "./recurring-series-trigger";

const linkClass = "mt-4 inline-block rounded-md border border-zinc-600 px-4 py-2 text-sm underline-offset-4 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:py-3";
const navLinkClass = "rounded-md border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:py-3";
const navUnavailableClass = "rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-600 pointer-coarse:py-3";
function displayDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function QuestCard({ timezone, selectedDate, children, loading = false, locale = "en" }: {
  timezone: string; selectedDate: string; children: React.ReactNode; loading?: boolean; locale?: Locale;
}) {
  const t = getDictionary(locale).daily;
  const atMinimum = selectedDate === MIN_CALENDAR_DATE;
  const atMaximum = selectedDate === MAX_CALENDAR_DATE;
  const previousDate = atMinimum ? selectedDate : addCalendarDays(selectedDate, -1);
  const nextDate = atMaximum ? selectedDate : addCalendarDays(selectedDate, 1);
  return (
    <section lang={locale} aria-label={t.title} aria-busy={loading}
      className="ui-panel dashboard-daily [overflow-wrap:anywhere]">
      <h2 className="text-xs font-medium tracking-[0.3em] text-zinc-400">{t.heading}</h2>
      <p className="mt-2 text-sm text-zinc-300">{t.selected}: {displayDate(selectedDate, locale)}</p>
      <p className="mt-1 text-sm text-zinc-400">{t.timezone}: {timezone}</p>
      <nav aria-label={t.navigation} className="mt-4 flex flex-wrap items-center gap-2">
        {atMinimum ? <span aria-disabled="true" aria-label={t.previousUnavailable}
          className={navUnavailableClass}>{t.previous}</span> :
          <a href={`/dashboard?date=${previousDate}`} aria-label={t.viewPrevious}
            className={navLinkClass}>{t.previous}</a>}
        <a href="/dashboard" aria-label={t.viewToday}
          className={navLinkClass}>{t.today}</a>
        {atMaximum ? <span aria-disabled="true" aria-label={t.nextUnavailable}
          className={navUnavailableClass}>{t.next}</span> :
          <a href={`/dashboard?date=${nextDate}`} aria-label={t.viewNext}
            className={navLinkClass}>{t.next}</a>}
        <form action="/dashboard" className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <label htmlFor="quest-date" className="text-sm text-zinc-300">{t.choose}</label>
          <input id="quest-date" name="date" type="date" min={MIN_CALENDAR_DATE} max={MAX_CALENDAR_DATE} defaultValue={selectedDate}
            className="min-w-0 flex-1 basis-40 rounded-md border border-zinc-600 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:py-3 pointer-coarse:text-base" />
          <button type="submit"
            className={navLinkClass}>{t.view}</button>
        </form>
      </nav>
      {children}
    </section>
  );
}

export function DailyQuestLoading({ timezone, selectedDate, locale = "en" }: { timezone: string; selectedDate: string; locale?: Locale }) {
  return <QuestCard timezone={timezone} selectedDate={selectedDate} locale={locale} loading><p role="status" className="mt-4 text-muted">{getDictionary(locale).daily.loading}</p></QuestCard>;
}

export function DailyQuestList({ result, timezone, selectedDate, userId, locale = "en" }: { result: DayQuestResult; timezone: string; selectedDate: string; userId?: string; locale?: Locale }) {
  const t = getDictionary(locale).daily;
  let content: React.ReactNode;
  if (result.status === "timezone-required") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">{t.timezoneError}</p>
      <a href="/onboarding?repair=timezone" className={linkClass}>{t.repair}</a>
    </>;
  } else if (result.status === "session-expired") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">{t.sessionError}</p>
      <a href="/login" className={linkClass}>{t.signIn}</a>
    </>;
  } else if (result.status !== "ok") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">{result.status === "invalid"
        ? t.invalid
        : t.unavailable}</p>
      {/* A full navigation reruns the server reads, including after cached client navigation. */}
      <a href={`/dashboard?date=${selectedDate}`} className={linkClass}>{t.retry}</a>
    </>;
  } else if (result.quests.length === 0) {
    content = <p role="status" className="mt-4 text-zinc-300">{t.empty}</p>;
  } else {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone, year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
    });
    content = <>
      <ul aria-label={t.occurrences} className="mt-5 space-y-3">
        {result.quests.map((quest) => (
          <li key={quest.occurrence_id} className="dashboard-quest-row" data-completed={quest.status === "completed"}>
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <h3 className="min-w-0 flex-1 basis-40 font-medium text-zinc-100">{quest.quest_title}</h3>
              <div className="flex items-center gap-2">
                <Badge tone={quest.status === "completed" ? "success" : "muted"}>{t.status}: {t.states[quest.status]}</Badge>
                {quest.source_slot_date !== null && userId &&
                  <RecurringSeriesTrigger occurrenceId={quest.occurrence_id} questId={quest.quest_id}
                    title={quest.quest_title} locale={locale} />}
                {quest.source_slot_date === null && userId &&
                  <QuestManagementControl userId={userId} questId={quest.quest_id}
                    title={quest.quest_title} status={quest.status} locale={locale} />}
              </div>
            </div>
            {quest.source_slot_date && <p className="mt-2 text-sm text-zinc-400">{t.recurring} · {displayDate(quest.source_slot_date, locale)}</p>}
            <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
              {([
                [t.scheduled, quest.scheduled_at], [t.deadline, quest.deadline_at],
              ] as const).map(([label, value]) => value !== null && (
                <div key={label} className="min-w-0">
                  <dt className="text-zinc-400">{label}</dt>
                  <dd className="mt-1 text-zinc-200"><time dateTime={value}>{formatter.format(new Date(value))}</time></dd>
                </div>
              ))}
              <div className="min-w-0">
                <dt className="text-zinc-400">{t.reward}</dt>
                <dd className="mt-1 font-mono text-amber-300">{quest.reward_exp_snapshot === null ? t.notSet : `${quest.reward_exp_snapshot} EXP`}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-zinc-400">{t.readiness}</dt>
                <dd className="mt-1 text-zinc-200">{quest.completable ? t.ready : t.notReady}</dd>
                {!quest.progression_ready && <dd className="mt-1 text-zinc-400">{t.setup}</dd>}
              </div>
            </dl>
            {quest.completable && userId && <QuestCompletionControl userId={userId} occurrenceId={quest.occurrence_id} executionCycle={quest.execution_cycle} locale={locale} selectedDate={selectedDate} />}
            {quest.status === "completed" && quest.already_completed_cycle === quest.execution_cycle && userId && <QuestReopenControl occurrenceId={quest.occurrence_id} executionCycle={quest.execution_cycle} locale={locale} />}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-zinc-500">{t.fresh}</p>
    </>;
  }
  return <QuestCard timezone={timezone} selectedDate={selectedDate} locale={locale}>{result.status === "ok" && <div className="mt-4 flex flex-wrap gap-3 text-sm"><span className="text-success">{getDictionary(locale).dashboard.completed}: {result.quests.filter((quest) => quest.status === "completed").length}</span><span className="text-muted">{getDictionary(locale).dashboard.pending}: {result.quests.filter((quest) => quest.status !== "completed").length}</span><a href="#create-quest" className="ui-button ml-auto">+ {getDictionary(locale).dashboard.addQuest}</a></div>}{content}</QuestCard>;
}
