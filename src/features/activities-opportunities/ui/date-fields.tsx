"use client";

import { parseDeadline, type DeadlineSpec } from "../model";
import type { DateDraft, DateMode } from "../temporal-input";
import type { FieldFailure } from "../application";
import { coreCopy, type AoField } from "./core-copy";
import type { AoLocale } from "./ui-copy";

export function DateFields({ name, prefix, locale, value, onChange, deadline = false, failure }: {
  name: AoField; prefix: string; locale: AoLocale; value: DateDraft; onChange(value: DateDraft): void;
  deadline?: boolean; failure?: FieldFailure | null;
}) {
  const t = coreCopy[locale], id = `${prefix}-${name}`, error = failure?.field === name;
  const parts: ("year" | "month" | "day" | "time" | "offset" | "zone")[] = [];
  if (!["unset", "unknown"].includes(value.mode)) parts.push("year");
  if (!["unset", "unknown", "year"].includes(value.mode)) parts.push("month");
  if (["day", "unresolved", "instant"].includes(value.mode)) parts.push("day");
  if (["unresolved", "instant"].includes(value.mode)) parts.push("time");
  if (value.mode === "instant") parts.push("offset", "zone");
  return <fieldset className="ao-date-fields" id={id} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}>
    <legend>{t.fields[name]}</legend>
    <label htmlFor={`${id}-precision`}>{t.fields.precision}</label>
    <select id={`${id}-precision`} name={`${name}.precision`} className="ui-field" value={value.mode}
      aria-invalid={error || undefined} onChange={e => onChange({ ...value, mode: e.target.value as DateMode })}>
      {value.mode === "unset" && <option value="unset" disabled>{t.unset}</option>}
      {(["unknown", "year", "month", "day", ...(deadline ? ["unresolved", "instant"] : [])] as Exclude<DateMode, "unset">[])
        .map(mode => <option key={mode} value={mode}>{t.options[mode]}</option>)}
    </select>
    <div className="ao-core-grid">{parts.map(part => <div className="ao-core-field" key={part}>
      <label htmlFor={`${id}-${part}`}>{t.fields[part]}</label>
      <input id={`${id}-${part}`} name={`${name}.${part}`} className="ui-field" value={value[part]}
        inputMode={["year", "month", "day"].includes(part) ? "numeric" : undefined}
        aria-invalid={error || undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={e => onChange({ ...value, [part]: e.target.value })}/>
    </div>)}</div>
    <p id={`${id}-hint`}>{value.mode === "instant" ? t.instantHint : value.mode === "unresolved" ? t.unresolvedHint : t.uncertain}</p>
    {error && <p id={`${id}-error`} className="text-danger">{t.errors[failure.code]}</p>}
  </fieldset>;
}

export function DateValue({ value, locale, localZone }: { value: DeadlineSpec | null; locale: AoLocale; localZone?: string }) {
  const t = coreCopy[locale];
  if (value === null || value.precision === "unknown") return <span>{t.options.unknown} · {t.uncertain}</span>;
  const parsed = parseDeadline(value);
  if (!parsed.ok) return <span>{t.invalidDate}</span>;
  if (value.precision === "instant") {
    let local: string | undefined;
    if (localZone && parsed.value.utcMilliseconds !== null) {
      try { local = new Intl.DateTimeFormat(locale, { timeZone: localZone, dateStyle: "medium", timeStyle: "short" }).format(parsed.value.utcMilliseconds); }
      catch { /* An invalid display zone cannot change authoritative source data. */ }
    }
    return <span className="ao-date-value">
      <span>{t.source}: {value.source_date} {value.source_time}{value.source_zone ? ` · ${value.source_zone}` : ""} · UTC {value.source_offset_minutes >= 0 ? "+" : ""}{value.source_offset_minutes} min</span>
      {local && <span>{t.local} ({localZone}): {local}</span>}
    </span>;
  }
  const civil = `${String(value.year).padStart(4, "0")}${"month" in value ? `-${String(value.month).padStart(2, "0")}` : ""}${"day" in value ? `-${String(value.day).padStart(2, "0")}` : ""}`;
  return <span>{civil}{"source_time" in value ? ` ${value.source_time} · ${t.unresolvedHint}` : ` · ${t.options[value.precision]} · ${t.uncertain}`}</span>;
}
