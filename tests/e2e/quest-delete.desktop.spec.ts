import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { test, expect } from "./quest-fixtures";
import {
  completeQuest,
  createQuest,
  questDay,
  questRow,
  readExp,
  reopenQuest,
  rewardExp,
} from "./quest-helpers";
import { attachQuest, createGoal, goalDetail } from "./goals-helpers";

type DisposableEnvironment = {
  url: string;
  key: string;
  owner: { id: string; email: string; password: string };
  other: { id: string; email: string; password: string };
  sql: (statement: string) => Promise<string>;
};

function disposableClient(environment: DisposableEnvironment) {
  return createClient(environment.url, environment.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type DisposableClient = ReturnType<typeof disposableClient>;

async function signIn(client: DisposableClient, account: { email: string; password: string }) {
  const auth = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (auth.error) throw new Error(`Disposable login failed: ${auth.error.message}`);
}

async function questIdByTitle(client: DisposableClient, title: string) {
  const rows = await client.from("quests").select("id,title").eq("title", title);
  if (rows.error) throw new Error(`Disposable Quest lookup failed: ${rows.error.message}`);
  if (rows.data?.length !== 1) throw new Error(`Expected exactly one disposable Quest named ${title}`);
  return rows.data[0].id as string;
}

async function oneOffOccurrence(client: DisposableClient, questId: string) {
  const rows = await client
    .from("quest_occurrences")
    .select("id,status,execution_cycle")
    .eq("quest_id", questId);
  if (rows.error) throw new Error(`Disposable occurrence lookup failed: ${rows.error.message}`);
  if (rows.data?.length !== 1) throw new Error("Expected exactly one one-off occurrence");
  return rows.data[0] as { id: string; status: string; execution_cycle: number };
}

async function originFor(environment: DisposableEnvironment, questId: string) {
  const origin = (await environment.sql(`
SELECT payload->>'origin'
FROM public.quest_events
WHERE quest_id='${questId}'::uuid
  AND event_type='created'
ORDER BY occurred_at, id
LIMIT 1;
`)).trim();
  if (!origin) throw new Error("Disposable Quest has no recorded creation origin");
  return origin;
}

function expectRpcError(result: { error: { message?: string } | null }, text: string) {
  expect(result.error, `Expected RPC error containing: ${text}`).toBeTruthy();
  expect(result.error?.message ?? "").toContain(text);
}

function rpcRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Expected one RPC receipt row");
  }
  return row as Record<string, unknown>;
}

async function createOneOff(page: Page, label: string) {
  await page.goto(`/dashboard?date=${questDay}`);
  return createQuest(page, label);
}

