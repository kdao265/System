import type { ReactNode } from "react";
import { AppHeader } from "./app-header";

// One application shell for the four real routes: the SYSTEM navigation rail
// (a compact top shell below the desktop tier) beside a content column whose
// width the route chooses. Structure only — layout lives in
// src/styles/system-shell.css so the pages cannot drift apart.
export function SystemShell({ current, lang, selectedDate, compact = false, width = "narrow", pageClassName, children }: {
  current: "dashboard" | "calendar" | "goals" | "library";
  lang: string;
  selectedDate?: string;
  compact?: boolean;
  width?: "wide" | "narrow";
  pageClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={`system-shell${width === "wide" ? " system-shell-wide" : ""}`}>
      <AppHeader current={current} selectedDate={selectedDate} compact={compact} />
      <main lang={lang} className={`system-shell-content system-shell-content-${width} page-frame${pageClassName ? ` ${pageClassName}` : ""}`}>
        {children}
      </main>
    </div>
  );
}
