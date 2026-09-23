const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MIN_CALENDAR_DATE = "0001-01-01";
export const MAX_CALENDAR_DATE = "9999-12-31";
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  if (value < MIN_CALENDAR_DATE || value > MAX_CALENDAR_DATE) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveSelectedDate(value: unknown, timezone: string): string {
  return isCalendarDate(value) ? value : todayInTimezone(timezone);
}

export function todayInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year.padStart(4, "0")}-${values.month}-${values.day}`;
}

export function addCalendarDays(value: string, amount: number): string {
  if (!isCalendarDate(value) || !Number.isInteger(amount)) throw new Error("Invalid calendar date");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + amount);
  const result = date.toISOString().slice(0, 10);
  if (!isCalendarDate(result)) throw new Error("Calendar date is outside the supported range");
  return result;
}

export function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}