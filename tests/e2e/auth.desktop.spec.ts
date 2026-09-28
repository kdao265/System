import { test, expect } from "./fixtures";

test("unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Player status", exact: true })).toHaveCount(0);
});

test("owner login, dashboard, refresh and logout lifecycle", async ({ page, environment }) => {
  await test.step("valid disposable owner logs in through the UI", async () => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(environment.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(environment.owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Profile Setup", exact: true })).toBeVisible();
  });

  await test.step("complete required profile setup through the UI", async () => {
    await page.getByLabel("Display name").fill("E2E Owner");
    await page.getByLabel("Timezone", { exact: true }).selectOption("Asia/Ho_Chi_Minh");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
  });

  await test.step("dashboard loads with owner identity and stable progression state", async () => {
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "SYSTEM", exact: true })).toBeVisible();
    const player = page.getByRole("region", { name: "Player status", exact: true });
    await expect(player.getByRole("heading", { name: "E2E Owner", exact: true })).toBeVisible();
    await expect(player).toContainText(environment.owner.email);
    await expect(page.getByRole("region", { name: "Progression status: not configured", exact: true }))
      .toContainText("Level system not configured.");
  });

  await test.step("browser refresh preserves the authenticated session", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("region", { name: "Player status", exact: true })).toContainText(environment.owner.email);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  });

  await test.step("logout succeeds and clears browser authentication", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    const hasAuthCookie = (await page.context().cookies()).some(({ name }) => /auth-token(?:\.\d+)?$/.test(name));
    expect(hasAuthCookie, "Logout must clear Supabase session cookies").toBe(false);
  });

  await test.step("dashboard is protected again after logout", async () => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("region", { name: "Player status", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });
});
