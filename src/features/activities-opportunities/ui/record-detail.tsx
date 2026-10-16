import { Badge, Notice, Panel, SectionHeader } from "@/components/ui/primitives";
import type { AoSnapshot } from "../application";
import { isResourceUrl, type DeadlineSpec } from "../model";
import { aoCopy, type AoLocale } from "./ui-copy";
import { coreCopy, type AoField } from "./core-copy";
import { DateValue } from "./date-fields";

export function AoRecordDetail({ record, locale, localZone }: { record: AoSnapshot; locale: AoLocale; localZone?: string }) {
  const t = coreCopy[locale], base = aoCopy[locale], fields = record.fields;
  const dateKeys = record.kind === "opportunity" ? ["application_deadline", "program_start", "program_end", "applied_at", "decision_at"]
    : ["planned_start", "planned_end", "actual_start", "actual_end"];
  const textKeys = record.kind === "opportunity" ? ["description", "eligibility_notes", "benefits_notes", "notes"]
    : ["role", "description", "confirmation_note", "contributions", "outcomes", "lessons", "notes"];
  return <article className="ao-core ao-detail" lang={locale}>
    <Panel><SectionHeader title={fields.title} description={fields.organization ?? undefined}/>
      <Badge>{record.archived ? base.archived : base.active}</Badge>
      <p>{t.fields.category}: {fields.category ? t.options[fields.category] : t.unset}</p>
      <dl>{textKeys.map(key => <div key={key}><dt>{t.fields[key as AoField]}</dt><dd>{(fields as unknown as Record<string, string | null>)[key] ?? t.unset}</dd></div>)}</dl>
    </Panel>
    <Panel><SectionHeader title={record.kind === "opportunity" ? base.selection : t.lifecycle}/>
      {record.kind === "opportunity" ? <dl>
        <div><dt>{base.stage}</dt><dd>{base.stageLabels[record.fields.tracking_stage]}</dd></div>
        <div><dt>{base.outcome}</dt><dd>{record.fields.selection_applicability === "not_applicable" ? base.applicabilityLabels.not_applicable : base.outcomeLabels[record.fields.selection_outcome]}</dd></div>
        <div><dt>{base.applicability}</dt><dd>{base.applicabilityLabels[record.fields.selection_applicability]}</dd></div>
        <div><dt>{t.fields.entry_mode}</dt><dd>{t.options[record.fields.entry_mode]}</dd></div>
        <div><dt>{t.fields.priority}</dt><dd>{record.fields.priority ? t.options[record.fields.priority] : t.unset}</dd></div>
        {record.fields.tracking_stage === "closed" && <>
          <div><dt>{t.fields.closed_reason}</dt><dd>{record.fields.closed_reason ? t.options[record.fields.closed_reason] : t.unset}</dd></div>
          <div><dt>{t.fields.closed_note}</dt><dd>{record.fields.closed_note ?? t.unset}</dd></div>
        </>}
      </dl> : <p>{base.participation}: {base.activityStatusLabels[record.fields.status]}</p>}
    </Panel>
    <Panel><SectionHeader title={base.dates}/><dl>{dateKeys.map(key => <div key={key}>
      <dt>{t.fields[key as AoField]}</dt><dd><DateValue locale={locale} localZone={localZone} value={(fields as unknown as Record<string, DeadlineSpec | null>)[key]}/></dd>
    </div>)}</dl></Panel>
    <Panel><SectionHeader title={base.resource}/>{fields.resource_links.length ? <ul>{fields.resource_links.map(link => <li key={link.id}>
      {isResourceUrl(link.url) ? <a href={link.url} rel="noreferrer noopener" className="ao-resource-link">{link.label}</a> : <span>{link.label}</span>}
    </li>)}</ul> : <p>{t.unset}</p>}</Panel>
    <Panel><SectionHeader title={base.relationships}/><Notice>{t.relationshipsPending}</Notice></Panel>
    <Panel><SectionHeader title={base.history}/><Notice>{t.relationshipsPending}</Notice></Panel>
  </article>;
}
