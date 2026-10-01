import type { Page } from "@playwright/test";
import { test, expect } from "./quest-fixtures";
import {
  completeQuest,
  createQuest,
  expectExp,
  loginOwner,
  questDay,
  questRow,
  readExp,
  reopenQuest,
  rewardExp,
} from "./quest-helpers";

function archivedQuestRow(page: Page, title: string) {
  const region = page.getByRole("region", {
    name: "Archived Quests",
    exact: true,
  });

  return region
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", {
        name: title,
        exact: true,
      }),
    });
}

async function openQuestActions(page: Page, title: string) {
  const row = questRow(page, title);

  // Refresh can preserve an already-open details element after Reopen.
  if (await row.locator("details").getAttribute("open") === null) {
    await row.locator(`summary[aria-label="Quest actions: ${title}"]`).click();
  }

  return row;
}

async function archiveQuest(page: Page, title: string) {
  const row = await openQuestActions(page, title);

  await row
    .getByRole("button", {
      name: "Archive",
      exact: true,
    })
    .click();

  await expect(
    row.getByText(
      "Archive this Quest? It leaves the active list, keeps its history and EXP, and can be restored later.",
      { exact: true },
    ),
  ).toBeVisible();

  await row
    .getByRole("button", {
      name: "Confirm archive",
      exact: true,
    })
    .click();

  await expect(questRow(page, title)).toHaveCount(0);
  await expect(archivedQuestRow(page, title)).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Upcoming Calendar", exact: true }).getByRole("link", { name: title, exact: true })).toHaveCount(0);
}

async function restoreQuest(page: Page, title: string) {
  const row = archivedQuestRow(page, title);

  await row
    .getByRole("button", {
      name: "Restore",
      exact: true,
    })
    .click();

  await expect(
    row.getByText("Restore this Quest to active views?", {
      exact: true,
    }),
  ).toBeVisible();

  await row
    .getByRole("button", {
      name: "Confirm restore",
      exact: true,
    })
    .click();

  await expect(archivedQuestRow(page, title)).toHaveCount(0);
  await expect(questRow(page, title)).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Upcoming Calendar", exact: true }).getByRole("link", { name: title, exact: true })).toHaveCount(1);
}

async function deleteArchivedQuest(page: Page, title: string) {
  const row = archivedQuestRow(page, title);

  await row
    .getByRole("button", {
      name: "Delete permanently",
      exact: true,
    })
    .click();

  await expect(
    row.getByText(
      /Permanently remove this Quest from SYSTEM\?/,
    ),
  ).toBeVisible();

  await row
    .getByRole("button", {
      name: "Delete permanently",
      exact: true,
    })
    .click();

  await expect(archivedQuestRow(page, title)).toHaveCount(0);
  await expect(questRow(page, title)).toHaveCount(0);
}

async function deleteActiveQuest(page: Page, title: string) {
  const row = await openQuestActions(page, title);

  await row
    .getByRole("button", {
      name: "Delete permanently",
      exact: true,
    })
    .click();

  await expect(
    row.getByText(
      /Permanently remove this Quest from SYSTEM\?/,
    ),
  ).toBeVisible();

  await row
    .getByRole("button", {
      name: "Delete permanently",
      exact: true,
    })
    .click();

  await expect(questRow(page, title)).toHaveCount(0);
  await expect(archivedQuestRow(page, title)).toHaveCount(0);
}

async function expectDeletedAudit(
  environment: {
    owner: { id: string };
    sql: (statement: string) => Promise<string>;
  },
  title: string,
) {
  const literal = `'${title.replaceAll("'", "''")}'`;

  const audit = JSON.parse(
    await environment.sql(`
SELECT json_build_object(
  'quests',
    (
      SELECT count(*)
      FROM public.quests
      WHERE user_id = '${environment.owner.id}'::uuid
        AND title = ${literal}
    ),
  'deleted',
    (
      SELECT count(*)
      FROM public.quests
      WHERE user_id = '${environment.owner.id}'::uuid
        AND title = ${literal}
        AND deleted_at IS NOT NULL
        AND archived_at IS NOT NULL
    ),
  'cancelled',
    (
      SELECT count(*)
      FROM public.quest_occurrences o
      JOIN public.quests q
        ON q.id = o.quest_id
       AND q.user_id = o.user_id
      WHERE q.user_id = '${environment.owner.id}'::uuid
        AND q.title = ${literal}
        AND o.status = 'cancelled'
    ),
  'deletedEvents',
    (
      SELECT count(*)
      FROM public.quest_events e
      JOIN public.quests q
        ON q.id = e.quest_id
       AND q.user_id = e.user_id
      WHERE q.user_id = '${environment.owner.id}'::uuid
        AND q.title = ${literal}
        AND e.event_type = 'deleted'
    )
);`),
  );

  expect(audit).toEqual({
    quests: 1,
    deleted: 1,
    cancelled: 1,
    deletedEvents: 1,
  });
}

