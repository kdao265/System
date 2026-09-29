import { test, expect } from "./quest-fixtures";
import { calendarDay, overflowDay, createCalendarViewScenario, expectNoCalendarOverflow, switchCalendarView } from "./calendar-view-helpers";

test("Calendar Day, Week and Month fit 360, 390 and 412 px with compact overflow and selected agendas", async ({ page, environment }) => {
  const { eventTitle, questTitle, overflowTitles } = await createCalendarViewScenario(page);
  const baseline = await environment.sql("SELECT count(*) FROM public.quest_occurrences;");
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/calendar?date=${calendarDay}&view=day`);
    await expect(page.getByRole("heading", { name: questTitle, exact: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: eventTitle, exact: true })).toHaveCount(1);
    await expectNoCalendarOverflow(page);
    await switchCalendarView(page, "Week", calendarDay);
    const week = page.getByRole("group", { name: "Week of January 31, 2028", exact: true });
    await expect(week.locator("[data-cal-timed]").filter({ hasText: questTitle })).toHaveCount(1);
    await expect(week.locator("[data-cal-timed]").filter({ hasText: eventTitle })).toHaveCount(1);
    await expectNoCalendarOverflow(page);
    await switchCalendarView(page, "Month", calendarDay);
    const selected = page.locator(`[data-cal-cell="${calendarDay}"]`);
    await expect(selected).toHaveAttribute("aria-current", "date");
    await expect(selected.locator('[data-cal-entry="quest"]:visible')).toHaveCount(1);
    await expect(selected.locator('[data-cal-entry="event"]:visible')).toHaveCount(1);
    const overflow = page.locator(`[data-cal-cell="${overflowDay}"]`);
    await expect(overflow.locator('[data-cal-more="compact"]')).toHaveText("+2");
    await expect(overflow.locator('[data-cal-more="compact"]')).toBeVisible();
    await expect(overflow.locator('[data-cal-more="wide"]')).toBeHidden();
    expect((await overflow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoCalendarOverflow(page);
    await overflow.click();
    await expect(page).toHaveURL(new RegExp(`date=${overflowDay}&view=month$`));
    const agenda = page.getByRole("list", { name: `Entries for ${overflowDay}`, exact: true });
    await expect(agenda.getByRole("listitem")).toHaveCount(6);
    for (const title of overflowTitles) await expect(agenda.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
    await expectNoCalendarOverflow(page);
    await page.getByRole("link", { name: "Next month", exact: true }).click();
    await expect(page).toHaveURL(/date=2028-03-01&view=month$/);
    await page.getByRole("link", { name: "Previous month", exact: true }).click();
    await expect(page).toHaveURL(/date=2028-02-01&view=month$/);
    await expectNoCalendarOverflow(page);
  }
  expect(await environment.sql("SELECT count(*) FROM public.quest_occurrences;")).toBe(baseline);
});