test("Quest Archive/Delete V1 preserves audit history, exact EXP and safety boundaries", async ({
  page,
  environment,
}) => {
  test.setTimeout(240_000);

  const owner = disposableClient(environment);
  const other = disposableClient(environment);
  await signIn(owner, environment.owner);

  try {
    await test.step("archive/restore is idempotent and hides only the active projection", async () => {
      const title = await createOneOff(page, `archive ${randomUUID()}`);
      const questId = await questIdByTitle(owner, title);
      const origin = await originFor(environment, questId);
      const archiveCommand = randomUUID();

      const archived = await owner.rpc("set_one_off_quest_archived_v1", {
        p_command_id: archiveCommand,
        p_quest_id: questId,
        p_archived: true,
        p_origin: origin,
      });
      if (archived.error) throw new Error(`Archive failed: ${archived.error.message}`);
      expect(rpcRow(archived.data).replay).toBe(false);
      expect(rpcRow(archived.data).changed).toBe(true);

      const replay = await owner.rpc("set_one_off_quest_archived_v1", {
        p_command_id: archiveCommand,
        p_quest_id: questId,
        p_archived: true,
        p_origin: origin,
      });
      if (replay.error) throw new Error(`Archive replay failed: ${replay.error.message}`);
      expect(rpcRow(replay.data).replay).toBe(true);

      const stored = await owner.from("quests").select("archived_at").eq("id", questId).single();
      expect(stored.error).toBeNull();
      expect(stored.data?.archived_at).toBeTruthy();
      const day = await owner.rpc("list_day_quest_occurrences", { p_day: questDay });
      const calendar = await owner.rpc("get_calendar_events", { p_from: questDay, p_to: questDay });
      expect(day.error).toBeNull();
      expect(calendar.error).toBeNull();
      // Fresh authenticated RPC reads distinguish a projection defect from stale UI/cache.
      expect.soft(day.data.filter((row: { quest_id: string }) => row.quest_id === questId), "Archived Quest in fresh day RPC").toEqual([]);
      expect.soft(calendar.data.filter((row: { quest_id: string }) => row.quest_id === questId), "Archived Quest in fresh Calendar RPC").toEqual([]);

      await page.reload();
      await expect(page.getByRole("region", { name: "Daily Quests", exact: true })).toHaveAttribute("aria-busy", "false");
      await expect(questRow(page, title)).toHaveCount(0);

      const restore = await owner.rpc("set_one_off_quest_archived_v1", {
        p_command_id: randomUUID(),
        p_quest_id: questId,
        p_archived: false,
        p_origin: origin,
      });
      if (restore.error) throw new Error(`Restore failed: ${restore.error.message}`);

      const restoredDay = await owner.rpc("list_day_quest_occurrences", { p_day: questDay });
      const restoredCalendar = await owner.rpc("get_calendar_events", { p_from: questDay, p_to: questDay });
      expect(restoredDay.error).toBeNull();
      expect(restoredCalendar.error).toBeNull();
      expect(restoredDay.data.filter((row: { quest_id: string }) => row.quest_id === questId)).toHaveLength(1);
      expect(restoredCalendar.data.filter((row: { quest_id: string }) => row.quest_id === questId)).toHaveLength(1);

      await page.reload();
      await expect(page.getByRole("region", { name: "Daily Quests", exact: true })).toHaveAttribute("aria-busy", "false");
      await expect(questRow(page, title)).toHaveCount(1);

      const conflictingReplay = await owner.rpc("set_one_off_quest_archived_v1", {
        p_command_id: archiveCommand,
        p_quest_id: questId,
        p_archived: false,
        p_origin: origin,
      });
      expectRpcError(conflictingReplay, "Conflicting Quest archive command reuse");
    });

    await test.step("plain one-off delete is a retained tombstone, replay-safe and browser-hidden", async () => {
      const title = await createOneOff(page, `plain delete ${randomUUID()}`);
      const questId = await questIdByTitle(owner, title);
      const occurrence = await oneOffOccurrence(owner, questId);
      const origin = await originFor(environment, questId);
      const command = randomUUID();

      const deleted = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: command,
        p_quest_id: questId,
        p_origin: origin,
      });
      if (deleted.error) throw new Error(`Delete failed: ${deleted.error.message}`);
      expect(rpcRow(deleted.data).replay).toBe(false);
      expect(rpcRow(deleted.data).occurrence_id).toBe(occurrence.id);

      const replay = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: command,
        p_quest_id: questId,
        p_origin: origin,
      });
      if (replay.error) throw new Error(`Delete replay failed: ${replay.error.message}`);
      expect(rpcRow(replay.data).replay).toBe(true);

      const browserQuest = await owner.from("quests").select("id").eq("id", questId);
      if (browserQuest.error) throw new Error(`Deleted Quest browser read failed: ${browserQuest.error.message}`);
      expect(browserQuest.data).toEqual([]);

      const browserOccurrence = await owner.from("quest_occurrences").select("id").eq("quest_id", questId);
      if (browserOccurrence.error) throw new Error(`Deleted occurrence browser read failed: ${browserOccurrence.error.message}`);
      expect(browserOccurrence.data).toEqual([]);

      const browserEvents = await owner.from("quest_events").select("id").eq("quest_id", questId);
      if (browserEvents.error) throw new Error(`Deleted events browser read failed: ${browserEvents.error.message}`);
      expect(browserEvents.data).toEqual([]);

      expect(await environment.sql(`
SELECT
  (q.deleted_at IS NOT NULL)::text || '|' ||
  (q.archived_at IS NOT NULL)::text || '|' ||
  o.status || '|' ||
  (SELECT count(*) FROM public.quest_events e
   WHERE e.quest_id=q.id AND e.user_id=q.user_id AND e.event_type='deleted')::text
FROM public.quests q
JOIN public.quest_occurrences o
  ON o.quest_id=q.id AND o.user_id=q.user_id
WHERE q.id='${questId}'::uuid;
`)).toBe("true|true|cancelled|1");

      await page.reload();
      await expect(page.getByRole("region", { name: "Daily Quests", exact: true })).toHaveAttribute("aria-busy", "false");
      await expect(questRow(page, title)).toHaveCount(0);

      const restoreDeleted = await owner.rpc("set_one_off_quest_archived_v1", {
        p_command_id: randomUUID(),
        p_quest_id: questId,
        p_archived: false,
        p_origin: origin,
      });
      expectRpcError(restoreDeleted, "Permanently deleted Quest cannot be restored or archived");

      const lateComplete = await owner.rpc("complete_quest_occurrence", {
        command_id: randomUUID(),
        occurrence_id: occurrence.id,
        expected_execution_cycle: occurrence.execution_cycle,
        reported_completed_at: null,
        origin,
      });
      expectRpcError(lateComplete, "Occurrence is not completable");

      const anotherTitle = await createOneOff(page, `delete command conflict ${randomUUID()}`);
      const anotherId = await questIdByTitle(owner, anotherTitle);
      const anotherOrigin = await originFor(environment, anotherId);
      const reuseAgainstAnotherQuest = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: command,
        p_quest_id: anotherId,
        p_origin: anotherOrigin,
      });
      expectRpcError(reuseAgainstAnotherQuest, "Conflicting Quest delete command reuse");
    });

    await test.step("completed Quest must reopen; Complete -> Reopen -> Delete never reverses EXP twice", async () => {
      const title = await createOneOff(page, `reopened delete ${randomUUID()}`);
      const questId = await questIdByTitle(owner, title);
      const occurrence = await oneOffOccurrence(owner, questId);
      const origin = await originFor(environment, questId);
      const before = await readExp(page);

      await completeQuest(page, title);
      expect(await readExp(page)).toBe(before + BigInt(rewardExp));

      const aliasCommand = randomUUID();
      const alias = await owner.rpc("complete_quest_occurrence", {
        command_id: aliasCommand,
        occurrence_id: occurrence.id,
        expected_execution_cycle: occurrence.execution_cycle,
        reported_completed_at: null,
        origin,
      });
      if (alias.error) throw new Error(`Completion alias registration failed: ${alias.error.message}`);
      expect(rpcRow(alias.data).replay).toBe(true);

      const aliasCollision = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: aliasCommand,
        p_quest_id: questId,
        p_origin: origin,
      });
      expectRpcError(aliasCollision, "Conflicting quest command reuse");

      const whileCompleted = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: randomUUID(),
        p_quest_id: questId,
        p_origin: origin,
      });
      expectRpcError(whileCompleted, "Reopen completed Quest before permanent deletion");

      await reopenQuest(page, title);
      expect(await readExp(page)).toBe(before);

      expect(await environment.sql(`
SELECT
  (SELECT count(*)
     FROM public.exp_ledger c
     JOIN public.quest_events e ON e.id=c.source_id AND e.user_id=c.user_id
    WHERE e.quest_id='${questId}'::uuid
      AND c.source_type='quest_completion'
      AND c.reason='completion_reward')::text
  || '|' ||
  (SELECT count(*)
     FROM public.exp_ledger r
     JOIN public.exp_ledger c ON c.id=r.reverses_entry_id AND c.user_id=r.user_id
     JOIN public.quest_events e ON e.id=c.source_id AND e.user_id=c.user_id
    WHERE e.quest_id='${questId}'::uuid
      AND r.source_type='quest_completion_reversal'
      AND r.reason='completion_reward_reversal')::text;
`)).toBe("1|1");

      const deleted = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: randomUUID(),
        p_quest_id: questId,
        p_origin: origin,
      });
      if (deleted.error) throw new Error(`Delete after Reopen failed: ${deleted.error.message}`);

      expect(await environment.sql(`
SELECT
  (SELECT count(*)
     FROM public.exp_ledger c
     JOIN public.quest_events e ON e.id=c.source_id AND e.user_id=c.user_id
    WHERE e.quest_id='${questId}'::uuid
      AND c.source_type='quest_completion'
      AND c.reason='completion_reward')::text
  || '|' ||
  (SELECT count(*)
     FROM public.exp_ledger r
     JOIN public.exp_ledger c ON c.id=r.reverses_entry_id AND c.user_id=r.user_id
     JOIN public.quest_events e ON e.id=c.source_id AND e.user_id=c.user_id
    WHERE e.quest_id='${questId}'::uuid
      AND r.source_type='quest_completion_reversal'
      AND r.reason='completion_reward_reversal')::text;
`)).toBe("1|1");

      await page.reload();
      await expect(page.getByRole("region", { name: "Daily Quests", exact: true })).toHaveAttribute("aria-busy", "false");
      expect(await readExp(page)).toBe(before);
      await expect(questRow(page, title)).toHaveCount(0);
    });

    await test.step("current Main Quest membership blocks delete until detach", async () => {
      const title = await createOneOff(page, `goal linked delete ${randomUUID()}`);
      const questId = await questIdByTitle(owner, title);
      const origin = await originFor(environment, questId);

      await page.goto("/goals");
      await createGoal(page, `Delete guard ${randomUUID()}`);
      await attachQuest(page, title);

      const blocked = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: randomUUID(),
        p_quest_id: questId,
        p_origin: origin,
      });
      expectRpcError(blocked, "Detach Quest from Main Quest before permanent deletion");

      await goalDetail(page)
        .getByRole("button", { name: `Detach ${title}`, exact: true })
        .click();

      // The click only starts the Next Server Action. Wait for the authoritative
      // Goal projection and database state before racing a direct delete RPC.
      await expect(goalDetail(page)).toContainText("0 / 0 Sub Quests");
      await expect.poll(async () => environment.sql(`
SELECT count(*)
FROM public.goal_quest_links
WHERE quest_id='${questId}'::uuid
  AND user_id='${environment.owner.id}'::uuid
  AND detached_at IS NULL;
`)).toBe("0");

      const deleted = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: randomUUID(),
        p_quest_id: questId,
        p_origin: origin,
      });
      if (deleted.error) throw new Error(`Delete after Goal detach failed: ${deleted.error.message}`);
    });

    await test.step("recurring Quest is rejected and non-owner can never delete owner data", async () => {
      await page.goto(`/dashboard?date=${questDay}`);
      const recurringTitle = `Delete recurring guard ${randomUUID()}`;
      const form = page.getByRole("region", { name: "Create Quest", exact: true });
      await form.getByLabel("Quest type", { exact: true }).selectOption("daily");
      await form.getByLabel("Title", { exact: true }).fill(recurringTitle);
      await form.getByLabel("Start date", { exact: true }).fill(questDay);
      await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
      await expect(form.getByRole("status")).toContainText("Recurring Quest created");

      const recurringId = await questIdByTitle(owner, recurringTitle);
      const recurringOrigin = await originFor(environment, recurringId);
      const recurringDelete = await owner.rpc("delete_one_off_quest_v1", {
        p_command_id: randomUUID(),
        p_quest_id: recurringId,
        p_origin: recurringOrigin,
      });
      expectRpcError(recurringDelete, "Quest Delete V1 supports one-off Quests only");

      const ownerTitle = await createOneOff(page, `owner only delete ${randomUUID()}`);
      const ownerQuestId = await questIdByTitle(owner, ownerTitle);
      const ownerOrigin = await originFor(environment, ownerQuestId);

      await signIn(other, environment.other);
      const forbidden = await other.rpc("delete_one_off_quest_v1", {
        p_command_id: randomUUID(),
        p_quest_id: ownerQuestId,
        p_origin: ownerOrigin,
      });
      expectRpcError(forbidden, "SYSTEM owner authorization required");
      expectRpcError(await other.rpc("list_day_quest_occurrences", { p_day: questDay }), "SYSTEM owner authorization required");
      expectRpcError(await other.rpc("get_calendar_events", { p_from: questDay, p_to: questDay }), "SYSTEM owner authorization required");

      const stillVisible = await owner.from("quests").select("id").eq("id", ownerQuestId);
      if (stillVisible.error) throw new Error(`Owner Quest verification failed: ${stillVisible.error.message}`);
      expect(stillVisible.data?.length).toBe(1);
    });
  } finally {
    await owner.auth.signOut({ scope: "local" });
    await other.auth.signOut({ scope: "local" });
  }
});
