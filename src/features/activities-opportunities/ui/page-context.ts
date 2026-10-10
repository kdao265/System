import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/localization/dictionaries";

// The verified owner and Profile gate must run BEFORE rendering any AO screen.
// This performs only the existing Auth/Profile read; it never queries AO tables.
export async function aoPageContext() {
  const { profile, error } = await getProfileContext();
  if (error === "unavailable") return { outcome: "unavailable" as const };
  if (error === "missing") return { outcome: "missing" as const };
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { outcome: "ready" as const, locale };
}
