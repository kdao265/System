"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { goalCommand, goalError, unknownOutcome, validReceipt, validRequest, type GoalRequest, type GoalResult } from "./model";

export async function mutateGoal(input: GoalRequest): Promise<GoalResult> {
  const { user, profile } = await getProfileContext();
  if (!validRequest(input) || input.userId !== user.id || !isOnboardingComplete(profile)) {
    return { outcome: "rejected", message: "Your account, Profile or request changed. Refresh before continuing." };
  }
  try {
    const client = await createServerSupabaseClient();
    const { name, args } = goalCommand(input);
    const { data, error } = await client.rpc(name, args);
    if (error) return goalError(error);
    if (!validReceipt(data, input)) return unknownOutcome;
  } catch (error) { unstable_rethrow(error); return unknownOutcome; }
  // A cache refresh failure cannot turn an acknowledged mutation into a failed command.
  try { revalidatePath("/goals"); } catch {
    return { outcome: "success", message: "Change confirmed. Refresh Goals to read current progress." };
  }
  return { outcome: "success", message: "Change confirmed. Current progress comes from a fresh read." };
}
