import { getGoal, getGoals } from "@/features/goals/data";
import type { GoalDetail } from "@/features/goals/model";

export type MainQuestResult =
  | { status: "ok"; detail: GoalDetail }
  | { status: "empty" | "unavailable" };

/** Stable UUID order comes from the existing paginated read. Never persist a preference. */
export async function getDashboardMainQuest(): Promise<MainQuestResult> {
  let after: string | null = null;
  do {
    const page = await getGoals("unarchived", after);
    if (!page) return { status: "unavailable" };
    const selected = page.goals.find((goal) => goal.display_state === "active");
    if (selected) {
      const detail = await getGoal(selected.id);
      // A concurrent archive/completion can change the second read. Do not render
      // a stale list projection as though it were the current active Goal.
      if (!detail || detail.goal.display_state !== "active") return { status: "unavailable" };
      return { status: "ok", detail };
    }
    after = page.next_after_id;
  } while (after);
  return { status: "empty" };
}
