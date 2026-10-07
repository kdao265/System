"use client";

import { useState } from "react";
import { useLocale } from "@/lib/localization/provider";
import { resolveLocale } from "@/lib/localization/dictionaries";
import { Button } from "./ui/primitives";

export function AppHeader({ current, selectedDate, compact = false }: { current: "dashboard" | "calendar" | "goals"; selectedDate?: string; compact?: boolean }) {
  const { locale, messages: t, pending, changeLocale } = useLocale();
  const [error, setError] = useState(false);
  const links = [
    { key: "dashboard", href: "/dashboard" },
    { key: "calendar", href: selectedDate ? `/calendar?date=${selectedDate}` : "/calendar" },
    { key: "goals", href: "/goals" },
  ] as const;
  // The root class marks this header as the shell's navigation rail; system-shell.css
  // turns it into a vertical rail, a split top shell or a compact stack per tier.
  return <header lang={locale} className="app-header system-shell-rail">
    <div className="system-brand">
      <p className="type-metadata text-accent">PERSONAL LIFE OS</p>
      <h1 className={current === "dashboard" ? "type-display" : "type-page"}>
        {current === "dashboard" ? "SYSTEM" : t.navigation[current]}
      </h1>
      <p className="system-shell-tagline">{t.shell[current]}</p>
    </div>
    <nav aria-label={t.navigation.label} className="system-nav">
      {links.map(({ key, href }) => <a key={key} href={href} aria-current={current === key ? "page" : undefined}
        className="ui-button ui-nav-link">{t.navigation[key]}</a>)}
      {/* Dashboard-only shortcut to the daily Quests region (compact prop). */}
      {compact && <a href="#daily-quests" className="ui-button ui-nav-link">{t.dashboard.quests}</a>}
    </nav>
    <form className="system-locale" aria-busy={pending} onSubmit={(event) => {
      event.preventDefault();
      const next = resolveLocale(new FormData(event.currentTarget).get("locale"));
      setError(!changeLocale(next));
    }}>
      <div className="system-locale-field">
        <label className="type-metadata" htmlFor="shell-locale">{t.locale.label}</label>
        <select key={locale} defaultValue={locale} id="shell-locale" name="locale" className="ui-field" disabled={pending} aria-describedby="locale-hint">
          <option value="vi" lang="vi">Tiếng Việt</option><option value="en" lang="en">English</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>{t.locale.apply}</Button>
      <p id="locale-hint" className="system-locale-hint">{t.locale.hint}</p>
      {error && <p role="alert" className="system-locale-error text-danger">{t.locale.unavailable}</p>}
    </form>
  </header>;
}
