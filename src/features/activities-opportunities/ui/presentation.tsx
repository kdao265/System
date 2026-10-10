import type { ReactNode } from "react";
import { Badge, Notice, Panel, SectionHeader } from "@/components/ui/primitives";
import type { ActivityStatus, OpportunityStage, SelectionOutcome, SelectionApplicability } from "@/features/activities-opportunities/model";
import { aoCopy, type AoLocale } from "./ui-copy";

// Presentation-only types. Real records must eventually come from validated owner DTOs,
// never inline demo data, URL searchParams, browser storage or untrusted raw JSON.
export type AoOpportunityView = {
  kind: "opportunity"; id: string; title: string; organization: string | null;
  trackingStage: OpportunityStage; selectionOutcome: SelectionOutcome;
  applicability: SelectionApplicability; archived: boolean;
};
export type AoActivityView = {
  kind: "activity"; id: string; title: string; organization: string | null;
  participationStatus: ActivityStatus; archived: boolean;
};
export type AoView = AoOpportunityView | AoActivityView;

export function AoUnavailable({ locale }: { locale: AoLocale }) {
  return <Notice tone="warning" role="status">{aoCopy[locale].unavailable}</Notice>;
}

export function AoRecordCard({ item, locale }: { item: AoView; locale: AoLocale }) {
  const t = aoCopy[locale];
  return <Panel aria-label={item.title}>
    <SectionHeader title={item.title} description={item.organization ?? undefined}/>
    <div className="flex flex-wrap gap-2 mt-3">
      <Badge tone="muted">{item.archived ? t.archived : t.active}</Badge>
      {item.kind === "opportunity" ? <>
        <Badge tone="accent">{t.stage}: {t.stageLabels[item.trackingStage]}</Badge>
        <Badge tone="muted">{t.outcome}: {t.outcomeLabels[item.selectionOutcome]}</Badge>
        <Badge tone="muted">{t.applicability}: {t.applicabilityLabels[item.applicability]}</Badge>
      </> : <Badge tone="accent">{t.participation}: {t.activityStatusLabels[item.participationStatus]}</Badge>}
    </div>
  </Panel>;
}

export function AoListView({ kind, records, locale, footer }: {
  kind: AoView["kind"]; records: readonly AoView[]; locale: AoLocale; footer?: ReactNode;
}) {
  const t = aoCopy[locale];
  const items = records.filter(item => item.kind === kind);
  return <section lang={locale} aria-label={kind === "opportunity" ? t.opportunities : t.activities}>
    {items.length ? <ul className="ao-view-list" aria-label={kind === "opportunity" ? t.opportunities : t.activities}>
      {items.map(item => <li key={item.id}><AoRecordCard item={item} locale={locale}/></li>)}
    </ul> : <Panel><p role="status">{t.unavailableList}</p></Panel>}
    {footer}
  </section>;
}

export function AoDetailSections({ locale, kind }: { locale: AoLocale; kind: AoView["kind"] }) {
  const t = aoCopy[locale];
  return <div lang={locale} className="grid gap-4">
    <AoUnavailable locale={locale}/>
    <Panel><SectionHeader title={t.overview} description={t.detailPending}/></Panel>
    {kind === "opportunity" && <Panel><SectionHeader title={t.selection} description={t.detailPending}/></Panel>}
    <Panel><SectionHeader title={t.dates} description={t.detailPending}/></Panel>
    <Panel><SectionHeader title={t.resource} description={t.detailPending}/></Panel>
    <Panel><SectionHeader title={t.relationships} description={t.detailPending}/></Panel>
    <Panel><SectionHeader title={t.history} description={t.detailPending}/></Panel>
  </div>;
}

export function AoCreateFields({ kind, locale }: { kind: AoView["kind"]; locale: AoLocale }) {
  const t = aoCopy[locale];
  return <Panel>
    <p id="ao-create-pending" role="status" className="mb-4">{t.notSaved} {t.disabledPreview}</p>
    <fieldset disabled aria-describedby="ao-create-pending" className="grid gap-4">
      <div><label htmlFor="ao-title" className="block mb-2">{t.title}</label><input id="ao-title" name="title" className="ui-field" maxLength={240}/></div>
      <div><label htmlFor="ao-organization" className="block mb-2">{t.organization}</label><input id="ao-organization" name="organization" className="ui-field" maxLength={240}/></div>
      {kind === "opportunity" && <>
        <div><label htmlFor="ao-stage" className="block mb-2">{t.stage}</label>
          <select id="ao-stage" className="ui-field" defaultValue="saved" name="tracking_stage">
            {Object.entries(t.stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
        <div><label htmlFor="ao-outcome" className="block mb-2">{t.outcome}</label>
          <select id="ao-outcome" className="ui-field" defaultValue="unknown" name="selection_outcome">
            {Object.entries(t.outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
        <div><label htmlFor="ao-applicability" className="block mb-2">{t.applicability}</label>
          <select id="ao-applicability" className="ui-field" defaultValue="unknown" name="selection_applicability">
            {Object.entries(t.applicabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
      </>}
      {kind === "activity" && <fieldset className="grid gap-2"><legend>{t.chooseIntent}</legend>
        {(["confirmedPlan", "confirmedStarted", "historicalCompleted", "historicalEndedEarly"] as const).map(key =>
          <label key={key} className="flex gap-2 items-center min-h-11"><input type="radio" name="intent" value={key}/>{t[key]}</label>)}
      </fieldset>}
    </fieldset>
  </Panel>;
}
