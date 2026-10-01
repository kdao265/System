import { getCalendar } from "@/features/calendar/data";
import type { Locale } from "@/lib/localization/dictionaries";
import { getDashboardMainQuest } from "./data";
import { MainQuestHero, CalendarSnapshot } from "./components";
import { snapshotEnd } from "./model";

export async function DashboardMainQuest({ locale }: { locale: Locale }) {
  return <MainQuestHero locale={locale} result={await getDashboardMainQuest()} />;
}

export async function DashboardCalendar({ day, timezone, locale }: { day: string; timezone: string; locale: Locale }) {
  return <CalendarSnapshot entries={await getCalendar(day, snapshotEnd(day))} day={day} timezone={timezone} locale={locale} />;
}
