import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { getArchivedRecurringQuests } from "./recurring-retirement-data";
import { RecurringRetirementControl } from "./recurring-retirement-control";
import { recurringRetirementCopy } from "./recurring-retirement-copy";

export async function ArchivedRecurringQuestsPanel({ timezone, locale = "en" }: { timezone: string; locale?: Locale }) {
  const quests = await getArchivedRecurringQuests();
  const t = recurringRetirementCopy(locale), d = getDictionary(locale).dashboard;
  return <section id="archived-recurring-quests" tabIndex={-1} aria-label={t.title}
    className="min-w-0 [overflow-wrap:anywhere] rounded-lg border border-zinc-800 p-4 sm:p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
    <h2 id="archived-recurring-quests-title" className="type-card">{t.title}</h2><p className="mt-2 text-sm text-muted">{t.hint}</p>
    {quests === null ? <p role="alert">{t.unavailable}</p> : quests.length === 0 ? <p className="mt-4">{t.empty}</p> :
      <ul className="mt-4 space-y-3">{quests.map((quest) => <li key={quest.quest_id} className="rounded-lg border border-zinc-800 p-3">
        <h3 className="font-medium">{quest.title}</h3>
        <p className="mt-1 text-sm text-muted">{d[quest.recurrence_mode]} · {quest.paused ? d.paused : d.active}</p>
        <p className="mt-1 text-xs text-muted">{t.archivedAt}: <time dateTime={quest.archived_at}>
          {new Date(quest.archived_at).toLocaleString(locale, { timeZone: timezone, timeZoneName: "short" })}
        </time></p>
        <RecurringRetirementControl questId={quest.quest_id} title={quest.title} locale={locale} archived />
      </li>)}</ul>}
  </section>;
}
