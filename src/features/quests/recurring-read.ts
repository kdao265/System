import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseRecurringQuests, type RecurringQuest } from "./recurring-list";

/**
 * Owner-scoped recurring-definition read shared by Dashboard server components.
 * React cache deduplicates callers during the same server render.
 */
export const readRecurringQuests = cache(
  async (userId: string): Promise<RecurringQuest[] | null> => {
    try {
      const user = await requireUser();

      if (user.id !== userId) {
        throw new Error("Account changed");
      }

      const supabase = await createServerSupabaseClient(true);
      const { data, error } = await supabase.rpc("list_recurring_quests");

      if (error) return null;

      return parseRecurringQuests(data);
    } catch (error) {
      unstable_rethrow(error);
      return null;
    }
  },
);
