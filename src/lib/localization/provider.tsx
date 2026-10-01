"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, LOCALE_COOKIE, getDictionary, localeCookie, type Locale } from "./dictionaries";

const LocaleContext = createContext<{ locale: Locale; pending: boolean; changeLocale: (locale: Locale) => boolean }>({
  locale: DEFAULT_LOCALE, pending: false, changeLocale: () => false,
});

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function changeLocale(next: Locale) {
    try {
      document.cookie = localeCookie(next, location.protocol === "https:");
      if (!document.cookie.split(";").some((pair) => pair.trim() === `${LOCALE_COOKIE}=${next}`)) return false;
      // RSC refresh preserves mounted form state. The cookie supplies the same locale
      // to the document and client context; no localStorage/effect hydration correction.
      startTransition(() => router.refresh());
      return true;
    } catch { return false; }
  }
  return <LocaleContext.Provider value={{ locale, pending, changeLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  return { ...context, messages: getDictionary(context.locale) };
}
