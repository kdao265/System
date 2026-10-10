// SYSTEM AO V1 — pure domain vocabulary; authority: approved Requirements and ADR-024.
// No transport, database, Next.js, session state, or generated timestamps.
export const OPPORTUNITY_STAGES = ["saved", "preparing", "submitted", "closed"] as const;
export const SELECTION_OUTCOMES = ["unknown", "pending", "shortlisted", "waitlisted", "accepted", "rejected"] as const;
export const ENTRY_MODES = ["unknown", "application", "registration", "invitation", "direct_access", "other"] as const;
export const SELECTION_APPLICABILITY = ["unknown", "applicable", "not_applicable"] as const;
export const CLOSED_REASONS = ["not_interested", "withdrawn", "declined_offer", "deadline_missed", "program_cancelled", "process_finished", "other"] as const;
export const ACTIVITY_STATUSES = ["upcoming", "ongoing", "paused", "completed", "ended_early", "cancelled_before_start"] as const;
export const ACTIVITY_INTENTS = ["confirmed_plan", "confirmed_started", "historical_completed", "historical_ended_early"] as const;
export const ACTIVITY_ACTIONS = ["start", "pause", "resume", "complete", "end_early", "cancel_before_start"] as const;
export const OPPORTUNITY_CATEGORIES = ["scholarship", "internship", "fellowship", "competition", "research", "training", "program", "event", "other"] as const;
export const ACTIVITY_CATEGORIES = ["research", "project", "club", "volunteer", "training", "competition", "internship", "event", "other"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const SUBJECT_KINDS = ["opportunity", "activity"] as const;
export const CONTEXT_TARGETS = ["goal", "quest"] as const;
export const AO_MUTATIONS = [
  "create_opportunity_v1", "update_opportunity_v1", "set_opportunity_stage_v1", "record_opportunity_outcome_v1", "set_opportunity_archived_v1",
  "create_activity_v1", "update_activity_v1", "transition_activity_v1", "correct_activity_status_v1", "set_activity_archived_v1",
  "set_activity_source_v1", "attach_ao_context_v1", "detach_ao_context_v1",
] as const;
export const AO_READS = ["get_opportunity_v1", "list_opportunities_v1", "get_activity_v1", "list_activities_v1", "list_ao_history_v1", "search_ao_link_candidates_v1", "resolve_ao_command_v1"] as const;

export type OpportunityStage = typeof OPPORTUNITY_STAGES[number];
export type SelectionOutcome = typeof SELECTION_OUTCOMES[number];
export type EntryMode = typeof ENTRY_MODES[number];
export type SelectionApplicability = typeof SELECTION_APPLICABILITY[number];
export type ClosedReason = typeof CLOSED_REASONS[number];
export type ActivityStatus = typeof ACTIVITY_STATUSES[number];
export type ActivityIntent = typeof ACTIVITY_INTENTS[number];
export type ActivityAction = typeof ACTIVITY_ACTIONS[number];
export type OpportunityCategory = typeof OPPORTUNITY_CATEGORIES[number];
export type ActivityCategory = typeof ACTIVITY_CATEGORIES[number];
export type Priority = typeof PRIORITIES[number];
export type SubjectKind = typeof SUBJECT_KINDS[number];
export type ContextTargetKind = typeof CONTEXT_TARGETS[number];
export type AoMutationName = typeof AO_MUTATIONS[number];
export type AoReadName = typeof AO_READS[number];
export type PartialDate =
  | { precision: "unknown" }
  | { precision: "year"; year: number }
  | { precision: "month"; year: number; month: number }
  | { precision: "day"; year: number; month: number; day: number };
export type DeadlineSpec = PartialDate
  | { precision: "day"; year: number; month: number; day: number; source_time: string; source_time_state: "unresolved" }
  | { precision: "instant"; source_date: string; source_time: string; source_offset_minutes: number; source_zone?: string };
export type ResourceLink = { id: string; label: string; url: string };

export type OpportunityFields = {
  title: string; category: OpportunityCategory | null; organization: string | null;
  description: string | null; eligibility_notes: string | null; benefits_notes: string | null;
  tracking_stage: OpportunityStage; selection_outcome: SelectionOutcome; entry_mode: EntryMode;
  selection_applicability: SelectionApplicability; closed_reason: ClosedReason | null; closed_note: string | null;
  application_deadline: DeadlineSpec | null; program_start: PartialDate | null;
  program_end: PartialDate | null; applied_at: PartialDate | null; decision_at: PartialDate | null;
  priority: Priority | null; notes: string | null; resource_links: ResourceLink[];
};
export type ActivityFields = {
  title: string; category: ActivityCategory | null; organization: string | null;
  role: string | null; description: string | null; status: ActivityStatus;
  planned_start: PartialDate | null; planned_end: PartialDate | null;
  actual_start: PartialDate | null; actual_end: PartialDate | null;
  confirmation_note: string | null; contributions: string | null; outcomes: string | null;
  lessons: string | null; notes: string | null; resource_links: ResourceLink[];
};

export const OPPORTUNITY_LIMITS = {
  title: 240, organization: 240, description: 4000, eligibility_notes: 10000,
  benefits_notes: 10000, closed_note: 2000, notes: 10000,
} as const;
export const ACTIVITY_LIMITS = {
  title: 240, organization: 240, role: 160, description: 4000,
  confirmation_note: 2000, contributions: 10000, outcomes: 10000,
  lessons: 10000, notes: 10000,
} as const;
export const MAX_RESOURCE_LINKS = 30;
export const RESOURCE_LABEL_LIMIT = 120;
export const RESOURCE_URL_LIMIT = 2048;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_REVISION = BigInt("9223372036854775807");

export type ValidationCode = "shape" | "required" | "text" | "limit" | "enum" | "date" | "time" | "timezone" | "range" | "url" | "duplicate" | "invariant" | "transition";
export type Validation<T> = { ok: true; value: T } | { ok: false; field: string; code: ValidationCode };
export const valid = <T>(value: T): Validation<T> => ({ ok: true, value });
export const invalid = (field: string, code: ValidationCode): Validation<never> => ({ ok: false, field, code });
export const isEnum = <T extends string>(choices: readonly T[], value: unknown): value is T =>
  typeof value === "string" && choices.some(x => x === value);
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export const isRevision = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= MAX_REVISION;
export const isRootCreationRevision = (v: unknown): v is "0" => v === "0";
export const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const allowedKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).every(k => keys.includes(k));

