import { test, expect } from "./quest-fixtures";
import {
  completeQuest, createQuest, expectCompleted, expectExp, expectQuestHistory,
  questRow, readExp, reopenQuest, rewardExp,
} from "./quest-helpers";

test("one-off Quest completion, refresh, reopen and new-cycle EXP", async ({ page, environment }) => {
  const title = await test.step("create a uniquely titled one-off Quest through the UI", () => createQuest(page, "lifecycle"));
  const before = await readExp(page);
  const earned = before + BigInt(rewardExp);

  await test.step("complete once and read exactly one reward", async () => {
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
