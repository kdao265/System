import { getDayQuests } from "./data";
import { DailyQuestList } from "./components";

export async function DailyQuestsPanel({ timezone, selectedDate, userId }: { timezone: string; selectedDate: string; userId: string }) {
  return <DailyQuestList result={await getDayQuests(selectedDate)} timezone={timezone} selectedDate={selectedDate} userId={userId} />;
}
