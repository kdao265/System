import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateRecurringRequest, type RecurringRequest } from "./recurring-model";
import { validateRecurringReceipt, validatePauseReceipt } from "./recurring-receipt";

export async function createRecurringQuest(commandId: string, request: RecurringRequest) {
  if (!validateRecurringRequest(request)) throw new Error("Invalid recurring Quest request");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_recurring_quest", { command_id: commandId, request, origin: "web_ui" });
  if (error) throw error;
  if (!validateRecurringReceipt(data, commandId, request)) throw new Error("Invalid recurring Quest receipt");
  return data;
}

export async function setRecurrencePause(commandId: string, questId: string, paused: boolean) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_quest_recurrence_pause", { command_id: commandId, quest_id: questId, paused, origin: "web_ui" });
  if (error) throw error;
  if (!validatePauseReceipt(data, commandId, questId, paused)) throw new Error("Invalid recurrence state receipt");
}
