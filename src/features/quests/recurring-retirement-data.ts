import { unstable_rethrow } from "next/navigation";
import { getAuthenticatedUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { QuestManagementOperation } from "./management-action";
import { parseArchivedRecurringQuests, validateRecurringRetirementReceipt } from "./recurring-retirement-model";

export async function retireRecurringQuest(commandId: string, questId: string, operation: QuestManagementOperation) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc(operation === "delete" ? "delete_recurring_quest_v1" : "set_recurring_quest_archived_v1", {
    p_command_id: commandId, p_quest_id: questId, p_origin: "web_ui",
    ...(operation === "delete" ? {} : { p_archived: operation === "archive" }),
  });
  if (error) throw error;
  if (!validateRecurringRetirementReceipt(data, commandId, questId, operation)) throw new Error("Invalid recurring retirement receipt");
  return data;
}
export async function getArchivedRecurringQuests() {
  try {
    if (!await getAuthenticatedUser()) return null;
    const client = await createServerSupabaseClient(true);
    const { data, error } = await client.rpc("list_archived_recurring_quests_v1");
    return error ? null : parseArchivedRecurringQuests(data);
  } catch (error) { unstable_rethrow(error); return null; }
}
