import type { Locale } from "@/lib/localization/dictionaries";
import { getDayQuests } from "./data";
import { DailyQuestList } from "./components";
import { QuestReopenRead } from "./completion-provider";
import { readRecurringQuests } from "./recurring-read";

export async function DailyQuestsPanel({ timezone, selectedDate, userId, locale }: { timezone: string; selectedDate: string; userId: string; locale?: Locale }) {
  const result = await getDayQuests(selectedDate);

  const recurring = result.status === "ok" && result.issues?.length
    ? await readRecurringQuests(userId)
    : null;

  const seriesTitles = recurring
    ? Object.fromEntries(
        recurring.map((quest) => [quest.quest_id, quest.title]),
      )
    : undefined;

  return <>
    <QuestReopenRead userId={userId} result={result} />
    <DailyQuestList
      locale={locale}
      result={result}
      timezone={timezone}
      selectedDate={selectedDate}
      userId={userId}
      seriesTitles={seriesTitles}
    />
  </>;
}
