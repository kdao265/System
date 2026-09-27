import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateCompletionResolution, type CompletionResolution } from "./completion-resolution";

export async function getQuestCompletionResolution(commandId: string, occurrenceId: string, executionCycle: number): Promise<CompletionResolution> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_quest_completion_resolution_v1", {
    command_id: commandId, occurrence_id: occurrenceId, expected_execution_cycle: executionCycle,
  });
  if (error) throw error;
  if (!validateCompletionResolution(data, commandId, occurrenceId, executionCycle)) throw new Error("Invalid completion resolution response");
  return data;
}
