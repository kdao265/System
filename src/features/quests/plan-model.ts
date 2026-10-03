import { UUID } from "./create-pending";
import { isAbsoluteTimestamp } from "./create-model";
import { isCalendarDate } from "./dates";
import { localTimeToUtc } from "./time";

export const questStatuses = ["draft", "scheduled", "active", "completed", "failed", "cancelled"] as const;
export type QuestStatus = typeof questStatuses[number];
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const integer = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= 2147483647;
export const nullableTime = (v: unknown) => v === null || isAbsoluteTimestamp(v);
const nullableText = (v: unknown) => v === null || typeof v === "string";
const date = (v: unknown) => v === null || isCalendarDate(v);
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export function exactKeys(v: Record<string, unknown>, keys: string[]) {
  return Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
}
export function validInterval(start: unknown, end: unknown) {
  return nullableTime(start) && nullableTime(end) && (end === null ||
    (typeof start === "string" && typeof end === "string" && Date.parse(end) > Date.parse(start)));
}
export type OccurrenceDetail = {
  version: 1; occurrence_id: string; quest_id: string; title: string; description: string | null; notes: string | null;
  status: QuestStatus; scheduled_at: string | null; planned_end_at: string | null; deadline_at: string | null;
  execution_cycle: number; reward_exp_snapshot: number | null; estimated_duration_minutes_snapshot: number | null;
  source_slot_date: string | null; source_timezone: string | null; recurrence_rule_id: string | null;
  recurrence_revision: number | null; recurrence_mode: string; plannable: boolean;
  rule: null | { recurrence_type: string; weekdays: number[] | null; month_day: number | null; interval_count: number | null;
    anchor_date: string; end_date: string | null; occurrence_limit: number | null; revision: number; paused: boolean };
  goal: null | { id: string; title: string; archived: boolean };
};
export function parseOccurrenceDetail(v: unknown, occurrenceId: string): OccurrenceDetail | null {
  if (!record(v) || !exactKeys(v, ["version","occurrence_id","quest_id","title","description","notes","status","scheduled_at","planned_end_at","deadline_at","execution_cycle","reward_exp_snapshot","estimated_duration_minutes_snapshot","source_slot_date","source_timezone","recurrence_rule_id","recurrence_revision","recurrence_mode","rule","goal","plannable"]) ||
    v.version !== 1 || v.occurrence_id !== occurrenceId || !uuid(v.occurrence_id) || !uuid(v.quest_id) ||
    typeof v.title !== "string" || !v.title.trim() || ![v.description,v.notes].every(nullableText) ||
    !questStatuses.includes(v.status as QuestStatus) || !validInterval(v.scheduled_at,v.planned_end_at) || !nullableTime(v.deadline_at) ||
    !integer(v.execution_cycle,1) || !(v.reward_exp_snapshot === null || integer(v.reward_exp_snapshot)) ||
    !(v.estimated_duration_minutes_snapshot === null || integer(v.estimated_duration_minutes_snapshot,1)) ||
    !date(v.source_slot_date) || !nullableText(v.source_timezone) ||
    !["one_off","daily","weekly","monthly","custom"].includes(String(v.recurrence_mode)) ||
    typeof v.plannable !== "boolean" || v.plannable !== ["draft","scheduled","active"].includes(String(v.status))) return null;
  if (v.recurrence_rule_id === null) {
    if (v.recurrence_revision !== null || v.source_slot_date !== null || v.source_timezone !== null || v.rule !== null || v.recurrence_mode !== "one_off") return null;
  } else {
    const r=v.rule;
    if (!uuid(v.recurrence_rule_id) || !integer(v.recurrence_revision,1) || !isCalendarDate(v.source_slot_date) ||
      typeof v.source_timezone !== "string" || !v.source_timezone || v.recurrence_mode === "one_off" ||
      !record(r) || !exactKeys(r,["recurrence_type","weekdays","month_day","interval_count","anchor_date","end_date","occurrence_limit","revision","paused"]) ||
      !["daily","selected_weekdays","monthly","every_n_days","every_n_weeks"].includes(String(r.recurrence_type)) ||
      !isCalendarDate(r.anchor_date) || !date(r.end_date) || !integer(r.revision,1) || typeof r.paused !== "boolean" ||
      !(r.month_day === null || (integer(r.month_day,1) && r.month_day <= 31)) ||
      !(r.interval_count === null || integer(r.interval_count,1)) || !(r.occurrence_limit === null || integer(r.occurrence_limit,1)) ||
      !(r.weekdays === null || (Array.isArray(r.weekdays) && r.weekdays.length > 0 && r.weekdays.length <= 7 && r.weekdays.every((n,i,a)=>integer(n,1)&&n<=7&&(i===0||n>a[i-1]))))) return null;
  }
  if (v.goal !== null && (!record(v.goal) || !exactKeys(v.goal,["id","title","archived"]) || !uuid(v.goal.id) ||
      typeof v.goal.title !== "string" || typeof v.goal.archived !== "boolean" || v.recurrence_mode !== "one_off")) return null;
  return v as OccurrenceDetail;
}
export type PlanRequest = { userId: string; commandId: string; occurrenceId: string; executionCycle: number;
  expectedStart: string | null; expectedEnd: string | null; start: string | null; end: string | null };
