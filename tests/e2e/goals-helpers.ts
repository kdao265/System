import { expect, type Page } from "@playwright/test";

export const goalDetail = (page: Page) => page.getByRole("region", { name: "Main Quest detail", exact: true });
export async function createGoal(page: Page, title: string) {
  const form = page.getByRole("region", { name: "Create Main Quest", exact: true });
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByRole("button", { name: "Create Main Quest", exact: true }).click();
  await expect(goalDetail(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
  return new URL(page.url()).searchParams.get("id")!;
}
export async function attachQuest(page: Page, title: string) {
  const detail = goalDetail(page);
  const disclosure = detail.locator("details").filter({ has: page.locator("summary", { hasText: "Attach Sub Quest" }) });
  if (!await disclosure.evaluate((e) => (e as HTMLDetailsElement).open)) await disclosure.locator("summary").click();
  await detail.getByLabel("Eligible Quest", { exact: true }).selectOption({ label: title });
  await detail.getByRole("button", { name: "Attach selected Quest", exact: true }).click();
  await expect(detail.getByRole("list", { name: "Sub Quests", exact: true }).getByRole("heading", { name: title, exact: true })).toBeVisible();
}
export const subRow = (page: Page, title: string) => goalDetail(page).getByRole("list", { name: "Sub Quests", exact: true })
  .getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
