import { progressPercent, type Goal } from "./model";

export const goalButton = "inline-flex min-h-11 max-w-full items-center justify-center rounded-md border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
export const goalInput = "mt-1 block min-h-11 w-full min-w-0 rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function GoalProgress({ goal }: { goal: Goal }) {
  const percent = progressPercent(goal);
  return <div className="mt-4 space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-sm text-zinc-300">{goal.completed_subquests} / {goal.total_subquests} Sub Quests</p>
      <p className="text-xl font-semibold tabular-nums text-sky-300">{percent}%</p>
    </div>
    <div role="progressbar" aria-label={`${goal.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      aria-valuetext={`${goal.completed_subquests} of ${goal.total_subquests} Sub Quests completed; ${percent}%`}
      className="h-3 overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full ${goal.is_complete ? "bg-emerald-400" : "bg-sky-400"}`} style={{ width: `${percent}%` }} />
    </div>
    <p className={`text-sm ${goal.is_complete ? "text-emerald-300" : "text-zinc-400"}`}>
      {goal.archived_at && "Archived · "}{goal.is_complete ? "Complete" : goal.archived_at ? "Incomplete" : "Active · Incomplete"}
    </p>
  </div>;
}
