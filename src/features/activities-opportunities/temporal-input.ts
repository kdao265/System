import { parseDeadline, parsePartialDate, type DeadlineSpec, type PartialDate, type Validation } from "./model";

// "unset" represents an untouched nullable field in the editor, never a domain precision.
// Choosing Unknown is an explicit clear; mounting a null field is not an edit.
export type DateMode = PartialDate["precision"] | "instant" | "unresolved" | "unset";
export type DateDraft = { mode: DateMode; year: string; month: string; day: string; time: string; zone: string; offset: string };
export const blankDate = (): DateDraft => ({ mode: "unset", year: "", month: "", day: "", time: "", zone: "", offset: "" });
export function dateDraft(value: DeadlineSpec | null): DateDraft {
  const draft = blankDate();
  if (!value) return draft;
  if (value.precision === "unknown") return { ...draft, mode: "unknown" };
  if (value.precision === "instant") {
    const [year, month, day] = value.source_date.split("-");
    return { mode: "instant", year, month, day, time: value.source_time, zone: value.source_zone ?? "", offset: String(value.source_offset_minutes) };
  }
  return { ...draft, mode: "source_time" in value ? "unresolved" : value.precision,
    year: String(value.year), month: "month" in value ? String(value.month) : "",
    day: "day" in value ? String(value.day) : "", time: "source_time" in value ? value.source_time : "" };
}
export function parseDateDraft(draft: DateDraft, deadline: boolean, field: string): Validation<DeadlineSpec | null> {
  const numeric = (s: string) => /^\d+$/.test(s) ? Number(s) : NaN;
  const civil = { year: numeric(draft.year), month: numeric(draft.month), day: numeric(draft.day) };
  let raw: unknown;
  switch (draft.mode) {
    case "unset": return { ok: true, value: null };
    case "unknown": raw = { precision: "unknown" }; break;
    case "year": raw = { precision: "year", year: civil.year }; break;
    case "month": raw = { precision: "month", year: civil.year, month: civil.month }; break;
    case "day": raw = { precision: "day", ...civil }; break;
    case "unresolved": raw = { precision: "day", ...civil, source_time: draft.time, source_time_state: "unresolved" }; break;
    case "instant": raw = { precision: "instant", source_date: `${draft.year.padStart(4, "0")}-${draft.month.padStart(2, "0")}-${draft.day.padStart(2, "0")}`,
      source_time: draft.time, source_offset_minutes: /^[+-]?\d+$/.test(draft.offset) ? Number(draft.offset) : NaN,
      ...(draft.zone ? { source_zone: draft.zone } : {}) }; break;
  }
  if (!deadline) return parsePartialDate(raw, field);
  const parsed = parseDeadline(raw, field);
  return parsed.ok ? { ok: true, value: parsed.value.spec } : parsed;
}
