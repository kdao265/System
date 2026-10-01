import { test } from "./fixtures";
import { visualFoundationJourney } from "./visual-foundation-helpers";

test.use({ localePreference: null });
test("V2 desktop shell, bilingual SSR, persistence and hydration", async ({ page, context, environment }, info) => {
  await visualFoundationJourney(page, context, environment.owner, [1280], info);
});
