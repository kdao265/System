// L1-08 Acceptance Gap Closure: real owner-authenticated AO RPC checks.
// All fixtures are synthetic and confined to the runner-owned tmpfs Docker DB.
// This suite never accepts a caller-supplied database URL or credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const uid=()=>randomUUID();
function good(r,label){assert.equal(r.error,null,label+": "+(r.error?.code??"")+" "+(r.error?.message??""));return r.data;}
function reject(r,label,code){assert(r.error,label+": invalid operation accepted");if(code)assert.equal(r.error.code,code,label);}
const invoke=(client,name,args)=>client.rpc(name,args);
const rpc=async (client,name,args)=>good(await invoke(client,name,args),name);
async function createOpp(client,title,extra={}){
  const id=uid();
  await rpc(client,"create_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,p_fields:{title,...extra}});
  return id;
}
async function createAct(client,title,intent="confirmed_plan"){
  const id=uid();
  await rpc(client,"create_activity_v1",{p_command_id:uid(),p_activity_id:id,p_fields:{title,intent}});
  return id;
}
async function opp(client,id){return (await rpc(client,"get_opportunity_v1",{p_opportunity_id:id})).root;}
async function act(client,id){return (await rpc(client,"get_activity_v1",{p_activity_id:id})).root;}
async function testDeadline(env,owner){
  const fixed={precision:"instant",source_date:"2026-10-10",source_time:"09:30",source_offset_minutes:420};
  const id=await createOpp(owner,"L108 UTC no inference",{application_deadline:fixed});
  const utc=()=>env.sql("SELECT to_char(deadline_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') FROM public.opportunities WHERE id='"+id+"'");
  assert.equal(await utc(),"2026-10-10 02:30","offset-only persisted as exact UTC instant");
  const before=await opp(owner,id);
  assert.deepEqual(before.application_deadline,fixed);
  good(await invoke(owner,"update_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,
    p_expected_revision:"1",p_changes:{organization:"Validation only"}}),"unrelated edit");
  assert.equal(await utc(),"2026-10-10 02:30","unrelated metadata edit must not reinterpret UTC");
  const unresolved={precision:"day",year:2026,month:10,day:10,source_time:"09:30",source_time_state:"unresolved"};
  good(await invoke(owner,"update_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,
    p_expected_revision:"2",p_changes:{application_deadline:unresolved}}),"unresolved clock");
  assert.equal(await env.sql("SELECT deadline_at_utc IS NULL FROM public.opportunities WHERE id='"+id+"'"),"t",
    "unresolved local clock must have no UTC");
  const fold={precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_offset_minutes:-240,source_zone:"America/New_York"};
  good(await invoke(owner,"update_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,
    p_expected_revision:"3",p_changes:{application_deadline:fold}}),"DST fold with explicit offset");
  assert.equal(await utc(),"2026-11-01 05:30","DST fold offset determines instant");
  const invalid=[
    ["gap",{...fold,source_date:"2026-03-08",source_time:"02:30",source_offset_minutes:-300}],
    ["wrong fold offset",{...fold,source_offset_minutes:-360}],
    ["UTC underflow",{precision:"instant",source_date:"0001-01-01",source_time:"00:00",source_offset_minutes:840}],
    ["invalid civil leap day",{precision:"instant",source_date:"2026-02-29",source_time:"09:30",source_offset_minutes:420}],
    ["extra date key",{...fold,surprise:true}],
  ];
  for(const [label,date] of invalid)
    reject(await invoke(owner,"update_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,
      p_expected_revision:"4",p_changes:{application_deadline:date}}),label,"22023");
  assert.equal(await utc(),"2026-11-01 05:30","invalid date writes must roll back");
  assert.equal(String((await opp(owner,id)).revision),"4","invalid date writes cannot bump revision");
  console.log("PASS: L1-08 QA-10 owner wire date trigger UTC, unresolved, DST fold/gap, boundary, immutability and rollback");
}
async function testLifecycle(owner){
  const id=await createOpp(owner,"L108 lifecycle");
  let rev=1;
  async function stage(stage,kind,details={}){
    const data=await rpc(owner,"set_opportunity_stage_v1",{p_command_id:uid(),p_opportunity_id:id,
      p_expected_revision:String(rev),p_stage:stage,p_kind:kind,p_details:details});
    if(data.changed)rev++;
    assert.equal(String(data.revision_after),String(rev));
    return data;
  }
  assert.equal((await opp(owner,id)).tracking_stage,"saved");
  await stage("preparing","advance");
  await stage("submitted","advance");
  await stage("closed","advance",{closed_reason:"other",closed_note:"Reason\r\ncontinues"});
  assert.equal((await opp(owner,id)).closed_note,"Reason\ncontinues");
  reject(await invoke(owner,"set_opportunity_stage_v1",{p_command_id:uid(),p_opportunity_id:id,
    p_expected_revision:String(rev),p_stage:"saved",p_kind:"advance",p_details:{}}),
    "closed cannot advance backward","23514");
  await stage("preparing","reopen");
  assert.equal((await opp(owner,id)).closed_reason,null,"reopen removes closed fields");
  await stage("saved","correction");
  const outcome=await rpc(owner,"record_opportunity_outcome_v1",{p_command_id:uid(),p_opportunity_id:id,
    p_expected_revision:String(rev),p_outcome:"shortlisted",p_kind:"new_decision",p_details:{}});
  assert.equal(outcome.changed,true);rev++;
  assert.equal((await opp(owner,id)).selection_outcome,"shortlisted");
  reject(await invoke(owner,"update_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,
    p_expected_revision:String(rev),p_changes:{tracking_stage:"submitted"}}),
    "lifecycle cannot be changed via metadata","22023");
  assert.equal(String((await opp(owner,id)).revision),String(rev));
  for(const [intent,status] of [["confirmed_plan","upcoming"],["confirmed_started","ongoing"],
    ["historical_completed","completed"],["historical_ended_early","ended_early"]]){
    const aid=await createAct(owner,"L108 intent "+intent,intent);
    assert.equal((await act(owner,aid)).status,status);
  }
  const aid=await createAct(owner,"L108 state machine");
  let arev=1;
  for(const [action,status] of [["start","ongoing"],["pause","paused"],["resume","ongoing"],["complete","completed"]]){
    const v=await rpc(owner,"transition_activity_v1",{p_command_id:uid(),p_activity_id:aid,
      p_expected_revision:String(arev),p_action:action,p_details:{}});
    assert.equal(v.changed,true);arev++;assert.equal((await act(owner,aid)).status,status);
  }
  reject(await invoke(owner,"transition_activity_v1",{p_command_id:uid(),p_activity_id:aid,
    p_expected_revision:String(arev),p_action:"resume",p_details:{}}),
    "terminal Activity cannot resume","23514");
  const correction=await rpc(owner,"correct_activity_status_v1",{p_command_id:uid(),p_activity_id:aid,
    p_expected_revision:String(arev),p_target_status:"upcoming",
    p_correction:{reason:"Correct wrong completion"}});
  assert.equal(correction.changed,true);arev++;
  assert.equal((await act(owner,aid)).status,"upcoming");
  assert.equal(String((await act(owner,aid)).revision),String(arev));
  console.log("PASS: L1-08 QA-19/20 Opportunity stage/outcome and Activity creation/transition/correction wire subset");
}
async function testRelationships(env,owner){
  const o=await createOpp(owner,"L108 context owner");
  const a=await createAct(owner,"L108 context Activity");
  const goal=uid();
  await rpc(owner,"create_goal_v1",{p_command_id:uid(),p_goal_id:goal,p_title:"L108 contextual Goal",p_description:null});
  const quest=await rpc(owner,"create_one_off_quest",{command_id:uid(),origin:"web_ui",
    request:{title:"L108 contextual Quest",scheduled_at:"2031-08-03T10:00:00Z",default_reward_exp:0}});
  for(const [kind,id,subjectArg] of [["opportunity",o,"p_source_id"],["activity",a,"p_source_id"]]){
    let rev=1;
    const attach=async (targetKind,targetId)=>rpc(owner,"attach_ao_context_v1",{
      p_command_id:uid(),p_source_kind:kind,[subjectArg]:id,p_expected_revision:String(rev),
      p_target_kind:targetKind,p_target_id:targetId});
    const g=await attach("goal",goal);assert.equal(g.changed,true);rev++;
    const duplicate=await attach("goal",goal);assert.equal(duplicate.changed,false);
    assert.equal(String(duplicate.revision_after),String(rev),"duplicate link must not bump revision");
    const q=await attach("quest",quest.quest_id);assert.equal(q.changed,true);rev++;
    const detail=await rpc(owner,kind==="opportunity"?"get_opportunity_v1":"get_activity_v1",
      {[kind==="opportunity"?"p_opportunity_id":"p_activity_id"]:id});
    for(const targetKind of ["goal","quest"])assert(detail.contexts.some(x=>x.target_kind===targetKind),"missing typed "+kind+" "+targetKind);
    const goalLink=detail.contexts.find(x=>x.target_kind==="goal").link_id;
    const removed=await rpc(owner,"detach_ao_context_v1",{p_command_id:uid(),p_source_kind:kind,
      p_source_id:id,p_expected_revision:String(rev),p_target_kind:"goal",p_link_id:goalLink});
    assert.equal(removed.changed,true);rev++;
    const after=await rpc(owner,kind==="opportunity"?"get_opportunity_v1":"get_activity_v1",
      {[kind==="opportunity"?"p_opportunity_id":"p_activity_id"]:id});
    assert.equal(after.contexts.filter(x=>x.target_kind==="goal").length,0);
    assert.equal(after.contexts.filter(x=>x.target_kind==="quest").length,1);
    assert.equal(String(after.root.revision),String(rev));
  }
  // Activity current source is 0..1; replacing S1 with S2 must close old interval.
  const s1=await createOpp(owner,"L108 provenance first"),s2=await createOpp(owner,"L108 provenance second");
  let rev=4;
  const source=async (expected,next)=>rpc(owner,"set_activity_source_v1",{
    p_command_id:uid(),p_activity_id:a,p_expected_revision:String(rev),
    p_expected_source_link_id:expected,p_desired_opportunity_id:next,p_note:null});
  const initial=await source(null,s1);assert.equal(initial.changed,true);rev++;
  const first=(await rpc(owner,"get_activity_v1",{p_activity_id:a})).source.link_id;
  const swap=await source(first,s2);assert.equal(swap.changed,true);rev++;
  const second=(await rpc(owner,"get_activity_v1",{p_activity_id:a})).source.link_id;
  assert.notEqual(first,second,"source replacement must create new interval");
  assert.equal(await env.sql("SELECT detached_at IS NOT NULL FROM public.activity_source_links WHERE id='"+first+"'"),"t");
  assert.equal(await env.sql("SELECT detached_at IS NULL FROM public.activity_source_links WHERE id='"+second+"'"),"t");
  reject(await invoke(owner,"set_activity_source_v1",{p_command_id:uid(),p_activity_id:a,
    p_expected_revision:String(rev),p_expected_source_link_id:first,
    p_desired_opportunity_id:s1,p_note:null}),"stale source link","23514");
  const archived=await rpc(owner,"set_opportunity_archived_v1",{p_command_id:uid(),p_opportunity_id:s1,
    p_expected_revision:"1",p_archived:true});
  assert(archived.changed);
  reject(await invoke(owner,"set_activity_source_v1",{p_command_id:uid(),p_activity_id:a,
    p_expected_revision:String(rev),p_expected_source_link_id:second,
    p_desired_opportunity_id:s1,p_note:null}),"archived source forbidden","23514");
  await rpc(owner,"set_goal_archived_v1",{p_command_id:uid(),p_goal_id:goal,p_expected_revision:"1",p_archived:true});
  reject(await invoke(owner,"attach_ao_context_v1",{p_command_id:uid(),p_source_kind:"opportunity",
    p_source_id:o,p_expected_revision:"4",p_target_kind:"goal",p_target_id:goal}),
    "archived Goal cannot newly attach","23514");
  console.log("PASS: L1-08 QA-21/22/23 typed links 4 variants, no-op, detach, provenance replacement and archived eligibility subset");
}
async function testValidation(env,owner){
  const id=await createOpp(owner,"L108 atomically safe");
  const original=await opp(owner,id);
  const before=await env.sql("SELECT count(*) FROM public.opportunity_history WHERE opportunity_id='"+id+"'");
  const bad=[
    ["unknown key",{rogue:true}],
    ["empty title",{title:"   "}],
    ["unicode codepoint overflow",{title:"😀".repeat(241)}],
    ["invalid partial date",{program_start:{precision:"day",year:2023,month:2,day:29}}],
    ["bad URL",{resource_links:[{id:uid(),label:"Unsafe",url:"http://example.invalid"}]}],
    ["31 links",{resource_links:Array.from({length:31},(_,i)=>({id:uid(),label:"Link "+i,url:"https://example.invalid/"+i}))}],
    ["wrong enum",{priority:"critical"}],
  ];
  for(const [label,changes] of bad)
    reject(await invoke(owner,"update_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,
      p_expected_revision:"1",p_changes:changes}),label);
  assert.deepEqual(await opp(owner,id),original,"rejected updates changed root");
  assert.equal(await env.sql("SELECT count(*) FROM public.opportunity_history WHERE opportunity_id='"+id+"'"),before,
    "rejected updates changed immutable history");
  for(const name of ["list_opportunities_v1","list_activities_v1"]){
    const invalid=[
      {created_at:"2026-02-30T10:30:00.000000Z",id:uid()},
      {created_at:"2026-10-10T10:30:00.1234567Z",id:uid()},
      {created_at:"2026-10-10T10:30:00.000000Z",id:"not-uuid"},
    ];
    for(const cursor of invalid)reject(await invoke(owner,name,{
      p_scope:"active",p_filters:{},p_cursor:cursor,p_limit:50}),name+" bad cursor","22023");
  }
  console.log("PASS: L1-08 QA-11/12/R05 selected negative value, no-state-change and cursor errors");
}
export async function exerciseAoL108(env,owner){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/,"disposable loopback only");
  await testDeadline(env,owner);
  await testLifecycle(owner);
  await testRelationships(env,owner);
  await testValidation(env,owner);
  console.log("PASS: L1-08 acceptance gap subset; exhaustive SQL/TS parity and full release review remain open");
}
