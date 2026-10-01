import { test } from "./dashboard-v2-fixtures";
import { dashboardJourney } from "./dashboard-v2-helpers";

test.use({ localePreference: null });
test("Dashboard V2 desktop uses real Goals, EXP, Quest lifecycle and Calendar in both languages", async ({ page, environment }, info) => {
  test.setTimeout(180_000);
  await dashboardJourney(page, environment.owner, [1280, 1536], info);
});
