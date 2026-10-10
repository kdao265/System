import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SystemShell } from "@/components/system-shell";
import { ProfileError } from "@/features/profile/profile-error";
import { isUuid } from "@/features/activities-opportunities/model";
import { AoCreateFields, AoDetailSections, AoListView, AoUnavailable } from "./presentation";
import { aoPageContext } from "./page-context";
import { aoCopy } from "./ui-copy";

type Kind = "opportunity" | "activity";
type Mode = "list" | "new" | "detail";

// No AO RPC, mutation or sample records: these are protected, disabled UI shells.
export async function AoRoutePage({ kind, mode, id }: { kind: Kind; mode: Mode; id?: string }) {
  const context = await aoPageContext();
  if (context.outcome !== "ready") return <ProfileError missing={context.outcome === "missing"} />;
  if (mode === "detail" && !isUuid(id)) notFound();
  const { locale } = context;
  const t = aoCopy[locale];
  const listHref = kind === "opportunity" ? "/opportunities" : "/activities";
  const createHref = `${listHref}/new`;
  const title = kind === "opportunity" ? t.opportunities : t.activities;
  const newTitle = kind === "opportunity" ? t.newOpportunity : t.newActivity;
  return <SystemShell current={kind === "opportunity" ? "opportunities" : "activities"} lang={locale} width="wide" pageClassName="ao-page">
    <div className="ao-workspace">
      {mode !== "list" && <Link prefetch={false} className="ui-button ao-back" href={listHref}>{t.back}</Link>}
      {mode === "list" && <>
        <header className="ao-heading">
          <div><p className="type-metadata text-accent">{t.growth}</p><h2 className="type-page">{title}</h2></div>
          <Link prefetch={false} href={createHref} className="ui-button ui-button-primary">{newTitle}</Link>
        </header>
        <AoUnavailable locale={locale} />
        <div className="ao-filter-controls" aria-label={t.filters}>
          <label>{t.search}<input className="ui-field" type="search" disabled placeholder={t.searchPlaceholder}/></label>
          <label>{t.scope}<select className="ui-field" disabled defaultValue="active"><option value="active">{t.active}</option><option value="archived">{t.archived}</option></select></label>
        </div>
        <AoListView kind={kind} records={[]} locale={locale} />
      </>}
      {mode === "new" && <>
        <header className="ao-heading"><div><p className="type-metadata text-accent">{t.growth}</p><h2 className="type-page">{newTitle}</h2></div></header>
        <AoUnavailable locale={locale} />
        <AoCreateFields kind={kind} locale={locale}/>
      </>}
      {mode === "detail" && <>
        <header className="ao-heading"><div><p className="type-metadata text-accent">{t.growth}</p><h2 className="type-page">{t.detail}</h2></div></header>
        <AoDetailSections locale={locale} kind={kind} />
      </>}
    </div>
  </SystemShell>;
}
