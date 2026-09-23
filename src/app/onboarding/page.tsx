import { redirect } from "next/navigation";
import { LogoutForm } from "@/features/auth/logout-form";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { ProfileError } from "@/features/profile/profile-error";
import { OnboardingForm } from "@/features/profile/onboarding-form";
import { timezoneOptions } from "@/features/profile/timezones";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ repair?: string | string[] }>;
}) {
  const context = await getProfileContext();
  if (!context.profile) return <ProfileError missing={context.error === "missing"} />;
  const repairTimezone = (await searchParams).repair === "timezone";
  if (isOnboardingComplete(context.profile) && !repairTimezone) redirect("/dashboard");
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <p className="mb-3 text-sm tracking-widest text-zinc-400">SYSTEM V1</p>
        <h1 className="text-3xl font-semibold">{repairTimezone ? "Repair timezone" : "Profile Setup"}</h1>
        {repairTimezone && <p className="mt-3 text-sm text-zinc-400">Select and save a valid timezone, then return to Daily Quests.</p>}
        <OnboardingForm displayName={context.profile.display_name} timezones={timezoneOptions()} />
        <LogoutForm />
      </div>
    </main>
  );
}
