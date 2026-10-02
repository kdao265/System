"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { UUID } from "./create-pending";
import { deleteOneOffQuest, setOneOffQuestArchived } from "./management-data";

export type QuestManagementOperation = "archive" | "restore" | "delete";
export type QuestManagementReason =
  | "account"
  | "validation"
  | "completed"
  | "goal"
  | "recurring"
  | "deleted"
  | "exp"
  | "conflict"
  | "stale";

export type QuestManagementState =
  | { outcome: "idle" }
  | { outcome: "success"; operation: QuestManagementOperation; replay: boolean }
  | { outcome: "rejected"; operation: QuestManagementOperation; reason: QuestManagementReason }
  | { outcome: "unknown"; operation: QuestManagementOperation };


function rpcError(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
  };
}

function rejectedReason(error: unknown): QuestManagementReason | null {
  const detail = rpcError(error);
  if (!detail) return null;
  const { code, message } = detail;

  if (code === "23514" && message === "Reopen completed Quest before permanent deletion") return "completed";
  if (code === "23514" && message === "Detach Quest from Main Quest before permanent deletion") return "goal";
  if (code === "23514" && (
    message === "Quest Delete V1 supports one-off Quests only" ||
    message === "Quest Archive V1 supports one-off Quests only"
  )) return "recurring";
  if (code === "23514" && (
    message === "Permanently deleted Quest cannot be restored or archived" ||
    message === "Quest is already permanently deleted"
  )) return "deleted";
  if (code === "23514" && message === "Quest EXP must be fully reversed before permanent deletion") return "exp";
  if (code === "23505" && (
    message === "Conflicting Quest archive command reuse" ||
    message === "Conflicting Quest delete command reuse" ||
    message === "Conflicting quest command reuse"
  )) return "conflict";
  if (code === "P0002" && message === "Quest subject not found") return "stale";
  return null;
}

function revalidateQuestSurfaces() {
  revalidatePath("/dashboard");
  revalidatePath("/goals");
  revalidatePath("/calendar");
}

export async function manageQuest(
  _previous: QuestManagementState,
  formData: FormData,
): Promise<QuestManagementState> {
  const user = await requireUser();
  const expectedAccount = formData.get("expected_account");
  const questId = formData.get("quest_id");
  const operation = formData.get("operation");
  const commandId = formData.get("command_id");
  const mode = formData.get("mode");

  if (expectedAccount !== user.id) {
    return { outcome: "rejected", operation: "archive", reason: "account" };
  }
  if (
    typeof questId !== "string" || !UUID.test(questId) ||
    typeof commandId !== "string" || !UUID.test(commandId) ||
    (mode !== "new" && mode !== "retry") ||
    (operation !== "archive" && operation !== "restore" && operation !== "delete")
  ) {
    return {
      outcome: "rejected",
      operation: operation === "restore" || operation === "delete" ? operation : "archive",
      reason: "validation",
    };
  }

  try {
    if (operation === "delete") {
      const receipt = await deleteOneOffQuest(commandId, questId);
      revalidateQuestSurfaces();
      return { outcome: "success", operation, replay: receipt.replay };
    }

    const receipt = await setOneOffQuestArchived(commandId, questId, operation === "archive");
    revalidateQuestSurfaces();
    return { outcome: "success", operation, replay: receipt.replay };
  } catch (error) {
    // A rejection now does not disprove an earlier commit whose response was lost.
    const reason = mode === "new" ? rejectedReason(error) : null;
    return reason
      ? { outcome: "rejected", operation, reason }
      : { outcome: "unknown", operation };
  }
}