export function statusFromIntent(intent: ActivityIntent): ActivityStatus {
  switch (intent) {
    case "confirmed_plan": return "upcoming";
    case "confirmed_started": return "ongoing";
    case "historical_completed": return "completed";
    case "historical_ended_early": return "ended_early";
  }
}
const allowedActivityActions: Record<ActivityStatus, Partial<Record<ActivityAction, ActivityStatus>>> = {
  upcoming: { start: "ongoing", cancel_before_start: "cancelled_before_start" },
  ongoing: { pause: "paused", complete: "completed", end_early: "ended_early" },
  paused: { resume: "ongoing", complete: "completed", end_early: "ended_early" },
  completed: {}, ended_early: {}, cancelled_before_start: {},
};
export function activityTransition(status: ActivityStatus, action: ActivityAction): Validation<ActivityStatus> {
  const target = allowedActivityActions[status]?.[action];
  return target ? valid(target) : invalid("status", "transition");
}
export function opportunityStageTransition(current: OpportunityStage, next: OpportunityStage, kind: "advance" | "reopen" | "correction"): Validation<OpportunityStage> {
  if (kind === "correction") return valid(next); // caller must audit correction independently
  if (kind === "reopen") return current === "closed" && next !== "closed" ? valid(next) : invalid("tracking_stage", "transition");
  const order = ["saved", "preparing", "submitted", "closed"] as const;
  return current !== "closed" && order.indexOf(next) > order.indexOf(current)
    ? valid(next) : invalid("tracking_stage", "transition");
}

// --- Strict field/date/URL validation ---
// Pure AO input validation. L1-02 must implement independently verified SQL parity.

// Aligned to the existing Library V1 whitespace boundary, with CRLF conversion on long text.
const whitespace = "\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const edges = new RegExp(`^[${whitespace}]+|[${whitespace}]+$`, "gu");
const urlForbidden = new RegExp(`[${whitespace}\\u0000-\\u001f\\u007f-\\u009f\\\\]`, "u");
export const trimBoundaryWhitespace = (value: string) => value.replace(edges, "");
export const unicodeCodePoints = (value: string) => [...value].length;
export function isPostgresText(value: unknown): value is string {
  if (typeof value !== "string" || value.includes("\0")) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length || value.charCodeAt(i + 1) < 0xdc00 || value.charCodeAt(i + 1) > 0xdfff) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export function normalizeText(raw: unknown, field: string, limit: number, required = false, multiline = false): Validation<string | null> {
  if (raw === null) return required ? invalid(field, "required") : valid(null);
  if (!isPostgresText(raw)) return invalid(field, "text");
  const value = multiline ? raw.replace(/\r\n?/g, "\n") : trimBoundaryWhitespace(raw);
  if (trimBoundaryWhitespace(value) === "") return required ? invalid(field, "required") : valid(null);
  if (unicodeCodePoints(value) > limit) return invalid(field, "limit");
  return valid(value);
}

