/** Exact public.level_reward_listing projection; numeric/bigint travel as text. */
export type LevelReward = {
  reward_id: string;
  required_level: number;
  title: string;
  description: string | null;
  category: "treat" | "purchase" | "experience" | "custom";
  estimated_cost: string | null;
  currency_label: string | null;
  revision: string;
  archived_at: string | null;
  lifecycle: "LOCKED" | "UNLOCKED" | "REDEEMED";
  unlock_id: string | null;
  unlocked_at: string | null;
  redemption_event_id: string | null;
  redeemed_at: string | null;
};

export type RewardsResult =
  | { status: "ok"; rewards: LevelReward[] }
  | { status: "invalid" | "unavailable" | "session-expired" };

// Cast before JSON parsing: neither unconstrained numeric nor bigint is safely
// transported as a JS number. Keep the SQL names and all fourteen fields.
export const REWARD_PROJECTION = "reward_id,required_level,title,description,category,estimated_cost::text,currency_label,revision::text,archived_at,lifecycle,unlock_id,unlocked_at,redemption_event_id,redeemed_at";
const FIELDS = REWARD_PROJECTION.replaceAll("::text", "").split(",");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
// PostgreSQL btrim(text) removes spaces, not every Unicode whitespace character.
const nonblank = (value: unknown): value is string => typeof value === "string" && value.replace(/^ +| +$/g, "").length > 0;

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!parts) return false;
  const date = new Date(`${parts[1]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === parts[1] && Number.isFinite(Date.parse(value));
}

function isReward(input: unknown): input is LevelReward {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== FIELDS.length || FIELDS.some((key) => !Object.hasOwn(row, key))) return false;
  return uuid(row.reward_id) && typeof row.required_level === "number" &&
    Number.isInteger(row.required_level) && row.required_level >= 0 && row.required_level <= 2147483647 &&
    nonblank(row.title) && (row.description === null || typeof row.description === "string") &&
    typeof row.category === "string" && ["treat", "purchase", "experience", "custom"].includes(row.category) &&
    ((row.estimated_cost === null && row.currency_label === null) ||
      (typeof row.estimated_cost === "string" && /^(0|[1-9]\d*)(\.\d+)?$/.test(row.estimated_cost) && nonblank(row.currency_label))) &&
    typeof row.revision === "string" && /^[1-9]\d{0,18}$/.test(row.revision) && BigInt(row.revision) <= BigInt("9223372036854775807") &&
    (row.archived_at === null || timestamp(row.archived_at)) &&
    typeof row.lifecycle === "string" && ["LOCKED", "UNLOCKED", "REDEEMED"].includes(row.lifecycle) &&
    (row.unlock_id === null || uuid(row.unlock_id)) && (row.unlocked_at === null || timestamp(row.unlocked_at)) &&
    (row.redemption_event_id === null || uuid(row.redemption_event_id)) && (row.redeemed_at === null || timestamp(row.redeemed_at));
}

export function parseRewards(data: unknown): RewardsResult {
  if (!Array.isArray(data)) return { status: "invalid" };
  const rewards: LevelReward[] = [];
  const ids = new Set<string>();
  for (const row of data) {
    if (!isReward(row) || ids.has(row.reward_id.toLowerCase())) return { status: "invalid" };
    ids.add(row.reward_id.toLowerCase());
    rewards.push(row);
  }
  // Validate all rows before preview truncation; never salvage a malformed list.
  // Preserve SQL order and lifecycle, independently of archive/receipt presence.
  return { status: "ok", rewards };
}
