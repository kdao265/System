import type { ReactNode } from "react";
import { AppHeader } from "./app-header";

// One shared SYSTEM shell. AO extends its route vocabulary but creates no second shell.
export type SystemSection = "dashboard" | "calendar" | "goals" | "library" | "opportunities" | "activities";
export function SystemShell({ current, lang, selectedDate, compact = false, width = "narrow", pageClassName, children }: {
  current: SystemSection;
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
