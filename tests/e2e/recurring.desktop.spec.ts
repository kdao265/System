import { randomUUID } from "node:crypto";
import { test, expect } from "./quest-fixtures";
import { completeQuest, expectCompleted, expectExp, expectQuestHistory, questRow, readExp, rewardExp, createQuest } from "./quest-helpers";

test("Daily recurring Quest uses the ordinary completion/reopen/EXP pipeline and pause/resume", async ({ page, environment }) => {
  await page.getByRole("link", { name: "View today", exact: true }).click();
  const day = await page.getByLabel("Choose date", { exact: true }).inputValue();
  const title = `E2E recurring ${randomUUID()}`;
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  await form.getByLabel("Quest type", { exact: true }).selectOption("daily");
  await expect(form.getByLabel("Planned start (optional)", { exact: true })).toHaveCount(0);
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByLabel("Reward EXP", { exact: true }).fill(String(rewardExp));
  await form.getByLabel("Start date", { exact: true }).fill(day);
  await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Recurring Quest created");
  const row = questRow(page, title);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Recurring occurrence");
  const series = page.getByRole("list", { name: "Recurring definitions", exact: true }).getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(series).toContainText("Recurring · Daily · Active");
  const before = await readExp(page);
  await completeQuest(page, title); await expectExp(page, before + BigInt(rewardExp));
  await page.reload(); await expectCompleted(page, title); await expectExp(page, before + BigInt(rewardExp));
  await expectQuestHistory(environment, title, 1, 0);
  await series.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(series).toContainText("Daily · Paused");
  await expectCompleted(page, title); await expectExp(page, before + BigInt(rewardExp));
  await series.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(series).toContainText("Daily · Active");
  await row.getByRole("button", { name: "Reopen", exact: true }).click();
  await row.getByRole("button", { name: "Confirm reopen", exact: true }).click();
  // Generated slots have no invented instant, so reopen returns them to Draft.
  await expect(row.getByText("Status: Draft", { exact: true })).toBeVisible();
  await expectExp(page, before); await expectQuestHistory(environment, title, 1, 1);
  await completeQuest(page, title); await expectExp(page, before + BigInt(rewardExp));
  await page.reload(); await expectCompleted(page, title); await expectQuestHistory(environment, title, 2, 1);
  await expect(form.getByLabel("Quest type", { exact: true })).toHaveValue("one_off");
  await page.getByLabel("Choose date", { exact: true }).fill("2026-09-20");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await createQuest(page, "one-off after recurring");
});

test("recurring creation and pause survive committed responses lost before the browser receives them", async ({ page, environment }) => {
  await page.getByRole("link", { name: "View today", exact: true }).click();
  const day = await page.getByLabel("Choose date", { exact: true }).inputValue();
  const title = `E2E recurring recovery ${randomUUID()}`;
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  await form.getByLabel("Quest type", { exact: true }).selectOption("daily");
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByLabel("Start date", { exact: true }).fill(day);
  await form.getByLabel("Reward EXP", { exact: true }).fill(String(rewardExp));
  let dropped = 0;
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    await route.fetch(); dropped++; await route.abort("failed");
  });
  await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("outcome is unknown");
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("system.quest-creation.pending.v3:")));
  expect(saved).toBeDefined();
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(form.getByLabel("Quest type", { exact: true })).toHaveValue("daily");
  await expect(form.getByLabel("Start date", { exact: true })).toHaveValue(day);
  const series = page.getByRole("list", { name: "Recurring definitions", exact: true }).getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  // The definition committed despite the lost response. Subsequent legitimate
  // state/Profile changes must not make that original creation unrecoverable.
  await series.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(series).toContainText("Daily · Paused");
  await page.goto("/onboarding?repair=timezone");
  await page.getByLabel("Timezone", { exact: true }).selectOption("Africa/Abidjan");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(form).toContainText("Original timezone: UTC");
  await form.getByRole("button", { name: "Retry exact request", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Recurring Quest created");
  await expectQuestHistory(environment, title, 0, 0);
  await expect(series).toContainText("Daily · Paused");
  await series.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(series).toContainText("Daily · Active");
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    await route.fetch(); dropped++; await route.abort("failed");
  });
  await series.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(series.getByRole("button", { name: "Retry exact pause/resume request", exact: true })).toBeEnabled();
  const pause = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("system.quest-recurrence.pending.v1:")));
  expect(pause).toBeDefined();
  await page.unrouteAll({ behavior: "wait" }); await page.reload();
  await expect(series).toContainText("Daily · Paused");
  const request = page.waitForRequest((request) => !!request.headers()["next-action"]);
  await series.getByRole("button", { name: "Retry exact pause/resume request", exact: true }).click();
  expect((await request).postData()).toContain(JSON.parse(pause![1]).commandId);
  await expect(series.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  expect(dropped).toBe(2);
  await expect(questRow(page, title)).toHaveCount(1);
  await expectQuestHistory(environment, title, 0, 0);
});
