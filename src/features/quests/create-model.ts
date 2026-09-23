export type QuestCreationRequest = {
  title: string;
  description: string | null;
  importance: "main" | "side";
  priority: "low" | "medium" | "high" | "critical" | null;
  default_reward_exp: number;
  scheduled_at: string | null;
  deadline_at: string | null;
};

const ABSOLUTE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function isAbsoluteTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ABSOLUTE_TIMESTAMP.exec(value);
  if (!match) return false;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}

export function validateQuestCreationRequest(request: unknown): request is QuestCreationRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) return false;
  const value = request as Record<string, unknown>;
  const keys = ["title", "description", "importance", "priority", "default_reward_exp", "scheduled_at", "deadline_at"];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return false;
  if (typeof value.title !== "string" || value.title.trim() === "" || [...value.title].length > 120 ||
      (value.description !== null && (typeof value.description !== "string" || [...value.description].length > 4000)) ||
      typeof value.importance !== "string" || !["main", "side"].includes(value.importance) ||
      (value.priority !== null && (typeof value.priority !== "string" || !["low", "medium", "high", "critical"].includes(value.priority))) ||
      typeof value.default_reward_exp !== "number" || !Number.isInteger(value.default_reward_exp) ||
      value.default_reward_exp < 0 || value.default_reward_exp > 2147483647 ||
      (value.scheduled_at !== null && !isAbsoluteTimestamp(value.scheduled_at)) ||
      (value.deadline_at !== null && !isAbsoluteTimestamp(value.deadline_at)) ||
      (value.scheduled_at === null && value.deadline_at === null)) return false;
  return value.scheduled_at === null || value.deadline_at === null ||
    new Date(value.deadline_at).getTime() >= new Date(value.scheduled_at).getTime();
}
