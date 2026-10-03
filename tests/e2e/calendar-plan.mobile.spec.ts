import { test,expect } from "./quest-fixtures";
import { timelineScenario,fillPlan,expectPlanGeometry } from "./calendar-plan-helpers";
import { expectNoCalendarOverflow } from "./calendar-view-helpers";

test("detail and planning fit 360/390/412 px with long content and full-day timeline",async({page,environment})=>{
  const s=await timelineScenario(environment);
  try{
    for(const width of [360,390,412]){
      await page.setViewportSize({width,height:800});await page.goto(`/calendar?date=${s.day}&view=day`);
      await page.locator('[data-cal-timed]').filter({hasText:s.title}).getByRole("button").click();
      const modal=page.getByRole("dialog",{name:"Quest detail"});await expect(modal.getByRole("heading",{name:s.title,exact:true})).toBeVisible();
      expect(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await expectNoCalendarOverflow(page);
      await fillPlan(modal,s.day);await expect(modal).toContainText("Plan saved.");
      const close=modal.getByRole("button",{name:"Close",exact:true});expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);await close.click();
      await expectPlanGeometry(page,s.title);await expectNoCalendarOverflow(page);
      await page.getByRole("navigation",{name:"Calendar view",exact:true}).getByRole("link",{name:"Week",exact:true}).click();
      await expectPlanGeometry(page,s.title);await expectNoCalendarOverflow(page);
      await page.getByRole("navigation",{name:"Calendar view",exact:true}).getByRole("link",{name:"Month",exact:true}).click();
      const cell=page.locator(`[data-cal-cell="${s.day}"]`);await expect(cell).toHaveAttribute("aria-current","date");await expect(cell.getByRole("button")).toHaveCount(0);await expectNoCalendarOverflow(page);
    }
  }finally{await s.retire();s.client.auth.stopAutoRefresh();}
});
