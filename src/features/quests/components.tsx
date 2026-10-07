import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { Badge } from "@/components/ui/primitives";
import type { DayQuestResult } from "./model";
import { issueClock, type MaterializationIssue } from "./materialization-model";
import { addCalendarDays, MAX_CALENDAR_DATE, MIN_CALENDAR_DATE } from "./dates";
import { QuestCompletionControl, QuestReopenControl } from "./completion-control";
import { QuestManagementControl } from "./management-control";
import { RecurringSeriesTrigger, RecurringSeriesManageButton } from "./recurring-series-trigger";

const linkClass = "ui-button mt-4";
const navLinkClass = "ui-button ui-nav-link";
const navUnavailableClass = "ui-button ui-nav-link ui-nav-link-unavailable";
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
      <h2 className="dashboard-daily-heading">{t.heading}</h2>
      <p className="mt-2 text-sm text-zinc-300">{t.selected}: {displayDate(selectedDate, locale)}</p>
      <p className="mt-1 text-sm text-zinc-400">{t.timezone}: {timezone}</p>
      <nav aria-label={t.navigation} className="dashboard-date-nav mt-4">
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
        <form action="/dashboard" className="dashboard-date-form">
          <label htmlFor="quest-date" className="text-sm text-zinc-300">{t.choose}</label>
          <input id="quest-date" name="date" type="date" min={MIN_CALENDAR_DATE} max={MAX_CALENDAR_DATE} defaultValue={selectedDate}
            className="ui-field dashboard-date-field" />
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

/**
 * Nonfatal, slot-local materialization notices. This surface is independent of
 * whether the day produced any occurrences, and never turns a successful read
 * into an unavailable state. Each notice links to the SAME shared series manager,
 * so a series whose first slot failed materialization can still be corrected even
 * though it has no occurrence card to click.
 */
function MaterializationNotices({ issues, locale, userId, seriesTitles }: {
  issues: MaterializationIssue[];
  locale: Locale;
  userId?: string;
  seriesTitles?: Readonly<Record<string, string>>;
}) {
  const dictionary = getDictionary(locale);
  const mi = dictionary.materialization;
  const sm = dictionary.seriesManage;
  const sd = dictionary.scheduleDefaults;
  return (
    <div lang={locale} role="alert" aria-live="polite"
    className="dashboard-materialization-notice mt-4">
      <p className="font-medium">{mi.heading}</p>
      <p className="mt-1 text-amber-300/80">{mi.hint}</p>
      <ul className="mt-2 space-y-2">
        {issues.map((issue, index) => {
          const start = issueClock(issue.local_start_time);
          const end = issueClock(issue.local_end_time);
          const title = seriesTitles?.[issue.quest_id] ?? mi.quest;
          const interval = start && end
            ? ` ${start}\u2013${end}${issue.planned_end_day_offset === 1 ? ` (${sd.nextDay})` : ""}`
            : "";

          return           <li key={`${issue.quest_id}:${issue.source_slot_date}:${index}`} className="dashboard-materialization-item">
            {mi.reasons[issue.reason]} {mi.endpoint}: {mi.endpoints[issue.endpoint]} {"\u00b7"} {mi.slot}: {issue.source_slot_date}
            {interval} {"\u00b7"} {mi.quest}: {title}
            {userId &&             <RecurringSeriesManageButton questId={issue.quest_id} title={title} label={sm.manage} locale={locale} className="ui-button ui-button-warning dashboard-materialization-action" />}
          </li>;
        })}
      </ul>
    </div>
  );
}

