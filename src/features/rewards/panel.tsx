import { getRewards } from "./data";
import { RewardsPreview } from "./components";

export async function RewardsPanel() {
  return <RewardsPreview result={await getRewards()} />;
}
