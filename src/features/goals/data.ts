import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { UUID } from "@/features/quests/create-pending";
import { eligibleCandidate, parseGoalDetail, parseGoalPage, type Candidate } from "./model";

export async function getGoals(scope: "unarchived" | "archived", after: string | null) {
  await requireUser();
  try {
    const client = await createServerSupabaseClient(true);
    const { data, error } = await client.rpc("list_goals_v1", { p_scope: scope, p_after_id: after, p_limit: 50 });
    return error ? null : parseGoalPage(data);
  } catch (error) { unstable_rethrow(error); return null; }
}
export async function getGoal(id: string) {
  await requireUser();
  if (!UUID.test(id)) return null;
  try {
    const client = await createServerSupabaseClient(true);
    const { data, error } = await client.rpc("get_goal_v1", { p_goal_id: id });
    const detail = error ? null : parseGoalDetail(data);
    return detail?.goal.id === id ? detail : null;
  } catch (error) { unstable_rethrow(error); return null; }
}

export type CandidatePage = { candidates: Candidate[]; next: string | null };
export async function getCandidates(after: string | null): Promise<CandidatePage | null> {
  await requireUser();
  try {
    const client = await createServerSupabaseClient(true);
    // Existing RLS-bound reads only. Embedded current links include archived Goals.
    let query = client.from("quests").select(`id,title,recurrence_mode,archived_at,direct_goal_id,project_id,
      rules:quest_recurrence_rules!fk_rule_quest_owner(id),
      links:goal_quest_links!fk_goal_link_quest_owner(detached_at),
      occurrences:quest_occurrences!fk_occurrence_quest_owner(recurrence_rule_id,recurrence_revision,source_slot_date,source_timezone,direct_goal_id_snapshot,project_id_snapshot)`)
      .eq("recurrence_mode", "one_off").is("archived_at", null).is("direct_goal_id", null).is("project_id", null)
      .is("links.detached_at", null).order("id").limit(100);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return null;
    return { candidates: data.filter(eligibleCandidate).map(({ id, title }) => ({ id, title })),
      next: data.length === 100 ? data[data.length - 1].id : null };
  } catch (error) { unstable_rethrow(error); return null; }
}
