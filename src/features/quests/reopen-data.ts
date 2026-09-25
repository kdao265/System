import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateQuestReopenReceipt, type QuestReopenReceipt } from "./reopen-receipt";

export async function reopenQuestOccurrence(commandId: string, occurrenceId: string, executionCycle: number): Promise<QuestReopenReceipt> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("reopen_quest_occurrence_v2", { command_id: commandId, occurrence_id: occurrenceId, expected_execution_cycle: executionCycle, origin: "web_ui" });
  if (error) throw error;
  if (!validateQuestReopenReceipt(data, commandId, occurrenceId, executionCycle)) throw new Error("The Quest reopen response was invalid.");
  return data;
}