import { test, expect } from "./fixtures";
import { loginOwner, questDay } from "./quest-helpers";

test("Calendar week, all-day editor and recovery controls fit 360, 390 and 412 px", async ({ page, context, environment }) => {
  await loginOwner(page, environment.owner);
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  const form = page.getByRole("region", { name: "Create schedule event", exact: true });
  const title = "Calendar " + "X".repeat(110);
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByLabel("All day", { exact: true }).check();
  await form.getByLabel("First day", { exact: true }).fill(questDay);
  await form.getByLabel("Notes (optional)", { exact: true }).fill("N".repeat(250));
  await form.getByRole("button", { name: "Create event", exact: true }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(row).toContainText("All day");
  await expect(row).not.toContainText("12:00");
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      right: Math.max(...Array.from(document.body.querySelectorAll("*"), (e) => e.getBoundingClientRect().right)) }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
    const edit = row.getByRole("button", { name: "Edit", exact: true });
    await edit.scrollIntoViewIfNeeded(); await expect(edit).toBeInViewport();
    expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await edit.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    await expect(edit).toBeFocused();
    expect(await edit.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
  }
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("region", { name: "Edit schedule event", exact: true });
  await expect(editor.getByLabel("First day", { exact: true })).toHaveValue(questDay);
  let calls = 0;
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    calls++; await route.abort("failed");
  });
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("outcome is unknown");
  const retry = editor.getByRole("button", { name: "Retry saved request", exact: true });
  await expect(retry).toBeEnabled();
  await context.setOffline(true); await expect(retry).toBeDisabled();
  await context.setOffline(false); await expect(retry).toBeEnabled(); expect(calls).toBe(1);
  await page.unrouteAll({ behavior: "wait" });
  await retry.click(); await expect(form.getByRole("status")).toContainText("Event saved");
  await page.getByRole("link", { name: "Day", exact: true }).click();
  await expect(row).toHaveCount(1);
});
