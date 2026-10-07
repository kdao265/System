import { ProgressBar } from "@/components/ui/primitives";
import { progressPercent, type Goal } from "./model";

export const goalButton = "ui-button goals-button";
export const goalInput = "ui-field goals-input";

export function GoalProgress({ goal }: { goal: Goal }) {
  const percent = progressPercent(goal);
  return <div className="goals-progress mt-4 space-y-2">
    <div className="goals-progress-readout">
      <p className="text-sm text-zinc-300">{goal.completed_subquests} / {goal.total_subquests} Sub Quests</p>
      <p className="goals-progress-percent">{percent}%</p>
    </div>
    <ProgressBar value={percent} label={`${goal.title} progress`}
      valueText={`${goal.completed_subquests} of ${goal.total_subquests} Sub Quests completed; ${percent}%`}
      tone={goal.is_complete ? "success" : "main-quest"} />
    <p className={`goals-progress-state ${goal.is_complete ? "text-success" : "text-muted"}`}>
      {goal.archived_at && "Archived · "}{goal.is_complete ? "Complete" : goal.archived_at ? "Incomplete" : "Active · Incomplete"}
    </p>
  </div>;
}