function leapYear(year: number) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function daysInMonth(year: number, month: number): number {
  return [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}
// Conservative, documented candidate boundary. SQL/TS-supported Gregorian range must be frozen at L1-02.
export const MIN_CIVIL_YEAR = 1;
export const MAX_CIVIL_YEAR = 9999;
function civilYear(y: unknown): y is number { return typeof y === "number" && Number.isInteger(y) && y >= MIN_CIVIL_YEAR && y <= MAX_CIVIL_YEAR; }
function civilMonth(m: unknown): m is number { return typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 12; }
function civilDay(y: number, m: number, d: unknown): d is number { return typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= daysInMonth(y,m); }
export function parsePartialDate(raw: unknown, field = "date"): Validation<PartialDate> {
  if (!isRecord(raw)) return invalid(field, "shape");
  const precision = raw.precision;
  if (precision === "unknown" && exactKeys(raw, ["precision"])) return valid({precision});
  if (precision === "year" && exactKeys(raw,["precision","year"]) && civilYear(raw.year)) return valid({precision,year:raw.year});
  if (precision === "month" && exactKeys(raw,["precision","year","month"]) && civilYear(raw.year) && civilMonth(raw.month)) return valid({precision,year:raw.year,month:raw.month});
  if (precision === "day" && exactKeys(raw,["precision","year","month","day"]) && civilYear(raw.year) && civilMonth(raw.month) && civilDay(raw.year,raw.month,raw.day)) return valid({precision,year:raw.year,month:raw.month,day:raw.day});
  return invalid(field,"date");
}
export function possibleCivilRange(v: PartialDate): [number,number] | null {
  if (v.precision === "unknown") return null;
  const min = v.year * 10000 + (v.precision === "year" ? 1 : v.month)*100 + (v.precision === "day" ? v.day : 1);
  const endMonth = v.precision === "year" ? 12 : v.month;
  const max = v.year * 10000 + endMonth*100 + (v.precision === "day" ? v.day : daysInMonth(v.year,endMonth));
  return [min,max];
}
export function isCertainReverse(start: PartialDate | null, end: PartialDate | null): boolean {
  const a = start && possibleCivilRange(start), b = end && possibleCivilRange(end);
  return !!(a && b && a[0] > b[1]);
}
const dateString = /^(\d{4})-(\d{2})-(\d{2})$/;
const timeString = /^([01]\d|2[0-3]):([0-5]\d)$/;
function isoDay(s: unknown): {year:number;month:number;day:number}|null {
  if (typeof s !== "string") return null;
  const match = dateString.exec(s);
  if (!match) return null;
  const [year,month,day] = match.slice(1).map(Number);
  return civilYear(year) && civilMonth(month) && civilDay(year,month,day) ? {year,month,day} : null;
}
// New UTC Date epoch bypasses Date.UTC's special 0..99-year interpretation.
function utcMillis(d: {year:number;month:number;day:number}, hour: number, minute: number) {
  const date = new Date(0);
  date.setUTCFullYear(d.year, d.month - 1, d.day);
  date.setUTCHours(hour,minute,0,0);
  return date.getTime();
}
function ianaWall(utc: number, zone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone:zone,calendar:"gregory",numberingSystem:"latn",hourCycle:"h23",
      year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
    }).formatToParts(new Date(utc));
    const v = Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${v.year.padStart(4,"0")}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
  } catch { return null; }
}
export type ValidatedDeadline = { spec: DeadlineSpec; utcMilliseconds: number | null };
export function parseDeadline(raw: unknown, field = "application_deadline"): Validation<ValidatedDeadline> {
  if (!isRecord(raw)) return invalid(field,"shape");
  if (raw.precision !== "instant") {
    if (raw.precision === "day" && Object.hasOwn(raw,"source_time")) {
      if (!exactKeys(raw,["precision","year","month","day","source_time","source_time_state"])) return invalid(field,"shape");
      const day = parsePartialDate({precision:"day",year:raw.year,month:raw.month,day:raw.day},field);
      if (!day.ok || raw.source_time_state !== "unresolved" || typeof raw.source_time !== "string" || !timeString.test(raw.source_time)) return invalid(field,"time");
      return valid({spec:{...day.value,source_time:raw.source_time,source_time_state:"unresolved"} as DeadlineSpec,utcMilliseconds:null});
    }
    const d = parsePartialDate(raw,field);
    return d.ok ? valid({spec:d.value,utcMilliseconds:null}) : d;
  }
  if (!exactKeys(raw,["precision","source_date","source_time","source_offset_minutes"]) &&
      !exactKeys(raw,["precision","source_date","source_time","source_offset_minutes","source_zone"])) return invalid(field,"shape");
  const day = isoDay(raw.source_date), time = typeof raw.source_time === "string" ? timeString.exec(raw.source_time) : null;
  const offset = raw.source_offset_minutes;
  // Validated offset is an explicit integer. The limit is a parity proposal, not a SQL-authorized fact.
  if (!day || !time) return invalid(field,"time");
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < -840 || offset > 840) return invalid(field,"timezone");
  if (Object.hasOwn(raw,"source_zone") && (typeof raw.source_zone !== "string" || !/^[A-Za-z0-9_+./-]{1,120}$/.test(raw.source_zone))) return invalid(field,"timezone");
  const epoch = utcMillis(day,Number(time[1]),Number(time[2])) - offset*60000;
  if (!Number.isFinite(epoch)) return invalid(field,"date");
  // R-08: PostgreSQL rejects an offset-derived UTC instant outside civil years
  // 0001..9999 even when the source calendar day itself lies inside that range.
  // Date.getUTCFullYear() avoids Date.UTC's special treatment of years 00..99.
  const utcYear = new Date(epoch).getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) return invalid(field,"date");
  if (typeof raw.source_zone === "string") {
    const expected = `${raw.source_date}T${raw.source_time}`;
    if (ianaWall(epoch,raw.source_zone) !== expected) return invalid(field,"timezone"); // gap or wrong offset; fold needs explicit offset
  }
  const spec = typeof raw.source_zone === "string"
    ? {precision:"instant",source_date:raw.source_date,source_time:raw.source_time,source_zone:raw.source_zone,source_offset_minutes:offset}
    : {precision:"instant",source_date:raw.source_date,source_time:raw.source_time,source_offset_minutes:offset};
  return valid({spec:spec as DeadlineSpec,utcMilliseconds:epoch});
}

