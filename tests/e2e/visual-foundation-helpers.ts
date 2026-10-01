import type { Page, BrowserContext, TestInfo } from "@playwright/test";
import { expect } from "./fixtures";
import { loginOwner } from "./quest-helpers";

export async function visualFoundationJourney(page: Page, context: BrowserContext, owner: { email: string; password: string }, widths: number[], info: TestInfo) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await loginOwner(page, owner);
  const originalUrl = page.url();
  const ssr = await context.request.get(originalUrl);
  expect(await ssr.text()).toContain('<html lang="vi"');
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.getByRole("navigation", { name: "Điều hướng SYSTEM", exact: true })).toBeVisible();

  // Refreshing locale must retain an unsent feature draft and selected-date URL.
  const title = page.getByRole("region", { name: "Create Quest", exact: true }).getByLabel("Title", { exact: true });
  await title.fill("Unsent locale draft");
  await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Áp dụng ngôn ngữ", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "SYSTEM navigation", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(title).toHaveValue("Unsent locale draft");
  expect(page.url()).toBe(originalUrl);
  expect((await context.cookies()).find((cookie) => cookie.name === "system-locale")?.value).toBe("en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  for (const language of ["en", "vi"] as const) {
    if (language === "vi") {
      await page.getByLabel("Language", { exact: true }).selectOption("vi");
      await page.getByRole("button", { name: "Apply language", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    }
    for (const route of ["dashboard", "calendar", "goals"] as const) {
      await page.goto(`/${route}`);
      const navigation = page.getByRole("navigation", { name: language === "vi" ? "Điều hướng SYSTEM" : "SYSTEM navigation", exact: true });
      await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute("href", `/${route}`);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        for (const link of await navigation.getByRole("link").all()) {
          const box = await link.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          await expect(link).toBeVisible();
        }
        if (language === "vi") await page.screenshot({ path: info.outputPath(`shell-${route}-${width}.png`) });
      }
      // Real navigation, with no localized route prefix.
      await navigation.getByRole("link").first().click();
      await expect(page).toHaveURL(/\/dashboard$/);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const link = page.getByRole("navigation", { name: "Điều hướng SYSTEM", exact: true }).getByRole("link").first();
  await page.keyboard.press("Tab");
  await link.focus();
  await expect(link).toBeFocused();
  expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  expect(await link.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s, 0s");

  await context.addCookies([{ name: "system-locale", value: "unsupported", url: page.url() }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  // A privacy setting that rejects preference cookies must leave the current UI
  // usable and show a localized error instead of pretending the switch succeeded.
  await page.evaluate(() => Object.defineProperty(document, "cookie", {
    configurable: true, get: () => "", set: () => { throw new Error("Synthetic cookie refusal"); },
  }));
  await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Áp dụng ngôn ngữ", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Không lưu được ngôn ngữ" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  expect(errors.filter((error) => /hydrat|didn't match|does not match|Minified React error/i.test(error))).toEqual([]);
}
