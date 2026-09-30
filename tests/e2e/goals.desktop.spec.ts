import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./quest-fixtures";
import { completeQuest, createQuest, expectQuestHistory, questDay, reopenQuest, rewardExp } from "./quest-helpers";
import { attachQuest, createGoal, goalDetail, subRow } from "./goals-helpers";

test("Main Quest live projection, normal Quest lifecycle, archive/restore and protection", async ({ page, environment }) => {
  test.setTimeout(150_000);
  const titles = [];
  for (let i = 0; i < 3; i++) titles.push(await createQuest(page, `Goal sub ${i}`));
  await page.getByRole("link", { name: "Goals / Main Quests", exact: true }).click();
  const title = `Main ${randomUUID()}`;
  const id = await createGoal(page, title);
  const detail = goalDetail(page);
  await expect(detail).toContainText("0 / 0 Sub Quests");
  await expect(detail.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(detail.getByText("Active · Incomplete", { exact: true })).toBeVisible();
  for (const sub of titles) await attachQuest(page, sub);
  await expect(detail).toContainText("0 / 3 Sub Quests");
  await expect(detail.getByRole("list", { name: "Sub Quests", exact: true }).getByRole("heading")).toHaveText(titles);
  await page.reload(); await expect(detail).toContainText("0 / 3 Sub Quests");
  for (let i = 0; i < titles.length; i++) {
    await page.goto(`/dashboard?date=${questDay}`); await completeQuest(page, titles[i]);
    await page.goto(`/goals?id=${id}`); await expect(detail).toContainText(`${i + 1} / 3 Sub Quests`);
  }
  await expect(detail.getByText("Complete", { exact: true })).toBeVisible();
  await expect(detail.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await page.goto(`/dashboard?date=${questDay}`); await reopenQuest(page, titles[0]);
  await page.goto(`/goals?id=${id}`); await expect(detail).toContainText("2 / 3 Sub Quests");
  await expect(detail.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "66.6");
  await detail.getByRole("button", { name: `Detach ${titles[1]}`, exact: true }).click();
  await expect(detail).toContainText("1 / 2 Sub Quests");
  await expect(detail.getByRole("list", { name: "Sub Quests", exact: true }).getByRole("heading")).toHaveText([titles[0], titles[2]]);
  await detail.getByRole("button", { name: "Archive Main Quest", exact: true }).click();
  await expect(detail).toContainText("read-only until restored");
  await expect(detail.getByText("Edit Main Quest", { exact: true })).toHaveCount(0);
  await expect(detail.getByText("Attach Sub Quest", { exact: true })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: /^Detach / })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Main Quest list" }).getByRole("link", { name: title, exact: true })).toHaveCount(0);
  await page.goto(`/dashboard?date=${questDay}`); await reopenQuest(page, titles[2]);
  await page.goto("/goals?scope=archived"); await page.getByRole("link", { name: title, exact: true }).click();
  await expect(detail).toContainText("0 / 2 Sub Quests");
  await detail.getByRole("button", { name: "Restore Main Quest", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Archive Main Quest", exact: true })).toBeVisible();
  await detail.getByText("Edit Main Quest", { exact: true }).click();
  await detail.getByLabel("Title", { exact: true }).fill(`${title} edited`);
  await detail.getByLabel("Description (optional)").fill("Live planning, separate from Quest EXP.");
  await detail.getByRole("button", { name: "Save Main Quest", exact: true }).click();
  await expect(detail.getByRole("heading", { name: `${title} edited`, exact: true })).toBeVisible();
  // Shared controls also work in Goal detail without a parallel completion engine.
  await subRow(page, titles[0]).getByRole("button", { name: "Complete", exact: true }).click();
  // The row's own receipt is transient: the revalidated Goal read unmounts the
  // completion control and renders the completed projection instead. Assert the
  // durable acknowledgement owner (Quest recovery) and then the committed state.
  await expect(page.getByRole("region", { name: "Quest recovery", exact: true })).toContainText(`Quest completed. ${rewardExp} EXP awarded.`);
  await page.getByRole("link", { name: "Reload Goals", exact: true }).first().click();
  await expect(detail).toContainText("1 / 2 Sub Quests");
  await expect(subRow(page, titles[0])).toContainText("Status: Completed");
  await expect(subRow(page, titles[0]).getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
  await subRow(page, titles[0]).getByRole("button", { name: "Reopen", exact: true }).click();
  await subRow(page, titles[0]).getByRole("button", { name: "Confirm reopen", exact: true }).click();
  await expect(detail).toContainText("0 / 2 Sub Quests");
  await expectQuestHistory(environment, titles[0], 2, 2);
  await page.context().clearCookies();
  await page.goto("/goals"); await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/goals?id=${id}`); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email", { exact: true }).fill(environment.other.email);
  await page.getByLabel("Password", { exact: true }).fill(environment.other.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goto("/goals"); await expect(page).toHaveURL(/\/login$/);
});

test("Goal picker excludes recurring and attached Quests; server rejection and stale revisions recover", async ({ page, environment }) => {
  test.setTimeout(120_000);
  const title = await createQuest(page, "membership");
  const recurringTitle = `Recurring excluded ${randomUUID()}`;
  const form = page.getByRole("region", { name: "Create Quest", exact: true });
  await form.getByLabel("Quest type", { exact: true }).selectOption("daily");
  await form.getByLabel("Title", { exact: true }).fill(recurringTitle);
  await form.getByLabel("Start date", { exact: true }).fill(questDay);
  await form.getByRole("button", { name: "Create recurring Quest", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Recurring Quest created");
  await page.goto("/goals"); const first = await createGoal(page, `First ${randomUUID()}`);
  await attachQuest(page, title);
  await goalDetail(page).getByRole("button", { name: "Archive Main Quest", exact: true }).click();
  await expect(goalDetail(page)).toContainText("read-only until restored");
  const second = await createGoal(page, `Second ${randomUUID()}`);
  const detail = goalDetail(page);
  await detail.getByText("Attach Sub Quest", { exact: true }).click();
  await expect(detail.getByRole("option", { name: title, exact: true })).toHaveCount(0);
  await expect(detail.getByRole("option", { name: recurringTitle, exact: true })).toHaveCount(0);
  const client = createClient(environment.url, environment.key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const auth = await client.auth.signInWithPassword({ email: environment.owner.email, password: environment.owner.password });
    if (auth.error) throw new Error("Disposable owner login failed");
    const rows = await client.from("quests").select("id,title").in("title", [title, recurringTitle]);
    if (rows.error || rows.data?.length !== 2) throw new Error("Disposable Quest lookup failed");
    // Simulate a stale/tampered browser candidate; prove action feedback, not just filtering.
    for (const [candidateTitle, feedback] of [[title, "already attached to another"], [recurringTitle, "Recurring or archived Quests"]]) {
      const questId = rows.data.find((q) => q.title === candidateTitle)!.id;
      const request = { userId: environment.owner.id, commandId: randomUUID(), goalId: second, revision: "1", kind: "attach", questId };
      await page.evaluate(({ key, request }) => sessionStorage.setItem(key, JSON.stringify(request)), { key: `system:goal-request:v1:${environment.owner.id}`, request });
      await page.reload();
      await page.getByRole("button", { name: "Retry saved request", exact: true }).click();
      await expect(page.getByRole("region", { name: "Main Quest changes" }).getByRole("alert")).toContainText(feedback);
      await expect(detail).toContainText("0 / 0 Sub Quests");
    }
    const latest = await client.rpc("update_goal_v1", { p_command_id: randomUUID(), p_goal_id: second, p_expected_revision: "1", p_title: "Changed elsewhere", p_description: null });
    if (latest.error) throw new Error("Disposable concurrent edit failed");
    await detail.getByText("Edit Main Quest", { exact: true }).click();
    await detail.getByLabel("Title", { exact: true }).fill("Stale overwrite");
    await detail.getByRole("button", { name: "Save Main Quest", exact: true }).click();
    await expect(page.getByRole("region", { name: "Main Quest changes" }).getByRole("alert")).toContainText("Main Quest changed");
    await page.getByRole("button", { name: "Refresh Goals", exact: true }).click();
    await expect(detail.getByRole("heading", { name: "Changed elsewhere", exact: true })).toBeVisible();
    const stillFirst = await client.rpc("get_goal_v1", { p_goal_id: first });
    expect(stillFirst.data.goal.total_subquests).toBe("1");
  } finally { await client.auth.signOut({ scope: "local" }); }
});

test("Goal duplicate submit and lost committed response retain exact intent across reload", async ({ page, environment }) => {
  await page.goto("/goals");
  const form = page.getByRole("region", { name: "Create Main Quest", exact: true });
  const title = `Recovery ${randomUUID()}`;
  await form.getByLabel("Title", { exact: true }).fill(title);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.fallback();
    calls++; await gate; await route.fetch(); await route.abort("failed");
  });
  await form.locator("form").evaluate((el: HTMLFormElement) => { el.requestSubmit(); el.requestSubmit(); });
  await expect(form.getByLabel("Title", { exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("region", { name: "Main Quest changes" }).getByRole("alert")).toContainText("outcome is unknown");
  expect(calls).toBe(1);
  const key = `system:goal-request:v1:${environment.owner.id}`;
  const saved = await page.evaluate((key) => sessionStorage.getItem(key), key);
  await page.unrouteAll({ behavior: "wait" }); await page.reload();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBe(saved);
  await expect(form.getByRole("button", { name: "Create Main Quest", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry saved request", exact: true }).click();
  await expect(goalDetail(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
  expect(await environment.sql(`SELECT count(*) FROM public.goals WHERE title='${title}';`)).toBe("1");
});
