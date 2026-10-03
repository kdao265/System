import type { QuestManagementLifecycle } from "./management-lifecycle";

/** A newly acknowledged, non-replayed archive of the selected series only. */
export function isFreshSeriesArchive(
  state: ReturnType<QuestManagementLifecycle["getSnapshot"]>,
  questId: string,
  commandAtOpen: string | undefined,
) {
  return state.questId === questId && state.resultCommandId !== undefined &&
    state.resultCommandId !== commandAtOpen && state.result?.outcome === "success" &&
    state.result.operation === "archive" && state.result.replay === false;
}
