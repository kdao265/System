import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseRecurringQuests } from "./recurring-list";
import { RecurringQuestControls } from "./recurring-controls";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import { Panel, SectionHeader } from "@/components/ui/primitives";

export async function RecurringQuestsPanel({ userId, locale = "en", compact = false }: { userId: string; locale?: Locale; compact?: boolean }) {
  const messages = getDictionary(locale);
  const t = messages.dashboard;
  let quests = null;
  try {
    const user = await requireUser();
    if (user.id !== userId) throw new Error("Account changed");
    const supabase = await createServerSupabaseClient(true);
    const { data, error } = await supabase.rpc("list_recurring_quests");
    if (!error) quests = parseRecurringQuests(data);
  } catch (error) { unstable_rethrow(error); }
  return <Panel lang={locale} aria-label={t.recurring} className={compact ? "dashboard-recurring" : ""}>
    <SectionHeader title={t.recurring} />
    <p className="mt-2 type-metadata text-muted">{messages.recurringControl.hint}</p>
    {quests === null ? <><p role="alert" className="mt-4">{t.recurringUnavailable}</p><a href="/dashboard" className="ui-button mt-3">{messages.common.retry}</a></> : quests.length === 0 ? <p className="mt-4 text-sm text-muted">{t.recurringEmpty}</p> :
      <RecurringQuestControls key={userId} userId={userId} quests={quests} locale={locale} />}
    <a href="#create-quest" className="ui-button mt-4">+ {t.addQuest}</a>
  </Panel>;
}
