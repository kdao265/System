/** The twelve fields of public.list_day_quest_occurrences(), without derivation. */
export type DayQuest = {
  occurrence_id: string;
  quest_id: string;
  quest_title: string;
  status: "draft" | "scheduled" | "active" | "completed" | "failed" | "cancelled";
  scheduled_at: string | null;
  deadline_at: string | null;
  source_slot_date: string | null;
  execution_cycle: number;
  reward_exp_snapshot: number | null;
  progression_ready: boolean;
  completable: boolean;
  already_completed_cycle: number | null;
};

export type DayQuestResult =
  | { status: "ok"; quests: DayQuest[] }
  | { status: "invalid" | "unavailable" | "timezone-required" | "session-expired" };

const FIELDS = [
  "occurrence_id", "quest_id", "quest_title", "status", "scheduled_at", "deadline_at",
  "source_slot_date", "execution_cycle", "reward_exp_snapshot", "progression_ready",
  "completable", "already_completed_cycle",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["draft", "scheduled", "active", "completed", "failed", "cancelled"];

function pgInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= minimum && value <= 2147483647;
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Require an absolute PostgREST timestamp; reject JS date rollover and local times.
  const parts = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return parts !== null && calendarDate(parts[1]) && Number.isFinite(Date.parse(value));
}

function isDayQuest(input: unknown): input is DayQuest {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== FIELDS.length ||
      FIELDS.some((key) => !Object.hasOwn(row, key))) return false;
  return typeof row.occurrence_id === "string" && UUID.test(row.occurrence_id) &&
    typeof row.quest_id === "string" && UUID.test(row.quest_id) &&
    typeof row.quest_title === "string" && row.quest_title.trim().length > 0 &&
    [...row.quest_title].length <= 120 &&
    typeof row.status === "string" && STATUSES.includes(row.status) &&
    (row.scheduled_at === null || timestamp(row.scheduled_at)) &&
    (row.deadline_at === null || timestamp(row.deadline_at)) &&
    (row.source_slot_date === null || calendarDate(row.source_slot_date)) &&
    pgInteger(row.execution_cycle, 1) &&
    (row.reward_exp_snapshot === null || pgInteger(row.reward_exp_snapshot, 0)) &&
    typeof row.progression_ready === "boolean" && typeof row.completable === "boolean" &&
    (row.already_completed_cycle === null || pgInteger(row.already_completed_cycle, 1));
}

export function parseDayQuests(data: unknown): DayQuestResult {
  if (!Array.isArray(data)) return { status: "invalid" };
  const quests: DayQuest[] = [];
  const ids = new Set<string>();
  for (const row of data) {
    if (!isDayQuest(row) || ids.has(row.occurrence_id)) return { status: "invalid" };
    ids.add(row.occurrence_id);
    quests.push(row);
  }
  // Preserve every row, its order and both readiness flags exactly as returned.
  // Only [] is an intentionally empty day; never salvage partial malformed data.
  return { status: "ok", quests };
}
