"use client";

import { useRef } from "react";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { useSeriesSelection } from "./recurring-series-manager";

/**
 * The `...` entry point on a recurring occurrence card. It never exposes
 * Archive/Delete/Pause directly; it only opens explicit SERIES management.
 */
export function RecurringSeriesTrigger({ occurrenceId, questId, title, locale = "en" }: {
  occurrenceId: string; questId: string; title: string; locale?: Locale;
}) {
  const t = getDictionary(locale).seriesManage;
  const open = useSeriesSelection();
  const summary = useRef<HTMLElement>(null);
  return <details className="relative shrink-0">
    <summary ref={summary} aria-label={`${t.manage}: ${title}`}
      className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-300 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:py-3">
      <span aria-hidden="true">...</span>
    </summary>
    <div className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
      <button type="button"
        onClick={() => {
          const element = summary.current;
          if (!element || !open) return;
          element.closest("details")?.removeAttribute("open");
          open({ occurrenceId, questId, title }, element);
        }}
        className="block min-h-11 w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900">
        {t.manage}
      </button>
    </div>
  </details>;
}
