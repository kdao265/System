"use client";

import { useId, useState } from "react";
import { Button, Notice, Panel } from "@/components/ui/primitives";
import { ACTIVITY_CATEGORIES, ACTIVITY_STATUSES, OPPORTUNITY_CATEGORIES, OPPORTUNITY_STAGES, SELECTION_OUTCOMES, type SubjectKind } from "../model";
import { filterSummaries, initialAoQuery, type AoSummary } from "../read-contracts";
import { aoCopy, type AoLocale } from "./ui-copy";
import { coreCopy } from "./core-copy";
import { AoRecordCard } from "./presentation";

type ListState = { outcome: "ready"; items: readonly AoSummary[]; hasMore: boolean } | { outcome: "loading" | "error" | "unavailable" };
export function AoRecordBrowser({ kind, locale, state, onNext, onOpen }: {
  kind: SubjectKind; locale: AoLocale; state: ListState; onNext?: () => void; onOpen?: (id: string) => void;
}) {
  return <RecordBrowser key={kind} kind={kind} locale={locale} state={state} onNext={onNext} onOpen={onOpen}/>;
}
function RecordBrowser({ kind, locale, state, onNext, onOpen }: {
  kind: SubjectKind; locale: AoLocale; state: ListState; onNext?: () => void; onOpen?: (id: string) => void;
}) {
  const [query, setQuery] = useState(initialAoQuery), prefix = useId();
  const t = coreCopy[locale], base = aoCopy[locale];
  const items = state.outcome === "ready" ? filterSummaries(state.items, kind, query) : [];
  return <section className="ao-core" lang={locale} aria-label={kind === "opportunity" ? base.opportunities : base.activities}>
    <fieldset className="ao-core-grid" disabled={state.outcome !== "ready"}>
      <legend>{t.filters}</legend>
      <div className="ao-core-field"><label htmlFor={`${prefix}-search`}>{base.search}</label><input id={`${prefix}-search`} className="ui-field" type="search" value={query.search}
        onChange={e => setQuery({ ...query, search: e.target.value })}/></div>
      <div className="ao-core-field"><label htmlFor={`${prefix}-scope`}>{base.scope}</label><select id={`${prefix}-scope`} className="ui-field" value={query.scope}
        onChange={e => setQuery({ ...query, scope: e.target.value as "active" | "archived" })}>
        <option value="active">{base.active}</option><option value="archived">{base.archived}</option>
      </select></div>
      <div className="ao-core-field"><label htmlFor={`${prefix}-category`}>{t.fields.category}</label><select id={`${prefix}-category`} className="ui-field" value={query.category}
        onChange={e => setQuery({ ...query, category: e.target.value })}>
        <option value="">{t.all}</option>{(kind === "opportunity" ? OPPORTUNITY_CATEGORIES : ACTIVITY_CATEGORIES).map(value => <option key={value} value={value}>{t.options[value]}</option>)}
      </select></div>
      <div className="ao-core-field"><label htmlFor={`${prefix}-status`}>{kind === "opportunity" ? base.stage : base.participation}</label><select id={`${prefix}-status`} className="ui-field" value={query.status}
        onChange={e => setQuery({ ...query, status: e.target.value })}>
        <option value="">{t.all}</option>{kind === "opportunity" ? OPPORTUNITY_STAGES.map(value => <option key={value} value={value}>{base.stageLabels[value]}</option>)
          : ACTIVITY_STATUSES.map(value => <option key={value} value={value}>{base.activityStatusLabels[value]}</option>)}
      </select></div>
      {kind === "opportunity" && <div className="ao-core-field"><label htmlFor={`${prefix}-outcome`}>{base.outcome}</label><select id={`${prefix}-outcome`} className="ui-field" value={query.outcome}
        onChange={e => setQuery({ ...query, outcome: e.target.value })}>
        <option value="">{t.all}</option>{SELECTION_OUTCOMES.map(value => <option key={value} value={value}>{base.outcomeLabels[value]}</option>)}
      </select></div>}
    </fieldset>
    <p>{t.loadedPage}</p>
    {state.outcome !== "ready" ? <Notice role={state.outcome === "error" ? "alert" : "status"}>
      {state.outcome === "unavailable" ? base.unavailableList : t[state.outcome]}</Notice>
      : items.length ? <ul className="ao-view-list">{items.map(item => <li key={item.id}>
        <AoRecordCard item={item} locale={locale}/>
        {onOpen && <Button onClick={() => onOpen(item.id)}>{t.open}: {item.title}</Button>}
      </li>)}</ul> : <Panel><p role="status">{t.empty}</p></Panel>}
    {state.outcome === "ready" && state.hasMore && <Button disabled={!onNext} onClick={onNext}>{t.more}</Button>}
  </section>;
}
