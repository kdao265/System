"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { UUID } from "./create-pending";
import { parseOccurrenceDetail, planArguments, validPlanReceipt, validPlanRequest, type PlanRequest, type PlanResult } from "./plan-model";

export async function readOccurrenceDetail(userId: string, occurrenceId: string) {
  const user=await requireUser();
  if(user.id!==userId || !UUID.test(occurrenceId)) return null;
  try {
    const client=await createServerSupabaseClient(true);
    const {data,error}=await client.rpc("get_quest_occurrence_detail_v1",{p_occurrence_id:occurrenceId});
    return error ? null : parseOccurrenceDetail(data,occurrenceId);
  } catch(error) { unstable_rethrow(error); return null; }
}
export async function saveOccurrencePlan(request: PlanRequest, retry = false): Promise<PlanResult> {
  const user=await requireUser();
  if(!validPlanRequest(request)) return {outcome:"rejected",reason:"invalid"};
  if(request.userId!==user.id) return {outcome:"rejected",reason:"account"};
  try {
    const client=await createServerSupabaseClient();
    const {data,error}=await client.rpc("set_quest_occurrence_plan_v1",planArguments(request));
    if(error) {
      // A failed retry cannot disprove an earlier accepted response. Keep that identity.
      if(retry) return {outcome:"unknown"};
      const known: Record<string,PlanResult["reason"]>={
        "23514:Stale occurrence plan":"stale", "23514:Quest occurrence is not plannable":"retired",
        "23514:Planned start is after deadline":"deadline", "23505:Conflicting occurrence plan command reuse":"conflict",
        "22023:Invalid occurrence plan":"invalid", "P0002:Quest subject not found":"retired",
      };
      const reason=known[`${error.code}:${error.message}`];
      return reason ? {outcome:"rejected",reason} : {outcome:"unknown"};
    }
    if(!validPlanReceipt(data,request)) return {outcome:"unknown"};
    // The accepted receipt remains success even if cache invalidation fails.
    try { for(const path of ["/calendar","/dashboard","/goals"]) revalidatePath(path); } catch { /* explicit fresh read follows */ }
    return {outcome:"success"};
  } catch(error) { unstable_rethrow(error); return {outcome:"unknown"}; }
}
