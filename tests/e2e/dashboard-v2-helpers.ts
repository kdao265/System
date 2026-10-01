import type { Page, TestInfo } from "@playwright/test";
import { expect } from "./fixtures";
import { loginOwner, createQuest, completeQuest, reopenQuest, questDay, expectExp, questRow } from "./quest-helpers";
import { attachQuest, createGoal } from "./goals-helpers";

export async function dashboardJourney(page: Page, owner: { email: string; password: string }, widths: number[], info: TestInfo) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await loginOwner(page, owner);
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  const hero = page.getByRole("region", { name: "Main Quest", exact: true });
  await expect(hero).toContainText("Định hướng cho chặng đường mới.");
  await expect(hero.getByRole("link")).toHaveAttribute("href", "/goals");
  await expect(page.getByRole("region", { name: "Quest trong ngày", exact: true })).toContainText("Không có Quest");
  await expect(page.getByRole("region", { name: "Trạng thái tiến trình", exact: true })).toContainText("0 EXP");
  const html = await (await page.context().request.get(page.url())).text();
  expect(html).toContain('<main lang="vi"');
  expect(html).toContain("Định hướng cho chặng đường mới.");

  await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Áp dụng ngôn ngữ", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const first = await createQuest(page, "Dashboard practice");
  const second = await createQuest(page, "Dashboard review");
  await page.goto("/goals");
  const goalId = await createGoal(page, "Build a life with intention");
  await attachQuest(page, first);
  await attachQuest(page, second);
  await page.goto(`/dashboard?date=${questDay}`);
  await expect(hero).toContainText("0 / 2 Sub Quests");
  await expect(hero.getByRole("link")).toHaveAttribute("href", `/goals?id=${goalId}`);
  await completeQuest(page, first);
  await expect(hero).toContainText("1 / 2 Sub Quests");
  await expect(hero.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expectExp(page, BigInt(37));
  await reopenQuest(page, first);
  await expect(hero).toContainText("0 / 2 Sub Quests");
  await expectExp(page, BigInt(0));
  await completeQuest(page, first);

  await page.goto(`/calendar?view=day&date=${questDay}`);
  const event = page.getByRole("region", { name: "Create schedule event", exact: true });
  await event.getByLabel("Title", { exact: true }).fill("Plan the next chapter");
  await event.getByLabel("Start", { exact: true }).fill(`${questDay}T09:00`);
  await event.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(event.getByRole("status")).toContainText("Event saved");
  await page.goto(`/dashboard?date=${questDay}`);
  const calendar = page.getByRole("region", { name: "Upcoming Calendar", exact: true });
  await expect(calendar).toContainText("Plan the next chapter");
  await expect(calendar.getByRole("link", { name: /Plan the next chapter/ })).toHaveAttribute("href", `/calendar?view=day&date=${questDay}`);
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  await form.getByLabel("Quest type", { exact: true }).selectOption("weekly");
  await form.getByLabel("Title", { exact: true }).fill("Make time to reflect");
  await form.getByLabel("Start date", { exact: true }).fill(questDay);
  await form.getByLabel("Monday", { exact: true }).check();
  await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Recurring Quest created");
  await expect(page.getByRole("region", { name: "Recurring Quests", exact: true })).toContainText("Make time to reflect");

  for (const locale of ["en", "vi"] as const) {
    if (locale === "vi") {
      await page.getByLabel("Language", { exact: true }).selectOption("vi");
      await page.getByRole("button", { name: "Apply language", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "vi");
      await expect(hero.getByRole("link")).toContainText("Mở Main Quest");
      await expect(page.getByRole("region", { name: "Quest trong ngày", exact: true })).toContainText("Đã hoàn thành: 1");
      await expect(page.getByRole("region", { name: "Quest định kỳ", exact: true })).toContainText("Hằng tuần");
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const regions = await page.locator(".dashboard-grid > div").evaluateAll((elements) => elements.map((element) => ({
        name: element.className, top: element.getBoundingClientRect().top, left: element.getBoundingClientRect().left,
      })));
      if (width < 760) {
        expect(regions.map((region) => region.top)).toEqual([...regions.map((region) => region.top)].sort((a, b) => a - b));
      } else if (width >= 1200) {
        const main = regions.find((region) => region.name === "dashboard-slot-main")!;
        const level = regions.find((region) => region.name === "dashboard-slot-level")!;
        const calendar = regions.find((region) => region.name === "dashboard-slot-calendar")!;
        expect(main.top).toBe(level.top); expect(level.top).toBe(calendar.top);
        expect(main.left).toBeLessThan(level.left); expect(level.left).toBeLessThan(calendar.left);
      }
      await page.screenshot({ path: info.outputPath(`dashboard-${locale}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const navigation = page.getByRole("navigation", { name: "Điều hướng SYSTEM", exact: true });
  for (const link of await navigation.getByRole("link").all()) {
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  const goalLink = hero.getByRole("link");
  await goalLink.focus();
  // Exercise keyboard focus visibility after the preceding pointer interactions.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(goalLink).toBeFocused();
  expect(await goalLink.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  // Exercise the translated shared control too; no separate Dashboard action exists.
  await page.getByRole("list", { name: "Các Quest trong ngày", exact: true }).getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: second, exact: true }) })
    .getByRole("button", { name: "Hoàn thành", exact: true }).click();
  await expect(page.getByRole("region", { name: "Quest recovery", exact: true })).toContainText("Quest completed.");
  await page.getByRole("link", { name: "Reload selected day", exact: true }).first().click();
  await expect(hero).toContainText("Định hướng cho chặng đường mới."); // no active Goal after 2/2
  await expect(page.getByRole("region", { name: "Trạng thái tiến trình", exact: true })).toContainText("74 EXP");
  await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Áp dụng ngôn ngữ", exact: true }).click();
  await expect(questRow(page, second)).toContainText("Status: Completed");
  await page.getByRole("navigation", { name: "SYSTEM navigation", exact: true }).getByRole("link", { name: "Quests", exact: true }).click();
  await expect(page).toHaveURL(/#daily-quests$/);
  await page.getByRole("navigation", { name: "SYSTEM navigation", exact: true }).getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${questDay}$`));
  expect(errors.filter((error) => /hydrat|didn't match|does not match|Minified React error/i.test(error))).toEqual([]);
}
