import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  validateQuestArchiveReceipt,
  validateQuestDeleteReceipt,
  type QuestArchiveReceipt,
  type QuestDeleteReceipt,
} from "./management-receipt";

export async function setOneOffQuestArchived(
  commandId: string,
  questId: string,
  archived: boolean,
): Promise<QuestArchiveReceipt> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_one_off_quest_archived_v1", {
    p_command_id: commandId,
    p_quest_id: questId,
    p_archived: archived,
    p_origin: "web_ui",
  });
  if (error) throw error;
  if (!validateQuestArchiveReceipt(data, commandId, questId, archived)) {
    throw new Error("The Quest archive response was invalid.");
  }
  return data;
}

export async function deleteOneOffQuest(
  commandId: string,
  questId: string,
): Promise<QuestDeleteReceipt> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("delete_one_off_quest_v1", {
    p_command_id: commandId,
    p_quest_id: questId,
    p_origin: "web_ui",
  });
  if (error) throw error;
  if (!validateQuestDeleteReceipt(data, commandId, questId)) {
    throw new Error("The Quest delete response was invalid.");
  }
  return data;
}
