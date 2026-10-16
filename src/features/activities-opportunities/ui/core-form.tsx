"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button, Notice, Panel, SectionHeader } from "@/components/ui/primitives";
import {
  ACTIVITY_CATEGORIES, ACTIVITY_INTENTS, ACTIVITY_LIMITS, CLOSED_REASONS, ENTRY_MODES,
  normalizeActivityCreate, normalizeOpportunity, OPPORTUNITY_CATEGORIES, OPPORTUNITY_LIMITS,
  OPPORTUNITY_STAGES, PRIORITIES, SELECTION_APPLICABILITY, SELECTION_OUTCOMES,
  type ActivityFields, type ActivityIntent, type OpportunityFields, type PartialDate,
} from "../model";
import { activityMetadata, opportunityMetadata, unavailableAoAdapter, type ActivitySnapshot, type AoAdapter, type FieldFailure, type OpportunitySnapshot, type Operation } from "../application";
import { createCommandSession } from "../command-session";
import { dateDraft, parseDateDraft, type DateDraft } from "../temporal-input";
import { aoCopy, type AoLocale } from "./ui-copy";
import { coreCopy, type AoField } from "./core-copy";
import { SelectField, TextField } from "./core-fields";
import { DateFields } from "./date-fields";
import { CommandFeedback } from "./command-feedback";

