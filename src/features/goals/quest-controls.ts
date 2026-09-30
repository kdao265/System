import type { ProgressionResult } from "@/features/progression/data";
import type { SubQuest } from "./model";

/** Advisory affordance only; the existing Quest command owns all completion rules. */
export function canCompleteSubQuest(quest: SubQuest, progression: ProgressionResult | null) {
  return progression?.status === "ok" && progression.exp.state === "available" &&
    quest.reward_exp_snapshot !== null && ["draft", "scheduled", "active"].includes(quest.status);
}
