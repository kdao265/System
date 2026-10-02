import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: process.env.SYSTEM_E2E_OUTPUT_DIR ?? "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: process.env.SYSTEM_E2E_REPORT_DIR ?? "playwright-report" }]],
  use: {
    // baseURL is supplied exclusively by the disposable environment fixture.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: "**/*.desktop.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: "**/*.mobile.spec.ts",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
  ],
});
