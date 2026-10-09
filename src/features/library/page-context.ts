import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDictionary, LOCALE_COOKIE, resolveLocale } from "@/lib/localization/dictionaries";
import { libraryContext } from "./data";

export async function libraryPageContext() {
  const context = await libraryContext();
  if (context.outcome === "onboarding_required") redirect("/onboarding");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { context, locale, copy: getDictionary(locale).library };
}