export function DailyQuestList({ result, timezone, selectedDate, userId, seriesTitles, locale = "en" }: {
  result: DayQuestResult;
  timezone: string;
  selectedDate: string;
  userId?: string;
  seriesTitles?: Readonly<Record<string, string>>;
  locale?: Locale;
}) {
  const t = getDictionary(locale).daily;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone, year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  });
  const issues = result.status === "ok" ? (result.issues ?? []) : [];
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
  } else {
    // Materialization warnings are INDEPENDENT of occurrence-list emptiness. A day
    // with zero occurrences and one skipped slot must still surface the notice, so
    // the warning surface renders first and unconditionally, and only then does the
    // body resolve to either the Quest rows or the normal empty-day state. It is
    // valid to show both the warning and "No Quests for this day".
    content = <>
      {issues.length > 0 && <MaterializationNotices issues={issues} locale={locale} userId={userId} seriesTitles={seriesTitles} />}
      {result.quests.length === 0 ? <p role="status" className="mt-4 text-zinc-300">{t.empty}</p> : <>
      <ul aria-label={t.occurrences} className="mt-5 space-y-3">
        {result.quests.map((quest) => (
          <li key={quest.occurrence_id} className="dashboard-quest-row" data-completed={quest.status === "completed"}>
            <div className="dashboard-quest-heading">
              <span className="dashboard-quest-marker" aria-hidden="true">{quest.status === "completed" ? "✓" : "◇"}</span>
              <h3 className="dashboard-quest-title">{quest.quest_title}</h3>
              <Badge className="dashboard-quest-status" tone={quest.status === "completed" ? "success" : "accent"}>{t.status}: {t.states[quest.status]}</Badge>
              {quest.reward_exp_snapshot !== null && <span className="dashboard-quest-reward">{quest.reward_exp_snapshot} EXP</span>}
              <div className="dashboard-quest-actions">
                {quest.source_slot_date !== null && userId &&
                  <RecurringSeriesTrigger occurrenceId={quest.occurrence_id} questId={quest.quest_id}
                    title={quest.quest_title} locale={locale} />}
                {quest.source_slot_date === null && userId &&
                  <QuestManagementControl userId={userId} questId={quest.quest_id}
                    title={quest.quest_title} status={quest.status} locale={locale} />}
              </div>
            </div>
            {quest.source_slot_date && <p className="mt-2 text-sm text-zinc-400">{t.recurring} · {displayDate(quest.source_slot_date, locale)}</p>}
            <dl className="dashboard-quest-meta mt-3">
              {([
                [t.scheduled, quest.scheduled_at], [t.deadline, quest.deadline_at],
              ] as const).map(([label, value]) => value !== null && (
                <div key={label} className="dashboard-quest-meta-item">
                  <dt className="text-zinc-400">{label}</dt>
                  <dd className="mt-1 text-zinc-200"><time dateTime={value}>{formatter.format(new Date(value))}</time></dd>
                </div>
              ))}
              <div className="dashboard-quest-meta-item dashboard-quest-meta-reward">
                <dt className="text-zinc-400">{t.reward}</dt>
                <dd className="mt-1 font-mono text-amber-300">{quest.reward_exp_snapshot === null ? t.notSet : `${quest.reward_exp_snapshot} EXP`}</dd>
              </div>
              <div className={`dashboard-quest-meta-item dashboard-quest-readiness${quest.completable ? "" : " dashboard-quest-readiness-blocked"}`}>
                <dt className="text-zinc-400">{t.readiness}</dt>
                <dd className="mt-1 text-zinc-200">{quest.completable ? t.ready : t.notReady}</dd>
                {!quest.progression_ready && <dd className="mt-1 text-zinc-400">{t.setup}</dd>}
              </div>
            </dl>
            {quest.completable && userId && <div className="dashboard-quest-primary-action"><QuestCompletionControl userId={userId} occurrenceId={quest.occurrence_id} executionCycle={quest.execution_cycle} locale={locale} selectedDate={selectedDate} /></div>}
            {quest.status === "completed" && quest.already_completed_cycle === quest.execution_cycle && userId && <div className="dashboard-quest-secondary-action"><QuestReopenControl occurrenceId={quest.occurrence_id} executionCycle={quest.execution_cycle} locale={locale} /></div>}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-zinc-500">{t.fresh}</p>
    </>}
    </>;
  }
  return <QuestCard timezone={timezone} selectedDate={selectedDate} locale={locale}>{result.status === "ok" && <div className="mt-4 flex flex-wrap gap-3 text-sm"><span className="text-success">{getDictionary(locale).dashboard.completed}: {result.quests.filter((quest) => quest.status === "completed").length}</span><span className="text-muted">{getDictionary(locale).dashboard.pending}: {result.quests.filter((quest) => quest.status !== "completed").length}</span><a href="#create-quest" className="ui-button ml-auto">+ {getDictionary(locale).dashboard.addQuest}</a></div>}{content}</QuestCard>;
}
