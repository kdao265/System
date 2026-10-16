import {
  activityTransition, ACTIVITY_STATUSES, isCommandIdentity, isEnum, isRecord,
  isCertainReverse, normalizeActivityCreate, normalizeActivityUpdate,
  normalizeOpportunity, normalizeText, opportunityStageTransition, opportunityWarnings,
  parseAoReceipt, validateActivityDates, validateOpportunityState, valid, invalid,
  type ActivityAction, type ActivityFields, type ActivityIntent, type ActivityStatus,
  type AoCommandIdentity, type AoReceipt, type OpportunityFields,
  type OpportunityStage, type OpportunityWarning, type PartialDate,
  type SelectionApplicability, type SelectionOutcome, type Validation,
} from "./model";

// Application contracts, not PostgREST parameter names. A future owner-authenticated
// adapter must map these to reviewed RPCs; UI components never receive a DB client.
export type OpportunityMetadata = Partial<Omit<OpportunityFields,
  "tracking_stage" | "selection_outcome" | "selection_applicability" | "closed_reason" | "closed_note" | "decision_at">>;
export type ActivityMetadata = Partial<Omit<ActivityFields, "status">>;
export function opportunityMetadata(fields: OpportunityFields): OpportunityMetadata {
  return { title: fields.title, category: fields.category, organization: fields.organization,
    description: fields.description, eligibility_notes: fields.eligibility_notes, benefits_notes: fields.benefits_notes,
    entry_mode: fields.entry_mode, application_deadline: fields.application_deadline,
    program_start: fields.program_start, program_end: fields.program_end, applied_at: fields.applied_at,
    priority: fields.priority, notes: fields.notes, resource_links: fields.resource_links };
}
export function activityMetadata(fields: ActivityFields): Omit<ActivityFields, "status"> {
  return { title: fields.title, category: fields.category, organization: fields.organization, role: fields.role,
    description: fields.description, planned_start: fields.planned_start, planned_end: fields.planned_end,
    actual_start: fields.actual_start, actual_end: fields.actual_end, confirmation_note: fields.confirmation_note,
    contributions: fields.contributions, outcomes: fields.outcomes, lessons: fields.lessons,
    notes: fields.notes, resource_links: fields.resource_links };
}
export type OpportunitySnapshot = { kind: "opportunity"; id: string; revision: string; archived: boolean; fields: OpportunityFields };
export type ActivitySnapshot = { kind: "activity"; id: string; revision: string; archived: boolean; fields: ActivityFields };
export type AoSnapshot = OpportunitySnapshot | ActivitySnapshot;
type Identity = Pick<AoCommandIdentity, "command_id" | "subject_id" | "expected_revision">;
// Optional date keys carry edit intent: absent preserves the revision-bound value,
// explicit Unknown clears. Validation always checks the merged state atomically.
export type Operation =
  | { operation: "create_opportunity_v1"; fields: Partial<OpportunityFields> }
  | { operation: "create_activity_v1"; fields: ActivityMetadata; intent: ActivityIntent | "" }
  | { operation: "update_opportunity_v1"; current: OpportunitySnapshot; changes: OpportunityMetadata }
  | { operation: "update_activity_v1"; current: ActivitySnapshot; changes: ActivityMetadata }
  | { operation: "set_opportunity_stage_v1"; current: OpportunitySnapshot; stage: OpportunityStage;
      mode: "advance" | "reopen" | "correction"; closed_reason: OpportunityFields["closed_reason"]; closed_note: string | null }
  | { operation: "record_opportunity_outcome_v1"; current: OpportunitySnapshot; outcome: SelectionOutcome;
      applicability: SelectionApplicability; decision_at?: PartialDate | null; mode: "new_decision" | "correction" }
  | { operation: "transition_activity_v1"; current: ActivitySnapshot; action: ActivityAction }
  | { operation: "correct_activity_status_v1"; current: ActivitySnapshot; target_status: ActivityStatus;
      actual_start?: PartialDate | null; actual_end?: PartialDate | null; reason: string | null };

