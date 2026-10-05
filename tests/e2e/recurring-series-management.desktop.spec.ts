import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./quest-fixtures";
import { completeQuest, expectExp, expectQuestHistory, questRow, readExp, rewardExp } from "./quest-helpers";
import { createRecurring, recurringRow, retire, createRecurringWithoutOccurrences, openSeriesFromDefinition } from "./recurring-retirement-helpers";

// Recurring Series Management UI V1: the occurrence card exposes only an entry
// point; every series-level action lives behind the shared dialog or the
// existing archived panel. Active cards never offer permanent delete.
const occurrenceCard = (page: Page, title: string) => page.getByRole("list", { name: "Quest occurrences", exact: true })
  .getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const summaryOf = (page: Page, title: string) => occurrenceCard(page, title).locator(`summary[aria-label="Manage series: ${title}"]`);
const openSeries = async (page: Page, title: string) => {
  const action = occurrenceCard(page, title).getByRole("button", { name: "Manage series", exact: true });
  // A background refresh may reset the native disclosure between the two clicks.
  for (let attempt = 0; attempt < 4 && !(await action.isVisible()); attempt += 1) await summaryOf(page, title).click();
  await expect(action).toBeVisible();
  await action.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName("Series management");
  return dialog;
};

test("daily recurring occurrence exposes Manage series; the dialog never offers permanent delete", async ({ page }) => {
  const { title } = await createRecurring(page);
  await expect(questRow(page, title)).toContainText("Recurring occurrence");
  await expect(summaryOf(page, title)).toHaveCount(1);
  await expect(page.locator(`summary[aria-label="Quest actions: ${title}"]`)).toHaveCount(0);

  const dialog = await openSeries(page, title);
  await expect(dialog.getByText("This affects the entire recurring series.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Pause series", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Archive series", exact: true })).toBeVisible();
  await expect(dialog.getByText("Delete permanently", { exact: true })).toHaveCount(0);
  await expect(dialog.locator("summary")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Close series management", exact: true })).toBeVisible();

  // Escape closes and restores focus to the original `...` trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(summaryOf(page, title)).toBeFocused();
  await expect(occurrenceCard(page, title).locator("details")).not.toHaveAttribute("open", "");
  // Closing via the Close button behaves the same.
  const reopened = await openSeries(page, title);
  await reopened.getByRole("button", { name: "Close series management", exact: true }).click();
  await expect(reopened).toHaveCount(0);
  await expect(summaryOf(page, title)).toBeFocused();
  await expect(occurrenceCard(page, title).locator("details")).not.toHaveAttribute("open", "");
});

// Recurring Schedule Defaults V1 in the Manage series dialog: set, reorder and
// clear the default pair through the certified command, with a stale revision
// surfaced instead of silently overwritten.
const scheduleSection = (dialog: Locator) => dialog.locator("> div").filter({ hasText: /^Schedule defaults/ }).last();

test("Manage series sets, reorders and clears schedule defaults through the certified command", async ({ page, environment }) => {
  const { title } = await createRecurring(page);
  const dialog = await openSeries(page, title);
  const section = scheduleSection(dialog);
  await expect(section.getByText("No schedule defaults", { exact: true })).toBeVisible();

  await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
  await section.getByLabel("Default start", { exact: true }).fill("08:00");
  await section.getByLabel("Default end", { exact: true }).fill("09:30");
  await expect(section.getByText("A same-day end must be later than the start.", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Save schedule", exact: true }).click();
  // The command bumps the rule revision; the refreshed detail shows the new pair.
  await expect(section.getByText("08:00", { exact: true })).toBeVisible();
  await expect(section.getByText("09:30", { exact: true })).toBeVisible();

  // A next-day flag requires an end at or before the start; anything else is refused.
  await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
  await section.getByLabel("Ends the next day", { exact: true }).check();
  await expect(section.getByText("An end at or before the start continues past midnight", { exact: false })).toBeVisible();
  await section.getByRole("button", { name: "Save schedule", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("at or before start when ending the next day");
  await section.getByLabel("Default end", { exact: true }).fill("07:00");
  await section.getByRole("button", { name: "Save schedule", exact: true }).click();
  await expect(section.getByText("07:00 (Ends the next day)", { exact: true })).toBeVisible();

  await section.getByRole("button", { name: "Clear schedule defaults", exact: true }).click();
  await expect(section.getByText("No schedule defaults", { exact: true })).toBeVisible();
  // Three commands append three events to this series' own recurrence history.
  expect(await environment.sql(`SELECT count(*) FROM public.quest_events e JOIN public.quests q ON q.id=e.quest_id WHERE q.title='${title}' AND e.event_type='recurrence_changed';`)).toBe("4");
  expect(await environment.sql(`SELECT count(*) FROM public.quest_recurrence_rules r JOIN public.quests q ON q.id=r.quest_id WHERE q.title='${title}' AND r.local_start_time IS NULL;`)).toBe("1");
  await page.keyboard.press("Escape");
});

test("a lost schedule response is retried exactly and never duplicated", async ({ page, environment }) => {
  const { title } = await createRecurring(page, { start: "08:00", end: "09:30" });
  const dialog = await openSeries(page, title);
  const section = scheduleSection(dialog);
  await expect(section.getByText("08:00", { exact: true })).toBeVisible();

  // The command commits on the server; only its own response is lost.
  await page.route("**/*", async (route) => {
    if (!route.request().postData()?.includes("expectedRevision")) return route.fallback();
    await route.fetch();
    await route.abort("failed");
  });
  await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
  await section.getByLabel("Default end", { exact: true }).fill("10:00");
  await section.getByRole("button", { name: "Save schedule", exact: true }).click();
  // The command commits server-side before its response is lost, so the authoritative
  // detail has already moved past this dirty draft: both the transport error and the
  // resulting draft conflict are legitimately present.
  await expect(dialog.getByRole("alert").filter({ hasText: "Connection lost" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Retry saved request", exact: true })).toBeVisible();
  await expect(section.getByText("A saved schedule request must be resolved", { exact: false })).toBeVisible();

  const saved = await page.evaluate(() => Object.entries(localStorage)
    .find(([key]) => key.startsWith("system.quest-schedule.pending.v1:")));
  expect(saved).toBeDefined();
  const operation = JSON.parse(saved![1]);
  expect(operation.defaults).toEqual({ local_start_time: "08:00", local_end_time: "10:00", planned_end_day_offset: 0 });
  // A second edit stays blocked until the saved command is resolved.
  await expect(section.getByRole("button", { name: "Edit schedule", exact: true })).toHaveCount(0);

  await page.unrouteAll({ behavior: "wait" });
  const retry = page.waitForRequest((request) => !!request.headers()["next-action"]
    && !!request.postData()?.includes(JSON.stringify(operation.commandId)));
  await section.getByRole("button", { name: "Retry saved request", exact: true }).click();
  await retry;
  await expect(section.getByText("10:00", { exact: true })).toBeVisible();
  expect(saved![1]).toBeDefined();
  // One command, one event: the retry is a replay, never a second change.
  expect(await environment.sql(`SELECT count(*) FROM public.quest_events WHERE command_id='${operation.commandId}';`)).toBe("1");
  expect(await page.evaluate(() => Object.entries(localStorage)
    .some(([key]) => key.startsWith("system.quest-schedule.pending.v1:")))).toBe(false);
  await page.keyboard.press("Escape");
});

test("another tab's schedule change refreshes this dialog before it can submit its own command", async ({ page, context }) => {
  const { title } = await createRecurring(page, { start: "08:00", end: "09:30" });
  const dialog = await openSeries(page, title);
  const section = scheduleSection(dialog);
  await expect(section.getByText("09:30", { exact: true })).toBeVisible();
  const other = await context.newPage();
  try {
    await other.goto(page.url());
    const otherSection = scheduleSection((await openSeries(other, title)));
    await otherSection.getByRole("button", { name: "Edit schedule", exact: true }).click();
    await otherSection.getByLabel("Default end", { exact: true }).fill("11:00");
    await otherSection.getByRole("button", { name: "Save schedule", exact: true }).click();
    await expect(otherSection.getByText("11:00", { exact: true })).toBeVisible();
    // A storage event must refresh this open dialog without a local submission.
    await expect(section.getByText("11:00", { exact: true })).toBeVisible();
    // It therefore submits against the refreshed revision, not a stale one.
    await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
    await section.getByLabel("Default end", { exact: true }).fill("12:00");
    await section.getByRole("button", { name: "Save schedule", exact: true }).click();
    await expect(section.getByText("12:00", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => Object.entries(localStorage)
      .some(([key]) => key.startsWith("system.quest-schedule.pending.v1:")))).toBe(false);
  } finally { await other.close(); }
  await page.keyboard.press("Escape");
});

// RELEASE BLOCKER 1: a DIRTY revision-1 draft must not overwrite revision 2.
// The draft owns its base revision, so an external edit turns Save into a
// conflict with an explicit reload, never a silent overwrite.
const ruleTimes = (environment: { sql: (query: string) => Promise<string> }, title: string) =>
  environment.sql(`SELECT coalesce(to_char(local_start_time,'HH24:MI')||'|'||to_char(local_end_time,'HH24:MI'),'untimed') FROM public.quest_recurrence_rules r JOIN public.quests q ON q.id=r.quest_id WHERE q.title='${title}';`);
const ruleRevision = (environment: { sql: (query: string) => Promise<string> }, title: string) =>
  environment.sql(`SELECT revision FROM public.quest_recurrence_rules r JOIN public.quests q ON q.id=r.quest_id WHERE q.title='${title}';`);
const pendingSchedule = (page: Page) => page.evaluate(() => Object.entries(localStorage)
  .some(([key]) => key.startsWith("system.quest-schedule.pending.v1:")));

test("a dirty draft cannot overwrite newer defaults and requires an explicit reload", async ({ page, context, environment }) => {
  const { title } = await createRecurring(page, { start: "08:00", end: "09:30" });
  const dialog = await openSeries(page, title);
  const section = scheduleSection(dialog);
  await expect(section.getByText("08:00", { exact: true })).toBeVisible();

  // Open a revision-1 draft and modify local values.
  await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
  await section.getByLabel("Default start", { exact: true }).fill("07:00");
  await section.getByLabel("Default end", { exact: true }).fill("07:45");

  const other = await context.newPage();
  try {
    // An external edit advances the series to revision 2.
    await other.goto(page.url());
    const otherSection = scheduleSection((await openSeries(other, title)));
    await otherSection.getByRole("button", { name: "Edit schedule", exact: true }).click();
    await otherSection.getByLabel("Default start", { exact: true }).fill("14:00");
    await otherSection.getByLabel("Default end", { exact: true }).fill("15:00");
    await otherSection.getByRole("button", { name: "Save schedule", exact: true }).click();
    await expect(otherSection.getByText("14:00", { exact: true })).toBeVisible();
    expect(await ruleRevision(environment, title)).toBe("2");

    // The manager receives the refreshed authoritative detail (revision 2) and conflicts.
    await expect(dialog.getByText("This series changed elsewhere. Reload the latest defaults before saving.", { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Save schedule", exact: true })).toBeDisabled();
    // Local draft values are preserved; nothing was silently merged or rebased.
    await expect(section.getByLabel("Default start", { exact: true })).toHaveValue("07:00");
    await expect(section.getByLabel("Default end", { exact: true })).toHaveValue("07:45");
    // Revision 2's defaults are untouched by the stale draft.
    expect(await ruleTimes(environment, title)).toBe("14:00|15:00");

    // Explicit reload replaces local values with authoritative ones and re-enables Save.
    await section.getByRole("button", { name: "Reload latest", exact: true }).click();
    await expect(section.getByLabel("Default start", { exact: true })).toHaveValue("14:00");
    await expect(section.getByLabel("Default end", { exact: true })).toHaveValue("15:00");
    await expect(dialog.getByText("This series changed elsewhere.", { exact: false })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Save schedule", exact: true })).toBeEnabled();

    // The reconciled draft now submits correctly against revision 2.
    await section.getByLabel("Default end", { exact: true }).fill("15:30");
    await section.getByRole("button", { name: "Save schedule", exact: true }).click();
    await expect(section.getByText("15:30", { exact: true })).toBeVisible();
    expect(await ruleTimes(environment, title)).toBe("14:00|15:30");
    expect(await pendingSchedule(page)).toBe(false);
  } finally { await other.close(); }
  await page.keyboard.press("Escape");
});

// RELEASE BLOCKER 1 (race): a submit that races the last local check is rejected by the
// backend as stale. The same conflict must surface, with no automatic retry.
test("a stale rejection surfaces the conflict and never retries with the newer revision", async ({ page, context, environment }) => {
  const { title } = await createRecurring(page, { start: "08:00", end: "09:30" });
  // Simulate the race window deterministically: this tab has already passed its
  // local check and has not yet learned about the other edit, so its authoritative
  // detail stays at revision 1 while the series actually advances to revision 2.
  // Dropping the cross-tab/focus recovery listeners for THIS page only is exactly
  // that window; no application code path is stubbed or replaced.
  await page.addInitScript(() => {
    const native = window.addEventListener.bind(window);
    window.addEventListener = function patched(
      type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "storage" || type === "focus") return;
      native(type, listener, options);
    };
  });
  await page.reload();

  const dialog = await openSeries(page, title);
  const section = scheduleSection(dialog);
  // Read the authoritative revision the manager itself loaded.
  const before = await ruleRevision(environment, title);
  await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
  await section.getByLabel("Default end", { exact: true }).fill("10:00");

  const other = await context.newPage();
  try {
    // Another tab advances the series while this tab is stale.
    await other.goto(page.url());
    const otherSection = scheduleSection((await openSeries(other, title)));
    await otherSection.getByRole("button", { name: "Edit schedule", exact: true }).click();
    await otherSection.getByLabel("Default start", { exact: true }).fill("14:00");
    await otherSection.getByLabel("Default end", { exact: true }).fill("15:00");
    await otherSection.getByRole("button", { name: "Save schedule", exact: true }).click();
    await expect(otherSection.getByText("14:00", { exact: true })).toBeVisible();
    expect(await ruleRevision(environment, title)).toBe(String(Number(before) + 1));
    const changes = await environment.sql(`SELECT count(*) FROM public.quest_events e JOIN public.quests q ON q.id=e.quest_id WHERE q.title='${title}' AND e.event_type='recurrence_changed';`);

    // The stale submit sends the OLD expected revision and the backend rejects it.
    await section.getByRole("button", { name: "Save schedule", exact: true }).click();
    await expect(dialog.getByText("This series changed elsewhere. Reload the latest defaults before saving.", { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Save schedule", exact: true })).toBeDisabled();
    await expect(section.getByLabel("Default end", { exact: true })).toHaveValue("10:00");

    // No automatic retry: the local stale submit added no further committed change.
    expect(await environment.sql(`SELECT count(*) FROM public.quest_events e JOIN public.quests q ON q.id=e.quest_id WHERE q.title='${title}' AND e.event_type='recurrence_changed';`)).toBe(changes);
    // The rejected command was discarded; nothing uncertain remains for replay.
    expect(await pendingSchedule(page)).toBe(false);
    // Revision advanced by the external edit kept its values; the stale draft never overwrote them.
    expect(await ruleTimes(environment, title)).toBe("14:00|15:00");
  } finally {
    await other.close();
  }
  await page.keyboard.press("Escape");
});

// RELEASE BLOCKER 3: a recurring definition with ZERO materialized occurrences still
// opens the SAME shared Quest-ID manager and can set and clear schedule defaults.
test("a zero-occurrence recurring definition opens the shared manager and edits defaults", async ({ page, environment }) => {
  const { title } = await createRecurringWithoutOccurrences(page);
  const dialog = await openSeriesFromDefinition(page, title);
  const section = scheduleSection(dialog);
  await expect(section.getByText("No schedule defaults", { exact: true })).toBeVisible();

  // Authoritative detail is readable and defaults can be set with no occurrence card.
  await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
  await section.getByLabel("Default start", { exact: true }).fill("06:30");
  await section.getByLabel("Default end", { exact: true }).fill("07:15");
  await section.getByRole("button", { name: "Save schedule", exact: true }).click();
  await expect(section.getByText("06:30", { exact: true })).toBeVisible();
  expect(await ruleTimes(environment, title)).toBe("06:30|07:15");

  // And cleared again, still without any materialized occurrence.
  await section.getByRole("button", { name: "Clear schedule defaults", exact: true }).click();
  await expect(section.getByText("No schedule defaults", { exact: true })).toBeVisible();
  expect(await environment.sql(`SELECT count(*) FROM public.quest_occurrences o JOIN public.quests q ON q.id=o.quest_id WHERE q.title='${title}';`)).toBe("0");
  expect(await ruleTimes(environment, title)).toBe("untimed");

  // The active modal still never offers permanent delete.
  await expect(dialog.getByText("Delete permanently", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// RELEASE BLOCKER 2: materialization warnings are independent of occurrence-list
// emptiness. A day with ZERO occurrences and one skipped slot shows the warning,
// its reason text and a Manage series entry, alongside the normal empty-day text.
test("an empty day still surfaces materialization warnings with a Manage series entry", async ({ page, environment }) => {
  // A DST gap day in a DST zone: 02:30 does not exist, so the backend skips the slot
  // and reports a nonfatal issue instead of materializing an occurrence. The day must
  // be on/after today, because generation deliberately ignores earlier days.
  const gapDay = "2027-03-14";
  const original = await environment.sql(`SELECT timezone FROM public.profiles WHERE user_id='${environment.owner.id}';`);
  await environment.sql(`UPDATE public.profiles SET timezone='America/New_York' WHERE user_id='${environment.owner.id}';`);
  try {
    // Reload so the server-rendered creation form and read use the new Profile zone.
    await page.reload();
    const title = `Unmaterialized ${randomUUID()}`;
    const form = page.getByRole("region", { name: "Create Quest", exact: true });
    await form.getByLabel("Quest type", { exact: true }).selectOption("daily");
    await form.getByLabel("Title", { exact: true }).fill(title);
    await form.getByLabel("Default start time", { exact: true }).fill("02:30");
    await form.getByLabel("Default end time", { exact: true }).fill("03:30");
    await form.getByLabel("Start date", { exact: true }).fill(gapDay);
    await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
    const definitions = page.getByRole("list", { name: "Recurring definitions", exact: true });
    const mine = definitions.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(mine).toBeVisible();

    // Archive every other active definition through the product's own control so this
    // day has no other materializable series. Generation skips stopped series.
    const others = await definitions.getByRole("listitem").evaluateAll(
      (rows) => rows.map((row) => row.querySelector("h3")?.textContent ?? ""));
    for (const name of others.filter((name) => name && name !== title)) {
      await retire(page, name, "archive");
      await expect(recurringRow(page, name)).toHaveCount(0);
    }

    await page.getByLabel("Choose date", { exact: true }).fill(gapDay);
    await page.getByRole("button", { name: "View", exact: true }).click();

    const panel = page.getByRole("region", { name: "Daily Quests", exact: true });
    // The warning renders even though the day produced zero occurrences.
    await expect(panel.getByText("Recurring timing notices", { exact: true })).toBeVisible();
    await expect(panel.getByText("A default time does not exist that day (clocks moved forward).", { exact: false })).toBeVisible();
    // It is valid to show BOTH the warning and the normal empty-day state.
    await expect(panel.getByText("No Quests for this day", { exact: false })).toBeVisible();
    await expect(panel.getByRole("list", { name: "Quest occurrences", exact: true })).toHaveCount(0);
    expect(await environment.sql(`SELECT count(*) FROM public.quest_occurrences o JOIN public.quests q ON q.id=o.quest_id WHERE q.title='${title}';`)).toBe("0");
    // Nonfatal: no retry and no unavailable surface.
    await expect(panel.getByRole("button", { name: "Retry Daily Quests" })).toHaveCount(0);

    // The notice itself offers Manage series for the failing series.
    await panel.getByRole("button", { name: "Manage series", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Edit schedule", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");

    // An unrelated normal day is completely unchanged.
    await page.getByLabel("Choose date", { exact: true }).fill("2027-03-13");
    await page.getByRole("button", { name: "View", exact: true }).click();
    const normal = page.getByRole("region", { name: "Daily Quests", exact: true });
    await expect(normal.getByText("Recurring timing notices", { exact: true })).toHaveCount(0);
  } finally {
    await environment.sql(`UPDATE public.profiles SET timezone='${original}' WHERE user_id='${environment.owner.id}';`);
  }
});
// Hold only the command response: the real disposable backend still commits.
// Subsequent detail requests are allowed through after the action queue resumes.
async function delayNextAction(page: Page) {
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const committed = new Promise<void>((resolve) => { reached = resolve; });
  let used = false;
  await page.route("**/*", async (route) => {
    if (used || !route.request().headers()["next-action"]) return route.fallback();
    used = true;
    const response = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response });
  });
  return { committed, release };
}

test("row-originated delayed Pause refreshes the open modal before it can submit Resume", async ({ page }) => {
  const { title } = await createRecurring(page);
  await expect(recurringRow(page, title).getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  const delayed = await delayNextAction(page);
  try {
    await recurringRow(page, title).getByRole("button", { name: "Pause", exact: true }).click();
    await delayed.committed;
    const dialog = await openSeries(page, title);
    await expect(dialog.getByRole("button", { name: /^(Pause|Resume) series$/ }).and(page.locator(":enabled"))).toHaveCount(0);
    delayed.release();
    await expect(dialog.getByText("Paused", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Resume series", exact: true })).toBeEnabled();
    const resume = page.waitForRequest((request) => !!request.headers()["next-action"] && !!request.postData()?.includes('"paused":false'));
    await dialog.getByRole("button", { name: "Resume series", exact: true }).click();
    await resume;
    await expect(dialog.getByText("Running", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    delayed.release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("another tab's pause and focus reconciliation refresh authoritative modal detail", async ({ page, context }) => {
  const { title } = await createRecurring(page);
  const other = await context.newPage();
  try {
    await other.goto(page.url());
    const dialog = await openSeries(page, title);
    await expect(dialog.getByText("Running", { exact: true })).toBeVisible();
    await recurringRow(other, title).getByRole("button", { name: "Pause", exact: true }).click();
    await expect(recurringRow(other, title)).toContainText("Paused");
    // A storage event must refresh this open modal without a local submission.
    await expect(dialog.getByText("Paused", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Resume series", exact: true })).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(dialog.getByRole("button", { name: "Resume series", exact: true })).toBeEnabled();
    const resume = page.waitForRequest((request) => !!request.headers()["next-action"] && !!request.postData()?.includes('"paused":false'));
    await dialog.getByRole("button", { name: "Resume series", exact: true }).click();
    await resume;
    await expect(dialog.getByText("Running", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally { await other.close(); }
});

test("closing during a delayed archive keeps focus on a surviving target after refresh", async ({ page }) => {
  const { title } = await createRecurring(page);
  const dialog = await openSeries(page, title);
  await expect(dialog.getByRole("button", { name: "Archive series", exact: true })).toBeEnabled();
  const delayed = await delayNextAction(page);
  try {
    await dialog.getByRole("button", { name: "Archive series", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm archive", exact: true }).click();
    await delayed.committed;
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#archived-recurring-quests")).toBeFocused();
    delayed.release();
    await expect(occurrenceCard(page, title)).toHaveCount(0);
    await expect(recurringRow(page, title, true)).toBeVisible();
    await expect(page.locator("#archived-recurring-quests")).toBeFocused();
  } finally {
    delayed.release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("weekly and monthly series report their cadence and rule details", async ({ page }) => {
  await page.getByRole("link", { name: "View today", exact: true }).click();
  const day = await page.getByLabel("Choose date", { exact: true }).inputValue();
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${day}T12:00:00Z`).getUTCDay()];
  const form = page.getByRole("region", { name: "Create Quest", exact: true });

  const weekly = `Series weekly ${randomUUID()}`;
  await form.getByLabel("Quest type", { exact: true }).selectOption("weekly");
  await form.getByLabel("Title", { exact: true }).fill(weekly);
  await form.getByLabel("Start date", { exact: true }).fill(day);
  await form.getByRole("checkbox", { name: weekday, exact: true }).check();
  await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
  await expect(recurringRow(page, weekly)).toBeVisible();
  await expect(questRow(page, weekly)).toHaveCount(1);
  const weeklyDialog = await openSeries(page, weekly);
  await expect(weeklyDialog.getByText("Weekly", { exact: true })).toBeVisible();
  await expect(weeklyDialog.getByText(new RegExp(`^${weekday.slice(0, 3)}`))).toBeVisible();
  await expect(weeklyDialog.getByText("This affects the entire recurring series.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const monthly = `Series monthly ${randomUUID()}`;
  await form.getByLabel("Quest type", { exact: true }).selectOption("monthly");
  await form.getByLabel("Title", { exact: true }).fill(monthly);
  await form.getByLabel("Start date", { exact: true }).fill(day);
  await form.getByLabel("Day of month", { exact: true }).fill(String(new Date(`${day}T12:00:00Z`).getUTCDate()));
  await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
  await expect(recurringRow(page, monthly)).toBeVisible();
  await expect(questRow(page, monthly)).toHaveCount(1);
  const monthlyDialog = await openSeries(page, monthly);
  await expect(monthlyDialog.getByText("Monthly", { exact: true })).toBeVisible();
  await expect(monthlyDialog.getByText("Day of month", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});
test("Pause from the dialog keeps the materialized occurrence; Resume restores Running", async ({ page }) => {
  const { title } = await createRecurring(page);
  const dialog = await openSeries(page, title);
  await dialog.getByRole("button", { name: "Pause series", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Resume series", exact: true })).toBeVisible();
  await expect(dialog.getByText("Paused", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // The already-materialized occurrence stays visible and independently actionable.
  const occurrence = questRow(page, title);
  await expect(occurrence).toHaveCount(1);
  await expect(occurrence.getByRole("button", { name: "Complete", exact: true })).toBeEnabled();
  await expect(recurringRow(page, title)).toContainText("Paused");
  // A single pause namespace entry exists and it is removed after acceptance.
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("system.quest-recurrence.pending.v1:")))).toHaveLength(0);

  const reopened = await openSeries(page, title);
  await reopened.getByRole("button", { name: "Resume series", exact: true }).click();
  await expect(reopened.getByRole("button", { name: "Pause series", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(recurringRow(page, title)).toContainText("Active");
  await expect(questRow(page, title)).toHaveCount(1);
});

test("Archive from the dialog closes it, hides the occurrence and focuses the archived panel", async ({ page, environment }) => {
  const { title } = await createRecurring(page);
  const before = await readExp(page);
  await completeQuest(page, title);
  await expectExp(page, before + BigInt(rewardExp));
  await expectQuestHistory(environment, title, 1, 0);

  const dialog = await openSeries(page, title);
  await dialog.getByRole("button", { name: "Archive series", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm archive", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Active surfaces hide the series and its occurrence; the archived panel gains it.
  await expect(questRow(page, title)).toHaveCount(0);
  await expect(recurringRow(page, title)).toHaveCount(0);
  await expect(recurringRow(page, title, true)).toBeVisible();
  // Focus moved to the stable archived-series target, not to a removed trigger.
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toBe("archived-recurring-quests");
  await expectExp(page, before + BigInt(rewardExp));
  await expectQuestHistory(environment, title, 1, 0);

  // Restore from the existing archived panel returns the series in Running state.
  await retire(page, title, "restore");
  await expect(recurringRow(page, title)).toBeVisible();
  await expect(recurringRow(page, title)).toContainText("Active");
  await expect(questRow(page, title)).toHaveCount(1);
  await expectExp(page, before + BigInt(rewardExp));
});
test("permanent delete exists only after archive, confirms the whole series and never offers Restore", async ({ page, environment }) => {
  const { title } = await createRecurring(page);
  const before = await readExp(page);
  await completeQuest(page, title);
  await expectExp(page, before + BigInt(rewardExp));

  // Absent on the active card and inside the active dialog.
  await expect(questRow(page, title).getByText("Delete permanently", { exact: true })).toHaveCount(0);
  const dialog = await openSeries(page, title);
  await expect(dialog.getByText("Delete permanently", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await retire(page, title, "archive");
  await expect(questRow(page, title)).toHaveCount(0);
  await expect(recurringRow(page, title, true).getByRole("button", { name: "Delete permanently", exact: true })).toBeEnabled();
  await retire(page, title, "delete");
  await expect(recurringRow(page, title, true)).toHaveCount(0);
  await page.reload();

  // The deleted series leaves no restore path of its own; unrelated archived
  // series owned by the same account (other fixtures) are untouched.
  const archivedPanel = page.getByRole("region", { name: "Archived Recurring Quests", exact: true });
  await expect(archivedPanel).toBeVisible();
  await expect(archivedPanel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) })).toHaveCount(0);
  await expect(questRow(page, title)).toHaveCount(0);
  await expect(recurringRow(page, title)).toHaveCount(0);
  await expect(recurringRow(page, title, true)).toHaveCount(0);
  await expectExp(page, before + BigInt(rewardExp));
  await expectQuestHistory(environment, title, 1, 0);
});

test("a lost archive response from the dialog recovers with the exact saved command", async ({ page, environment }) => {
  const { title } = await createRecurring(page);
  // Load the series detail first so the intercept only affects the archive command.
  const dialog = await openSeries(page, title);
  await expect(dialog.getByRole("button", { name: "Archive series", exact: true })).toBeVisible();
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    await route.fetch();
    await route.abort("failed");
  });
  await dialog.getByRole("button", { name: "Archive series", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm archive", exact: true }).click();
  await expect(dialog.getByText("The outcome is unknown. Use Recurring Quest recovery to retry the exact saved request.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const recovery = page.getByRole("region", { name: "Quest management recovery", exact: true }).filter({ hasText: title });
  await expect(recovery).toBeVisible();
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("system.recurring-retirement.pending.v1:")));
  expect(saved).toBeDefined();
  expect(JSON.parse(saved![1]).operation).toBe("archive");

  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(recovery).toBeVisible();
  const request = page.waitForRequest((r) => !!r.headers()["next-action"]);
  await recovery.getByRole("button", { name: "Retry exact request", exact: true }).click();
  expect((await request).postData()).toContain(JSON.parse(saved![1]).commandId);
  await expect(recovery).toHaveCount(0);
  await expect(recurringRow(page, title, true)).toBeVisible();
  expect(await environment.sql(`SELECT count(*) FROM public.quest_events WHERE command_id='${JSON.parse(saved![1]).commandId}';`)).toBe("1");
});
