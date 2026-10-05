import type { Page } from "@playwright/test";
import { test, expect } from "./quest-fixtures";
import { createRecurring, recurringRow, retire, createRecurringWithoutOccurrences } from "./recurring-retirement-helpers";

const occurrenceCard = (page: Page, title: string) => page.getByRole("list", { name: "Quest occurrences", exact: true })
  .getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const summaryOf = (page: Page, title: string) => occurrenceCard(page, title).locator(`summary[aria-label="Manage series: ${title}"]`);
const manageAction = (page: Page, title: string) => occurrenceCard(page, title).getByRole("button", { name: "Manage series", exact: true });
// A background refresh may reset the native disclosure between the two steps.
const openDisclosure = async (page: Page, title: string, viaKeyboard: boolean) => {
  for (let attempt = 0; attempt < 4 && !(await manageAction(page, title).isVisible()); attempt += 1) {
    if (viaKeyboard) { await summaryOf(page, title).focus(); await page.keyboard.press("Enter"); }
    else await summaryOf(page, title).click();
  }
  await expect(manageAction(page, title)).toBeVisible();
};
const expectNoHorizontalOverflow = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

test("series management is reachable, contained and recoverable at 360, 390 and 412 px", async ({ page }, testInfo) => {
  const { title } = await createRecurring(page);
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const summary = summaryOf(page, title);
    await summary.scrollIntoViewIfNeeded();
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Keyboard: open the disclosure and choose the single Manage series action.
    await summaryOf(page, title).focus();
    await page.keyboard.press("Enter");
    await openDisclosure(page, title, true);
    const action = manageAction(page, title);
    await page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Series management");
    await expect(dialog.getByText("This affects the entire recurring series.", { exact: true })).toBeVisible();
    // Near-full-screen presentation at phone widths without horizontal overflow.
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(width - 24);
    expect(box.height).toBeGreaterThanOrEqual(640);
    for (const name of ["Pause series", "Close series management"]) {
      expect((await dialog.getByRole("button", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    await dialog.screenshot({ path: testInfo.outputPath(`series-management-${width}.png`) });

    // Escape closes and returns focus to the card trigger.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(summary).toBeFocused();
    await expect(occurrenceCard(page, title).locator("details")).not.toHaveAttribute("open", "");
    await expectNoHorizontalOverflow(page);
    await expect(occurrenceCard(page, title)).toHaveCount(1);
  }

  // Archive at phone width: dialog closes, focus falls back to the archived panel, no overflow.
  await page.setViewportSize({ width: 360, height: 800 });
  await openDisclosure(page, title, false);
  await manageAction(page, title).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Archive series", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm archive", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(occurrenceCard(page, title)).toHaveCount(0);
  await expect(recurringRow(page, title, true)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toBe("archived-recurring-quests");
  await expectNoHorizontalOverflow(page);

  await retire(page, title, "restore");
  await expect(recurringRow(page, title)).toBeVisible();
  await retire(page, title, "archive");
  await retire(page, title, "delete");
  await expect(recurringRow(page, title, true)).toHaveCount(0);
});

// Release blocker 3 at phone widths: a recurring definition with ZERO materialized
// occurrences must reach the SAME shared manager, read authoritative detail and set
// then clear schedule defaults, without horizontal overflow.
test("a zero-occurrence definition manages its schedule at 360, 390 and 412 px", async ({ page }, testInfo) => {
  const { title } = await createRecurringWithoutOccurrences(page);
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const action = recurringRow(page, title).getByRole("button", { name: "Manage series", exact: true });
    await action.scrollIntoViewIfNeeded();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await action.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Series management");
    const section = dialog.locator("> div").filter({ hasText: /^Schedule defaults/ }).last();
    await expect(section.getByText("No schedule defaults", { exact: true })).toBeVisible();

    // Set and clear the defaults from the definition row alone.
    await section.getByRole("button", { name: "Edit schedule", exact: true }).click();
    await section.getByLabel("Default start", { exact: true }).fill("06:30");
    await section.getByLabel("Default end", { exact: true }).fill("07:15");
    await section.getByRole("button", { name: "Save schedule", exact: true }).click();
    await expect(section.getByText("06:30", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await dialog.screenshot({ path: testInfo.outputPath(`definition-series-${width}.png`) });

    await section.getByRole("button", { name: "Clear schedule defaults", exact: true }).click();
    await expect(section.getByText("No schedule defaults", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Escape closes and returns focus to the definition-row trigger.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(recurringRow(page, title).getByRole("button", { name: "Manage series", exact: true })).toBeFocused();
    await expectNoHorizontalOverflow(page);
  }
  // Still no occurrence card for this series at any width.
  await expect(page.getByRole("list", { name: "Quest occurrences", exact: true })
    .getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) })).toHaveCount(0);
});
