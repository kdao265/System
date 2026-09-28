import { test, expect } from "./fixtures";
import { loginOwner } from "./quest-helpers";
import type { Page, Route } from "@playwright/test";

async function rejectPendingAction(page: Page, buttonName: string, pendingName: string) {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handler = async (route: Route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    calls++;
    await gate;
    await route.abort("failed");
  };
  await page.route("**/*", handler);
  try {
    const button = page.getByRole("button", { name: buttonName, exact: true });
    // Same-tick submissions exercise the synchronous guard before pending renders.
    await button.evaluate((element: HTMLButtonElement) => {
      element.form!.requestSubmit();
      element.form!.requestSubmit();
    });
    await expect(page.getByRole("button", { name: pendingName, exact: true })).toBeDisabled();
    await expect.poll(() => calls).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be confirmed");
  await expect(page.getByRole("button", { name: buttonName, exact: true })).toBeEnabled();
  expect(calls).toBe(1);
  await page.unroute("**/*", handler);
}

test("Auth transport failures restore controls and repeated submits send once", async ({ page, context, environment }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(environment.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(environment.owner.password);
  await rejectPendingAction(page, "Sign in", "Please wait…");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(environment.owner.email);
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("You are offline");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await loginOwner(page, environment.owner);
  await rejectPendingAction(page, "Sign out", "Signing out…");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
