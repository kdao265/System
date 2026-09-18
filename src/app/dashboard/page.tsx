import { LogoutForm } from "@/features/auth/logout-form";
import { redirect } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { ProfileError } from "@/features/profile/profile-error";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, profile, error } = await getProfileContext();
  if (!profile) return <ProfileError missing={error === "missing"} />;
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight">SYSTEM V1</h1>
        <p className="mt-6 text-zinc-300">You are signed in.</p>
        <p className="mt-2 break-words text-sm text-zinc-400">{user.email}</p>
        {profile.display_name && <p className="mt-4 break-words">{profile.display_name}</p>}
        <p className="mt-2 text-sm text-zinc-400">Timezone: {profile.timezone}</p>
        <LogoutForm />
      </div>
    </main>
  );
}
