import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { en, vi } from "../../src/lib/localization/dictionaries";

export const pendingKey = "system.library.pending-create.v1";
export const detail = (page: Page) => page.getByRole("region", { name: en.library.detail, exact: true });
export const editor = (page: Page) => page.getByRole("region", { name: en.library.editTitle, exact: true });
export async function createLibraryBook(page: Page, title: string) {
  await page.goto("/library/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add book", exact: true }).click();
  await expect(detail(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
  return new URL(page.url()).pathname.split("/").at(-1)!;
}
export async function libraryClient(environment: { url: string; key: string; owner: { email: string; password: string } }) {
  const client = createClient(environment.url, environment.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await client.auth.signInWithPassword(environment.owner);
  if (auth.error) throw new Error("Disposable Library owner login failed");
  return client;
}
export async function seedBook(client: Awaited<ReturnType<typeof libraryClient>>, fields: Record<string, string | null>) {
  const id = randomUUID();
  const result = await client.rpc("create_book_v1", { p_book_id: id, p_fields: fields });
  if (result.error) throw new Error("Disposable Library fixture creation failed");
  return id;
}
export async function assertLibraryLayout(page: Page) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    right: Math.max(...Array.from(document.body.querySelectorAll("*"), e => e.getBoundingClientRect().right)) }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
  for (const control of await page.locator("main button:visible, main a:visible, main input:visible, main select:visible, .system-nav a:visible").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}

export async function libraryVisualJourney(page: Page, environment: Parameters<typeof libraryClient>[0], sizes: { width: number; height: number }[], info: TestInfo) {
  const client = await libraryClient(environment);
  const t = en.library;
  const title = "The Art of Paying Attention — Sách và những điều cần nhớ " + "LongTitle".repeat(13);
  const notes = "A quiet space to understand what you read.\nGiữ lại điều bạn hiểu, bằng lời của chính mình.\n\n".repeat(16) + "LongNote".repeat(40);
  const id = await seedBook(client, { title, author: "Synthetic author with a long name for wrapping", status: "reading", summary: "An example of a short, considered summary.", content_notes: notes, lessons: "Return to one idea and put it into practice." });
  const broken = await seedBook(client, { title: "A book with an unavailable cover", cover_url: "https://library-cover.invalid/missing.png", status: "finished" });
  await page.route("https://library-cover.invalid/**", route => route.abort("failed"));
  const archived = await seedBook(client, { title: "A retained chapter", summary: "Archived content stays readable.", content_notes: notes, status: "finished" });
  if ((await client.rpc("set_book_archived_v1", { p_book_id: archived, p_expected_revision: "1", p_archived: true })).error) throw new Error("Archive fixture failed");
  try {
    for (const size of sizes) {
      await page.setViewportSize(size);
      const shot = async (state: string) => { await assertLibraryLayout(page); await page.screenshot({ path: info.outputPath(`library-${size.width}x${size.height}-${state}.png`), fullPage: true }); };
      await page.goto("/library"); await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByText(t.coverFailed, { exact: true })).toBeVisible(); await shot("collection");
      await page.getByRole("navigation", { name: t.filters }).getByRole("link", { name: "Reading", exact: true }).click();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible(); await shot("filtered");
      await page.goto("/library?scope=archived"); await expect(page.getByRole("heading", { name: "A retained chapter", exact: true })).toBeVisible(); await shot("archived-collection");
      await page.goto(`/library?after=${encodeURIComponent(JSON.stringify({ created_at: "0001-01-01T00:00:00.000001Z", id }))}`);
      await expect(page.getByText(t.filteredEmpty, { exact: true })).toBeVisible(); await shot("empty");
      await page.goto("/library/new"); await expect(page.getByRole("button", { name: t.add, exact: true })).toBeEnabled();
      await page.getByLabel("Title", { exact: true }).fill("Unsaved visual draft");
      await page.getByLabel("Content notes", { exact: true }).fill(notes); await shot("new");
      await page.goto(`/library/${id}`); await expect(detail(page)).toBeVisible(); await shot("detail-long-notes");
      await detail(page).getByRole("button", { name: t.edit, exact: true }).click();
      await expect(editor(page)).toBeVisible(); await shot("editor");
      await page.goto(`/library/${archived}`); await expect(detail(page).getByText(t.readOnly)).toBeVisible(); await shot("archived-detail");
      await page.goto(`/library/${broken}`); await expect(page.getByText(t.coverFailed, { exact: true })).toBeVisible(); await shot("broken-cover");
      await page.goto("/library/new");
      await page.evaluate(key => sessionStorage.setItem(key, "{"), pendingKey); await page.reload();
      await expect(page.getByRole("button", { name: t.resetBlocked })).toBeVisible(); await shot("recovery");
      await page.getByRole("button", { name: t.resetBlocked }).click();
      await expect(page.getByRole("button", { name: t.add, exact: true })).toBeEnabled();
      await page.getByLabel("Title", { exact: true }).fill("Draft across language refresh");
      await page.getByLabel("Language", { exact: true }).selectOption("vi"); await page.getByRole("button", { name: "Apply language", exact: true }).click();
      await expect(page.getByLabel(vi.library.fields.title, { exact: true })).toHaveValue("Draft across language refresh");
      await shot("vietnamese-new");
      await page.getByLabel("Ngôn ngữ", { exact: true }).selectOption("en"); await page.getByRole("button", { name: "Áp dụng ngôn ngữ", exact: true }).click();
      await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const submit = page.getByRole("button", { name: t.add, exact: true });
    await submit.scrollIntoViewIfNeeded(); await submit.focus();
    await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(submit).toBeFocused();
    expect(await submit.evaluate(e => getComputedStyle(e).outlineStyle)).toBe("solid");
    expect(await submit.evaluate(e => getComputedStyle(e).transitionDuration.split(",").every(s => Number.parseFloat(s) === 0))).toBe(true);
  } finally { await client.auth.signOut({ scope: "local" }); }
}
