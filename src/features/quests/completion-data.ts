import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateQuestCompletionReceipt, type QuestCompletionReceipt } from "./completion-receipt";

export async function completeQuestOccurrence(commandId: string, occurrenceId: string, executionCycle: number): Promise<QuestCompletionReceipt> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("complete_quest_occurrence", {
    command_id: commandId,
    occurrence_id: occurrenceId,
    expected_execution_cycle: executionCycle,
    reported_completed_at: null,
    origin: "web_ui",
  });
  if (error) throw error;
  if (!validateQuestCompletionReceipt(data, commandId, occurrenceId, executionCycle)) throw new Error("The Quest completion response was invalid.");
  return data;
}