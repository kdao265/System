import { test, expect } from "./fixtures";
import { loginOwner } from "./quest-helpers";

test("offline and long uncertain creation remain usable at phone widths", async ({ page, context, environment }) => {
  await loginOwner(page, environment.owner);
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  await form.getByLabel("Title", { exact: true }).fill("X".repeat(120));
  await form.getByLabel("Planned start (optional)", { exact: true }).fill("2026-09-20T12:00");
  let calls = 0;
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    calls++;
    await route.abort("failed");
  });
  await form.getByRole("button", { name: "Schedule Quest", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("outcome is unknown");
  const retry = form.getByRole("button", { name: "Retry exact request", exact: true });
  await expect(retry).toBeEnabled();
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      right: Math.max(...Array.from(document.body.querySelectorAll("*"), (e) => e.getBoundingClientRect().right)),
    }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeInViewport();
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await retry.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(retry).toBeFocused();
    expect(await retry.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
  }
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(retry).toBeEnabled();
  expect(calls, "reconnect must not automatically replay saved requests").toBe(1);
});