type RequestByOperation = {
  create_opportunity_v1: { fields: OpportunityFields };
  create_activity_v1: { fields: Omit<ActivityFields, "status">; intent: ActivityIntent };
  update_opportunity_v1: { changes: OpportunityMetadata };
  update_activity_v1: { changes: ActivityMetadata };
  set_opportunity_stage_v1: { stage: OpportunityStage; mode: "advance" | "reopen" | "correction";
    closed_reason: OpportunityFields["closed_reason"]; closed_note: string | null };
  record_opportunity_outcome_v1: { outcome: SelectionOutcome; applicability: SelectionApplicability;
    decision_at?: PartialDate | null; mode: "new_decision" | "correction" };
  transition_activity_v1: { action: ActivityAction };
  correct_activity_status_v1: { target_status: ActivityStatus; actual_start?: PartialDate | null;
    actual_end?: PartialDate | null; reason: string | null };
};
export type PreparedCommand = { [K in keyof RequestByOperation]: {
  identity: AoCommandIdentity & { operation: K }; request: RequestByOperation[K];
} }[keyof RequestByOperation];
export type FieldFailure = { field: string; code: import("./model").ValidationCode };
export type RejectionReason = "validation" | "archived" | "forbidden" | "not_found" | "command_reuse";
export type CommandResult =
  | { outcome: "success"; receipt: AoReceipt }
  | { outcome: "rejected"; reason: RejectionReason; error?: FieldFailure }
  | { outcome: "conflict" }
  | { outcome: "unknown" }
  | { outcome: "unavailable" };
export type Preparation =
  | { outcome: "ready"; command: PreparedCommand; warnings: OpportunityWarning[] }
  | Extract<CommandResult, { outcome: "rejected" | "conflict" }>;
// unavailable is a pre-dispatch capability decision. Any exception after send
// may conceal a committed write and therefore maps to unknown, never rejected.
export type AoAdapter = { available: false } | {
  available: true; send(command: PreparedCommand): Promise<unknown>;
};
export const unavailableAoAdapter: AoAdapter = { available: false };
const failure = (error: FieldFailure): Preparation => ({ outcome: "rejected", reason: "validation", error });

