import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Page, Locator } from "@playwright/test";
import { expect } from "./fixtures";
import type { startAuthEnvironment } from "../helpers/auth-environment.mjs";

export async function timelineScenario(environment: Awaited<ReturnType<typeof startAuthEnvironment>>) {
  const client=createClient(environment.url,environment.key,{auth:{persistSession:false,autoRefreshToken:false}});
  expect((await client.auth.signInWithPassword(environment.owner)).error).toBeNull();
  async function rpc(name:string,args:Record<string,unknown>={}){
    const r=await client.rpc(name,args);expect(r.error,`${name} must succeed`).toBeNull();return r.data;
  }
  const day=await environment.sql("SELECT (now() AT TIME ZONE 'UTC')::date;");
  const title=`Timeline ${randomUUID()}`,recurringTitle=`Recurring ${randomUUID()}`;
  const one=await rpc("create_one_off_quest",{command_id:randomUUID(),origin:"web_ui",request:{title,scheduled_at:`${day}T09:20:00Z`,deadline_at:`${day}T18:00:00Z`,default_reward_exp:0,description:"Description "+"long text ".repeat(150),notes:"Notes "+"N".repeat(700)}});
  const series=await rpc("create_recurring_quest",{command_id:randomUUID(),origin:"web_ui",request:{title:recurringTitle,recurrence_mode:"daily",start_date:day,default_reward_exp:0}});
  await rpc("materialize_quest_day",{p_day:day});
  const rows=await rpc("get_calendar_events_v2",{p_from:day,p_to:day});
  const recurring=rows.find((r:{quest_id:string})=>r.quest_id===series.quest_id);
  const eventTitle=`Schedule ${randomUUID()}`;
  await rpc("create_schedule_event",{p_event_id:randomUUID(),p_title:eventTitle,p_start_at:`${day}T10:00:00Z`,p_end_at:`${day}T11:00:00Z`,p_all_day:false,p_category:null,p_notes:"Schedule notes"});
  // This worker environment is shared with later Calendar specs, and opening the Dashboard on
  // their fixed day materializes a slot for every running series there. Retire this scenario's
  // fixtures so no other spec sees them; archived Quests stay out of the Calendar projection.
  async function retire(){
    await rpc("set_recurring_quest_archived_v1",{p_command_id:randomUUID(),p_quest_id:series.quest_id,p_archived:true,p_origin:"web_ui"});
    await rpc("set_one_off_quest_archived_v1",{p_command_id:randomUUID(),p_quest_id:one.quest_id,p_archived:true,p_origin:"web_ui"});
  }
  return {client,rpc,day,title,eventTitle,recurringTitle,one,recurring,retire};
}
export async function fillPlan(modal:Locator,day:string,start="09:20",end="11:45") {
  await modal.getByText("Plan / Edit plan",{exact:true}).click();
  await modal.getByLabel("Planned start",{exact:true}).fill(`${day}T${start}`);
  await modal.getByLabel("Planned end",{exact:true}).fill(end?`${day}T${end}`:"");
  await modal.getByRole("button",{name:"Save plan",exact:true}).click();
}
export async function expectPlanGeometry(page:Page,title:string,startMinutes=560,durationMinutes=145) {
  const block=page.locator('[data-cal-timed]').filter({hasText:title});await expect(block).toHaveCount(1);
  await expect(async()=>{
    const geometry=await block.evaluate(e=>({top:e.getBoundingClientRect().top-e.parentElement!.getBoundingClientRect().top,height:e.getBoundingClientRect().height,hour:parseFloat(getComputedStyle(document.documentElement).fontSize)*2.75}));
    expect(geometry.top).toBeCloseTo(startMinutes/60*geometry.hour,1);expect(geometry.height).toBeCloseTo(durationMinutes/60*geometry.hour,1);
  }).toPass();
}
