// TEST ONLY. Compiled by ao-l2-browser.mjs into an ignored, loopback-only harness.
// This file is not imported by any Next route and never receives real records.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OpportunityForm, ActivityForm } from "../../src/features/activities-opportunities/ui/core-form";
import { AoLifecycleForm } from "../../src/features/activities-opportunities/ui/lifecycle-form";
import { AoRecordBrowser } from "../../src/features/activities-opportunities/ui/record-browser";
import { AoRecordDetail } from "../../src/features/activities-opportunities/ui/record-detail";
import { ACTIVITY_STATUSES, normalizeActivityCreate, normalizeOpportunity, type ActivityStatus, type PartialDate } from "../../src/features/activities-opportunities/model";
import type { AoAdapter, PreparedCommand, OpportunitySnapshot, ActivitySnapshot } from "../../src/features/activities-opportunities/application";
import type { AoSummary } from "../../src/features/activities-opportunities/read-contracts";
import type { AoLocale } from "../../src/features/activities-opportunities/ui/ui-copy";

declare global { interface Window { aoHarness: { calls: PreparedCommand[]; opened: string[]; next: number } } }
window.aoHarness = { calls: [], opened: [], next: 0 };
const op = normalizeOpportunity({ title: "Học bổng nghiên cứu quốc tế — dữ liệu kiểm thử 🧭", organization: "Tổ chức kiểm thử tổng hợp",
  selection_applicability: "not_applicable", application_deadline: { precision: "day", year: 2027, month: 2, day: 20, source_time: "23:59", source_time_state: "unresolved" },
  description: "Bản ghi tổng hợp chỉ dùng trong kiểm thử. ".repeat(8), category: "scholarship" }, "create");
const act = normalizeActivityCreate({ title: "Hoạt động tình nguyện — kiểm thử", intent: "historical_completed" });
if (!op.ok || !act.ok) throw Error("Invalid test fixture");
const opportunity: OpportunitySnapshot = { kind: "opportunity", id: "11111111-1111-4111-8111-111111111111", revision: "7", archived: false, fields: op.value };
const activity: ActivitySnapshot = { kind: "activity", id: "33333333-3333-4333-8333-333333333333", revision: "9", archived: false, fields: act.value.fields };
const summaries: AoSummary[] = [
  { kind: "opportunity", id: opportunity.id, title: opportunity.fields.title, organization: opportunity.fields.organization,
    category: "scholarship", archived: false, trackingStage: "saved", selectionOutcome: "unknown", applicability: "not_applicable" },
  { kind: "opportunity", id: "44444444-4444-4444-8444-444444444444", title: "Archived synthetic record", organization: null,
    category: "event", archived: true, trackingStage: "closed", selectionOutcome: "accepted", applicability: "applicable" },
  { kind: "activity", id: activity.id, title: activity.fields.title, organization: null, category: "volunteer", archived: false, participationStatus: "completed" },
];
const screens = ["opportunity", "activity", "edit-opportunity", "edit-activity", "opportunity-lifecycle", "activity-lifecycle", "opportunity-list", "activity-list", "opportunity-detail", "activity-detail", "archived"];
function Harness() {
  const [screen, setScreen] = useState("opportunity"), [locale, setLocale] = useState<AoLocale>("en"), [result, setResult] = useState("success");
  const [fixtureStatus, setFixtureStatus] = useState<ActivityStatus>("completed");
  const [fixtureDate, setFixtureDate] = useState("null");
  const dateValue: PartialDate | null = fixtureDate === "null" ? null : fixtureDate === "unknown" ? { precision: "unknown" } : { precision: "year", year: 2025 };
  const editOpportunity: OpportunitySnapshot = { ...opportunity, fields: { ...opportunity.fields,
    selection_outcome: "accepted", selection_applicability: "applicable", application_deadline: dateValue,
    program_start: dateValue, program_end: dateValue, applied_at: dateValue, decision_at: dateValue } };
  const editActivity: ActivitySnapshot = { ...activity, fields: { ...activity.fields, status: fixtureStatus,
    planned_start: dateValue, planned_end: dateValue, actual_start: dateValue, actual_end: dateValue } };
  const adapter: AoAdapter = result === "unavailable" ? { available: false } : { available: true, send: async command => {
    window.aoHarness.calls.push(command);
    await new Promise(resolve => setTimeout(resolve, 80));
    if (result === "unknown") throw Error("Synthetic response loss");
    if (result === "conflict") return { outcome: "conflict" };
    if (result === "rejected") return { outcome: "rejected", reason: "validation" };
    const i = command.identity, before = i.expected_revision ?? "0";
    return { outcome: "success", receipt: { version: 1, command_id: i.command_id, subject_kind: i.subject_kind, subject_id: i.subject_id,
      operation: i.operation, revision_before: before, revision_after: String(BigInt(before) + BigInt(1)), changed: true, replay: false } };
  } };
  const props = { locale, adapter, now: () => Date.parse("2026-10-16T12:00:00Z") };
  return <main className="ao-page" style={{ maxWidth: 1120, margin: "0 auto", padding: 16 }}>
    <nav aria-label="Test harness controls" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
      <label>Screen<select id="screen" className="ui-field" value={screen} onChange={e => setScreen(e.target.value)}>{screens.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Locale<select id="locale" className="ui-field" value={locale} onChange={e => setLocale(e.target.value as AoLocale)}><option>en</option><option>vi</option></select></label>
      <label>Adapter result<select id="result" className="ui-field" value={result} onChange={e => setResult(e.target.value)}>{["success", "unknown", "conflict", "rejected", "unavailable"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Fixture status<select id="fixture-status" className="ui-field" value={fixtureStatus} onChange={e => setFixtureStatus(e.target.value as ActivityStatus)}>{ACTIVITY_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Fixture dates<select id="fixture-date" className="ui-field" value={fixtureDate} onChange={e => setFixtureDate(e.target.value)}>{["null", "unknown", "known"].map(value => <option key={value}>{value}</option>)}</select></label>
    </nav>
    <div key={`${screen}:${locale}:${result}:${fixtureStatus}:${fixtureDate}`}>
      {screen === "opportunity" && <OpportunityForm {...props}/>}
      {screen === "activity" && <ActivityForm {...props}/>}
      {screen === "edit-opportunity" && <OpportunityForm {...props} current={editOpportunity}/ >}
      {screen === "edit-activity" && <ActivityForm {...props} current={editActivity}/>}
      {screen === "opportunity-lifecycle" && <AoLifecycleForm {...props} current={{ ...opportunity, fields: { ...opportunity.fields, decision_at: dateValue } }}/>}
      {screen === "activity-lifecycle" && <AoLifecycleForm {...props} current={editActivity}/>}
      {screen === "archived" && <OpportunityForm {...props} current={{ ...opportunity, archived: true }}/>}
      {screen.endsWith("-list") && <AoRecordBrowser kind={screen === "opportunity-list" ? "opportunity" : "activity"} locale={locale}
        state={{ outcome: "ready", items: summaries, hasMore: true }} onNext={() => window.aoHarness.next++} onOpen={id => window.aoHarness.opened.push(id)}/>}
      {screen.endsWith("-detail") && <AoRecordDetail record={screen === "opportunity-detail" ? opportunity : activity} locale={locale} localZone="Asia/Ho_Chi_Minh"/>}
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);
