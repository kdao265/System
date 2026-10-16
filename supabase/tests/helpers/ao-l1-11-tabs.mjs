// L1-11 PO-approved finite T-A/T-B/T-C gap closure, disposable Auth/PostgREST/PG only.
// Do not run against production/local state or remove review-only SQL guard.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import * as model from "../../../src/features/activities-opportunities/model.ts";
const uuid=()=>randomUUID();
function ok(r,label){assert.equal(r.error,null,label+": "+(r.error?.code??"")+" "+(r.error?.message??""));return r.data;}
const rpc=async(c,name,args)=>ok(await c.rpc(name,args),name);
function rejected(r,label){assert(r.error,label+": unexpectedly succeeded");}
async function opp(c,fields={}){const key=uuid();await rpc(c,"create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:key,p_fields:{title:"L111 TABC "+uuid(),...fields}});return key;}
async function act(c,fields={}){const key=uuid();await rpc(c,"create_activity_v1",{p_command_id:uuid(),p_activity_id:key,p_fields:{title:"L111 activity "+uuid(),intent:"confirmed_plan",...fields}});return key;}
const root=async(c,kind,key)=>(await rpc(c,kind==="opportunity"?"get_opportunity_v1":"get_activity_v1",{[kind==="opportunity"?"p_opportunity_id":"p_activity_id"]:key})).root;
const sqlStr=s=>"'"+s.replaceAll("'","''")+"'";
async function sqlJson(env,query){const raw=await env.sql("SELECT ("+query+")::text;");return JSON.parse(raw);}
const external=["quests","quest_occurrences","quest_events","goals","goal_quest_links","exp_ledger","schedule_events","books"];
async function snapshot(env){return env.sql("SELECT jsonb_build_object("+external.map(t=>sqlStr(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public."+t+" x)").join(",")+")::text;");}
function same(a,b,label){assert.deepEqual(a,b,label);}
async function testA(owner,env){
  // Six outcomes, all applicability choices, unusual (warning-only) states.
  for(const choice of model.SELECTION_OUTCOMES){
    const key=await opp(owner,{selection_outcome:choice,
      selection_applicability:choice==="unknown"?"not_applicable":"applicable",
      tracking_stage:choice==="accepted"?"saved":"submitted"});
    const r=await root(owner,"opportunity",key);
    assert.equal(r.selection_outcome,choice);
    assert.equal(r.tracking_stage,choice==="accepted"?"saved":"submitted");
    assert.equal(r.selection_applicability,choice==="unknown"?"not_applicable":"applicable");
  }
  const invalid=await owner.rpc("create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:uuid(),
    p_fields:{title:"L111 invalid applicability",selection_applicability:"not_applicable",selection_outcome:"accepted"}});
  rejected(invalid,"applicability hard reject");
  const warn=await opp(owner,{tracking_stage:"closed",closed_reason:"declined_offer",selection_outcome:"unknown"});
  assert.equal((await root(owner,"opportunity",warn)).selection_outcome,"unknown");
  for(const reason of model.CLOSED_REASONS){
    const key=await opp(owner);
    const details={closed_reason:reason,...(reason==="other"?{closed_note:"Audit\r\nnote"}:{})};
    const stage=await rpc(owner,"set_opportunity_stage_v1",{p_command_id:uuid(),p_opportunity_id:key,
      p_expected_revision:"1",p_stage:"closed",p_kind:"advance",p_details:details});
    assert.equal(stage.changed,true);
    const closed=await root(owner,"opportunity",key);
    assert.equal(closed.closed_reason,reason);
    if(reason==="other")assert.equal(closed.closed_note,"Audit\nnote");
    const reopened=await rpc(owner,"set_opportunity_stage_v1",{p_command_id:uuid(),p_opportunity_id:key,
      p_expected_revision:"2",p_stage:"saved",p_kind:"reopen",p_details:{}});
    assert.equal(reopened.changed,true);
    const after=await root(owner,"opportunity",key);
    assert.equal(after.closed_reason,null);assert.equal(after.closed_note,null);
    const types=await env.sql("SELECT string_agg(event_type,',' ORDER BY id) FROM public.opportunity_history WHERE opportunity_id="+sqlStr(key));
    assert(types.includes("set_opportunity_stage_v1:advance")&&types.includes("set_opportunity_stage_v1:reopen"));
  }
  const noNote=await opp(owner);
  rejected(await owner.rpc("set_opportunity_stage_v1",{p_command_id:uuid(),p_opportunity_id:noNote,
    p_expected_revision:"1",p_stage:"closed",p_kind:"advance",p_details:{closed_reason:"other"}}),"other missing note");
  const late=await opp(owner,{tracking_stage:"closed",closed_reason:"process_finished",selection_outcome:"unknown"});
  const stageBefore=await root(owner,"opportunity",late);
  const decision=await rpc(owner,"record_opportunity_outcome_v1",{p_command_id:uuid(),p_opportunity_id:late,
    p_expected_revision:"1",p_outcome:"accepted",p_kind:"new_decision",p_details:{}});
  assert.equal(decision.changed,true);
  const correction=await rpc(owner,"record_opportunity_outcome_v1",{p_command_id:uuid(),p_opportunity_id:late,
    p_expected_revision:"2",p_outcome:"rejected",p_kind:"correction",p_details:{}});
  assert.equal(correction.changed,true);
  const latest=await root(owner,"opportunity",late);
  assert.equal(latest.tracking_stage,stageBefore.tracking_stage);
  assert.equal(latest.selection_outcome,"rejected");
  const history=await env.sql("SELECT string_agg(event_type,',' ORDER BY id) FROM public.opportunity_history WHERE opportunity_id="+sqlStr(late));
  assert(history.includes("record_opportunity_outcome_v1:new_decision")&&history.includes("record_opportunity_outcome_v1:correction"),"outcome events need distinct history types");
  for(const intent of ["historical_completed","historical_ended_early"]){
    const key=await act(owner,{intent});
    const data=await root(owner,"activity",key);
    assert.equal(data.status,intent==="historical_completed"?"completed":"ended_early");
    assert.equal(data.actual_start,null);assert.equal(data.actual_end,null);
    const events=await env.sql("SELECT count(*) FROM public.activity_history WHERE activity_id="+sqlStr(key));
    assert.equal(Number(events),1,"historical import should be one direct creation event");
  }
  console.log("PASS: L1-11 T-A outcome enums/warnings/invalid applicability, seven close reasons, reopen, late outcome history and direct Activity imports");
}
async function testB(owner,env){
  // Real SQL/PostgREST owner decisions vs TypeScript model: both DST fold
  // offsets, spring gap, impossible Gregorian years, mismatch and unresolved.
  const deadlines=[
    {precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_offset_minutes:-240,source_zone:"America/New_York"},
    {precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_offset_minutes:-300,source_zone:"America/New_York"},
    {precision:"instant",source_date:"2026-03-08",source_time:"02:30",source_offset_minutes:-300,source_zone:"America/New_York"},
    {precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_offset_minutes:-360,source_zone:"America/New_York"},
    {precision:"instant",source_date:"2026-10-10",source_time:"09:30",source_offset_minutes:420},
    {precision:"instant",source_date:"0001-01-01",source_time:"00:00",source_offset_minutes:840},
    {precision:"instant",source_date:"9999-12-31",source_time:"23:59",source_offset_minutes:-840},
    {precision:"day",year:2026,month:10,day:10,source_time:"09:30",source_time_state:"unresolved"},
    {precision:"year",year:2029},
  ];
  for(const date of deadlines){
    const ts=model.parseDeadline(date);
    const id=uuid();
    const pg=await owner.rpc("create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:id,
      p_fields:{title:"L111 deadline "+id,application_deadline:date}});
    assert.equal(pg.error===null,ts.ok,"TS/PG deadline acceptance parity "+JSON.stringify(date)+" "+(pg.error?.message??""));
    if(!ts.ok)continue;
    const data=await root(owner,"opportunity",id);
    same(data.application_deadline,date,"source deadline fidelity");
    const actual=await env.sql("SELECT coalesce(to_char(deadline_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),'NULL') FROM public.opportunities WHERE id="+sqlStr(id));
    if(ts.value.utcMilliseconds===null)assert.equal(actual,"NULL");
    else assert.equal(actual,new Date(ts.value.utcMilliseconds).toISOString().slice(0,19)+"Z");
  }
  const day=(y,m,d)=>({precision:"day",year:y,month:m,day:d});
  const comparisons=[
    [day(2031,4,1),day(2031,4,1),true],
    [{precision:"year",year:2031},day(2031,1,1),true],
    [{precision:"month",year:2031,month:12},day(2031,11,30),false],
    [{precision:"unknown"},day(2020,2,1),true],
    [null,day(2025,2,1),true],
  ];
  for(const [start,end,expected] of comparisons){
    const ts=!(start&&end&&model.isCertainReverse(start,end));
    assert.equal(ts,expected,"model expected ordering");
    const result=await owner.rpc("create_activity_v1",{p_command_id:uuid(),p_activity_id:uuid(),
      p_fields:{title:"L111 partial order "+uuid(),intent:"confirmed_plan",planned_start:start,planned_end:end}});
    assert.equal(result.error===null,expected,"SQL date order parity "+JSON.stringify([start,end])+" "+(result.error?.message??""));
  }
  const link=(label,url,id)=>({id,label,url});
  const shared="https://example.org/duplicate";
  const links=[link("L".repeat(120),shared,uuid()),link("Second",shared,uuid())];
  const valid=await opp(owner,{resource_links:links});
  same((await root(owner,"opportunity",valid)).resource_links,links,"preserve duplicate URLs and order");
  for(const item of [
    [link("x".repeat(121),shared,uuid())],
    [link("Okay","https://name:pwd@example.org/",uuid())],
    [link("Okay","https://example.org/path with space",uuid())],
    [link("Okay","https://example.org/"+
      "a".repeat(2050),uuid())],
    [link("Okay","https://example.org/line\nbreak",uuid())]
  ]){
    const tmp=uuid();
    const res=await owner.rpc("create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:tmp,
      p_fields:{title:"L111 bad URL "+tmp,resource_links:item}});
    rejected(res,"bad link boundary");
  }
  const invalidDate=await opp(owner,{program_start:day(2031,4,1)});
  const before=await root(owner,"opportunity",invalidDate);
  rejected(await owner.rpc("update_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:invalidDate,
    p_expected_revision:"1",p_changes:{program_end:day(2031,3,1)}}),"reverse PartialDate");
  same(await root(owner,"opportunity",invalidDate),before,"invalid update rollback");
  console.log("PASS: L1-11 T-B TS/PG deadline fold/gap UTC equivalence, partial ordering, URL text exact boundaries and invalid-update atomicity");
}
async function testC(owner,other,env){
  const o1=await opp(owner),o2=await opp(owner);
  const a=await act(owner,{organization:"Original organization"});
  let rev=1;
  const link=async(expected,target)=>rpc(owner,"set_activity_source_v1",{p_command_id:uuid(),p_activity_id:a,
    p_expected_revision:String(rev),p_expected_source_link_id:expected,p_desired_opportunity_id:target,p_note:null});
  const first=await link(null,o1);assert(first.changed);rev++;
  const one=(await rpc(owner,"get_activity_v1",{p_activity_id:a})).source.link_id;
  const swap=await link(one,o2);assert(swap.changed);rev++;
  const two=(await rpc(owner,"get_activity_v1",{p_activity_id:a})).source.link_id;
  const remove=await link(two,null);assert(remove.changed);rev++;
  assert.equal((await rpc(owner,"get_activity_v1",{p_activity_id:a})).source,null);
  const again=await link(null,o1);assert(again.changed);rev++;
  const three=(await rpc(owner,"get_activity_v1",{p_activity_id:a})).source.link_id;
  assert(new Set([one,two,three]).size===3,"source identity after reattach");
  const intervals=await sqlJson(env,"SELECT jsonb_agg(jsonb_build_object('id',id,'attached_at',attached_at,'detached_at',detached_at) ORDER BY attached_at,id) FROM public.activity_source_links WHERE activity_id="+sqlStr(a));
  assert.equal(intervals.length,3);assert.equal(intervals.filter(x=>x.detached_at===null).length,1);
  assert(intervals.filter(x=>x.detached_at!==null).length===2);
  const attr=(await root(owner,"activity",a)).organization;
  await rpc(owner,"update_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:o1,p_expected_revision:"1",p_changes:{organization:"Source changed"}});
  assert.equal((await root(owner,"activity",a)).organization,attr,"provenance must not synchronize metadata");
  await rpc(owner,"set_opportunity_archived_v1",{p_command_id:uuid(),p_opportunity_id:o1,p_expected_revision:"2",p_archived:true});
  assert.equal((await rpc(owner,"get_activity_v1",{p_activity_id:a})).source.link_id,three,"source persists across archive");
  const goal=uuid();await rpc(owner,"create_goal_v1",{p_command_id:uuid(),p_goal_id:goal,p_title:"L111 target",p_description:null});
  const quest=await rpc(owner,"create_one_off_quest",{command_id:uuid(),origin:"web_ui",
    request:{title:"L111 one-off",scheduled_at:"2031-12-15T10:00:00Z",default_reward_exp:0}});
  const before=await snapshot(env);
  const subject=await opp(owner);
  const qsource=await act(owner,{intent:"historical_completed"});
  const attach=await rpc(owner,"attach_ao_context_v1",{p_command_id:uuid(),
    p_source_kind:"activity",p_source_id:qsource,p_expected_revision:"1",
    p_target_kind:"quest",p_target_id:quest.quest_id});
  assert(attach.changed);
  const gattach=await rpc(owner,"attach_ao_context_v1",{p_command_id:uuid(),
    p_source_kind:"opportunity",p_source_id:subject,p_expected_revision:"1",p_target_kind:"goal",p_target_id:goal});
  assert(gattach.changed);
  for(const r of [
    ["set_opportunity_stage_v1",{p_command_id:uuid(),p_opportunity_id:subject,p_expected_revision:"2",p_stage:"submitted",p_kind:"advance",p_details:{}}],
    ["record_opportunity_outcome_v1",{p_command_id:uuid(),p_opportunity_id:subject,p_expected_revision:"3",p_outcome:"accepted",p_kind:"new_decision",p_details:{}}],
    ["correct_activity_status_v1",{p_command_id:uuid(),p_activity_id:qsource,p_expected_revision:"2",p_target_status:"ongoing",p_correction:{reason:"Correct record"}}],
    ["set_activity_archived_v1",{p_command_id:uuid(),p_activity_id:qsource,p_expected_revision:"3",p_archived:true}],
    ["set_activity_archived_v1",{p_command_id:uuid(),p_activity_id:qsource,p_expected_revision:"4",p_archived:false}],
  ])await rpc(owner,r[0],r[1]);
  same(await snapshot(env),before,"AO mutations must not modify external domains");
  const outsiders=await other.rpc("attach_ao_context_v1",{p_command_id:uuid(),p_source_kind:"activity",
    p_source_id:qsource,p_expected_revision:"5",p_target_kind:"goal",p_target_id:goal});
  rejected(outsiders,"nonowner attach");
  same(await snapshot(env),before,"rejected external link must not mutate legacy domains");
  console.log("PASS: L1-11 T-C 0..1 provenance chronology, 3 link IDs, source archive/metadata isolation, completed Activity context and cross-domain snapshots");
}
export async function exerciseAoL111(env,owner,other){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/,"fixture loopback only");
  await testA(owner,env);
  await testB(owner,env);
  await testC(owner,other,env);
  console.log("PASS: L1-11 bounded T-A + T-B + T-C subsets; migration/UI release gates remain CLOSED");
}
