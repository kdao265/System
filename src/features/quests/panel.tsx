import type { Locale } from "@/lib/localization/dictionaries";
import { getDayQuests } from "./data";
import { DailyQuestList } from "./components";
import { QuestReopenRead } from "./completion-provider";

export async function DailyQuestsPanel({ timezone, selectedDate, userId, locale }: { timezone: string; selectedDate: string; userId: string; locale?: Locale }) {
  const result = await getDayQuests(selectedDate);
  return <><QuestReopenRead userId={userId} result={result} /><DailyQuestList locale={locale} result={result} timezone={timezone} selectedDate={selectedDate} userId={userId} /></>;
}
