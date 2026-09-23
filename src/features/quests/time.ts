import { isSupportedTimezone } from "@/features/profile/timezones";

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

function wallMilliseconds(parts: Intl.DateTimeFormatPart[]) {
  const values = Object.fromEntries(parts
    .filter((part) => ["year", "month", "day", "hour", "minute", "second"].includes(part.type))
    .map((part) => [part.type, Number(part.value)]));
  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
}

function formatter(timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function localMilliseconds(value: string) {
  const match = LOCAL_TIME.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const result = Date.UTC(year, month - 1, day, hour, minute, 0);
  const check = new Date(result).toISOString().slice(0, 16);
  return check === value ? result : null;
}

export type LocalTimeResult =
  | { ok: true; value: string }
  | { ok: false; reason: "format" | "nonexistent" | "ambiguous" | "timezone" };

export function localTimeToUtc(value: string, timezone: string): LocalTimeResult {
  if (!isSupportedTimezone(timezone)) return { ok: false, reason: "timezone" };
  const local = localMilliseconds(value);
  if (local === null) return { ok: false, reason: "format" };
  const format = formatter(timezone);
  const offsets = new Set<number>();
  for (let minutes = -2880; minutes <= 2880; minutes += 15) {
    const instant = local + minutes * 60_000;
    offsets.add(wallMilliseconds(format.formatToParts(new Date(instant))) - instant);
  }
  const matches = [...offsets]
    .map((offset) => local - offset)
    .filter((instant, index, values) => values.indexOf(instant) === index)
    .filter((instant) => wallMilliseconds(format.formatToParts(new Date(instant))) === local);
  if (matches.length === 0) return { ok: false, reason: "nonexistent" };
  if (matches.length !== 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, value: new Date(matches[0]).toISOString() };
}

export function formatProfileLocal(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function utcToLocalInput(value: string, timezone: string) {
  const parts = formatter(timezone).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}