import { test, expect } from "./quest-fixtures";
import {
  completeQuest, createQuest, expectCompleted, expectExp, expectQuestHistory,
  questRow, readExp, reopenQuest, rewardExp,
} from "./quest-helpers";
import { randomUUID } from "node:crypto";
import type { Route } from "@playwright/test";

test("creation sends once while pending and safely retries the saved request after transport loss", async ({ page, environment }) => {
  const title = `E2E hardening ${randomUUID()}`;
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByLabel("Planned start (optional)", { exact: true }).fill("2026-09-20T12:00");
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handler = async (route: Route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    calls++;
    await gate;
    await route.abort("failed");
  };
  await page.route("**/*", handler);
  try {
    await form.getByRole("button", { name: "Schedule Quest", exact: true }).evaluate((button: HTMLButtonElement) => {
      button.form!.requestSubmit(); button.form!.requestSubmit();
    });
    await expect(form.getByRole("button", { name: "Confirming request…", exact: true })).toBeDisabled();
    await expect.poll(() => calls).toBe(1);
  } finally { release(); }
  await expect(form.getByRole("alert")).toContainText("outcome is unknown");
  await expect(form.getByRole("button", { name: "Schedule Quest", exact: true })).toBeDisabled();
  await expect(form.getByRole("button", { name: "Retry exact request", exact: true })).toBeEnabled();
  const saved = await page.evaluate(() => Object.values(localStorage)
    .map((value) => { try { return JSON.parse(value); } catch { return null; } })
    .find((value) => value?.request?.title?.startsWith("E2E hardening")));
  expect(saved.commandId).toMatch(/^[a-f0-9-]{36}$/);
  expect(calls).toBe(1);
  await page.unroute("**/*", handler);
  const retryRequest = page.waitForRequest((request) => !!request.headers()["next-action"]);
  await form.getByRole("button", { name: "Retry exact request", exact: true }).click();
  expect((await retryRequest).postData()).toContain(saved.commandId);
  await expect(form.getByRole("status")).toContainText("Quest created");
  await expect(form.getByRole("button", { name: "Schedule Quest", exact: true })).toBeEnabled();
  await expectQuestHistory(environment, title, 0, 0);
});

test("one-off Quest completion, refresh, reopen and new-cycle EXP", async ({ page, context, environment }) => {
  const title = await test.step("create a uniquely titled one-off Quest through the UI", () => createQuest(page, "lifecycle"));
  const before = await readExp(page);
  const earned = before + BigInt(rewardExp);

  await test.step("complete once and read exactly one reward", async () => {
    await context.setOffline(true);
    await expect(questRow(page, title).getByRole("button", { name: "Complete", exact: true })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible();
    await context.setOffline(false);
    await expect(questRow(page, title).getByRole("button", { name: "Complete", exact: true })).toBeEnabled();
    await completeQuest(page, title);
    await expectExp(page, earned);
    await expectQuestHistory(environment, title, 1, 0);
  });

  await test.step("refresh preserves completion without another EXP credit", async () => {
    await page.reload();
    await expectCompleted(page, title);
    await expectExp(page, earned);
    await expectQuestHistory(environment, title, 1, 0);
  });

  await test.step("reopen reverses the original credit and restores actionability", async () => {
    const row = questRow(page, title);
    await row.getByRole("button", { name: "Reopen", exact: true }).click();
    await context.setOffline(true);
    await expect(row.getByRole("button", { name: "Confirm reopen", exact: true })).toBeDisabled();
    await context.setOffline(false);
    await expect(row.getByRole("button", { name: "Confirm reopen", exact: true })).toBeEnabled();
    await row.getByRole("button", { name: "Cancel", exact: true }).click();
    await reopenQuest(page, title);
    await expectExp(page, before);
    await expectQuestHistory(environment, title, 1, 1);
    await page.reload();
    await expect(questRow(page, title).getByRole("button", { name: "Complete", exact: true })).toBeEnabled();
    await expectExp(page, before);
  });

  await test.step("complete the new cycle once, then reobserve without duplicate rewards", async () => {
    await completeQuest(page, title);
    await expectExp(page, earned);
    await expectQuestHistory(environment, title, 2, 1);
    await page.reload();
    await expectCompleted(page, title);
    await expectExp(page, earned);
    await expectQuestHistory(environment, title, 2, 1);
  });
});

test("two owner tabs converge after completion, reopen and recompletion without duplicate EXP", async ({ page: pageA, context, environment }) => {
  const title = await createQuest(pageA, "two tabs");
  const before = await readExp(pageA);
  const earned = before + BigInt(rewardExp);
  const pageB = await context.newPage();
  try {
    await pageB.goto(pageA.url());
    await expect(questRow(pageB, title).getByRole("button", { name: "Complete", exact: true })).toBeEnabled();
    await expectExp(pageB, before);

    await test.step("page A completes; page B reloads the authoritative completion", async () => {
      await completeQuest(pageA, title);
      await expectExp(pageA, earned);
      await pageB.reload();
      await expectCompleted(pageB, title);
      await expectExp(pageB, earned);
      await expectQuestHistory(environment, title, 1, 0);
    });

    await test.step("page A reopens; page B reloads the actionable next cycle and reversed EXP", async () => {
      await reopenQuest(pageA, title);
      await expectExp(pageA, before);
      await pageB.reload();
      const rowB = questRow(pageB, title);
      await expect(rowB.getByText("Status: Scheduled", { exact: true })).toBeVisible();
      await expect(rowB.getByRole("button", { name: "Complete", exact: true })).toBeEnabled();
      await expectExp(pageB, before);
      await expectQuestHistory(environment, title, 1, 1);
      await pageA.reload();
      await expectExp(pageA, before);
    });

    await test.step("page A recompletes; repeated reads in both tabs cannot mint another reward", async () => {
      await completeQuest(pageA, title);
      await expectExp(pageA, earned);
      await pageB.reload();
      await expectCompleted(pageB, title);
      await expectExp(pageB, earned);
      await expectQuestHistory(environment, title, 2, 1);
      await pageA.reload();
      await pageB.reload();
      await expectCompleted(pageA, title);
      await expectCompleted(pageB, title);
      await expectExp(pageA, earned);
      await expectExp(pageB, earned);
      await expectQuestHistory(environment, title, 2, 1);
    });
  } finally {
    await pageB.close();
  }
});