test(
  "Quest management UI archives, restores and permanently deletes one-off Quests safely",
  async ({ page, environment }) => {
    await loginOwner(page, environment.owner);

    await test.step("archive, restore, archive again and permanently delete", async () => {
      const baseline = await readExp(page);
      const title = await createQuest(page, "management archive restore");

      await archiveQuest(page, title);
      await expect(archivedQuestRow(page, title).locator("time")).toContainText("UTC");
      await expectExp(page, baseline);

      await restoreQuest(page, title);
      await expectExp(page, baseline);

      await archiveQuest(page, title);
      await deleteArchivedQuest(page, title);

      await expectExp(page, baseline);
      await expectDeletedAudit(environment, title);
    });

    await test.step("completed Quest must reopen before permanent deletion", async () => {
      const baseline = await readExp(page);
      const title = await createQuest(page, "management completed delete");

      await completeQuest(page, title);
      await expectExp(page, baseline + BigInt(rewardExp));

      const completedRow = await openQuestActions(page, title);

      const deleteButton = completedRow.getByRole("button", {
        name: "Delete permanently",
        exact: true,
      });

      await expect(deleteButton).toBeDisabled();
      await expect(
        completedRow.getByText(
          "Reopen this completed Quest before permanent deletion.",
          { exact: true },
        ),
      ).toBeVisible();

      await archiveQuest(page, title);
      const archivedCompleted = archivedQuestRow(page, title);
      await expect(archivedCompleted.getByRole("button", { name: "Delete permanently", exact: true })).toBeDisabled();
      await expect(archivedCompleted.getByText("Restore this Quest, then reopen it before permanent deletion.", { exact: true })).toBeVisible();
      await expectExp(page, baseline + BigInt(rewardExp));
      await restoreQuest(page, title);

      await reopenQuest(page, title);
      await expectExp(page, baseline);

      await deleteActiveQuest(page, title);

      await expectExp(page, baseline);
      await expectDeletedAudit(environment, title);
    });
  },
);

test("global management recovery replays archive and delete after a committed response is lost", async ({ page, environment }) => {
  test.setTimeout(90_000);
  const title = await createQuest(page, "management lost response");
  const storageKey = `system.quest-management.pending.v1:${environment.owner.id}`;
  const recovery = page.getByRole("region", { name: "Quest management recovery", exact: true });

  for (const operation of ["archive", "delete"] as const) {
    const row = operation === "archive" ? await openQuestActions(page, title) : archivedQuestRow(page, title);
    await row.getByRole("button", { name: operation === "archive" ? "Archive" : "Delete permanently", exact: true }).click();
    let committed = false;
    await page.route("**/dashboard**", async (route) => {
      if (!route.request().headers()["next-action"]) return route.fallback();
      // Execute the real action and RPC, then lose only its response to the browser.
      const response = await route.fetch();
      committed = response.status() === 200 && (await response.text()).includes('"outcome":"success"');
      await route.abort("failed");
    });
    await row.getByRole("button", { name: operation === "archive" ? "Confirm archive" : "Delete permanently", exact: true }).click();
    await expect(recovery.getByRole("button", { name: "Retry exact request", exact: true })).toBeEnabled();
    expect(committed, "manageQuest returned success before transport loss").toBe(true);
    await page.unrouteAll({ behavior: "wait" });
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
    expect(saved.operation).toBe(operation);

    await page.reload();
    await expect(page.getByRole("region", { name: "Daily Quests", exact: true })).toHaveAttribute("aria-busy", "false");
    await expect(questRow(page, title)).toHaveCount(0);
    if (operation === "delete") await expect(archivedQuestRow(page, title)).toHaveCount(0);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)).toEqual(saved);
    let replayed = false;
    await page.route("**/dashboard**", async (route) => {
      if (!route.request().headers()["next-action"]) return route.fallback();
      const response = await route.fetch();
      const body = await response.text();
      replayed = body.includes('"outcome":"success"') && body.includes('"replay":true');
      await route.fulfill({ response });
    });
    await recovery.getByRole("button", { name: "Retry exact request", exact: true }).click();
    await expect(recovery).toHaveCount(0);
    expect(replayed, "manageQuest confirms the same command by RPC replay").toBe(true);
    await page.unrouteAll({ behavior: "wait" });
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
    expect(await environment.sql(`SELECT count(*) FROM public.quest_events WHERE command_id='${saved.commandId}'::uuid AND user_id='${environment.owner.id}'::uuid;`)).toBe("1");
  }
  await expectDeletedAudit(environment, title);
  await page.goto(`/calendar?view=day&date=${questDay}`);
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});
