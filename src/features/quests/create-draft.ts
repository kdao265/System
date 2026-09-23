import { localTimeToUtc, utcToLocalInput } from "./time";
import { validateQuestCreationRequest, type QuestCreationRequest } from "./create-model";
import type { PendingCreation } from "./create-pending";

export type QuestDraft = {
  title: string; description: string; scheduled_at: string; deadline_at: string;
  default_reward_exp: string; importance: "main" | "side";
  priority: "" | "low" | "medium" | "high" | "critical";
};
export const emptyDraft: QuestDraft = { title: "", description: "", scheduled_at: "", deadline_at: "", default_reward_exp: "0", importance: "side", priority: "" };
export function draftFromPending(operation: PendingCreation): QuestDraft {
  return {
    ...operation.request, description: operation.request.description ?? "", priority: operation.request.priority ?? "",
    default_reward_exp: String(operation.request.default_reward_exp),
    scheduled_at: operation.request.scheduled_at ? utcToLocalInput(operation.request.scheduled_at, operation.timezone) : "",
    deadline_at: operation.request.deadline_at ? utcToLocalInput(operation.request.deadline_at, operation.timezone) : "",
  };
}
export function requestFromDraft(draft: QuestDraft, timezone: string): { request: QuestCreationRequest; error?: never } | { error: string; request?: never } {
  const scheduled = draft.scheduled_at ? localTimeToUtc(draft.scheduled_at, timezone) : { ok: true as const, value: "" };
  const deadline = draft.deadline_at ? localTimeToUtc(draft.deadline_at, timezone) : { ok: true as const, value: "" };
  if (!scheduled.ok || !deadline.ok) {
    const reason = !scheduled.ok ? scheduled.reason : deadline.ok ? "format" : deadline.reason;
    return { error: reason === "ambiguous" ? "That local time occurs twice during the daylight-saving transition." : reason === "nonexistent" ? "That local time does not exist during the daylight-saving transition." : "Enter a valid local date and time." };
  }
  const request: QuestCreationRequest = {
    title: draft.title.trim(), description: draft.description.trim() || null,
    importance: draft.importance, priority: draft.priority || null,
    default_reward_exp: draft.default_reward_exp.trim() === "" ? 0 : Number(draft.default_reward_exp),
    scheduled_at: scheduled.value || null, deadline_at: deadline.value || null,
  };
  if (!request.title || [...request.title].length > 120) return { error: "Enter a title of 1 to 120 characters." };
  if (request.description !== null && [...request.description].length > 4000) return { error: "Description must be 4000 characters or fewer." };
  if (!Number.isInteger(request.default_reward_exp) || request.default_reward_exp < 0 || request.default_reward_exp > 2147483647) return { error: "EXP must be a whole number from 0 to 2,147,483,647." };
  return validateQuestCreationRequest(request) ? { request } : { error: "Enter a planned start or deadline, with the deadline at or after the planned start." };
}
