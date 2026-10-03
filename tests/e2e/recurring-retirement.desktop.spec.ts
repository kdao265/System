import { test, expect } from "./quest-fixtures";
import { completeQuest, questRow, readExp, expectExp, loginOwner, rewardExp } from "./quest-helpers";
import { createRecurring, recurringRow, retire } from "./recurring-retirement-helpers";

for(const paused of [false,true])test(`recurring archive/restore retains ${paused?"paused":"running"} state and delete preserves earned EXP`,async({page,environment})=>{
  const {title,day}=await createRecurring(page);
  const before=await readExp(page);await completeQuest(page,title);await expectExp(page,before+BigInt(rewardExp));
  if(paused){await recurringRow(page,title).getByRole("button",{name:"Pause",exact:true}).click();await expect(recurringRow(page,title)).toContainText("Paused");}
  // Snapshot exact mutable children/EXP before retirement, read only in this disposable fixture.
  const snapshot=()=>environment.sql(`SELECT jsonb_build_object(
    'rule',(SELECT jsonb_agg(to_jsonb(r)) FROM public.quest_recurrence_rules r JOIN public.quests q ON q.id=r.quest_id WHERE q.title='${title}'),
    'occurrences',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.quest_occurrences o JOIN public.quests q ON q.id=o.quest_id WHERE q.title='${title}'),
    'exp',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.exp_ledger e));`);
  const original=await snapshot();
  await expect(recurringRow(page,title).getByRole("button",{name:"Delete permanently",exact:true})).toHaveCount(0);
  await retire(page,title,"archive");await expect(recurringRow(page,title)).toHaveCount(0);
  await expect(recurringRow(page,title,true)).toBeVisible();await expect(questRow(page,title)).toHaveCount(0);
  expect(await snapshot()).toBe(original);
  await page.goto(`/calendar?view=day&date=${day}`);await expect(page.getByRole("heading",{name:title,exact:true})).toHaveCount(0);
  await page.goto(`/dashboard?date=${day}`);await retire(page,title,"restore");
  await expect(recurringRow(page,title)).toBeVisible();await expect(questRow(page,title)).toBeVisible();
  await expect(recurringRow(page,title).getByRole("button",{name:paused?"Resume":"Pause",exact:true})).toBeEnabled();
  expect(await snapshot()).toBe(original);
  await page.goto(`/calendar?view=day&date=${day}`);await expect(page.getByRole("heading",{name:title,exact:true}).first()).toBeVisible();
  await page.goto(`/dashboard?date=${day}`);await retire(page,title,"archive");await expect(recurringRow(page,title,true)).toBeVisible();
  await retire(page,title,"delete");await expect(recurringRow(page,title,true)).toHaveCount(0);await page.reload();
  await expect(questRow(page,title)).toHaveCount(0);await expectExp(page,before+BigInt(rewardExp));expect(await snapshot()).toBe(original);
});

test("pending retirement survives logout and cannot dispatch under another account",async({page,environment})=>{
  const {title}=await createRecurring(page);
  await page.route("**/*",async(route)=>{
    if(!route.request().headers()["next-action"])return route.fallback();
    await route.fetch();await route.abort("failed");
  });
  await retire(page,title,"archive");
  const recovery=page.getByRole("region",{name:"Quest management recovery",exact:true}).filter({hasText:title});
  await expect(recovery).toBeVisible();
  const key="system.recurring-retirement.pending.v1:"+environment.owner.id;
  const saved=await page.evaluate(key=>localStorage.getItem(key),key);
  expect(saved).not.toBeNull();
  await page.unrouteAll({behavior:"wait"});
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email",{exact:true}).fill(environment.other.email);
  await page.getByLabel("Password",{exact:true}).fill(environment.other.password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(recovery).toHaveCount(0);
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(saved);
  await loginOwner(page,environment.owner);
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button",{name:"Retry exact request",exact:true}).click();
  await expect(recovery).toHaveCount(0);
  expect(await environment.sql(`SELECT count(*) FROM public.quest_events WHERE command_id='${JSON.parse(saved!).commandId}';`)).toBe("1");
});

test("committed archive/delete response loss recovers globally after reload and coordinates tabs",async({page,context})=>{
  const {title}=await createRecurring(page);
  for(const operation of ["archive","delete"] as const){
    await page.route("**/*",async(route)=>{
      if(!route.request().headers()["next-action"])return route.fallback();
      await route.fetch();await route.abort("failed");
    });
    await retire(page,title,operation);
    const recovery=page.getByRole("region",{name:"Quest management recovery",exact:true}).filter({hasText:title});
    await expect(recovery).toBeVisible();
    const saved=await page.evaluate(()=>Object.entries(localStorage).find(([key])=>key.startsWith("system.recurring-retirement.pending.v1:")));
    expect(saved).toBeDefined();
    await page.unrouteAll({behavior:"wait"});await page.reload();await expect(recovery).toBeVisible();
    await expect(recurringRow(page,title,operation==="delete")).toHaveCount(0);
    const second=await context.newPage();await second.goto(page.url());
    await expect(second.getByRole("region",{name:"Quest management recovery",exact:true}).filter({hasText:title})).toBeVisible();
    expect(await second.evaluate(()=>Object.entries(localStorage).find(([key])=>key.startsWith("system.recurring-retirement.pending.v1:")))).toEqual(saved);
    if(operation==="archive")await expect(recurringRow(second,title,true).getByRole("button",{name:"Restore",exact:true})).toBeDisabled();
    // The shared lifecycle conservatively retains an in-memory uncertain identity
    // when another tab removes storage. Close that observer before acknowledging;
    // removal alone is deliberately not treated as proof of server acceptance.
    await second.close();
    const request=page.waitForRequest(r=>!!r.headers()["next-action"]);
    await recovery.getByRole("button",{name:"Retry exact request",exact:true}).click();
    expect((await request).postData()).toContain(JSON.parse(saved![1]).commandId);
    await expect(recovery).toHaveCount(0);
    if(operation==="archive")await expect(recurringRow(page,title,true)).toBeVisible();
  }
  await page.reload();await expect(recurringRow(page,title)).toHaveCount(0);await expect(recurringRow(page,title,true)).toHaveCount(0);
});