type Common = { locale: AoLocale; adapter?: AoAdapter; uuid?: () => string; now?: () => number };
type Props = Common & ({ kind: "opportunity"; current?: OpportunitySnapshot } | { kind: "activity"; current?: ActivitySnapshot });
const uuidDefault = () => crypto.randomUUID();
const opportunityDates = ["application_deadline", "program_start", "program_end", "applied_at", "decision_at"] as const;
const activityDates = ["planned_start", "planned_end", "actual_start", "actual_end"] as const;
function blankOpportunity(): OpportunityFields {
  const result = normalizeOpportunity({ title: "_" }, "create");
  if (!result.ok) throw new Error("AO defaults unavailable");
  return { ...result.value, title: "" };
}
function blankActivity(): ActivityFields {
  // The draft carries no selected intent; status is never submitted by this form.
  const result = normalizeActivityCreate({ title: "_", intent: "confirmed_plan" });
  if (!result.ok) throw new Error("AO defaults unavailable");
  return { ...result.value.fields, title: "" };
}
export function OpportunityForm(props: Common & { current?: OpportunitySnapshot }) {
  return <CoreForm key={`${props.current?.id ?? "new"}:${props.current?.revision ?? "0"}:${props.current?.archived}`} {...props} kind="opportunity"/>;
}
export function ActivityForm(props: Common & { current?: ActivitySnapshot }) {
  return <CoreForm key={`${props.current?.id ?? "new"}:${props.current?.revision ?? "0"}:${props.current?.archived}`} {...props} kind="activity"/>;
}
function CoreForm({ locale, adapter = unavailableAoAdapter, uuid = uuidDefault, now = Date.now, ...props }: Props) {
  const t = coreCopy[locale], base = aoCopy[locale], prefix = useId();
  const isOpportunity = props.kind === "opportunity";
  const [draft, setDraft] = useState<OpportunityFields | ActivityFields>(() => props.current?.fields ?? (isOpportunity ? blankOpportunity() : blankActivity()));
  const [intent, setIntent] = useState<ActivityIntent | "">("");
  const dates = isOpportunity ? opportunityDates : activityDates;
  const [temporal, setTemporal] = useState<Record<string, DateDraft>>(() => Object.fromEntries(dates.map(key => [key, dateDraft((draft as unknown as Record<string, PartialDate | null>)[key])])));
  const [editedDates, setEditedDates] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<FieldFailure | null>(null);
  const [session] = useState(() => createCommandSession({ adapter, subjectId: props.current?.id ?? uuid(), revision: props.current?.revision ?? null, uuid, now }));
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const failure = localError ?? (state.result?.outcome === "rejected" ? state.result.error : null);
  const locked = state.locked || !!props.current?.archived;
  function edit(name: string, value: unknown) {
    session.edit(); setLocalError(null); setDraft(previous => ({ ...previous, [name]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const fields = { ...draft };
    for (const name of dates) {
      if (props.current && name === "decision_at") continue;
      // Creation keeps domain null defaults; updates omit dates without edit intent.
      if (!editedDates[name]) continue;
      const result = parseDateDraft(temporal[name], name === "application_deadline", name);
      if (!result.ok) { setLocalError(result); return; }
      Object.assign(fields, { [name]: result.value });
    }
    let operation: Operation;
    if (props.kind === "opportunity") {
      const value = fields as OpportunityFields;
      if (props.current) {
        const changes = Object.fromEntries(Object.entries(opportunityMetadata(value))
          .filter(([key]) => !dates.some(date => date === key) || editedDates[key]));
        operation = { operation: "update_opportunity_v1", current: props.current, changes };
      } else operation = { operation: "create_opportunity_v1", fields: value };
    } else {
      const fieldsWithoutStatus = activityMetadata(fields as ActivityFields);
      const changes = Object.fromEntries(Object.entries(fieldsWithoutStatus)
        .filter(([key]) => !dates.some(date => date === key) || editedDates[key]));
      operation = props.current ? { operation: "update_activity_v1", current: props.current, changes }
        : { operation: "create_activity_v1", fields: fieldsWithoutStatus, intent };
    }
    setLocalError(null); await session.submit(operation);
  }
  const common = { prefix, locale, failure };
  const textNames = isOpportunity ? Object.keys(OPPORTUNITY_LIMITS).filter(key => key !== "closed_note") : Object.keys(ACTIVITY_LIMITS);
  return <Panel className="ao-core" lang={locale}>
    <SectionHeader title={props.current ? t.edit : isOpportunity ? t.createOpportunity : t.createActivity}
      description={isOpportunity ? t.createHint : t.intentHint}/>
    {props.current?.archived && <Notice role="status">{t.archived}</Notice>}
    <form noValidate onSubmit={submit} aria-busy={state.busy}>
      <fieldset disabled={locked} className="ao-core-grid">
        <legend className="ao-sr-only">{props.current ? t.edit : isOpportunity ? t.createOpportunity : t.createActivity}</legend>
        {textNames.map(name => <TextField key={name} {...common} name={name as AoField}
          value={(draft as unknown as Record<string, string | null>)[name]} required={name === "title"}
          limit={(isOpportunity ? OPPORTUNITY_LIMITS : ACTIVITY_LIMITS)[name as "title"]}
          multiline={!["title", "organization", "role"].includes(name)} onChange={value => edit(name, value)}/>)}
        <SelectField {...common} name="category" value={draft.category ?? ""} nullable
          choices={isOpportunity ? OPPORTUNITY_CATEGORIES : ACTIVITY_CATEGORIES} labels={t.options} onChange={value => edit("category", value || null)}/>
        {isOpportunity && <>
          <SelectField {...common} name="priority" value={(draft as OpportunityFields).priority ?? ""} nullable choices={PRIORITIES} labels={t.options} onChange={value => edit("priority", value || null)}/>
          <SelectField {...common} name="entry_mode" value={(draft as OpportunityFields).entry_mode} choices={ENTRY_MODES} labels={t.options} onChange={value => edit("entry_mode", value)}/>
          {!props.current && <>
            <SelectField {...common} name="tracking_stage" value={(draft as OpportunityFields).tracking_stage} choices={OPPORTUNITY_STAGES} labels={base.stageLabels} onChange={value => {
              session.edit(); setLocalError(null); setDraft(previous => ({ ...previous, tracking_stage: value as OpportunityFields["tracking_stage"],
                ...(value !== "closed" ? { closed_reason: null, closed_note: null } : {}) }));
            }}/>
            <SelectField {...common} name="selection_outcome" value={(draft as OpportunityFields).selection_outcome} choices={SELECTION_OUTCOMES} labels={base.outcomeLabels} onChange={value => edit("selection_outcome", value)}/>
            <SelectField {...common} name="selection_applicability" value={(draft as OpportunityFields).selection_applicability} choices={SELECTION_APPLICABILITY} labels={base.applicabilityLabels} onChange={value => edit("selection_applicability", value)}/>
            {(draft as OpportunityFields).tracking_stage === "closed" && <>
              <SelectField {...common} name="closed_reason" value={(draft as OpportunityFields).closed_reason ?? ""} choices={CLOSED_REASONS} labels={t.options} nullable onChange={value => edit("closed_reason", value || null)}/>
              <TextField {...common} name="closed_note" value={(draft as OpportunityFields).closed_note} limit={OPPORTUNITY_LIMITS.closed_note} multiline onChange={value => edit("closed_note", value)}/>
            </>}
          </>}
        </>}
        {!isOpportunity && !props.current && <fieldset className="ao-intent" aria-describedby={`${prefix}-intent-hint${failure?.field === "intent" ? ` ${prefix}-intent-error` : ""}`}>
          <legend>{t.fields.intent} · {t.required}</legend>
          <p id={`${prefix}-intent-hint`}>{t.intentHint}</p>
          {ACTIVITY_INTENTS.map((value, index) => <label key={value}>
            <input type="radio" name="intent" value={value} checked={intent === value} required aria-invalid={failure?.field === "intent" || undefined}
              onChange={() => { session.edit(); setLocalError(null); setIntent(value); }}/>
            {base[(["confirmedPlan", "confirmedStarted", "historicalCompleted", "historicalEndedEarly"] as const)[index]]}
          </label>)}
          {failure?.field === "intent" && <p id={`${prefix}-intent-error`} className="text-danger">{t.errors[failure.code]}</p>}
        </fieldset>}
        {dates.filter(name => !props.current || name !== "decision_at").map(name => <DateFields key={name} {...common} name={name}
          value={temporal[name]} deadline={name === "application_deadline"} onChange={value => {
            session.edit(); setLocalError(null); setTemporal(previous => ({ ...previous, [name]: value })); setEditedDates(previous => ({ ...previous, [name]: true }));
          }}/ >)}
      </fieldset>
      {isOpportunity && <p>{t.noActivity}</p>}
      <CommandFeedback state={state} locale={locale} failure={failure} onConfirm={() => void session.confirm()} onCancel={session.edit}/>
      <Button type="submit" variant="primary" disabled={locked}>{state.busy ? t.working : t.save}</Button>
    </form>
  </Panel>;
}
