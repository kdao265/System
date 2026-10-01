"use client";

import { useState } from "react";
import { useLocale } from "@/lib/localization/provider";
import { resolveLocale } from "@/lib/localization/dictionaries";
import { Button } from "./ui/primitives";

export function AppHeader({ current, selectedDate }: { current: "dashboard" | "calendar" | "goals"; selectedDate?: string }) {
  const { locale, messages: t, pending, changeLocale } = useLocale();
  const [error, setError] = useState(false);
  const links = [
    { key: "dashboard", href: "/dashboard" },
    { key: "calendar", href: selectedDate ? `/calendar?date=${selectedDate}` : "/calendar" },
    { key: "goals", href: "/goals" },
  ] as const;
  return <header lang={locale} className="app-header">
    <p className="type-metadata text-accent">PERSONAL LIFE OS</p>
    <h1 className={current === "dashboard" ? "type-display mt-2" : "type-page mt-2"}>
      {current === "dashboard" ? "SYSTEM" : t.navigation[current]}
    </h1>
    <p className="mt-3 text-muted">{t.shell[current]}</p>
    <nav aria-label={t.navigation.label} className="mt-6 flex flex-wrap gap-2">
      {links.map(({ key, href }) => <a key={key} href={href} aria-current={current === key ? "page" : undefined}
        className="ui-button ui-nav-link">{t.navigation[key]}</a>)}
    </nav>
    <form className="mt-5 flex flex-wrap items-end gap-2" aria-busy={pending} onSubmit={(event) => {
      event.preventDefault();
      const next = resolveLocale(new FormData(event.currentTarget).get("locale"));
      setError(!changeLocale(next));
    }}>
      <div className="min-w-0">
        <label className="type-metadata" htmlFor="shell-locale">{t.locale.label}</label>
        <select key={locale} defaultValue={locale} id="shell-locale" name="locale" className="ui-field mt-1" disabled={pending} aria-describedby="locale-hint">
          <option value="vi" lang="vi">Tiếng Việt</option><option value="en" lang="en">English</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>{t.locale.apply}</Button>
      <p id="locale-hint" className="w-full type-metadata text-muted">{t.locale.hint}</p>
      {error && <p role="alert" className="text-danger">{t.locale.unavailable}</p>}
    </form>
  </header>;
}
