import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseRecurringQuests } from "./recurring-list";
import { RecurringQuestControls } from "./recurring-controls";

export async function RecurringQuestsPanel({ userId }: { userId: string }) {
  let quests = null;
  try {
    const user = await requireUser();
    if (user.id !== userId) throw new Error("Account changed");
    const supabase = await createServerSupabaseClient(true);
    const { data, error } = await supabase.rpc("list_recurring_quests");
    if (!error) quests = parseRecurringQuests(data);
  } catch (error) { unstable_rethrow(error); }
  return <section aria-label="Recurring Quests" className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 [overflow-wrap:anywhere] sm:p-6">
    <h2 className="text-xs font-medium tracking-[0.3em] text-zinc-400">RECURRING QUESTS</h2>
    <p className="mt-2 text-sm text-zinc-400">Pause stops new occurrences. Existing occurrences and EXP history stay unchanged.</p>
    {quests === null ? <><p role="alert" className="mt-4">Recurring Quests could not be loaded safely.</p><a href="/dashboard" className="mt-3 inline-block underline">Reload recurring Quests</a></> : quests.length === 0 ? <p className="mt-4 text-sm text-zinc-400">No recurring Quests yet.</p> :
      <RecurringQuestControls key={userId} userId={userId} quests={quests} />}
  </section>;
}
