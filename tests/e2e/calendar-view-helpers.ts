import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

export const calendarDay = "2028-01-31";
export const overflowDay = "2028-02-01";

export async function createCalendarViewScenario(page: Page) {
  const suffix = randomUUID();
  const questTitle = `Calendar view Quest ${suffix}`;
  await page.goto(`/dashboard?date=${calendarDay}`);
  const quest = page.getByRole("region", { name: "Create Quest", exact: true });
  await quest.getByLabel("Title", { exact: true }).fill(questTitle);
  await quest.getByLabel("Planned start (optional)", { exact: true }).fill(`${calendarDay}T12:00`);
  await quest.getByLabel("Reward EXP", { exact: true }).fill("0");
  await quest.getByRole("button", { name: "Schedule Quest", exact: true }).click();
  await expect(quest.getByRole("status")).toContainText("Quest created:");

  const eventTitle = `Calendar view event ${suffix}`;
  const overflowTitles = Array.from({ length: 6 }, (_, index) => `Overflow ${index} ${suffix} ${"X".repeat(45)}`);
  await page.goto(`/calendar?date=${calendarDay}&view=day`);
  for (const [index, title] of [eventTitle, ...overflowTitles].entries()) {
    const form = page.getByRole("region", { name: "Create schedule event", exact: true });
    await form.getByLabel("Title", { exact: true }).fill(title);
    if (index === 1) {
      await form.getByLabel("All day", { exact: true }).check();
      await form.getByLabel("First day", { exact: true }).fill(overflowDay);
    } else {
      const day = index === 0 ? calendarDay : overflowDay;
      await form.getByLabel("Start", { exact: true }).fill(`${day}T09:00`);
      await form.getByLabel("End (optional)", { exact: true }).fill(`${day}T10:00`);
    }
    await form.getByRole("button", { name: "Create event", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(form.getByLabel("Title", { exact: true })).toHaveValue("");
  }
  return { questTitle, eventTitle, overflowTitles };
}

export async function expectNoCalendarOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    right: Math.max(...Array.from(document.body.querySelectorAll("*"), (element) => element.getBoundingClientRect().right)),
  }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
}

export async function switchCalendarView(page: Page, view: "Day" | "Week" | "Month", date: string) {
  await page.getByRole("navigation", { name: "Calendar view", exact: true }).getByRole("link", { name: view, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${date}&view=${view.toLowerCase()}$`));
  await expect(page.getByLabel("Choose date", { exact: true })).toHaveValue(date);
}
