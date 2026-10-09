import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";
import { loginOwner } from "./quest-helpers";
import { assertLibraryLayout, createLibraryBook, detail, editor, libraryVisualJourney } from "./library-helpers";
import { en } from "../../src/lib/localization/dictionaries";

test("Library mobile creation, long notes, keyboard, archive and restore at 360/390/412", async ({ page, environment }) => {
  test.setTimeout(150_000); const t = en.library; await loginOwner(page, environment.owner);
  for (const [width, height] of [[360, 800], [390, 844], [412, 915]]) {
    await page.setViewportSize({ width, height });
    const title = `Mobile ${randomUUID()} ` + "LongTitle".repeat(18);
    const id = await createLibraryBook(page, title); await assertLibraryLayout(page);
    await detail(page).getByRole("button", { name: t.edit, exact: true }).click();
    await editor(page).getByLabel("Content notes", { exact: true }).fill("Notes tiếng Việt\n".repeat(100));
    const save = editor(page).getByRole("button", { name: t.save, exact: true });
    await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport(); await save.focus();
    await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(save).toBeFocused();
    await page.keyboard.press("Enter"); await expect(detail(page)).toContainText("Notes tiếng Việt"); await assertLibraryLayout(page);
    await page.goto("/library"); await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible(); await assertLibraryLayout(page);
    await page.goto(`/library/${id}`); await page.getByRole("button", { name: t.archive, exact: true }).click();
    await page.getByRole("button", { name: t.confirmArchive, exact: true }).click();
    await expect(detail(page).getByText(t.readOnly)).toBeVisible(); await assertLibraryLayout(page);
    const restore = detail(page).getByRole("button", { name: t.restore, exact: true });
    await restore.scrollIntoViewIfNeeded(); await expect(restore).toBeInViewport(); await restore.click();
    await expect(detail(page).getByRole("button", { name: t.edit, exact: true })).toBeVisible();
  }
});

test("Library visual QA in both languages at all three phone sizes", async ({ page, environment }, info) => {
  test.setTimeout(180_000); await loginOwner(page, environment.owner);
  await libraryVisualJourney(page, environment, [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }], info);
});
