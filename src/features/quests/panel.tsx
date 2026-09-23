import { getDayQuests } from "./data";
import { DailyQuestList } from "./components";

export async function DailyQuestsPanel({ timezone, selectedDate }: { timezone: string; selectedDate: string }) {
  return <DailyQuestList result={await getDayQuests(selectedDate)} timezone={timezone} selectedDate={selectedDate} />;
}
