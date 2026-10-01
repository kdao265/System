import { AppHeader } from "@/components/app-header";
import { redirect } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { ProfileError } from "@/features/profile/profile-error";
import { getGoals, getGoal, getCandidates } from "@/features/goals/data";
import { GoalDetachControl, GoalsPanel } from "@/features/goals/panel";
import { UUID } from "@/features/quests/create-pending";
import { QuestCompletionProvider, QuestReopenRead } from "@/features/quests/completion-provider";
import { QuestCompletionRecovery } from "@/features/quests/completion-recovery-ui";
import { QuestCompletionControl, QuestReopenControl } from "@/features/quests/completion-control";
import { todayInTimezone } from "@/features/quests/dates";
import { getProgressionStatus } from "@/features/progression/data";
import { canCompleteSubQuest } from "@/features/goals/quest-controls";

export const dynamic = "force-dynamic";
const uuidParam = (v: unknown) => typeof v === "string" && UUID.test(v) ? v : null;

export default async function GoalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, profile, error } = await getProfileContext();
  if (!profile) return <ProfileError missing={error === "missing"} />;
  if (!isOnboardingComplete(profile)) redirect("/onboarding");
  const params = await searchParams;
  const scope = params.scope === "archived" ? "archived" : "unarchived";
  const selected = typeof params.id === "string" ? params.id : null;
  const candidateAfter = uuidParam(params.candidateAfter);
  const [page, detail] = await Promise.all([getGoals(scope, uuidParam(params.after)), selected ? getGoal(selected) : null]);
  const [candidates, progression] = await Promise.all([
    detail && !detail.goal.archived_at ? getCandidates(candidateAfter) : null,
    detail ? getProgressionStatus() : null,
  ]);
  const today = todayInTimezone(profile.timezone!);
  return <main lang="en" className="mx-auto w-full max-w-2xl page-frame">
    <AppHeader current="goals" />
    <p className="mt-2 text-sm text-zinc-400">Group your one-off Quests. Progress follows their current completion state.</p>
    <GoalsPanel key={user.id} userId={user.id} page={page} detail={detail} selected={selected} scope={scope} candidates={candidates} candidateAfter={candidateAfter}>
      {detail && <QuestCompletionProvider userId={user.id}>
        <div className="mt-4"><QuestCompletionRecovery selectedDate={today} refreshHref={`/goals?id=${detail.goal.id}&scope=${scope}`} refreshLabel="Goals" /></div>
        <QuestReopenRead userId={user.id} result={{ status: "ok", quests: detail.subquests }} />
        <ol aria-label="Sub Quests" className="mt-4 space-y-3">
          {detail.subquests.map((sub) => <li key={sub.link_id} className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <h4 className="font-medium">{sub.title}</h4>
            <p className="mt-2 text-sm text-zinc-300">Status: {sub.status[0].toUpperCase() + sub.status.slice(1)}{sub.quest_archived_at ? " · Quest archived" : ""}</p>
            <p className="mt-1 text-sm text-zinc-400">{sub.status === "completed" ? "Completed Sub Quest" : "Incomplete Sub Quest"}</p>
            {canCompleteSubQuest(sub, progression) && <QuestCompletionControl userId={user.id} occurrenceId={sub.occurrence_id} executionCycle={sub.execution_cycle} selectedDate={today} />}
            {sub.status === "completed" && <QuestReopenControl occurrenceId={sub.occurrence_id} executionCycle={sub.execution_cycle} />}
            {!detail.goal.archived_at && <div><GoalDetachControl linkId={sub.link_id} title={sub.title} /></div>}
            {["draft", "scheduled", "active"].includes(sub.status) && !canCompleteSubQuest(sub, progression) && <p className="mt-3 text-sm text-amber-200">Completion is unavailable until the Quest reward and progression are ready. Refresh or check Dashboard.</p>}
          </li>)}
        </ol>
      </QuestCompletionProvider>}
    </GoalsPanel>
  </main>;
}
