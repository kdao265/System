import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

// A fixed selected day avoids midnight/timezone races. Planned time is explicitly
// entered through the UI; completion permits scheduled work regardless of age.
export const questDay = "2026-09-20";
export const rewardExp = 37;

export function questRow(page: Page, title: string) {
  return page.getByRole("list", { name: "Quest occurrences", exact: true })
    .getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function expDisplay(page: Page) {
  return page.getByRole("region", { name: "Progression status", exact: true })
    .getByText(/^\d+ EXP$/, { exact: true });
}

export async function readExp(page: Page) {
  const display = expDisplay(page);
  await expect(display).toBeVisible();
  const value = (await display.innerText()).match(/^(\d+) EXP$/);
  if (!value) throw new Error("Expected an exact numeric EXP display");
  return BigInt(value[1]);
}

export async function expectExp(page: Page, expected: bigint) {
  await expect(expDisplay(page)).toHaveText(`${expected} EXP`);
  return readExp(page);
}

export async function loginOwner(page: Page, owner: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const setup = page.getByRole("heading", { name: "Profile Setup", exact: true });
  // Wait for a rendered destination, not the intermediate /dashboard redirect.
  await expect(setup.or(page.getByRole("heading", { name: "SYSTEM", exact: true }))).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel("Display name").fill("Quest E2E Owner");
    await page.getByLabel("Timezone", { exact: true }).selectOption("UTC");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("region", { name: "Player status", exact: true })).toContainText(owner.email);
  await page.getByLabel("Choose date", { exact: true }).fill(questDay);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard\\?date=${questDay}$`));
}

export async function createQuest(page: Page, scenario: string) {
  const title = `E2E ${scenario} ${randomUUID()}`;
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByLabel("Planned start (optional)", { exact: true }).fill(`${questDay}T12:00`);
  await form.getByLabel("Reward EXP", { exact: true }).fill(String(rewardExp));
  await form.getByRole("button", { name: "Schedule Quest", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Quest created:");
  // Creation confirms its receipt; a fresh selected-day read displays the row.
  await page.reload();
  const row = questRow(page, title);
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Status: Scheduled", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Complete", exact: true })).toBeEnabled();
  return title;
}

export async function expectCompleted(page: Page, title: string) {
  const row = questRow(page, title);
  await expect(row.getByText("Status: Completed", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Reopen", exact: true })).toBeEnabled();
}

export async function completeQuest(page: Page, title: string) {
  const row = questRow(page, title);
  await row.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(row.getByRole("status")).toContainText("An earlier completion request is confirmed.");
  // Completion deliberately requires a current-state read. Both recovery panels
  // may offer this same accessible link; either reloads the selected day.
  await page.getByRole("link", { name: "Reload selected day", exact: true }).first().click();
  await expectCompleted(page, title);
}

export async function reopenQuest(page: Page, title: string) {
  const row = questRow(page, title);
  await row.getByRole("button", { name: "Reopen", exact: true }).click();
  await row.getByRole("button", { name: "Confirm reopen", exact: true }).click();
  // Reopen automatically refreshes its server projection. Wait for that read,
  // rather than relying on a receipt message or timing the request.
  await expect(row.getByText("Status: Scheduled", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Complete", exact: true })).toBeEnabled();
}

// Browser-visible totals cannot prove the absence of offsetting duplicate ledger
// entries. This SELECT-only audit is scoped to the synthetic owner's unique title.
export async function expectQuestHistory(
  environment: { owner: { id: string }; sql: (query: string) => Promise<string> },
  title: string, completions: number, reversals: number,
) {
  expect(environment.owner.id).toMatch(/^[a-f0-9-]{36}$/);
  const literal = `'${title.replaceAll("'", "''")}'`;
  const history = JSON.parse(await environment.sql(`
    WITH quests AS (
      SELECT id FROM public.quests WHERE user_id = '${environment.owner.id}' AND title = ${literal}
    ), events AS (
      SELECT e.* FROM public.quest_events e JOIN quests q ON q.id = e.quest_id
    ), ledger AS (
      SELECT l.*, e.execution_cycle FROM public.exp_ledger l JOIN events e ON e.id = l.source_id
      WHERE l.user_id = '${environment.owner.id}'
    )
    SELECT json_build_object(
      'quests', (SELECT count(*) FROM quests),
      'occurrences', (SELECT count(*) FROM public.quest_occurrences o JOIN quests q ON q.id = o.quest_id),
      'completedCycles', (SELECT coalesce(json_agg(execution_cycle ORDER BY execution_cycle), '[]') FROM events WHERE event_type = 'completed'),
      'correctedCycles', (SELECT coalesce(json_agg(execution_cycle ORDER BY execution_cycle), '[]') FROM events WHERE event_type = 'completion_corrected'),
      'reopened', (SELECT count(*) FROM events WHERE event_type = 'reopened'),
      'credits', (SELECT coalesce(json_agg(json_build_object('cycle', execution_cycle, 'amount', amount::text) ORDER BY execution_cycle), '[]') FROM ledger WHERE source_type = 'quest_completion'),
      'reversals', (SELECT coalesce(json_agg(json_build_object('cycle', execution_cycle, 'amount', amount::text) ORDER BY execution_cycle), '[]') FROM ledger WHERE source_type = 'quest_completion_reversal')
    );`));
  expect(history).toEqual({
    quests: 1, occurrences: 1,
    completedCycles: Array.from({ length: completions }, (_, index) => index + 1),
    correctedCycles: Array.from({ length: reversals }, (_, index) => index + 1),
    reopened: reversals,
    credits: Array.from({ length: completions }, (_, index) => ({ cycle: index + 1, amount: String(rewardExp) })),
    reversals: Array.from({ length: reversals }, (_, index) => ({ cycle: index + 1, amount: String(-rewardExp) })),
  });
}
