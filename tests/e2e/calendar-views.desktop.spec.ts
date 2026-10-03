import { test, expect } from "./quest-fixtures";
import { calendarDay, overflowDay, createCalendarViewScenario, expectNoCalendarOverflow, switchCalendarView } from "./calendar-view-helpers";

test("Calendar view switching, adjacent months and Today retain the selected-day agenda", async ({ page }) => {
  await page.goto(`/calendar?date=${calendarDay}&view=day`);
  await switchCalendarView(page, "Week", calendarDay);
  await expect(page.getByRole("group", { name: "Week of January 31, 2028", exact: true })).toBeVisible();
  await switchCalendarView(page, "Month", calendarDay);
  const month = page.getByRole("group", { name: "January 2028 calendar", exact: true });
  await expect(month.locator("[data-cal-row]").first().locator("[data-cal-cell]").first()).toHaveAttribute("data-cal-cell", "2027-12-27");
  await expect(month.locator(`[data-cal-cell="${calendarDay}"]`)).toHaveAttribute("aria-current", "date");
  await page.getByRole("link", { name: "Next month", exact: true }).click();
  await expect(page).toHaveURL(/date=2028-02-29&view=month$/);
  await expect(page.getByRole("group", { name: "February 2028 calendar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Choose date", { exact: true })).toHaveValue("2028-02-29");
  await page.getByRole("link", { name: "Previous month", exact: true }).click();
  await expect(page).toHaveURL(/date=2028-01-29&view=month$/);
  await month.locator('[data-cal-cell="2028-01-15"]').click();
  await expect(page).toHaveURL(/date=2028-01-15&view=month$/);
  await expect(page.getByRole("region", { name: "January 15, 2028", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "January 29, 2028", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2028-01-15T09:00");
  await switchCalendarView(page, "Day", "2028-01-15");
  await expect(page.getByRole("group", { name: /calendar$/ })).toHaveCount(0);
  await switchCalendarView(page, "Month", "2028-01-15");
  const todayLink = page.getByRole("link", { name: "Today", exact: true });
  const today = new URL((await todayLink.getAttribute("href"))!, page.url()).searchParams.get("date")!;
  expect(today).toBe(new Date().toISOString().slice(0, 10)); // Fixture Profile timezone is UTC.
  await todayLink.click();
  await expect(page).toHaveURL(new RegExp(`date=${today}&view=month$`));
  await expect(page.locator(`[data-cal-cell="${today}"]`)).toHaveAttribute("aria-current", "date");
  await expect(page.locator(`[data-cal-cell="${today}"]`)).toHaveAccessibleName(/today/);
  await expectNoCalendarOverflow(page);
});

test("Calendar places Schedule Events and one Quest projection with truthful Month overflow", async ({ page, environment }) => {
  const { eventTitle, questTitle, overflowTitles } = await createCalendarViewScenario(page);
  const counts = () => environment.sql("SELECT json_build_array((SELECT count(*) FROM public.quest_occurrences),(SELECT count(*) FROM public.quest_events),(SELECT count(*) FROM public.exp_ledger),(SELECT count(*) FROM public.schedule_events));");
  const baseline = await counts();
  await page.goto(`/calendar?date=${calendarDay}&view=month`);
  const selected = page.locator(`[data-cal-cell="${calendarDay}"]`);
  await expect(selected.locator('[data-cal-entry="event"]:visible')).toHaveCount(1);
  await expect(selected.locator('[data-cal-entry="quest"]:visible')).toHaveCount(1);
  await expect(selected).toContainText(eventTitle);
  await expect(selected).toContainText(questTitle);
  const agenda = page.getByRole("list", { name: `Entries for ${calendarDay}`, exact: true });
  await expect(agenda.getByRole("heading", { name: questTitle, exact: true })).toHaveCount(1);
  await expect(agenda.getByRole("heading", { name: eventTitle, exact: true })).toHaveCount(1);
  const overflow = page.locator(`[data-cal-cell="${overflowDay}"]`);
  await expect(overflow.locator('[data-cal-more="wide"]')).toHaveText("+3 more");
  await overflow.click();
  await expect(page).toHaveURL(new RegExp(`date=${overflowDay}&view=month$`));
  const overflowAgenda = page.getByRole("list", { name: `Entries for ${overflowDay}`, exact: true });
  await expect(overflowAgenda.getByRole("listitem")).toHaveCount(6);
  for (const title of overflowTitles) await expect(overflowAgenda.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
  await expect(agenda).toHaveCount(0);
  await page.locator('[data-cal-cell="2028-02-02"]').click();
  await expect(page.getByRole("region", { name: "February 2, 2028", exact: true })).toContainText("No calendar entries.");

  await page.goto(`/calendar?date=${calendarDay}&view=week`);
  const week = page.getByRole("group", { name: "Week of January 31, 2028", exact: true });
  for (const fontSize of [16, 20]) {
    await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
    for (const [title, hour] of [[eventTitle, 9], [questTitle, 12]] as const) {
      const block = week.locator("[data-cal-timed]").filter({ hasText: title });
      await expect(block).toHaveCount(1);
      await expect(block.locator("..").locator("..").getByRole("link")).toHaveAttribute("href", `/calendar?date=${calendarDay}&view=day`);
      const geometry = await block.evaluate((element) => ({
        top: element.getBoundingClientRect().top - element.parentElement!.getBoundingClientRect().top,
        hour: parseFloat(getComputedStyle(document.documentElement).fontSize) * 2.75,
      }));
      expect(geometry.top).toBeCloseTo(hour * geometry.hour, 1);
    }
    await expectNoCalendarOverflow(page);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  // The all-day event stays in the date band, not the timed timeline.
  await expect(week.locator("[data-cal-timed]").filter({ hasText: overflowTitles[0] })).toHaveCount(0);
  await expect(week.getByRole("list", { name: /All-day.*February 1, 2028/ })).toContainText(overflowTitles[0]);
  await expectNoCalendarOverflow(page);
  await switchCalendarView(page, "Day", calendarDay);
  await expect(page.getByRole("heading", { name: questTitle, exact: true })).toHaveCount(1);
  await switchCalendarView(page, "Month", calendarDay);
  await page.reload();
  expect(await counts()).toBe(baseline);
});