// Same deliberately safe HTTPS syntactic subset as Library V1. Does not fetch or rewrite input.
export function isResourceUrl(value: unknown): value is string {
  if (!isPostgresText(value) || unicodeCodePoints(value)>RESOURCE_URL_LIMIT || urlForbidden.test(value)) return false;
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value)?.[1];
  if (!authority || authority.includes("@")) return false;
  const parts = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(authority);
  if (!parts || parts[2] && Number(parts[2]) > 65535) return false;
  const host = parts[1];
  if (!host.startsWith("[")) {
    const dns=host.replace(/\.$/,"");
    if (dns.length>253 || !dns.split(".").every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(x))) return false;
    const last=dns.split(".").at(-1)!;
    if (/^[0-9]+$/.test(last) || /^0x[0-9a-f]+$/i.test(last)) {
      const octets=dns.split(".");
      if (host!==dns || octets.length!==4 || !octets.every(x=>/^(0|[1-9][0-9]{0,2})$/.test(x) && Number(x)<=255)) return false;
    }
  }
  try { const url=new URL(value); return url.protocol==="https:" && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
export function parseResourceLinks(raw: unknown, field="resource_links"): Validation<ResourceLink[]> {
  if (!Array.isArray(raw) || raw.length>MAX_RESOURCE_LINKS) return invalid(field,"shape");
  const output: ResourceLink[]=[];const ids=new Set<string>();
  for (let index=0;index<raw.length;index++) {
    const item=raw[index],name=`${field}[${index}]`;
    if (!isRecord(item) || !exactKeys(item,["id","label","url"]) || !isUuid(item.id)) return invalid(name,"shape");
    const label=normalizeText(item.label,`${name}.label`,RESOURCE_LABEL_LIMIT,true);
    if (!label.ok) return label;
    if (!isResourceUrl(item.url)) return invalid(`${name}.url`,"url");
    const id=item.id.toLowerCase();if(ids.has(id)) return invalid(`${name}.id`,"duplicate");
    ids.add(id);output.push({id,label:label.value!,url:item.url});
  }
  return valid(output);
}

const opportunityFields=["title","category","organization","description","eligibility_notes","benefits_notes","tracking_stage","selection_outcome","entry_mode","selection_applicability","closed_reason","closed_note","application_deadline","program_start","program_end","applied_at","decision_at","priority","notes","resource_links"] as const;
const opportunityUpdate=["title","category","organization","description","eligibility_notes","benefits_notes","entry_mode","application_deadline","program_start","program_end","applied_at","priority","notes","resource_links"] as const;
const activityFields=["title","category","organization","role","description","planned_start","planned_end","actual_start","actual_end","confirmation_note","contributions","outcomes","lessons","notes","resource_links"] as const;
const activityUpdate=activityFields;
const longOpportunity = ["description","eligibility_notes","benefits_notes","closed_note","notes"] as const;
const longActivity = ["description","confirmation_note","contributions","outcomes","lessons","notes"] as const;
const opportunityDefaults:OpportunityFields = {
  title:"",category:null,organization:null,description:null,eligibility_notes:null,benefits_notes:null,
  tracking_stage:"saved",selection_outcome:"unknown",entry_mode:"unknown",selection_applicability:"unknown",
  closed_reason:null,closed_note:null,application_deadline:null,program_start:null,program_end:null,
  applied_at:null,decision_at:null,priority:null,notes:null,resource_links:[],
};
const activityDefaults:ActivityFields={title:"",category:null,organization:null,role:null,description:null,status:"upcoming",
  planned_start:null,planned_end:null,actual_start:null,actual_end:null,confirmation_note:null,
  contributions:null,outcomes:null,lessons:null,notes:null,resource_links:[]};
export function validateOpportunityState(value: Pick<OpportunityFields,"tracking_stage"|"selection_outcome"|"selection_applicability"|"closed_reason"|"closed_note">): Validation<true> {
  if(value.selection_applicability==="not_applicable" && value.selection_outcome!=="unknown") return invalid("selection_outcome","invariant");
  if(value.tracking_stage!=="closed" && (value.closed_reason!==null || value.closed_note!==null)) return invalid("closed_reason","invariant");
  if(value.closed_reason==="other" && (value.closed_note===null || trimBoundaryWhitespace(value.closed_note)==="")) return invalid("closed_note","required");
  return valid(true);
}
export type OpportunityWarning = "saved_accepted"|"submitted_without_applied_at"|"invitation_submitted"|"direct_access_submitted"|"declined_without_outcome"|"deadline_past_preparing";
// The optional reference instant is explicit: no machine clock or profile timezone
// is silently used. Warning only for verified exact deadlines, never a hard error.
export function opportunityWarnings(v: Pick<OpportunityFields,"tracking_stage"|"selection_outcome"|"entry_mode"|"closed_reason"|"applied_at">,
  timing?:{ applicationDeadline:DeadlineSpec|null; nowUtcMilliseconds:number }):OpportunityWarning[] {
  const out:OpportunityWarning[]=[];
  if(v.tracking_stage==="saved" && v.selection_outcome==="accepted")out.push("saved_accepted");
  if(v.tracking_stage==="submitted" && (v.applied_at===null || v.applied_at.precision==="unknown"))out.push("submitted_without_applied_at");
  if(v.tracking_stage==="submitted" && v.entry_mode==="invitation")out.push("invitation_submitted");
  if(v.tracking_stage==="submitted" && v.entry_mode==="direct_access")out.push("direct_access_submitted");
  if(v.tracking_stage==="closed" && v.closed_reason==="declined_offer" && v.selection_outcome==="unknown")out.push("declined_without_outcome");
  if(v.tracking_stage==="preparing" && timing && Number.isFinite(timing.nowUtcMilliseconds) && timing.applicationDeadline!==null) {
    const deadline=parseDeadline(timing.applicationDeadline);
    if(deadline.ok && deadline.value.utcMilliseconds!==null && deadline.value.utcMilliseconds<timing.nowUtcMilliseconds)out.push("deadline_past_preparing");
  }
  return out;
}
export function validateActivityDates(v:Pick<ActivityFields,"status"|"planned_start"|"planned_end"|"actual_start"|"actual_end">):Validation<true> {
  if(isCertainReverse(v.planned_start,v.planned_end))return invalid("planned_end","range");
  if(isCertainReverse(v.actual_start,v.actual_end))return invalid("actual_end","range");
  const known=(d:PartialDate|null)=>d!==null && d.precision!=="unknown";
  if((v.status==="upcoming" || v.status==="cancelled_before_start") && (known(v.actual_start)||known(v.actual_end)))return invalid("actual_start","invariant");
  return valid(true);
}
function normalizeField(field:string,raw:unknown,activity:boolean):Validation<unknown> {
  const limits=activity?ACTIVITY_LIMITS:OPPORTUNITY_LIMITS;
  if (Object.hasOwn(limits,field)) {
    const isLong=(activity?longActivity:longOpportunity).some(x=>x===field);
    return normalizeText(raw,field,(limits as unknown as Record<string,number>)[field],field==="title",isLong);
  }
  const enums:Record<string,readonly string[]>={category:activity?ACTIVITY_CATEGORIES:OPPORTUNITY_CATEGORIES,
    priority:PRIORITIES,tracking_stage:OPPORTUNITY_STAGES,selection_outcome:SELECTION_OUTCOMES,
    entry_mode:ENTRY_MODES,selection_applicability:SELECTION_APPLICABILITY,closed_reason:CLOSED_REASONS};
  if(Object.hasOwn(enums,field))return raw===null && (field==="category"||field==="priority"||field==="closed_reason")?valid(null):isEnum(enums[field],raw)?valid(raw):invalid(field,"enum");
  if(field==="resource_links")return parseResourceLinks(raw);
  if(field==="application_deadline") {
    if(raw===null)return valid(null);
    const d=parseDeadline(raw,field);return d.ok?valid(d.value.spec):d;
  }
  if(["program_start","program_end","applied_at","decision_at","planned_start","planned_end","actual_start","actual_end"].includes(field)) {
    if(raw===null)return valid(null);
    return parsePartialDate(raw,field);
  }
  return invalid(field,"shape");
}
export function normalizeOpportunity(input:unknown,mode:"create"):Validation<OpportunityFields>;
export function normalizeOpportunity(input:unknown,mode:"update"):Validation<Partial<OpportunityFields>>;
export function normalizeOpportunity(input:unknown,mode:"create"|"update"):Validation<Partial<OpportunityFields>> {
  const allowed=mode==="create"?opportunityFields:opportunityUpdate;
  if(!isRecord(input)||!allowedKeys(input,allowed)||mode==="update"&&Object.keys(input).length===0)return invalid("request","shape");
  const result:Record<string,unknown> = mode==="create"?{...opportunityDefaults}:{},defaults=opportunityDefaults as unknown as Record<string,unknown>;
  for(const key of allowed){
    if(mode==="update"&&!Object.hasOwn(input,key))continue;
    const v=normalizeField(key,Object.hasOwn(input,key)?input[key]:defaults[key],false);
    if(!v.ok)return v;
    result[key]=v.value;
  }
  if(mode==="create") {
    const state=validateOpportunityState(result as OpportunityFields);
    if(!state.ok)return state;
    if(isCertainReverse(result.program_start as PartialDate|null,result.program_end as PartialDate|null))return invalid("program_end","range");
  }
  return valid(result as Partial<OpportunityFields>);
}
export type ActivityCreation = { intent:ActivityIntent; fields:ActivityFields };
export function normalizeActivityCreate(input:unknown):Validation<ActivityCreation> {
  if(!isRecord(input)||!allowedKeys(input,["intent",...activityFields])||!isEnum(ACTIVITY_INTENTS,input.intent))return invalid("intent","shape");
  const result:Record<string,unknown>={...activityDefaults,status:statusFromIntent(input.intent)};
  for(const key of activityFields){const v=normalizeField(key,Object.hasOwn(input,key)?input[key]:(activityDefaults as unknown as Record<string,unknown>)[key],true);if(!v.ok)return v;result[key]=v.value;}
  const guard=validateActivityDates(result as ActivityFields);if(!guard.ok)return guard;
  return valid({intent:input.intent,fields:result as ActivityFields});
}
export function normalizeActivityUpdate(input:unknown):Validation<Partial<ActivityFields>> {
  if(!isRecord(input)||!allowedKeys(input,activityUpdate)||Object.keys(input).length===0)return invalid("request","shape");
  const out:Record<string,unknown>={};
  for(const key of activityUpdate){if(!Object.hasOwn(input,key))continue;const r=normalizeField(key,input[key],true);if(!r.ok)return r;out[key]=r.value;}
  return valid(out);
}

// --- Typed command/receipt/DTO boundaries ---
// Pure AO command/DTO boundary. Exact SQL parameter and receipt field names remain L1-04 review gates.

export type AoCommandIdentity = {
  command_id: string; subject_kind: SubjectKind; subject_id: string;
  operation: AoMutationName; expected_revision: string | null;
};
export type AoCanonicalIntent = AoCommandIdentity & { request: unknown };
export type AoReceipt = {
  version: 1; command_id: string; subject_kind: SubjectKind; subject_id: string;
  operation: AoMutationName; revision_before: string; revision_after: string;
  changed: boolean; replay: boolean;
};
export type AoRootDto = {
  version: 1; subject_kind: SubjectKind; id: string; revision: string;
  archived_at: string | null; created_at: string; updated_at: string;
};
export type AoPage<T> = { version: 1; items: T[]; next_cursor: {created_at:string;id:string}|null };
const ownerOperations:Record<SubjectKind,readonly AoMutationName[]>={
  opportunity:["create_opportunity_v1","update_opportunity_v1","set_opportunity_stage_v1","record_opportunity_outcome_v1","set_opportunity_archived_v1","attach_ao_context_v1","detach_ao_context_v1"],
  activity:["create_activity_v1","update_activity_v1","transition_activity_v1","correct_activity_status_v1","set_activity_archived_v1","set_activity_source_v1","attach_ao_context_v1","detach_ao_context_v1"],
};
export function isCommandIdentity(raw:unknown):raw is AoCommandIdentity {
  if(!isRecord(raw)||!exactKeys(raw,["command_id","subject_kind","subject_id","operation","expected_revision"])||
    !isUuid(raw.command_id)||!isUuid(raw.subject_id)||!isEnum(SUBJECT_KINDS,raw.subject_kind)||!isEnum(AO_MUTATIONS,raw.operation))return false;
  if(!ownerOperations[raw.subject_kind].includes(raw.operation))return false;
  const create=raw.operation.startsWith("create_");
  return create ? raw.expected_revision===null : isRevision(raw.expected_revision);
}

// Stable structural JSON, not a persistence/receipt replayer and not a substitute
// for operation-specific, server-authenticated SQL request canonicalization.
function canonical(raw:unknown,depth:number):unknown {
  if(depth>12)throw Error("AO request nesting too deep");
  if(raw===null||typeof raw==="boolean"||typeof raw==="string")return raw;
  if(typeof raw==="number"&&Number.isFinite(raw)&&Number.isSafeInteger(raw))return raw;
  if(Array.isArray(raw))return raw.map(x=>canonical(x,depth+1));
  if(!isRecord(raw)||Object.getPrototypeOf(raw)!==Object.prototype&&Object.getPrototypeOf(raw)!==null)throw Error("AO request is not plain JSON");
  const out:Record<string,unknown>={};
  for(const key of Object.keys(raw).sort()) {
    if(["__proto__","prototype","constructor"].includes(key))throw Error("Disallowed AO request key");
    out[key]=canonical(raw[key],depth+1);
  }
  return out;
}
export function canonicalAoIntent(value:unknown):string|null {
  if(!isRecord(value)||!exactKeys(value,["command_id","subject_kind","subject_id","operation","expected_revision","request"]))return null;
  const {request,...identity}=value;
  if(!isCommandIdentity(identity))return null;
  try { return JSON.stringify(canonical(value,0)); } catch { return null; }
}
export function parseAoReceipt(raw:unknown,expected:AoCommandIdentity):AoReceipt|null {
  if(!isCommandIdentity(expected)||!isRecord(raw)||!exactKeys(raw,["version","command_id","subject_kind","subject_id","operation","revision_before","revision_after","changed","replay"])||raw.version!==1)return null;
  if(!isUuid(raw.command_id)||!isUuid(raw.subject_id)||raw.command_id.toLowerCase()!==expected.command_id.toLowerCase()||raw.subject_kind!==expected.subject_kind||
    raw.subject_id.toLowerCase()!==expected.subject_id.toLowerCase()||raw.operation!==expected.operation||
    typeof raw.changed!=="boolean"||typeof raw.replay!=="boolean"||!isRevision(raw.revision_after)||
    !(raw.revision_before==="0"||isRevision(raw.revision_before)))return null;
  const before=BigInt(raw.revision_before),after=BigInt(raw.revision_after);
  const create=expected.operation.startsWith("create_");
  if(after-before!==BigInt(raw.changed?1:0)||create && (before!==BigInt(0)||after!==BigInt(1)||!raw.changed))return null;
  if(!create && before===BigInt(0))return null;
  // For replay, the original expected_revision may predate newer state: never use
  // this historical receipt to claim the root is still at revision_after.
  if(!raw.replay&&!create&&raw.revision_before!==expected.expected_revision)return null;
  return raw as AoReceipt;
}
// Preserve PostgreSQL microsecond precision in keyset ordering. JS Date.parse alone
// drops the last three fractional digits and may silently normalize invalid dates.
const isoInstant = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|([+-])(\d\d):(\d\d))$/;
function instantMicros(input:unknown):bigint|null {
  if(typeof input!=="string")return null;
  const m=isoInstant.exec(input);if(!m)return null;
  const [y,mo,d,h,mi,se]=m.slice(1,7).map(Number);
  const leap=y%4===0&&(y%100!==0||y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(y<1||mo<1||mo>12||d<1||d>days[mo-1]||h>23||mi>59||se>59)return null;
  const offsetH=m[10]===undefined?0:Number(m[10]),offsetM=m[11]===undefined?0:Number(m[11]);
  if(offsetH>14||offsetM>59||offsetH===14&&offsetM!==0)return null;
  const sign=m[9]==="-"?-1:1;
  const date=new Date(0);date.setUTCFullYear(y,mo-1,d);date.setUTCHours(h,mi,se,0);
  const utc=date.getTime()-sign*(offsetH*60+offsetM)*60000;
  if(!Number.isFinite(utc))return null;
  return BigInt(utc)*BigInt(1000)+BigInt((m[7]??"").padEnd(6,"0"));
}
export function parseAoRootDto(raw:unknown):AoRootDto|null {
  if(!isRecord(raw)||!exactKeys(raw,["version","subject_kind","id","revision","archived_at","created_at","updated_at"])||raw.version!==1||
    !isEnum(SUBJECT_KINDS,raw.subject_kind)||!isUuid(raw.id)||!isRevision(raw.revision))return null;
  const created=instantMicros(raw.created_at),updated=instantMicros(raw.updated_at),archived=raw.archived_at===null?null:instantMicros(raw.archived_at);
  if(created===null||updated===null||updated<created||raw.archived_at!==null&&(archived===null||archived<created||archived>updated))return null;
  return raw as AoRootDto;
}
export function parseAoIdentityPage(raw:unknown):AoPage<AoRootDto>|null {
  if(!isRecord(raw)||!exactKeys(raw,["version","items","next_cursor"])||raw.version!==1||
    !Array.isArray(raw.items)||raw.items.length>MAX_PAGE_SIZE)return null;
  const next=raw.next_cursor;
  if(next!==null&&(!isRecord(next)||!exactKeys(next,["created_at","id"])||instantMicros(next.created_at)===null||!isUuid(next.id)))return null;
  const items:AoRootDto[]=[],seen=new Set<string>();let previous:AoRootDto|null=null;
  for(const item of raw.items){
    const dto=parseAoRootDto(item);
    if(!dto||seen.has(dto.id.toLowerCase())||previous&&(instantMicros(previous.created_at)!<instantMicros(dto.created_at)!||
      instantMicros(previous.created_at)===instantMicros(dto.created_at)&&previous.id.toLowerCase()<=dto.id.toLowerCase()))return null;
    items.push(dto);seen.add(dto.id.toLowerCase());previous=dto;
  }
  if(next!==null&&(!previous||!isRecord(next)||!isUuid(next.id)||next.id.toLowerCase()!==previous.id.toLowerCase()||instantMicros(next.created_at)!==instantMicros(previous.created_at)))return null;
  return {version:1,items,next_cursor:next as {created_at:string;id:string}|null};
}

// F-01: typed, allowlisted list-card DTOs. Keep parseAoRootDto/parseAoIdentityPage
// strict for legacy identity projections; list cards have their own exact contract.
export type AoOpportunityListItem = AoRootDto & {
  subject_kind: "opportunity"; title: string; category: OpportunityCategory | null;
  organization: string | null; tracking_stage: OpportunityStage;
  selection_outcome: SelectionOutcome;
};
export type AoActivityListItem = AoRootDto & {
  subject_kind: "activity"; title: string; category: ActivityCategory | null;
  organization: string | null; status: ActivityStatus;
};
export type AoListItem = AoOpportunityListItem | AoActivityListItem;
const rootDtoKeys = ["version","subject_kind","id","revision","archived_at","created_at","updated_at"] as const;
export function parseAoListItem(value: unknown): AoListItem | null {
  if (!isRecord(value) || !isEnum(SUBJECT_KINDS,value.subject_kind)) return null;
  const kind = value.subject_kind;
  const extras = kind === "opportunity"
    ? ["title","category","organization","tracking_stage","selection_outcome"]
    : ["title","category","organization","status"];
  if (!exactKeys(value,[...rootDtoKeys,...extras])) return null;
  const base:Record<string,unknown>={};
  for (const key of rootDtoKeys) base[key]=value[key];
  if (parseAoRootDto(base)===null) return null;
  if (!isPostgresText(value.title) || value.title!==trimBoundaryWhitespace(value.title) ||
      unicodeCodePoints(value.title)>240 || value.title.length===0 ||
      (value.organization!==null && (!isPostgresText(value.organization) ||
        value.organization!==trimBoundaryWhitespace(value.organization) ||
        unicodeCodePoints(value.organization)>240 || value.organization.length===0))) return null;
  if (kind==="opportunity") {
    if ((value.category!==null && !isEnum(OPPORTUNITY_CATEGORIES,value.category)) ||
        !isEnum(OPPORTUNITY_STAGES,value.tracking_stage) ||
        !isEnum(SELECTION_OUTCOMES,value.selection_outcome)) return null;
  } else if ((value.category!==null && !isEnum(ACTIVITY_CATEGORIES,value.category)) ||
             !isEnum(ACTIVITY_STATUSES,value.status)) return null;
  return value as AoListItem;
}
export function parseAoListPage(value:unknown):AoPage<AoListItem>|null {
  if (!isRecord(value) || !exactKeys(value,["version","items","next_cursor"]) ||
      value.version!==1 || !Array.isArray(value.items) || value.items.length>MAX_PAGE_SIZE) return null;
  const next=value.next_cursor;
  if (next!==null && (!isRecord(next)||!exactKeys(next,["created_at","id"])||
      instantMicros(next.created_at)===null||!isUuid(next.id))) return null;
  const items:AoListItem[]=[],seen=new Set<string>();let previous:AoListItem|null=null;
  for (const raw of value.items) {
    const item=parseAoListItem(raw);
    if (item===null || seen.has(item.id.toLowerCase()) || previous &&
       (instantMicros(previous.created_at)!<instantMicros(item.created_at)! ||
       instantMicros(previous.created_at)===instantMicros(item.created_at) &&
       previous.id.toLowerCase()<=item.id.toLowerCase())) return null;
    items.push(item);seen.add(item.id.toLowerCase());previous=item;
  }
  if (next!==null && (!previous || !isRecord(next) ||
       !isUuid(next.id) || next.id.toLowerCase()!==previous.id.toLowerCase() ||
       instantMicros(next.created_at)!==instantMicros(previous.created_at))) return null;
  return {version:1,items,next_cursor:next as {created_at:string;id:string}|null};
}

// R-03: Opportunity detail contains a mixed active+archived preview of at most
// 50 currently derived Activities. When truncated, continue via TWO independent
// list_activities_v1 searches (active/archived) using the source filter. There
// is deliberately no single cursor for the mixed preview.
export type AoDerivedActivityItem = {id:string;title:string;status:ActivityStatus;archived:boolean};
export type AoDerivedActivityPreview = {
  items:AoDerivedActivityItem[];has_more:boolean;
  continuation:{rpc:"list_activities_v1";filters:{source_opportunity_id:string};scopes:["active","archived"]}|null;
};
export function parseAoDerivedActivityPreview(raw:unknown,opportunityId:string):AoDerivedActivityPreview|null {
  if(!isUuid(opportunityId)||!isRecord(raw)||!exactKeys(raw,["items","has_more","continuation"])||
     !Array.isArray(raw.items)||raw.items.length>50||typeof raw.has_more!=="boolean")return null;
  const continuation=raw.continuation;
  if(raw.has_more){
    if(raw.items.length!==50||!isRecord(continuation)||!exactKeys(continuation,["rpc","filters","scopes"])||
       continuation.rpc!=="list_activities_v1"||!isRecord(continuation.filters)||
       !exactKeys(continuation.filters,["source_opportunity_id"])||
       !isUuid(continuation.filters.source_opportunity_id)||
       continuation.filters.source_opportunity_id.toLowerCase()!==opportunityId.toLowerCase()||
       !Array.isArray(continuation.scopes)||continuation.scopes.length!==2||
       continuation.scopes[0]!=="active"||continuation.scopes[1]!=="archived")return null;
  } else if(continuation!==null)return null;
  const seen=new Set<string>();
  for(const item of raw.items){
    if(!isRecord(item)||!exactKeys(item,["id","title","status","archived"])||
       !isUuid(item.id)||seen.has(item.id.toLowerCase())||
       typeof item.archived!=="boolean"||!isEnum(ACTIVITY_STATUSES,item.status)||
       !isPostgresText(item.title)||trimBoundaryWhitespace(item.title)!==item.title||
       item.title.length===0||unicodeCodePoints(item.title)>240)return null;
    seen.add(item.id.toLowerCase());
  }
  return raw as AoDerivedActivityPreview;
}

// R-06: explicit owner-scoped History read DTO. `reason` is retained for
// effective Activity status corrections; full JSON snapshots remain untrusted
// until the server's allowlisted privacy contract passes disposable wire QA.
export type AoHistoryEvent = {
  id: string; command_id: string; event_seq: number; event_type: string;
  before_value: unknown; after_value: unknown; reason: string | null;
  recorded_at: string;
} & ({ opportunity_id: string } | { activity_id: string });
export type AoHistoryPage = {
  version: 1; items: AoHistoryEvent[];
  next_cursor: { recorded_at: string; id: string } | null;
};
export function parseAoHistoryPage(raw: unknown, kind: SubjectKind, subjectId: string): AoHistoryPage | null {
  if (!isEnum(SUBJECT_KINDS,kind) || !isUuid(subjectId) || !isRecord(raw) ||
      !exactKeys(raw,["version","items","next_cursor"]) || raw.version !== 1 ||
      !Array.isArray(raw.items) || raw.items.length > MAX_PAGE_SIZE) return null;
  const cursor=raw.next_cursor;
  if (cursor!==null && (!isRecord(cursor) || !exactKeys(cursor,["recorded_at","id"]) ||
      !isUuid(cursor.id) || instantMicros(cursor.recorded_at)===null)) return null;
  const subjectKey=kind==="opportunity"?"opportunity_id":"activity_id";
  let previous:AoHistoryEvent|null=null;
  const seen=new Set<string>();
  const items:AoHistoryEvent[]=[];
  for (const v of raw.items) {
    if (!isRecord(v) || !exactKeys(v,["id",subjectKey,"command_id","event_seq",
          "event_type","before_value","after_value","reason","recorded_at"]) ||
        !isUuid(v.id) || !isUuid(v[subjectKey]) ||
        v[subjectKey].toLowerCase()!==subjectId.toLowerCase() || !isUuid(v.command_id) ||
        !Number.isSafeInteger(v.event_seq) || (v.event_seq as number)<1 ||
        !isPostgresText(v.event_type) || unicodeCodePoints(v.event_type)>80 ||
        trimBoundaryWhitespace(v.event_type)!==v.event_type || !v.event_type ||
        (v.reason!==null && (!isPostgresText(v.reason) ||
          unicodeCodePoints(v.reason)>2000 || trimBoundaryWhitespace(v.reason)!==v.reason || !v.reason)) ||
        instantMicros(v.recorded_at)===null || seen.has(v.id.toLowerCase())) return null;
    if (previous) {
      const before=instantMicros(previous.recorded_at)!;
      const current=instantMicros(v.recorded_at)!;
      if (before<current || (before===current && previous.id.toLowerCase()<=v.id.toLowerCase())) return null;
    }
    const event=v as AoHistoryEvent;
    seen.add(event.id.toLowerCase());items.push(event);previous=event;
  }
  if (cursor!==null && (!previous || !isRecord(cursor) || !isUuid(cursor.id) ||
      cursor.id.toLowerCase()!==previous.id.toLowerCase() ||
      instantMicros(cursor.recorded_at)!==instantMicros(previous.recorded_at))) return null;
  return {version:1,items,next_cursor:cursor as AoHistoryPage["next_cursor"]};
}
