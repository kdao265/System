"use client";

import { useState } from "react";
import { useLocale } from "@/lib/localization/provider";
import { resolveLocale } from "@/lib/localization/dictionaries";
import { aoCopy } from "@/features/activities-opportunities/ui/ui-copy";
import type { SystemSection } from "./system-shell";
import { Button } from "./ui/primitives";

export function AppHeader({ current, selectedDate, compact = false }: { current: SystemSection; selectedDate?: string; compact?: boolean }) {
  const { locale, messages: t, pending, changeLocale } = useLocale();
  const [error, setError] = useState(false);
  const a = aoCopy[locale];
  const heading = current === "dashboard" ? "SYSTEM" : current === "opportunities" ? a.opportunities
    : current === "activities" ? a.activities : t.navigation[current];
  const subtitle = current === "opportunities" || current === "activities" ? a.growth : t.shell[current];
  const links = [
    { key: "dashboard", href: "/dashboard" },
    { key: "calendar", href: selectedDate ? `/calendar?date=${selectedDate}` : "/calendar" },
    { key: "goals", href: "/goals" },
    { key: "library", href: "/library" },
  ] as const;
  const growthLinks = [
    { key: "opportunities", href: "/opportunities", text: a.opportunities },
    { key: "activities", href: "/activities", text: a.activities },
  ] as const;
  return <header lang={locale} className="app-header system-shell-rail">
    <div className="system-brand">
      <p className="type-metadata text-accent">PERSONAL LIFE OS</p>
      <h1 className={current === "dashboard" ? "type-display" : "type-page"}>{heading}</h1>
      <p className="system-shell-tagline">{subtitle}</p>
    </div>
    <nav aria-label={t.navigation.label} className="system-nav">
      {links.map(({ key, href }) => <a key={key} href={href} aria-current={current === key ? "page" : undefined}
        className="ui-button ui-nav-link">{t.navigation[key]}</a>)}
      <div className="system-nav-growth" role="group" aria-label={a.growth}>
        <p className="type-metadata system-nav-growth-title">{a.growth}</p>
        <div className="system-nav-growth-links">
          {growthLinks.map(({ key, href, text }) => <a key={key} href={href} aria-current={current === key ? "page" : undefined}
            className="ui-button ui-nav-link">{text}</a>)}
        </div>
      </div>
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
