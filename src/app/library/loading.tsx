import { cookies } from "next/headers";
import { getDictionary, LOCALE_COOKIE } from "@/lib/localization/dictionaries";
export default async function LibraryLoading() {
  const t = getDictionary((await cookies()).get(LOCALE_COOKIE)?.value).library;
  return <main className="page-frame"><p role="status">{t.loading}</p></main>;
}
