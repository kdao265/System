import { test, expect } from "./fixtures";
import { loginOwner, questDay } from "./quest-helpers";

// Installability and phone-layout coverage for the Personal Beta PWA. These checks are
// read-only: they never create, complete, reopen or resolve a Quest, so the mutating
// lifecycle stays in the desktop Quest suite and is not duplicated per mobile project.
//
// The service worker is not executed here because the Playwright configuration blocks
// service workers on purpose; the delivered script and its cache allowlist are asserted,
// and real installation behavior stays a device check.

const phoneWidths = [360, 390, 412];
const phoneHeight = 800;
const expectedIcons = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
const precacheAllowlist = [
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon-180.png",
];

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, where: string) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    let widest = 0;
    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
      widest = Math.max(widest, element.getBoundingClientRect().right);
    }
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, widest };
  });
  expect(metrics.scrollWidth, `${where}: the document must not scroll horizontally`)
    .toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(Math.ceil(metrics.widest), `${where}: no element may extend past the viewport edge`)
    .toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test("the manifest advertises installable Personal Beta metadata", async ({ page }) => {
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"] ?? "").toContain("manifest");
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/", name: "SYSTEM", short_name: "SYSTEM", display: "standalone",
    start_url: "/dashboard", scope: "/", background_color: "#09090b", theme_color: "#09090b",
  });
  expect(manifest.icons).toEqual(expectedIcons);
});

test("every required installability asset resolves from the isolated build", async ({ page }) => {
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  const sources = [...manifest.icons.map((icon: { src: string }) => icon.src), "/icons/icon.svg", "/favicon.ico"];
  for (const source of sources) {
    const response = await page.request.get(source);
    expect(response.status(), `${source} must resolve from the production build`).toBe(200);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType, `${source} content type`).toMatch(/image\/(png|svg\+xml|x-icon|vnd\.microsoft\.icon)/);
    const body = await response.body();
    expect(body.length, `${source} must not be empty`).toBeGreaterThan(300);
    // A real image, not a rewritten HTML error page.
    if (source.endsWith(".png")) expect(body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    if (source.endsWith(".ico")) expect(body.subarray(0, 4).toString("hex")).toBe("00000100");
  }

  await page.goto("/login");
  const appleIcon = page.locator('link[rel="apple-touch-icon"]');
  await expect(appleIcon).toHaveCount(1);
  const href = await appleIcon.getAttribute("href");
  expect(href).toBeTruthy();
  const touch = await page.request.get(href!);
  expect(touch.status(), "the Apple touch icon must resolve").toBe(200);
  expect(touch.headers()["content-type"] ?? "").toContain("image/png");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#09090b");
  expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");
  // Both names are checked: the standard one and the legacy Apple one iOS recognized first.
  for (const name of ["mobile-web-app-capable", "apple-mobile-web-app-capable"]) {
    await expect(page.locator(`meta[name="${name}"]`)).toHaveAttribute("content", "yes");
  }
});


test("the service worker is delivered fresh and caches only static installability assets", async ({ page }) => {
  const response = await page.request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"] ?? "").toContain("javascript");
  // A stale worker script would keep an old static cache alive.
  expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  const source = await response.text();

  const declared = (source.match(/const PRECACHE = \[([\s\S]*?)\];/) ?? [])[1];
  expect(declared, "the worker must declare its cache allowlist").toBeTruthy();
  // Compare the paths themselves, not the surrounding quotes.
  const entries = (declared!.match(/"[^"]+"/g) ?? []).map((entry) => entry.slice(1, -1));
  expect(entries, "the worker cache allowlist must stay static-only").toEqual(precacheAllowlist);
  expect(source).toContain("skipWaiting");
  expect(source).toContain("clients.claim");

  // Authenticated application traffic and stored data must never be handled here.
  for (const forbidden of ["/dashboard", "/login", "/api", "supabase", "localStorage", "indexedDB"]) {
    expect(source, `the worker must not reference ${forbidden}`).not.toContain(forbidden);
  }
});

test("the sign-in screen stays usable and overflow-free at phone widths", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  for (const width of phoneWidths) {
    await page.setViewportSize({ width, height: phoneHeight });
    await expectNoHorizontalOverflow(page, `/login at ${width}px`);
    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await expect(page.getByLabel("Email", { exact: true })).toBeEditable();
    await expect(page.getByLabel("Password", { exact: true })).toBeEditable();
  }
  // Touch devices get finger-sized controls; desktop spacing is unchanged.
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  expect((await signIn.boundingBox())!.height, "sign-in must be finger-sized").toBeGreaterThanOrEqual(44);
});

test("the dashboard keeps Quest controls reachable and overflow-free at phone widths", async ({ page, environment }) => {
  test.setTimeout(120_000);
  await loginOwner(page, environment.owner);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

  for (const width of phoneWidths) {
    await page.setViewportSize({ width, height: phoneHeight });
    await page.goto(`/dashboard?date=${questDay}`);
    await expect(page.getByRole("region", { name: "Player status", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "SYSTEM", exact: true })).toBeVisible();
    // Streamed panels above creation can replace short fallbacks with tall content
    // after navigation. Check reachability against the settled Dashboard layout.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page, `/dashboard at ${width}px`);

    // Quest creation controls stay reachable, not merely present in the document.
    const create = page.getByRole("region", { name: "Create Quest", exact: true });
    for (const label of ["Title", "Planned start (optional)", "Reward EXP", "Importance"]) {
      const field = create.getByLabel(label, { exact: true });
      await field.scrollIntoViewIfNeeded();
      await expect(field).toBeInViewport();
    }
    const schedule = create.getByRole("button", { name: "Schedule Quest", exact: true });
    await schedule.scrollIntoViewIfNeeded();
    await expect(schedule).toBeInViewport();
    expect((await schedule.boundingBox())!.height, "the primary Quest action must be finger-sized")
      .toBeGreaterThanOrEqual(44);

    // Day navigation and the daily Quest region stay reachable.
    const dailyQuests = page.getByRole("region", { name: "Daily Quests", exact: true });
    await dailyQuests.scrollIntoViewIfNeeded();
    await expect(dailyQuests.getByLabel("Choose date", { exact: true })).toBeVisible();
    const view = dailyQuests.getByRole("button", { name: "View", exact: true });
    await view.scrollIntoViewIfNeeded();
    await expect(view).toBeInViewport();
    expect((await view.boundingBox())!.height, "day navigation must be finger-sized").toBeGreaterThanOrEqual(44);
    await expect(dailyQuests.getByRole("status")).toContainText(/No Quests for this day|Readiness reflects/);

    // Sign-out stays reachable, so an installed app cannot strand the session.
    const signOut = page.getByRole("button", { name: "Sign out", exact: true });
    await signOut.scrollIntoViewIfNeeded();
    await expect(signOut).toBeInViewport();
  }
});
