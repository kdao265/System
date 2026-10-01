import { test } from "./fixtures";
import { visualFoundationJourney } from "./visual-foundation-helpers";

test.use({ localePreference: null });
test("V2 shell fits 360, 390 and 412 px in both languages", async ({ page, context, environment }, info) => {
  await visualFoundationJourney(page, context, environment.owner, [360, 390, 412], info);
});
