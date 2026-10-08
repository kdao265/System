import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";
import { loginOwner } from "./quest-helpers";
import { createLibraryBook, detail, editor, libraryClient, libraryVisualJourney, pendingKey, seedBook } from "./library-helpers";
import { en } from "../../src/lib/localization/dictionaries";

const t = en.library;
test("Library real create/edit/status/filter/archive/restore journey and private routes", async ({ page, context, environment }) => {
  test.setTimeout(150_000);
  for (const path of ["/library", "/library/new", `/library/${randomUUID()}`]) { await page.goto(path); await expect(page).toHaveURL(/\/login$/); }
  await loginOwner(page, environment.owner);
  await page.getByRole("navigation", { name: "SYSTEM navigation" }).getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByText(t.empty, { exact: true })).toBeVisible();
  const title = `Library journey ${randomUUID()}`;
  const id = await createLibraryBook(page, title);
  await expect(page.locator('.system-nav [aria-current="page"]')).toHaveAttribute("href", "/library");
  expect(await page.evaluate(key => sessionStorage.getItem(key), pendingKey)).toBeNull();
  await detail(page).getByRole("button", { name: t.edit, exact: true }).click();
  for (const [label, value] of [["Author", "Synthetic author"], ["Summary", "A short summary"], ["Content notes", "Notes across\nmultiple lines"], ["Lessons / takeaways", "Keep one useful idea"]]) await editor(page).getByLabel(label, { exact: true }).fill(value);
  await editor(page).getByRole("button", { name: t.save, exact: true }).click();
  await expect(detail(page).getByText("Synthetic author", { exact: true })).toBeVisible();
  await expect(detail(page)).toContainText("Notes across");
  for (const status of ["reading", "finished", "want_to_read", "finished", "reading"]) {
    await detail(page).getByLabel("Reading status", { exact: true }).selectOption(status);
    await detail(page).getByRole("button", { name: t.statusSave, exact: true }).click();
    await expect(detail(page).locator(".library-badges")).toContainText(t.statuses[status as keyof typeof t.statuses]);
  }
  await page.reload(); await expect(detail(page)).toContainText("Keep one useful idea");
  await page.getByRole("link", { name: t.back, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: t.collection })).not.toContainText("A short summary");
  await page.getByRole("navigation", { name: t.filters }).getByRole("link", { name: t.statuses.finished, exact: true }).click();
  await expect(page.getByText(t.filteredEmpty, { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: t.filters }).getByRole("link", { name: t.statuses.reading, exact: true }).click();
  await page.getByRole("heading", { name: title, exact: true }).getByRole("link").click();
  await page.getByRole("button", { name: t.archive, exact: true }).click();
  await page.getByRole("button", { name: t.confirmArchive, exact: true }).click();
  await expect(detail(page).getByText(t.readOnly)).toBeVisible();
  await expect(detail(page).getByRole("button", { name: t.edit, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);
  await page.goto("/library?scope=archived"); await page.getByRole("heading", { name: title, exact: true }).getByRole("link").click();
  await expect(detail(page)).toContainText("Notes across");
  await detail(page).getByRole("button", { name: t.restore, exact: true }).click();
  await expect(detail(page).getByRole("button", { name: t.edit, exact: true })).toBeVisible();
  await expect(detail(page).locator(".library-badges")).toContainText(t.statuses.reading);
  await page.goto(`/library/${randomUUID()}`); await expect(page.getByRole("main").getByRole("alert")).toContainText(t.notFound);
  await page.goto("/library/invalid-id"); await expect(page.getByRole("main").getByRole("alert")).toContainText(t.notFound);
  await context.clearCookies(); await page.goto(`/library/${id}`); await expect(page).toHaveURL(/\/login$/);
});

test("Library conflict preserves draft, refetches and rebases only on explicit review", async ({ page, environment }, info) => {
  await loginOwner(page, environment.owner);
  const id = await createLibraryBook(page, `Conflict ${randomUUID()}`);
  const client = await libraryClient(environment);
  try {
    await detail(page).getByRole("button", { name: t.edit, exact: true }).click();
    await editor(page).getByLabel("Content notes", { exact: true }).fill("My retained draft");
    if ((await client.rpc("update_book_v1", { p_book_id: id, p_expected_revision: "1", p_changes: { content_notes: "A concurrent saved note" } })).error) throw new Error("Concurrent fixture edit failed");
    await editor(page).getByRole("button", { name: t.save, exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(t.conflict);
    await expect(editor(page).getByLabel("Content notes", { exact: true })).toHaveValue("My retained draft");
    await expect(page.getByRole("region", { name: t.review, exact: true })).toContainText("A concurrent saved note");
    await expect(editor(page).getByRole("button", { name: t.save, exact: true })).toBeDisabled();
    for (const [width, height] of [[1280, 800], [1024, 768], [820, 900], [412, 915], [390, 844], [360, 800]]) {
      await page.setViewportSize({ width, height }); await page.screenshot({ path: info.outputPath(`library-${width}x${height}-conflict.png`), fullPage: true });
    }
    await page.getByRole("button", { name: t.keepDraft, exact: true }).click();
    await editor(page).getByRole("button", { name: t.save, exact: true }).click();
    await expect(detail(page)).toContainText("My retained draft");
    const current = await client.rpc("get_book_v1", { p_book_id: id }); expect(current.data.book.revision).toBe("3");
  } finally { await client.auth.signOut({ scope: "local" }); }
});

test("Library lost create response converges on the saved identity; blocked and absent recovery stays explicit", async ({ page, environment }, info) => {
  test.setTimeout(120_000);
  await loginOwner(page, environment.owner); await page.goto("/library/new");
  const title = `Lost response ${randomUUID()}`; await page.getByLabel("Title", { exact: true }).fill(title);
  let calls = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    calls++; await gate; await route.fetch(); await route.abort("failed");
  });
  await page.locator(".library-create form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled(); release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(t.uncertain); expect(calls).toBe(1);
  const pending = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), pendingKey);
  expect(Object.keys(pending).sort()).toEqual(["bookId", "userId", "version"]);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
  for (const [width, height] of [[1280, 800], [1024, 768], [820, 900], [412, 915], [390, 844], [360, 800]]) {
    await page.setViewportSize({ width, height }); await page.screenshot({ path: info.outputPath(`library-${width}x${height}-uncertain.png`), fullPage: true });
  }
  await page.unrouteAll({ behavior: "wait" }); await page.reload();
  await expect(page.getByRole("main").getByRole("status")).toContainText(t.existing);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), pendingKey)).toBeNull();
  await page.getByRole("link", { name: t.open, exact: true }).click(); await expect(detail(page)).toContainText(title);
  await page.goto("/library/new");
  for (const raw of ["{", JSON.stringify({ version: 1, userId: environment.other.id, bookId: randomUUID() })]) {
    await page.evaluate(({ key, raw }) => sessionStorage.setItem(key, raw), { key: pendingKey, raw }); await page.reload();
    expect(await page.evaluate(key => sessionStorage.getItem(key), pendingKey)).toBe(raw);
    await page.getByRole("button", { name: t.resetBlocked, exact: true }).click();
    await expect(page.getByRole("button", { name: t.add, exact: true })).toBeEnabled();
  }
  const absent = { version: 1, userId: environment.owner.id, bookId: randomUUID() };
  await page.evaluate(({ key, absent }) => sessionStorage.setItem(key, JSON.stringify(absent)), { key: pendingKey, absent }); await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(t.absent);
  await page.getByRole("button", { name: t.continueSame, exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Same identity after absence");
  await page.getByRole("button", { name: t.add, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/library/${absent.bookId}$`));
});

test("Library visual QA at desktop and tablet sizes", async ({ page, environment }, info) => {
  test.setTimeout(180_000); await loginOwner(page, environment.owner);
  await libraryVisualJourney(page, environment, [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 820, height: 900 }], info);
});

test("Library bounded pagination preserves opaque cursor and never mixes long text into cards", async ({ page, environment }) => {
  test.setTimeout(120_000); await loginOwner(page, environment.owner);
  const client = await libraryClient(environment);
  try {
    for (let n = 0; n < 51; n++) await seedBook(client, { title: `Pagination ${String(n).padStart(2, "0")}`, summary: "Never on a card" });
    await page.goto("/library?status=want_to_read");
    await expect(page.getByRole("list", { name: t.collection }).getByRole("listitem")).toHaveCount(50);
    const href = await page.getByRole("link", { name: t.next, exact: true }).getAttribute("href");
    const cursor = JSON.parse(new URL(href!, environment.app).searchParams.get("after")!);
    const expectedPage = await client.rpc("list_books_v1", { p_scope: "active", p_status: "want_to_read", p_limit: 50 });
    if (expectedPage.error) throw new Error("Pagination fixture read failed");
    expect(cursor).toEqual(expectedPage.data.next_cursor);
    await page.getByRole("link", { name: t.next, exact: true }).click();
    await expect(page.getByRole("link", { name: t.first, exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: t.collection })).not.toContainText("Never on a card");
  } finally { await client.auth.signOut({ scope: "local" }); }
});
