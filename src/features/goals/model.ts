import { UUID } from "@/features/quests/create-pending";

export type Goal = {
  id: string; title: string; description: string | null; archived_at: string | null;
  created_at: string; updated_at: string; revision: string;
  total_subquests: string; completed_subquests: string; is_complete: boolean;
  display_state: "active" | "completed" | "archived";
};
export type SubQuest = {
  link_id: string; quest_id: string; occurrence_id: string; position: number; attached_at: string;
  title: string; quest_archived_at: string | null; status: "draft" | "scheduled" | "active" | "completed" | "failed" | "cancelled";
  execution_cycle: number; scheduled_at: string | null; deadline_at: string | null; reward_exp_snapshot: number | null;
};
export type GoalDetail = { version: 1; goal: Goal; subquests: SubQuest[] };
export type GoalPage = { version: 1; goals: Goal[]; next_after_id: string | null };
export type GoalRequest = { userId: string; commandId: string; goalId: string } & (
  | { kind: "create"; title: string; description: string }
  | { kind: "update_metadata"; revision: string; title: string; description: string }
  | { kind: "set_archived"; revision: string; archived: boolean }
  | { kind: "attach"; revision: string; questId: string }
  | { kind: "detach"; revision: string; linkId: string }
);
export type GoalResult = { outcome: "success" | "rejected" | "unknown"; message: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const instant = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const nullableInstant = (v: unknown) => v === null || instant(v);
const integer = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= 2147483647;
export const decimal = (v: unknown, min = BigInt(0)): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) >= min && BigInt(v) <= BigInt("9223372036854775807");
const metadata = (title: unknown, description: unknown) => typeof title === "string" && !!title.trim() && [...title.trim()].length <= 120 && typeof description === "string" && [...description.trim()].length <= 4000;

