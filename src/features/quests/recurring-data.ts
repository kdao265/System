import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateRecurringRequest, validateRecurringRequestV4, type RecurringRequest, type RecurringRequestV4 } from "./recurring-model";
import { validateRecurringReceipt, validateRecurringScheduleReceipt, validatePauseReceipt } from "./recurring-receipt";
import { parseScheduleDefaultsReceipt, parseSeriesDetail, type ScheduleDefaultsReceipt, type SeriesDetail } from "./series-detail-model";
import { validScheduleDefaults, type ScheduleDefaults } from "./schedule-model";

/** Carries the certified Postgres rejection so the action layer can map it to an outcome. */
export class ScheduleCommandError extends Error {
  readonly code: string | null;
  constructor(code: string | null, message: string) {
    super(message);
    this.name = "ScheduleCommandError";
    this.code = code;
  }
}

export async function createRecurringQuest(commandId: string, request: RecurringRequest) {
  if (!validateRecurringRequest(request)) throw new Error("Invalid recurring Quest request");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_recurring_quest", { command_id: commandId, request, origin: "web_ui" });
  if (error) throw error;
  if (!validateRecurringReceipt(data, commandId, request)) throw new Error("Invalid recurring Quest receipt");
  return data;
}

/** Schedule-capable recurring creation. Never sends a v3-shaped request body. */
export async function createRecurringQuestV2(commandId: string, request: RecurringRequestV4) {
  if (!validateRecurringRequestV4(request)) throw new Error("Invalid recurring Quest schedule request");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_recurring_quest_v2", { command_id: commandId, request, origin: "web_ui" });
  if (error) throw error;
  if (!validateRecurringScheduleReceipt(data, commandId, request)) throw new Error("Invalid recurring Quest receipt");
  return data as { replay: boolean };
}

export async function setRecurrencePause(commandId: string, questId: string, paused: boolean) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_quest_recurrence_pause", { command_id: commandId, quest_id: questId, paused, origin: "web_ui" });
  if (error) throw error;
  if (!validatePauseReceipt(data, commandId, questId, paused)) throw new Error("Invalid recurrence state receipt");
}

/** Quest-ID series read; null means the certified read returned nothing for this series. */
export async function getRecurringSeriesDetail(questId: string): Promise<SeriesDetail | null> {
  const supabase = await createServerSupabaseClient(true);
  const { data, error } = await supabase.rpc("get_recurring_quest_detail_v1", { p_quest_id: questId });
  if (error) throw error;
  return parseSeriesDetail(data, questId);
}

/**
 * Schedule-defaults command (set/replay/clear). Rejections arrive as
 * ScheduleCommandError with the Postgres code; a malformed receipt means the
 * outcome cannot be proven and must surface as unknown to the caller.
 */
export async function setRecurringScheduleDefaults(commandId: string, questId: string, expectedRevision: number, defaults: ScheduleDefaults): Promise<ScheduleDefaultsReceipt> {
  if (!validScheduleDefaults(defaults.local_start_time, defaults.local_end_time, defaults.planned_end_day_offset)) {
    throw new Error("Invalid schedule defaults");
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_recurring_quest_schedule_defaults_v1", {
    p_command_id: commandId,
    p_quest_id: questId,
    p_expected_rule_revision: expectedRevision,
    p_local_start_time: defaults.local_start_time,
    p_local_end_time: defaults.local_end_time,
    p_planned_end_day_offset: defaults.planned_end_day_offset,
    p_origin: "web_ui",
  });
  if (error) throw new ScheduleCommandError(error.code ?? null, error.message);
  const receipt = parseScheduleDefaultsReceipt(data, commandId, questId, expectedRevision, defaults);
  if (!receipt) throw new Error("Invalid schedule defaults receipt");
  return receipt;
}
