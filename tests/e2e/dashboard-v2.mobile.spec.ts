import { test } from "./dashboard-v2-fixtures";
import { dashboardJourney } from "./dashboard-v2-helpers";

test.use({ localePreference: null });
test("Dashboard V2 mobile order and no overflow at 360, 390 and 412 with real data", async ({ page, environment }, info) => {
  test.setTimeout(180_000);
  await dashboardJourney(page, environment.owner, [360, 390, 412], info);
});
