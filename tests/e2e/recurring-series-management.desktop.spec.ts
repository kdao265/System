import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./quest-fixtures";
import { completeQuest, expectExp, expectQuestHistory, questRow, readExp, rewardExp } from "./quest-helpers";
import { createRecurring, recurringRow, retire } from "./recurring-retirement-helpers";

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
