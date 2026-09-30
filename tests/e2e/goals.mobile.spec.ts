import { randomUUID } from "node:crypto";
import { test, expect } from "./quest-fixtures";
import { createQuest } from "./quest-helpers";
import { attachQuest, createGoal, goalDetail } from "./goals-helpers";

test("Main Quest cards, forms, Sub Quests and archive controls fit 360/390/412 px", async ({ page }) => {
  const quest = await createQuest(page, "X".repeat(55));
  await page.goto("/goals");
  const title = randomUUID() + "X".repeat(80);
  await createGoal(page, title); await attachQuest(page, quest);
  const detail = goalDetail(page);
  await detail.getByText("Edit Main Quest", { exact: true }).click();
  await detail.getByLabel("Description (optional)").fill("D".repeat(300));
  await detail.getByRole("button", { name: "Save Main Quest", exact: true }).click();
  await expect(detail).toContainText("D".repeat(300));
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 850 });
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      right: Math.max(...Array.from(document.body.querySelectorAll("*"), (e) => e.getBoundingClientRect().right)) }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
    const button = detail.getByRole("button", { name: "Archive Main Quest", exact: true });
    await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(button).toBeFocused();
    expect(await button.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
    await expect(detail.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "0 of 1 Sub Quests completed; 0%");
  }
  await detail.getByRole("button", { name: "Archive Main Quest", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Restore Main Quest", exact: true })).toBeVisible();
  await page.reload(); await expect(detail).toContainText("read-only until restored");
});