export function isGoal(value: unknown): value is Goal {
  if (!record(value) || !id(value.id) || !metadata(value.title, value.description ?? "") ||
    !(value.description === null || typeof value.description === "string") ||
    !nullableInstant(value.archived_at) || !instant(value.created_at) || !instant(value.updated_at) ||
    !decimal(value.revision, BigInt(1)) || !decimal(value.total_subquests) || !decimal(value.completed_subquests)) return false;
  const total = BigInt(value.total_subquests), completed = BigInt(value.completed_subquests);
  const complete = total > BigInt(0) && completed === total;
  return completed <= total && value.is_complete === complete &&
    value.display_state === (value.archived_at !== null ? "archived" : complete ? "completed" : "active");
}
export function parseGoalPage(value: unknown): GoalPage | null {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.goals) || !value.goals.every(isGoal) ||
    !(value.next_after_id === null || id(value.next_after_id))) return null;
  const goals = value.goals;
  if (goals.some((g, i) => i > 0 && g.id <= goals[i - 1].id) ||
    (value.next_after_id !== null && value.next_after_id !== goals.at(-1)?.id)) return null;
  return value as GoalPage;
}
export function parseGoalDetail(value: unknown): GoalDetail | null {
  if (!record(value) || value.version !== 1 || !isGoal(value.goal) || !Array.isArray(value.subquests)) return null;
  const links = new Set(), quests = new Set(), occurrences = new Set();
  let previous: SubQuest | undefined;
  for (const row of value.subquests) {
    if (!record(row) || ![row.link_id, row.quest_id, row.occurrence_id].every(id) || !integer(row.position, 1) ||
      !instant(row.attached_at) || typeof row.title !== "string" || !row.title.trim() ||
      !nullableInstant(row.quest_archived_at) || !nullableInstant(row.scheduled_at) || !nullableInstant(row.deadline_at) ||
      !integer(row.execution_cycle, 1) || !(row.reward_exp_snapshot === null || integer(row.reward_exp_snapshot)) ||
      !["draft", "scheduled", "active", "completed", "failed", "cancelled"].includes(String(row.status)) ||
      links.has(row.link_id) || quests.has(row.quest_id) || occurrences.has(row.occurrence_id)) return null;
    const sub = row as SubQuest;
    if (previous && (sub.position < previous.position || (sub.position === previous.position && sub.link_id <= previous.link_id))) return null;
    links.add(sub.link_id); quests.add(sub.quest_id); occurrences.add(sub.occurrence_id); previous = sub;
  }
  if (String(value.subquests.length) !== value.goal.total_subquests ||
    String(value.subquests.filter((s) => s.status === "completed").length) !== value.goal.completed_subquests) return null;
  return value as GoalDetail;
}
export function progressPercent(goal: Goal) {
  // Counts and completion stay exact; only the visual percentage is rounded.
  return goal.total_subquests === "0" ? 0 : Number(BigInt(goal.completed_subquests) * BigInt(1000) / BigInt(goal.total_subquests)) / 10;
}
export function validRequest(value: unknown): value is GoalRequest {
  if (!record(value) || ![value.userId, value.commandId, value.goalId].every(id)) return false;
  if (value.kind !== "create" && !decimal(value.revision, BigInt(1))) return false;
  switch (value.kind) {
    case "create": case "update_metadata": return !!metadata(value.title, value.description);
    case "set_archived": return typeof value.archived === "boolean";
    case "attach": return id(value.questId);
    case "detach": return id(value.linkId);
    default: return false;
  }
}
export function goalCommand(input: GoalRequest) {
  const args: Record<string, string | boolean | null> = { p_command_id: input.commandId, p_goal_id: input.goalId };
  if (input.kind !== "create") args.p_expected_revision = input.revision;
  if (input.kind === "create" || input.kind === "update_metadata") {
    args.p_title = input.title.trim(); args.p_description = input.description.trim() || null;
  } else if (input.kind === "set_archived") args.p_archived = input.archived;
  else if (input.kind === "attach") args.p_quest_id = input.questId;
  else args.p_link_id = input.linkId;
  const names = { create: "create_goal_v1", update_metadata: "update_goal_v1", set_archived: "set_goal_archived_v1", attach: "attach_goal_quest_v1", detach: "detach_goal_quest_v1" };
  return { name: names[input.kind], args };
}
export function validReceipt(value: unknown, request: GoalRequest) {
  if (!record(value) || value.version !== 1 || value.command_id !== request.commandId || value.goal_id !== request.goalId ||
    value.command_type !== request.kind || typeof value.changed !== "boolean" || typeof value.replay !== "boolean" ||
    !instant(value.recorded_at) || !decimal(value.revision_after, BigInt(1))) return false;
  if (request.kind === "create") return value.revision_before === "0" && value.revision_after === "1" && value.changed && value.link_id === null;
  return value.revision_before === request.revision &&
    BigInt(value.revision_after) === BigInt(request.revision) + BigInt(value.changed ? 1 : 0) &&
    (request.kind === "detach" ? value.link_id === request.linkId : request.kind === "attach" ? id(value.link_id) : value.link_id === null);
}
export const unknownOutcome: GoalResult = { outcome: "unknown", message: "The outcome is unknown. Retry the saved request to confirm it. Its command ID and revision are preserved." };
export function goalError(error: { code?: string; message?: string }): GoalResult {
  const known: Record<string, string> = {
    "23514:Stale Goal revision": "This Main Quest changed. Refresh Goals, review the latest state, then submit your change again.",
    "23514:Archived Goal cannot be edited": "This Main Quest is archived. Refresh Goals and restore it before editing.",
    "23505:Quest already belongs to a Goal": "This Quest is already attached to another Main Quest, which may be archived. Refresh the candidates.",
    "23514:Quest is not eligible for Goal membership": "This Quest is not eligible. Recurring or archived Quests and Quests with existing parent data cannot be attached. Refresh the candidates.",
    "23505:Conflicting Goal command reuse": "The saved command conflicts with recorded history. Refresh and review the Main Quest before making a new change.",
    "23505:Goal identity already exists": "This Main Quest identity already exists. Refresh and review the list.",
    "P0002:Goal subject not found": "The Main Quest or Sub Quest is unavailable. Refresh before continuing.",
  };
  const message = known[`${error.code}:${error.message}`] ?? (error.code === "22023" ? "Check the title (1–120 characters) and description (up to 4,000), then try again." : error.code === "42501" ? "Your session or access changed. Refresh before continuing." : undefined);
  return message ? { outcome: "rejected", message } : unknownOutcome;
}

export type Candidate = { id: string; title: string };
/** Convenience only: membership/eligibility is checked again atomically by Phase A. */
export function eligibleCandidate(row: unknown): row is Candidate {
  if (!record(row) || !id(row.id) || typeof row.title !== "string" || row.recurrence_mode !== "one_off" ||
    row.archived_at !== null || row.direct_goal_id !== null || row.project_id !== null ||
    !Array.isArray(row.rules) || row.rules.length || !Array.isArray(row.links) || row.links.some((l) => !record(l) || l.detached_at === null) ||
    !Array.isArray(row.occurrences) || row.occurrences.length !== 1) return false;
  const o = row.occurrences[0];
  return record(o) && ["recurrence_rule_id", "recurrence_revision", "source_slot_date", "source_timezone", "direct_goal_id_snapshot", "project_id_snapshot"].every((key) => o[key] === null);
}
