import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/localization/dictionaries";
import { aoCopy } from "@/features/activities-opportunities/ui/ui-copy";

export default async function Loading() {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <main className="page-frame" lang={locale}><p role="status">{aoCopy[locale].loading}</p></main>;
}
