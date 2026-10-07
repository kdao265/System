import type { CSSProperties } from "react";
import { Badge, EmptyState, Panel, ProgressBar, SectionHeader } from "@/components/ui/primitives";
import { progressPercent } from "@/features/goals/model";
import type { ProgressionResult } from "@/features/progression/data";
import type { CalendarEntry } from "@/features/calendar/model";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import type { MainQuestResult } from "./data";
import { calendarSnapshot } from "./model";

export function MainQuestHero({ result, locale }: { result: MainQuestResult; locale: Locale }) {
  const t = getDictionary(locale).dashboard;
  const detail = result.status === "ok" ? result.detail : null;
  return <Panel aria-label={t.main} className="dashboard-hero">
    <div className="dashboard-horizon" aria-hidden="true"><i /><i /><i /></div>
    <div className="dashboard-hero-content">
      <p className="type-metadata tracking-[0.2em] text-exp dashboard-hero-eyebrow">◇ {t.main}</p>
      {detail ? <>
        <h2 className="dashboard-hero-title">{detail.goal.title}</h2>
        {detail.goal.description && <p className="mt-3 max-w-xl line-clamp-3 text-muted">{detail.goal.description}</p>}
        <div className="dashboard-hero-status mt-6">
          <span className="dashboard-hero-count">{detail.goal.completed_subquests} / {detail.goal.total_subquests} {t.subquests}</span>
          <strong className="dashboard-hero-percent text-exp font-mono">{new Intl.NumberFormat(locale).format(progressPercent(detail.goal))}%</strong>
        </div>
        <ProgressBar value={progressPercent(detail.goal)} label={t.progress} className="mt-2" />
        {detail.subquests.length > 0 && <ul className="dashboard-subquests" aria-label={t.subquests}>
          {detail.subquests.slice(0, 3).map((sub) => <li key={sub.link_id} data-completed={sub.status === "completed"}>
            <span aria-hidden="true" className={sub.status === "completed" ? "text-success" : "text-exp"}>{sub.status === "completed" ? "✓" : "◇"}</span>
            <span className="dashboard-subquest-title">{sub.title}</span>
            <span className="type-metadata text-muted">{getDictionary(locale).daily.states[sub.status]}</span>
          </li>)}
        </ul>}
        <a href={`/goals?id=${detail.goal.id}`} className="ui-button dashboard-gold-button mt-5">{t.openGoal} <span aria-hidden="true">↗</span></a>
      </> : <div className="mt-5">
        {result.status === "empty"
          ? <EmptyState title={t.mainEmpty} description={t.mainEmptyHint}><a href="/goals" className="ui-button dashboard-gold-button">{t.browseGoals} ↗</a></EmptyState>
          : <><p role="alert">{t.mainUnavailable}</p><a href="/goals" className="ui-button mt-4">{t.browseGoals}</a></>}
      </div>}
    </div>
  </Panel>;
}

export function LevelSnapshot({ result, locale, selectedDate }: { result: ProgressionResult; locale: Locale; selectedDate: string }) {
  const t = getDictionary(locale).dashboard;
  const exp = result.status === "ok" ? result.exp : null;
  return <Panel aria-label={exp?.state === "unavailable" ? t.levelUnconfigured : exp?.state === "invalid" ? t.levelInvalid : t.level} className="dashboard-level">
    <p className="type-metadata tracking-[0.2em] text-exp">LEVEL / EXP</p>
    {exp?.state === "available" ? <>
      {/* Presentation only: --ring-angle positions the decorative arc-end marker;
          progress meaning stays in the progressbar + textual percentages. */}
      <div className="dashboard-level-ring" style={{
        "--ring-progress": `${exp.nextLevel === null ? 100 : exp.percentInLevel}%`,
        "--ring-angle": `${(exp.nextLevel === null ? 100 : exp.percentInLevel ?? 0) * 3.6}deg`,
      } as CSSProperties}>
        <div><span className="type-metadata text-muted">LEVEL</span><h2 className="type-stat text-level"><span className="sr-only">Level </span>{exp.currentLevel}</h2></div>
      </div>
      <p className="type-metadata text-muted">{t.currentExp}</p>
      <p className="break-all font-mono text-lg text-exp">{`${exp.currentExpText} EXP`}</p>
      {exp.nextLevel === null ? <p className="mt-3 text-exp">{t.max}</p> : <>
        <ProgressBar value={exp.percentInLevel ?? 0} label={t.progress} className="mt-4" />
        <p className="mt-2 type-metadata text-muted">{exp.percentInLevel}%</p>
        <p className="type-metadata text-muted"><span className="break-all">{exp.expToNextText}</span> {t.remaining} {exp.nextLevel}</p>
      </>}
      {exp.highestLevel !== null && <p className="mt-3 type-metadata text-muted">{t.highest} {exp.highestLevel}</p>}
    </> : <>
      <p className="my-6 text-muted" role={exp?.state === "unavailable" ? undefined : "alert"}>
        {exp?.state === "unavailable" ? t.unconfigured : exp?.state === "invalid" ? t.invalidExp : t.unavailableExp}
      </p>
      {exp?.state !== "unavailable" && <a href={`/dashboard?date=${selectedDate}`} className="ui-button">{getDictionary(locale).common.retry}</a>}
    </>}
  </Panel>;
}

export function CalendarSnapshot({ entries, day, timezone, locale }: { entries: CalendarEntry[] | null; day: string; timezone: string; locale: Locale }) {
  const t = getDictionary(locale).dashboard;
  const items = entries && calendarSnapshot(entries, day, timezone);
  const dates = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const times = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  return <Panel aria-label={t.calendar} className="dashboard-calendar">
    <SectionHeader title={t.calendar} />
    <p className="mt-2 type-metadata text-muted">{t.calendarHint} · {timezone}</p>
    {!items ? <p role="alert" className="my-5">{t.calendarUnavailable}</p>
      : items.length === 0 ? <p className="my-5 text-muted">{t.calendarEmpty}</p>
      : <ul className="dashboard-agenda">{items.map(({ entry, day: date }) => <li key={entry.source + entry.entry_id}>
        <p className="type-metadata text-accent"><time dateTime={date}>{dates.format(new Date(`${date}T12:00:00Z`))}</time> · {entry.all_day ? t.allDay : entry.start_at ? times.format(new Date(entry.start_at)) : t.untimed}</p>
        <a className="dashboard-event-link" href={`/calendar?view=day&date=${date}`}>{entry.title} <span aria-hidden="true">↗</span></a>
        <Badge tone={entry.source === "schedule_event" ? "accent" : "muted"}>{entry.source === "schedule_event" ? t.event : t.quest}</Badge>
      </li>)}</ul>}
    <a href={`/calendar?date=${day}`} className="ui-button mt-4">{t.openCalendar} <span aria-hidden="true">↗</span></a>
  </Panel>;
}
