import { AppHeader } from "@/components/app-header";
import { cookies } from "next/headers";
import { getDictionary, LOCALE_COOKIE, resolveLocale } from "@/lib/localization/dictionaries";
import { LevelSnapshot } from "@/features/dashboard/components";
import { DashboardMainQuest, DashboardCalendar } from "@/features/dashboard/panels";
import { Panel } from "@/components/ui/primitives";
import { LogoutForm } from "@/features/auth/logout-form";
import { redirect } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { ProfileError } from "@/features/profile/profile-error";
import { getProgressionStatus } from "@/features/progression/data";
import { Suspense } from "react";
import { RecurringQuestsPanel } from "@/features/quests/recurring-panel";
import { DailyQuestsPanel } from "@/features/quests/panel";
import { DailyQuestLoading } from "@/features/quests/components";
import { RewardsPanel } from "@/features/rewards/panel";
import { RewardsLoading } from "@/features/rewards/components";
import { resolveSelectedDate } from "@/features/quests/dates";
import { QuestCreationForm } from "@/features/quests/create-form";
import { QuestCompletionRecovery } from "@/features/quests/completion-recovery-ui";
import { QuestCompletionProvider } from "@/features/quests/completion-provider";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams = Promise.resolve({}) }: {
  searchParams?: Promise<{ date?: string | string[] }>;
} = {}) {
  const { user, profile, error } = await getProfileContext();
  if (!profile) return <ProfileError missing={error === "missing"} />;
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
  const params = await searchParams;
  const selectedDate = resolveSelectedDate(params.date, profile.timezone!);
  const progression = await getProgressionStatus();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = getDictionary(locale).dashboard;
  return (
    <main lang={locale} className="dashboard-page page-frame">
      <AppHeader current="dashboard" selectedDate={selectedDate} compact />
      <section aria-label={t.player} className="dashboard-player">
        <div><p className="type-metadata text-accent">{t.overview}</p>
          <h2 className="type-card">{profile.display_name || t.operator}</h2></div>
        <p className="type-metadata text-muted break-all">{user.email}</p>
      </section>
      <QuestCompletionProvider userId={user.id}>
        <div className="dashboard-grid">
          <div className="dashboard-slot-level"><LevelSnapshot result={progression} locale={locale} selectedDate={selectedDate} /></div>
          <div className="dashboard-slot-main">
            <Suspense fallback={<Panel aria-busy="true"><p role="status">{t.loadingMain}</p></Panel>}>
              <DashboardMainQuest locale={locale} />
            </Suspense>
          </div>
          <div className="dashboard-slot-daily" id="daily-quests">
            <div lang="en"><QuestCompletionRecovery selectedDate={selectedDate} /></div>
            <Suspense fallback={<DailyQuestLoading timezone={profile.timezone!} selectedDate={selectedDate} locale={locale} />}>
              <DailyQuestsPanel timezone={profile.timezone!} selectedDate={selectedDate} userId={user.id} locale={locale} />
            </Suspense>
          </div>
          <div className="dashboard-slot-calendar">
            <Suspense fallback={<Panel aria-busy="true"><p role="status">{t.loadingCalendar}</p></Panel>}>
              <DashboardCalendar day={selectedDate} timezone={profile.timezone!} locale={locale} />
            </Suspense>
          </div>
          <div className="dashboard-slot-recurring" id="recurring-quests">
            <Suspense fallback={<Panel aria-busy="true"><p role="status">{t.loadingRecurring}</p></Panel>}>
              <RecurringQuestsPanel userId={user.id} locale={locale} compact />
            </Suspense>
          </div>
        </div>
        <div className="dashboard-tools" id="quest-tools">
          <div id="create-quest">
            <p className="mb-3 type-metadata text-muted">{t.legacyHint}</p>
            <div lang="en"><QuestCreationForm timezone={profile.timezone!} userId={user.id} /></div>
          </div>
          <div lang="en"><Suspense fallback={<RewardsLoading />}><RewardsPanel /></Suspense></div>
        </div>
      </QuestCompletionProvider>
      <footer lang="en" className="mt-8"><LogoutForm /></footer>
    </main>
  );
}