export function prepareOperation(identity: Identity, operation: Operation, nowUtcMilliseconds: number): Preparation {
  const kind = operation.operation.includes("opportunity") ? "opportunity" : "activity";
  const full: AoCommandIdentity = { ...identity, subject_kind: kind, operation: operation.operation };
  if (!isCommandIdentity(full)) return failure({ field: "request", code: "shape" });
  if ("current" in operation) {
    if (operation.current.kind !== kind || operation.current.id !== identity.subject_id ||
        operation.current.revision !== identity.expected_revision) return { outcome: "conflict" };
    if (operation.current.archived) return { outcome: "rejected", reason: "archived" };
  }
  let request: RequestByOperation[keyof RequestByOperation];
  let opportunity: OpportunityFields | undefined;
  let warningFieldsChanged = true;
  switch (operation.operation) {
    case "create_opportunity_v1": {
      const result = normalizeOpportunity(operation.fields, "create");
      if (!result.ok) return failure(result);
      opportunity = result.value; request = { fields: result.value }; break;
    }
    case "create_activity_v1": {
      const result = normalizeActivityCreate({ ...operation.fields, intent: operation.intent });
      if (!result.ok) return failure(result);
      const fields = activityMetadata(result.value.fields);
      request = { fields, intent: result.value.intent }; break;
    }
    case "update_opportunity_v1": {
      const result = normalizeOpportunity(operation.changes, "update");
      if (!result.ok) return failure(result);
      opportunity = { ...operation.current.fields, ...result.value };
      const guard = validateOpportunityState(opportunity);
      if (!guard.ok) return failure(guard);
      if (isCertainReverse(opportunity.program_start, opportunity.program_end)) return failure({ field: "program_end", code: "range" });
      warningFieldsChanged = (["entry_mode", "applied_at", "application_deadline"] as const)
        .some(key => JSON.stringify(operation.current.fields[key]) !== JSON.stringify(opportunity![key]));
      request = { changes: result.value }; break;
    }
    case "update_activity_v1": {
      const result = normalizeActivityUpdate(operation.changes);
      if (!result.ok) return failure(result);
      const guard = validateActivityDates({ ...operation.current.fields, ...result.value });
      if (!guard.ok) return failure(guard);
      request = { changes: result.value }; break;
    }
    case "set_opportunity_stage_v1": {
      if (!isEnum(["advance", "reopen", "correction"], operation.mode)) return failure({ field: "mode", code: "enum" });
      const transition = opportunityStageTransition(operation.current.fields.tracking_stage, operation.stage, operation.mode);
      if (!transition.ok) return failure(transition);
      const result = normalizeOpportunity({ ...operation.current.fields, tracking_stage: operation.stage,
        closed_reason: operation.closed_reason, closed_note: operation.closed_note }, "create");
      if (!result.ok) return failure(result);
      opportunity = result.value;
      request = { stage: operation.stage, mode: operation.mode, closed_reason: result.value.closed_reason, closed_note: result.value.closed_note }; break;
    }
    case "record_opportunity_outcome_v1": {
      if (!isEnum(["new_decision", "correction"], operation.mode)) return failure({ field: "mode", code: "enum" });
      const result = normalizeOpportunity({ ...operation.current.fields, selection_outcome: operation.outcome,
        selection_applicability: operation.applicability, ...(Object.hasOwn(operation, "decision_at") ? { decision_at: operation.decision_at } : {}) }, "create");
      if (!result.ok) return failure(result);
      opportunity = result.value;
      request = { outcome: operation.outcome, applicability: operation.applicability,
        ...(Object.hasOwn(operation, "decision_at") ? { decision_at: result.value.decision_at } : {}), mode: operation.mode }; break;
    }
    case "transition_activity_v1":
    case "correct_activity_status_v1": {
      const correction = operation.operation === "correct_activity_status_v1";
      if (correction && !canCorrectActivityStatus(operation.current.fields.status)) return failure({ field: "status", code: "transition" });
      const target: Validation<ActivityStatus> = correction
        ? (isEnum(ACTIVITY_STATUSES, operation.target_status) ? valid(operation.target_status) : invalid("status", "enum"))
        : activityTransition(operation.current.fields.status, operation.action);
      if (!target.ok) return failure(target);
      // Reuse the domain's temporal parser and state validator. No timestamps are generated.
      const changes = correction ? {
        ...(Object.hasOwn(operation, "actual_start") ? { actual_start: operation.actual_start } : {}),
        ...(Object.hasOwn(operation, "actual_end") ? { actual_end: operation.actual_end } : {}),
      } : {};
      const dates = Object.keys(changes).length ? normalizeActivityUpdate(changes) : valid({});
      if (!dates.ok) return failure(dates);
      const guard = validateActivityDates({ ...operation.current.fields, ...dates.value, status: target.value });
      if (!guard.ok) return failure(guard);
      if (correction) {
        const reason = normalizeText(operation.reason, "reason", 2000);
        if (!reason.ok) return failure(reason);
        request = { target_status: target.value, ...dates.value, reason: reason.value };
      } else request = { action: operation.action };
      break;
    }
    default: return failure({ field: "request", code: "shape" });
  }
  const warnings = opportunity && warningFieldsChanged ? opportunityWarnings(opportunity,
    { applicationDeadline: opportunity.application_deadline, nowUtcMilliseconds }) : [];
  // The switch above normalizes the correlated request. Clone before handing it to
  // an adapter, so subsequent draft edits cannot alter a pending command's identity.
  const command = structuredClone({ identity: full, request }) as PreparedCommand;
  return { outcome: "ready", command, warnings };
}

export async function dispatchCommand(adapter: AoAdapter, prepared: Preparation, confirmed = false): Promise<CommandResult> {
  if (prepared.outcome !== "ready") return prepared;
  if (prepared.warnings.length && !confirmed) return { outcome: "rejected", reason: "validation", error: { field: "confirmation", code: "required" } };
  if (!adapter.available) return { outcome: "unavailable" };
  try {
    const response = await adapter.send(structuredClone(prepared.command));
    if (!isRecord(response)) return { outcome: "unknown" };
    if (response.outcome === "success") {
      const receipt = parseAoReceipt(response.receipt, prepared.command.identity);
      return receipt ? { outcome: "success", receipt } : { outcome: "unknown" };
    }
    if (response.outcome === "conflict") return { outcome: "conflict" };
    if (response.outcome === "rejected" && isEnum(["validation", "archived", "forbidden", "not_found", "command_reuse"], response.reason)) {
      return { outcome: "rejected", reason: response.reason };
    }
    // An adapter cannot claim 'unavailable' after dispatch without proof the
    // command never ran. Transport loss and unrecognized responses stay unknown.
    return { outcome: "unknown" };
  } catch { return { outcome: "unknown" }; }
}

// AO requirements section 6: correction is an exception available only from terminal states.
export function canCorrectActivityStatus(status: ActivityStatus): boolean {
  return status === "completed" || status === "ended_early" || status === "cancelled_before_start";
}

export function availableActivityActions(status: ActivityStatus): ActivityAction[] {
  return (["start", "pause", "resume", "complete", "end_early", "cancel_before_start"] as const)
    .filter(action => activityTransition(status, action).ok);
}