export function validPlanRequest(v: unknown): v is PlanRequest {
  return record(v) && exactKeys(v,["userId","commandId","occurrenceId","executionCycle","expectedStart","expectedEnd","start","end"]) &&
    [v.userId,v.commandId,v.occurrenceId].every(uuid) && integer(v.executionCycle,1) &&
    validInterval(v.expectedStart,v.expectedEnd) && validInterval(v.start,v.end);
}
export function preparePlan(start: string, end: string, timezone: string) {
  const a=start ? localTimeToUtc(start,timezone) : null, b=end ? localTimeToUtc(end,timezone) : null;
  if ((a && !a.ok) || (b && !b.ok)) return null;
  const result={start:a?.value ?? null,end:b?.value ?? null};
  return validInterval(result.start,result.end) ? result : null;
}
export function planArguments(r: PlanRequest) {
  return { p_command_id:r.commandId,p_occurrence_id:r.occurrenceId,p_expected_execution_cycle:r.executionCycle,
    p_expected_scheduled_at:r.expectedStart,p_expected_planned_end_at:r.expectedEnd,
    p_scheduled_at:r.start,p_planned_end_at:r.end,p_origin:"web_ui" };
}
const sameTime=(a: unknown,b: string | null)=>b===null ? a===null : typeof a==="string" && Date.parse(a)===Date.parse(b);
export function validPlanReceipt(v: unknown,r: PlanRequest) {
  if (!record(v) || !exactKeys(v,["version","command_id","occurrence_id","quest_id","execution_cycle","event_id","before","after","changed","replay"]) ||
    v.version!==1 || v.command_id!==r.commandId || v.occurrence_id!==r.occurrenceId || v.execution_cycle!==r.executionCycle ||
    !uuid(v.quest_id) || !uuid(v.event_id) || typeof v.changed!=="boolean" || typeof v.replay!=="boolean" || !record(v.before) || !record(v.after)) return false;
  const changed = !sameTime(v.before.scheduled_at,r.start) || !sameTime(v.before.planned_end_at,r.end) || v.before.status!==v.after.status;
  const validStatus = v.after.status===v.before.status || (v.before.status==="scheduled" && v.after.status==="draft" && r.start===null);
  return v.changed===changed && validStatus && [v.before,v.after].every(p=>exactKeys(p,["scheduled_at","planned_end_at","status"])&&questStatuses.includes(p.status as QuestStatus)) &&
    sameTime(v.before.scheduled_at,r.expectedStart) && sameTime(v.before.planned_end_at,r.expectedEnd) &&
    sameTime(v.after.scheduled_at,r.start) && sameTime(v.after.planned_end_at,r.end);
}
export type PlanResult = { outcome: "success" | "rejected" | "unknown"; reason?: "account" | "invalid" | "stale" | "retired" | "deadline" | "conflict" };

/** Requests are scoped to a selection generation, including refreshes of the same ID. */
export class OccurrenceReadGeneration {
  private generation = 0;
  begin() { return ++this.generation; }
  accepts(token: number) { return token === this.generation; }
  cancel() { this.generation++; }
}
