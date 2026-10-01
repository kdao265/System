import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { getArchivedOneOffQuests } from "./archived-data";
import { QuestManagementControl } from "./management-control";

export async function ArchivedQuestsPanel({
  userId,
  timezone,
  locale = "en",
}: {
  userId: string;
  timezone: string;
  locale?: Locale;
}) {
  const t = getDictionary(locale).questManage;
  const result = await getArchivedOneOffQuests();

  return (
    <section aria-label={t.archivedTitle}
      className="min-w-0 [overflow-wrap:anywhere] rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 sm:p-6">
      <h2 className="text-xs font-medium tracking-[0.3em] text-zinc-400">{t.archivedHeading}</h2>
      <p className="mt-2 text-sm text-zinc-400">{t.archivedHint}</p>

      {result.status === "session-expired" ? (
        <p role="alert" className="mt-4 text-sm text-amber-200">{t.session}</p>
      ) : result.status !== "ok" ? (
        <p role="alert" className="mt-4 text-sm text-amber-200">{t.unavailable}</p>
      ) : result.quests.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-zinc-400">{t.archivedEmpty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {result.quests.map((quest) => (
            <li key={quest.id} className="rounded-lg border border-zinc-800 p-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium text-zinc-100">{quest.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    {t.archivedAt}: <time dateTime={quest.archived_at}>{new Date(quest.archived_at).toLocaleString(locale, { timeZone: timezone, timeZoneName: "short" })}</time>
                  </p>
                </div>
              </div>
              <QuestManagementControl userId={userId} questId={quest.id}
                title={quest.title} status={quest.status} locale={locale} archived />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
