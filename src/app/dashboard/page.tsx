import { LogoutForm } from "@/features/auth/logout-form";
import { redirect } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { ProfileError } from "@/features/profile/profile-error";
import { getProgressionStatus } from "@/features/progression/data";
import { ExpProgressCard, PlayerSummary } from "@/features/progression/components";
import { Suspense } from "react";
import { DailyQuestsPanel } from "@/features/quests/panel";
import { DailyQuestLoading } from "@/features/quests/components";
import { RewardsPanel } from "@/features/rewards/panel";
import { RewardsLoading } from "@/features/rewards/components";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, profile, error } = await getProfileContext();
  if (!profile) return <ProfileError missing={error === "missing"} />;
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
  const progression = await getProgressionStatus();
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-[0.2em] text-zinc-100">SYSTEM</h1>
      <div className="mt-8 space-y-4">
        <PlayerSummary email={user.email ?? "unknown account"} displayName={profile.display_name} />
        {progression.status === "ok" ? (
          <ExpProgressCard exp={progression.exp} />
        ) : (
          <section
            aria-label="Progression"
            className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-6"
          >
            <p className="text-xs font-medium tracking-[0.3em] text-zinc-400">PROGRESSION</p>
            <p role="alert" className="mt-3 text-zinc-300">
              Progression status is unavailable right now. Please try again.
            </p>
            <a
              href="/dashboard"
              className="mt-4 inline-block rounded-md border border-zinc-600 px-4 py-2 text-sm underline-offset-4 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Retry
            </a>
          </section>
        )}
        <Suspense fallback={<DailyQuestLoading timezone={profile.timezone!} />}>
          <DailyQuestsPanel timezone={profile.timezone!} />
        </Suspense>
        <Suspense fallback={<RewardsLoading />}>
          <RewardsPanel />
        </Suspense>
      </div>
      <div className="mt-10">
        <LogoutForm />
      </div>
    </main>
  );
}
