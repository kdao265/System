import { test, expect } from "./fixtures";
import { loginOwner } from "./quest-helpers";

test("recurrence controls are reachable and usable at phone widths", async ({ page, environment }) => {
  await loginOwner(page, environment.owner);
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    await form.getByLabel("Quest type", { exact: true }).selectOption("weekly");
    await form.getByLabel("Start date", { exact: true }).fill("2026-10-01");
    await form.getByLabel("End date (optional)", { exact: true }).fill("2026-12-31");
    for (const day of ["Monday", "Wednesday", "Sunday"]) {
      const checkbox = form.getByRole("checkbox", { name: day, exact: true });
      await checkbox.check(); await expect(checkbox).toBeChecked();
      expect(await checkbox.evaluate((element) => element.closest("label")!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await form.getByLabel("Quest type", { exact: true }).selectOption("monthly");
    // Weekly weekday selection is gone for monthly; the schedule-defaults flag remains.
    await expect(form.getByRole("checkbox", { name: "Monday", exact: true })).toHaveCount(0);
    await form.getByLabel("Day of month", { exact: true }).fill("31");
    await expect(form.getByLabel("Day of month", { exact: true })).toHaveValue("31");
    const submit = form.getByRole("button", { name: "Create recurring Quest", exact: true });
    await submit.scrollIntoViewIfNeeded(); await expect(submit).toBeInViewport();
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await form.getByLabel("Quest type", { exact: true }).selectOption("daily");
    await expect(form.getByLabel("Day of month", { exact: true })).toHaveCount(0);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
  }
  await form.getByLabel("Quest type", { exact: true }).selectOption("one_off");
  await expect(form.getByLabel("Start date", { exact: true })).toHaveCount(0);
  await expect(form.getByLabel("Planned start (optional)", { exact: true })).toBeVisible();
});

test("the schedule-defaults inputs stay reachable and contained at phone widths", async ({ page, environment }) => {
  await loginOwner(page, environment.owner);
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    await form.getByLabel("Quest type", { exact: true }).selectOption("daily");
    const start = form.getByLabel("Default start time", { exact: true });
    const end = form.getByLabel("Default end time", { exact: true });
    await start.scrollIntoViewIfNeeded();
    for (const control of [start, end]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(control).toBeInViewport();
    }
    // A partial pair is flagged in place before anything is submitted.
    await start.fill("08:00");
    await expect(form.getByText("Enter both default times, or leave both empty.", { exact: true })).toBeVisible();
    await end.fill("09:30");
    await expect(form.getByText("Enter both default times, or leave both empty.", { exact: true })).toHaveCount(0);
    const nextDay = form.getByLabel("Ends the next day", { exact: true });
    await nextDay.check();
    expect((await nextDay.evaluate((element) => element.closest("label")!.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
    await expect(form.getByText("An end at or before the start continues past midnight", { exact: false })).toBeVisible();
    // Clearing both returns the series to untimed without an error.
    await start.fill(""); await end.fill("");
    await nextDay.uncheck();
    await expect(form.getByText("Enter both default times, or leave both empty.", { exact: true })).toHaveCount(0);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
  }
  await form.getByLabel("Quest type", { exact: true }).selectOption("one_off");
  await expect(form.getByLabel("Default start time", { exact: true })).toHaveCount(0);
});