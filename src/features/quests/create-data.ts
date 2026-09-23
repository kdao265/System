import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateQuestCreationRequest, type QuestCreationRequest } from "./create-model";
import { validateQuestCreationReceipt } from "./create-receipt";
export type { QuestCreationRequest } from "./create-model";
export type { QuestCreationReceipt } from "./create-receipt";

export async function createOneOffQuest(commandId: string, request: QuestCreationRequest) {
  if (!validateQuestCreationRequest(request)) throw new Error("The Quest details were invalid.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_one_off_quest", {
    command_id: commandId,
    request,
    origin: "web_ui",
  });
  if (error) throw error;
  if (!validateQuestCreationReceipt(data, commandId, request)) {
    throw new Error("The Quest creation response was invalid.");
  }
  return data;
}