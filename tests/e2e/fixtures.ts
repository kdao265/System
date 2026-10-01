import { test as base, expect } from "@playwright/test";
import { startAuthEnvironment } from "../helpers/auth-environment.mjs";
import { requireE2ERuntime } from "../helpers/e2e-boundary.mjs";

type Environment = Awaited<ReturnType<typeof startAuthEnvironment>> & { app: string };

export const test = base.extend<{ networkBoundary: void; localePreference: "en" | "vi" | null }, { environment: Environment }>({
  // Existing feature journeys assert English copy explicitly. Foundation tests clear
  // this preference to verify the real Vietnamese default independently.
  localePreference: ["en", { option: true }],
  environment: [async ({}, provide, workerInfo) => {
    if (workerInfo.config.workers !== 1 || workerInfo.project.retries !== 0 ||
      workerInfo.project.use.baseURL || workerInfo.project.use.storageState) {
      throw new Error("E2E requires one worker, no retries, and fixture-owned URL/authentication");
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 300_000);
    let environment: Awaited<ReturnType<typeof startAuthEnvironment>> | undefined;
    const stop = () => {
      controller.abort();
      // Startup observes abort and cleans its partial resources itself.
      void environment?.close().catch(() => { process.exitCode = 1; });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      environment = await startAuthEnvironment({ isolatedApp: true, signal: controller.signal });
      const app = await environment.startApp();
      clearTimeout(deadline);
      const runtime = { ...environment, app };
      requireE2ERuntime(runtime);
      await provide(runtime);
    } finally {
      clearTimeout(deadline);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      await environment?.close();
    }
  }, { scope: "worker", timeout: 420_000 }],

  baseURL: async ({ environment }, provide) => {
    requireE2ERuntime(environment);
    await provide(environment.app);
  },

  networkBoundary: [async ({ context, environment, localePreference }, provide) => {
    const allowed = new Set(requireE2ERuntime(environment));
    if (localePreference) await context.addCookies([{ name: "system-locale", value: localePreference, url: environment.app }]);
    let blocked = false;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && !allowed.has(url.origin)) {
        blocked = true;
        await route.abort("blockedbyclient");
      } else {
        await route.continue();
      }
    });
    await provide();
    expect(blocked, "Browser must contact only this run's app and Supabase gateway").toBe(false);
  }, { auto: true }],
});

export { expect };
