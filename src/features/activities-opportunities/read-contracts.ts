import type { ActivityCategory, ActivityStatus, OpportunityCategory, OpportunityStage, SelectionApplicability, SelectionOutcome, SubjectKind } from "./model";
import type { AoSnapshot } from "./application";

// Application read projections, not new database DTOs. The future adapter must
// validate owner-scoped transport data before returning these. No adapter is
// installed on real routes by L2-01 (notably, the current wire list DTO omits
// applicability and cannot yet produce this Opportunity summary by itself).
type SummaryBase = { id: string; title: string; organization: string | null; archived: boolean };
export type AoSummary = SummaryBase & (
  | { kind: "opportunity"; category: OpportunityCategory | null; trackingStage: OpportunityStage;
      selectionOutcome: SelectionOutcome; applicability: SelectionApplicability }
  | { kind: "activity"; category: ActivityCategory | null; participationStatus: ActivityStatus }
);
export type AoQuery = { search: string; scope: "active" | "archived"; category: string; status: string; outcome: string };
export const initialAoQuery: AoQuery = { search: "", scope: "active", category: "", status: "", outcome: "" };
export type ReadResult<T> = { outcome: "ready"; value: T } | { outcome: "unavailable" | "error" | "not_found" };
export type AoCursor = { created_at: string; id: string };
export interface AoReadPort {
  list(kind: SubjectKind, query: AoQuery, cursor: AoCursor | null): Promise<ReadResult<{ items: AoSummary[]; nextCursor: AoCursor | null }>>;
  detail(kind: SubjectKind, id: string): Promise<ReadResult<AoSnapshot>>;
}
// Local loaded-page filtering only; no inference that these are all owner records.
export function filterSummaries(items: readonly AoSummary[], kind: SubjectKind, query: AoQuery): AoSummary[] {
  const search = query.search.trim().toLocaleLowerCase();
  return items.filter(item => item.kind === kind && item.archived === (query.scope === "archived") &&
    (!query.category || item.category === query.category) &&
    (!query.status || (item.kind === "opportunity" ? item.trackingStage : item.participationStatus) === query.status) &&
    (!query.outcome || item.kind === "opportunity" && item.selectionOutcome === query.outcome) &&
    (!search || `${item.title}\n${item.organization ?? ""}`.toLocaleLowerCase().includes(search)));
}
