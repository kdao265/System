import { test, expect } from "./fixtures";

test("mobile anonymous dashboard redirects to a usable login form", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeInViewport();
  await expect(page.getByLabel("Email", { exact: true })).toBeEditable();
  await expect(page.getByLabel("Password", { exact: true })).toBeEditable();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Player status", exact: true })).toHaveCount(0);
});
