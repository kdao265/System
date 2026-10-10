import "server-only";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { ProfileError } from "@/features/profile/profile-error";

// Authenticate in the route-group layout, outside loading.tsx's page Suspense
// boundary, so a missing owner session cannot produce an HTTP 200 stream.
export async function AoAccessLayout({ children }: { children: ReactNode }) {
  const { profile, error } = await getProfileContext();
  if (!profile) return <ProfileError missing={error === "missing"} />;
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
  return children;
}
