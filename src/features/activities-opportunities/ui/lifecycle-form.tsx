"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button, Notice, Panel, SectionHeader } from "@/components/ui/primitives";
import { ACTIVITY_STATUSES, CLOSED_REASONS, OPPORTUNITY_STAGES, SELECTION_APPLICABILITY, SELECTION_OUTCOMES,
  type ActivityAction, type ActivityStatus, type ClosedReason, type OpportunityStage, type PartialDate,
  type SelectionApplicability, type SelectionOutcome } from "../model";
import { canCorrectActivityStatus, availableActivityActions, unavailableAoAdapter, type AoAdapter, type AoSnapshot, type FieldFailure, type Operation } from "../application";
import { createCommandSession } from "../command-session";
import { dateDraft, parseDateDraft } from "../temporal-input";
import { aoCopy, type AoLocale } from "./ui-copy";
import { coreCopy } from "./core-copy";
import { DateFields } from "./date-fields";
import { SelectField, TextField } from "./core-fields";
import { CommandFeedback } from "./command-feedback";

export function AoLifecycleForm(props: { current: AoSnapshot; locale: AoLocale; adapter?: AoAdapter; uuid?: () => string; now?: () => number }) {
  return <LifecycleEditor key={`${props.current.id}:${props.current.revision}:${props.current.archived}`} {...props}/>;
}
function LifecycleEditor({ current, locale, adapter = unavailableAoAdapter, uuid = () => crypto.randomUUID(), now = Date.now }: {
  current: AoSnapshot; locale: AoLocale; adapter?: AoAdapter; uuid?: () => string; now?: () => number;
}) {
  const t = coreCopy[locale], base = aoCopy[locale], prefix = useId();
  const opportunity = current.kind === "opportunity";
  const [operation, setOperation] = useState("");
  const [stage, setStage] = useState<OpportunityStage>(opportunity ? current.fields.tracking_stage : "saved");
  const [stageMode, setStageMode] = useState<"advance" | "reopen" | "correction">("advance");
  const [decisionMode, setDecisionMode] = useState<"new_decision" | "correction">("new_decision");
  const [outcome, setOutcome] = useState<SelectionOutcome>(opportunity ? current.fields.selection_outcome : "unknown");
  const [applicability, setApplicability] = useState<SelectionApplicability>(opportunity ? current.fields.selection_applicability : "unknown");
  const [closedReason, setClosedReason] = useState<ClosedReason | "">(opportunity ? current.fields.closed_reason ?? "" : "");
  const [closedNote, setClosedNote] = useState(opportunity ? current.fields.closed_note ?? "" : "");
  const [action, setAction] = useState<ActivityAction | "">("");
  const [status, setStatus] = useState<ActivityStatus>(!opportunity ? current.fields.status : "upcoming");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState(() => dateDraft(opportunity ? current.fields.decision_at : null));
  const [start, setStart] = useState(() => dateDraft(!opportunity ? current.fields.actual_start : null));
  const [end, setEnd] = useState(() => dateDraft(!opportunity ? current.fields.actual_end : null));
  const [editedDates, setEditedDates] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<FieldFailure | null>(null);
  const [session] = useState(() => createCommandSession({ adapter, subjectId: current.id, revision: current.revision, uuid, now }));
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const failure = localError ?? (state.result?.outcome === "rejected" ? state.result.error : null);
  const locked = state.locked || current.archived;
  const common = { prefix, locale, failure };
  const edit = (work: () => void) => { session.edit(); setLocalError(null); work(); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (locked) return;
    let command: Operation;
    if (current.kind === "opportunity" && operation === "stage") {
      command = { operation: "set_opportunity_stage_v1", current, stage, mode: stageMode,
        closed_reason: stage === "closed" ? closedReason || null : null, closed_note: stage === "closed" ? closedNote || null : null };
    } else if (current.kind === "opportunity" && operation === "outcome") {
      const date = parseDateDraft(decision, false, "decision_at");
      if (!date.ok) { setLocalError(date); return; }
      command = { operation: "record_opportunity_outcome_v1", current, outcome, applicability, mode: decisionMode,
        ...(editedDates.decision_at ? { decision_at: date.value as PartialDate | null } : {}) };
    } else if (current.kind === "activity" && operation === "transition" && action) {
      command = { operation: "transition_activity_v1", current, action };
    } else if (current.kind === "activity" && operation === "correction" && canCorrectActivityStatus(current.fields.status)) {
      const a = parseDateDraft(start, false, "actual_start"), b = parseDateDraft(end, false, "actual_end");
      if (!a.ok) { setLocalError(a); return; }
      if (!b.ok) { setLocalError(b); return; }
      command = { operation: "correct_activity_status_v1", current, target_status: status,
        ...(editedDates.actual_start ? { actual_start: a.value as PartialDate | null } : {}),
        ...(editedDates.actual_end ? { actual_end: b.value as PartialDate | null } : {}), reason };
    } else { setLocalError({ field: "status", code: "required" }); return; }
    await session.submit(command);
  }
  return <Panel className="ao-core" lang={locale}>
    <SectionHeader title={opportunity ? base.selection : t.lifecycle}/>
    {current.archived && <Notice role="status">{t.archived}</Notice>}
    <form noValidate onSubmit={submit} aria-busy={state.busy}>
      <fieldset disabled={locked} className="ao-core-grid">
        <legend className="ao-sr-only">{t.action}</legend>
        <label className="ao-core-field" htmlFor={`${prefix}-operation`}>{t.action}
          <select id={`${prefix}-operation`} name="operation" className="ui-field" value={operation} onChange={e => edit(() => setOperation(e.target.value))}>
            <option value="">{t.unset}</option>
            {opportunity ? <><option value="stage">{t.stageAction}</option><option value="outcome">{t.outcomeAction}</option></> : <>
              {availableActivityActions(current.fields.status).length > 0 && <option value="transition">{t.lifecycle}</option>}
              {canCorrectActivityStatus(current.fields.status) && <option value="correction">{t.correction}</option>}</>}
          </select>
        </label>
        {operation === "stage" && <>
          <label className="ao-core-field" htmlFor={`${prefix}-mode`}>{t.mode}<select id={`${prefix}-mode`} name="mode" className="ui-field" value={stageMode} onChange={e => edit(() => setStageMode(e.target.value as typeof stageMode))}>
            {(["advance", "reopen", "correction"] as const).map(value => <option key={value} value={value}>{t.options[value]}</option>)}
          </select></label>
          <SelectField {...common} name="tracking_stage" value={stage} choices={OPPORTUNITY_STAGES} labels={base.stageLabels} onChange={value => edit(() => setStage(value as OpportunityStage))}/>
          {stage === "closed" && <>
            <SelectField {...common} name="closed_reason" value={closedReason} nullable choices={CLOSED_REASONS} labels={t.options} onChange={value => edit(() => setClosedReason(value))}/>
            <TextField {...common} name="closed_note" value={closedNote} limit={2000} multiline onChange={value => edit(() => setClosedNote(value))}/>
          </>}
        </>}
        {operation === "outcome" && <>
          <label className="ao-core-field" htmlFor={`${prefix}-decision-mode`}>{t.mode}<select id={`${prefix}-decision-mode`} name="mode" className="ui-field" value={decisionMode} onChange={e => edit(() => setDecisionMode(e.target.value as typeof decisionMode))}>
            {(["new_decision", "correction"] as const).map(value => <option key={value} value={value}>{t.options[value]}</option>)}
          </select></label>
          <SelectField {...common} name="selection_outcome" value={outcome} choices={SELECTION_OUTCOMES} labels={base.outcomeLabels} onChange={value => edit(() => setOutcome(value as SelectionOutcome))}/>
          <SelectField {...common} name="selection_applicability" value={applicability} choices={SELECTION_APPLICABILITY} labels={base.applicabilityLabels} onChange={value => edit(() => setApplicability(value as SelectionApplicability))}/>
          <DateFields {...common} name="decision_at" value={decision} onChange={value => edit(() => { setDecision(value); setEditedDates(previous => ({ ...previous, decision_at: true })); })}/>
        </>}
        {operation === "transition" && current.kind === "activity" && <label className="ao-core-field" htmlFor={`${prefix}-action`}>{t.action}
          <select id={`${prefix}-action`} name="action" className="ui-field" value={action} onChange={e => edit(() => setAction(e.target.value as ActivityAction))}>
            <option value="">{t.unset}</option>{availableActivityActions(current.fields.status).map(value => <option key={value} value={value}>{t.options[value]}</option>)}
          </select></label>}
        {operation === "correction" && current.kind === "activity" && canCorrectActivityStatus(current.fields.status) && <>
          <p>{t.correctionHint}</p>
          <SelectField {...common} name="status" value={status} choices={ACTIVITY_STATUSES} labels={base.activityStatusLabels} onChange={value => edit(() => setStatus(value as ActivityStatus))}/>
          <DateFields {...common} name="actual_start" value={start} onChange={value => edit(() => { setStart(value); setEditedDates(previous => ({ ...previous, actual_start: true })); })}/>
          <DateFields {...common} name="actual_end" value={end} onChange={value => edit(() => { setEnd(value); setEditedDates(previous => ({ ...previous, actual_end: true })); })}/>
          <TextField {...common} name="reason" value={reason} limit={2000} onChange={value => edit(() => setReason(value))}/>
        </>}
      </fieldset>
      <CommandFeedback state={state} locale={locale} failure={failure} onConfirm={() => void session.confirm()} onCancel={session.edit}/>
      <Button type="submit" disabled={locked} variant="primary">{state.busy ? t.working : t.apply}</Button>
    </form>
  </Panel>;
}
