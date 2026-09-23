import { getDayQuests } from "./data";
import { DailyQuestList } from "./components";

export async function DailyQuestsPanel({ timezone }: { timezone: string }) {
  return <DailyQuestList result={await getDayQuests()} timezone={timezone} />;
}
