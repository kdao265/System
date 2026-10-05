/**
 * Closed parser for public.materialize_quest_day_v2 (contract version 2).
 * Materialization issues are slot-local: they describe one series slot the
 * backend deliberately skipped. They never replace the day's occurrence read,
 * and they never turn a successful generation into a fatal error.
 */
export const MATERIALIZATION_ISSUE_REASONS = [
  "nonexistent_local_time", "ambiguous_local_time", "unsupported_timezone_semantics",
  "unsupported_instant_range", "invalid_interval",
] as const;
export type MaterializationIssueReason = typeof MATERIALIZATION_ISSUE_REASONS[number];
export const MATERIALIZATION_ISSUE_ENDPOINTS = ["start", "end", "interval"] as const;
export type MaterializationIssueEndpoint = typeof MATERIALIZATION_ISSUE_ENDPOINTS[number];

export type MaterializationIssue = {
  quest_id: string;
  recurrence_rule_id: string;
  rule_revision: number;
  source_slot_date: string;
  local_start_time: string | null;
  local_end_time: string | null;
  planned_end_day_offset: 0 | 1 | null;
  endpoint: MaterializationIssueEndpoint;
  reason: MaterializationIssueReason;
};

export type MaterializationRead = { createdCount: number; issues: MaterializationIssue[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ["version", "day", "timezone", "created_count", "issues"];
const ISSUE_KEYS = ["quest_id", "recurrence_rule_id", "rule_revision", "source_slot_date", "local_start_time",
  "local_end_time", "planned_end_day_offset", "endpoint", "reason"];
// The snapshot path uses to_char("HH:MI"); the unspecified-timezone path returns
// the raw Postgres time, which serializes with seconds. Accept only those two.
const ISSUE_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function issue(value: unknown): MaterializationIssue | null {
  if (!record(value) || Object.keys(value).length !== ISSUE_KEYS.length || ISSUE_KEYS.some((key) => !Object.hasOwn(value, key))) return null;
  const time = (input: unknown) => input === null || (typeof input === "string" && ISSUE_TIME.test(input));
  if (typeof value.quest_id !== "string" || !UUID.test(value.quest_id)) return null;
  if (typeof value.recurrence_rule_id !== "string" || !UUID.test(value.recurrence_rule_id)) return null;
  if (!Number.isInteger(value.rule_revision) || (value.rule_revision as number) < 1) return null;
  if (!calendarDate(value.source_slot_date)) return null;
  if (!time(value.local_start_time) || !time(value.local_end_time)) return null;
  if (![0, 1, null].includes(value.planned_end_day_offset as 0 | 1 | null)) return null;
  if (!MATERIALIZATION_ISSUE_ENDPOINTS.includes(value.endpoint as MaterializationIssueEndpoint)) return null;
  if (!MATERIALIZATION_ISSUE_REASONS.includes(value.reason as MaterializationIssueReason)) return null;
  return value as MaterializationIssue;
}

/** Returns null only for a response outside the certified v2 contract. */
export function parseMaterializeDay(data: unknown, selectedDate: string): MaterializationRead | null {
  if (!record(data) || Object.keys(data).length !== KEYS.length || KEYS.some((key) => !Object.hasOwn(data, key))) return null;
  if (data.version !== 2 || data.day !== selectedDate) return null;
  if (typeof data.timezone !== "string" || data.timezone.trim() === "") return null;
  if (!Number.isInteger(data.created_count) || (data.created_count as number) < 0) return null;
  if (!Array.isArray(data.issues)) return null;
  const issues: MaterializationIssue[] = [];
  for (const entry of data.issues) {
    const parsed = issue(entry);
    // One malformed entry invalidates the whole response; partial salvage would
    // silently drop a warning the backend did emit.
    if (!parsed) return null;
    issues.push(parsed);
  }
  return { createdCount: data.created_count as number, issues };
}

/** "HH:MM" for display, from either accepted serialization. */
export function issueClock(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}
