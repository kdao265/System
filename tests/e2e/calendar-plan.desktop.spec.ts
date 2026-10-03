import { test,expect } from "./quest-fixtures";
import { timelineScenario,fillPlan,expectPlanGeometry } from "./calendar-plan-helpers";
import { expectNoCalendarOverflow } from "./calendar-view-helpers";

test("Day and Week show truthful intervals, separate deadline and occurrence detail with keyboard focus",async({page,environment})=>{
  const s=await timelineScenario(environment);
  try{
    await page.goto(`/calendar?date=${s.day}&view=day`);
    const block=page.locator('[data-cal-timed]').filter({hasText:s.title}),trigger=block.getByRole("button");
    await expect(block).toContainText("End not set");await expectPlanGeometry(page,s.title,560,0);
    await expect(page.locator('[data-cal-timed]').filter({hasText:s.eventTitle})).toHaveCount(1);
    await trigger.focus();await page.keyboard.press("Enter");
    const modal=page.getByRole("dialog",{name:"Quest detail"});await expect(modal.getByRole("heading",{name:s.title,exact:true})).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`date=${s.day}&view=day$`));
    await expect(modal.getByText("Deadline",{exact:true})).toBeVisible();await expect(modal).toContainText("Notes ");
    await expect(modal.getByRole("button",{name:"Complete",exact:true})).toHaveCount(0);
    await fillPlan(modal,s.day);await expect(modal).toContainText("Plan saved.");
    await expect(modal.getByText("11:45",{exact:false}).first()).toBeVisible();
    const close=modal.getByRole("button",{name:"Close",exact:true});await close.focus();await page.keyboard.press("Shift+Tab");
    expect(await modal.evaluate(e=>e.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");await expect(close).toBeFocused();
    await page.keyboard.press("Escape");await expect(modal).toHaveCount(0);await expect(trigger).toBeFocused();
    await expectPlanGeometry(page,s.title);
    await page.getByRole("navigation",{name:"Calendar view",exact:true}).getByRole("link",{name:"Week",exact:true}).click();
    await expectPlanGeometry(page,s.title);await expectNoCalendarOverflow(page);
    const detail=await s.rpc("get_quest_occurrence_detail_v1",{p_occurrence_id:s.one.occurrence_id});
    expect(Date.parse(detail.deadline_at)).toBe(Date.parse(`${s.day}T18:00:00Z`));
  }finally{await s.retire();s.client.auth.stopAutoRefresh();}
});

test("untimed recurring occurrence can be planned without changing template/provenance",async({page,environment})=>{
  const s=await timelineScenario(environment);
  try{
    const before=await s.rpc("get_quest_occurrence_detail_v1",{p_occurrence_id:s.recurring.entry_id});
    await page.goto(`/calendar?date=${s.day}&view=day`);
    const band=page.getByRole("list",{name:/All-day, untimed/});await band.getByRole("button",{name:new RegExp(s.recurringTitle)}).click();
    const modal=page.getByRole("dialog");await expect(modal).toContainText("Original occurrence");await fillPlan(modal,s.day);
    await expect(modal).toContainText("Plan saved.");await modal.getByRole("button",{name:"Close",exact:true}).click();
    await expectPlanGeometry(page,s.recurringTitle);
    const after=await s.rpc("get_quest_occurrence_detail_v1",{p_occurrence_id:s.recurring.entry_id});
    for(const key of ["source_slot_date","source_timezone","recurrence_rule_id","recurrence_revision","rule","execution_cycle","reward_exp_snapshot"])expect(after[key]).toEqual(before[key]);
  }finally{await s.retire();s.client.auth.stopAutoRefresh();}
});

test("committed planning response loss recovers exact command after reload",async({page,environment})=>{
  const s=await timelineScenario(environment);
  try{
    await page.goto(`/calendar?date=${s.day}&view=day`);
    await page.locator('[data-cal-timed]').filter({hasText:s.title}).getByRole("button").click();
    const modal=page.getByRole("dialog");await expect(modal.getByRole("heading",{name:s.title,exact:true})).toBeVisible();
    let lost=false;
    await page.route('**/calendar*',async route=>{
      if(!lost&&route.request().headers()['next-action']&&route.request().postData()?.includes('expectedStart')){
        lost=true;await route.fetch();await route.abort('failed');
      }else await route.fallback();
    });
    await fillPlan(modal,s.day);await expect(modal).toContainText("Plan outcome is unknown");expect(lost).toBe(true);
    const saved=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('system.quest-plan.v1:')));
    expect(saved).toHaveLength(1);const command=JSON.parse(saved[0][1]).commandId;
    await page.unrouteAll({behavior:"wait"});await page.reload();
    await page.getByRole("button",{name:"Retry saved plan",exact:true}).click();
    await expect(page.getByRole("button",{name:"Retry saved plan",exact:true})).toHaveCount(0);await expectPlanGeometry(page,s.title);
    expect(await environment.sql(`SELECT count(*) FROM public.quest_events WHERE command_id='${command}';`)).toBe("1");
  }finally{await s.retire();s.client.auth.stopAutoRefresh();}
});
