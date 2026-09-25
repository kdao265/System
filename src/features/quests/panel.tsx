import { getDayQuests } from "./data";
import { DailyQuestList } from "./components";
import { QuestReopenRead } from "./completion-provider";

export async function DailyQuestsPanel({ timezone, selectedDate, userId }: { timezone: string; selectedDate: string; userId: string }) {
  const result = await getDayQuests(selectedDate);
  return <><QuestReopenRead userId={userId} result={result} /><DailyQuestList result={result} timezone={timezone} selectedDate={selectedDate} userId={userId} /></>;
}
