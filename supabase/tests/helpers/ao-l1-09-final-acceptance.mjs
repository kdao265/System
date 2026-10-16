// SYSTEM AO L1-09 acceptance evidence; only runner-owned disposable database.
// No production connector, migration or review SQL changes are permitted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as model from "../../../src/features/activities-opportunities/model.ts";
const id=()=>randomUUID();
const ok=(r,label)=>{assert.equal(r.error,null,label+": "+(r.error?.code??"")+" "+(r.error?.message??""));return r.data;};
async function rpc(c,n,a){return ok(await c.rpc(n,a),n);}
function rejected(r,label,code){assert(r.error,label+": unexpectedly accepted");if(code)assert.equal(r.error.code,code,label);}
async function opportunity(c,title,fields={}){
  const key=id(),cmd=id();
  const receipt=await rpc(c,"create_opportunity_v1",{p_command_id:cmd,p_opportunity_id:key,p_fields:{title,...fields}});
  assert.equal(receipt.changed,true);
  return {key,cmd,receipt};
}
async function activity(c,title,intent="confirmed_plan"){
  const key=id(),cmd=id();
  const receipt=await rpc(c,"create_activity_v1",{p_command_id:cmd,p_activity_id:key,p_fields:{title,intent}});
  assert.equal(receipt.changed,true);
  return {key,cmd,receipt};
}
const getOpp=async(c,key)=>(await rpc(c,"get_opportunity_v1",{p_opportunity_id:key})).root;
const getAct=async(c,key)=>(await rpc(c,"get_activity_v1",{p_activity_id:key})).root;
async function count(env,table,key,idValue){
  assert.match(idValue,/^[0-9a-f-]{36}$/);
  return Number(await env.sql("SELECT count(*) FROM "+table+" WHERE "+key+"='"+idValue+"';"));
}
const domainTables=["quests","quest_occurrences","quest_events","goals","goal_quest_links","exp_ledger","schedule_events","books"];
async function domainSnapshot(env){
  const body=domainTables.map(t=>"'"+t+"',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public."+t+" x)").join(",");
  return await env.sql("SELECT jsonb_build_object("+body+")::text;");
}
async function noOpAndStale(env,owner){
  const o=await opportunity(owner,"L109 no-op and receipt",{organization:"Initial"});
  const unchanged=await getOpp(owner,o.key);
  const countBefore=await count(env,"public.opportunity_history","opportunity_id",o.key);
  const action={p_command_id:id(),p_opportunity_id:o.key,p_expected_revision:"1",p_changes:{organization:"Initial"}};
  const noop=await rpc(owner,"update_opportunity_v1",action);
  assert.equal(noop.changed,false);assert.equal(noop.replay,false);assert.equal(noop.revision_after,"1");
  assert.deepEqual(await getOpp(owner,o.key),unchanged,"Opportunity no-op changed timestamps/state");
  assert.equal(await count(env,"public.opportunity_history","opportunity_id",o.key),countBefore);
  const accepted=await rpc(owner,"resolve_ao_command_v1",{p_command_id:action.p_command_id});
  assert.equal(accepted.outcome,"recorded");assert.equal(accepted.receipt.changed,false);
  const replay=await rpc(owner,"update_opportunity_v1",action);
  assert.equal(replay.replay,true);assert.equal(replay.changed,false);
  const unknown=await rpc(owner,"resolve_ao_command_v1",{p_command_id:id()});
  assert.equal(unknown.outcome,"unknown");
  const a=await activity(owner,"L109 Activity no-op");
  const beforeAct=await getAct(owner,a.key),beforeActCount=await count(env,"public.activity_history","activity_id",a.key);
  const noAct=await rpc(owner,"update_activity_v1",{p_command_id:id(),p_activity_id:a.key,
    p_expected_revision:"1",p_changes:{title:beforeAct.title}});
  assert.equal(noAct.changed,false);
  assert.deepEqual(await getAct(owner,a.key),beforeAct);
  assert.equal(await count(env,"public.activity_history","activity_id",a.key),beforeActCount);
  // A failed stale revision is an atomic rejection: root/history/receipt and all
  // pre-existing domain data must stay identical.
  await rpc(owner,"update_opportunity_v1",{p_command_id:id(),p_opportunity_id:o.key,
    p_expected_revision:"1",p_changes:{organization:"Updated"}});
  const root=await getOpp(owner,o.key),otherDomains=await domainSnapshot(env);
  const history=await count(env,"public.opportunity_history","opportunity_id",o.key);
  const receiptCount=await count(env,"system_internal.ao_commands","opportunity_id",o.key);
  const badCmd=id();
  rejected(await owner.rpc("update_opportunity_v1",{p_command_id:badCmd,p_opportunity_id:o.key,
    p_expected_revision:"1",p_changes:{organization:"Stale"}}),"stale revision","23514");
  assert.deepEqual(await getOpp(owner,o.key),root,"stale mutation altered root");
  assert.equal(await count(env,"public.opportunity_history","opportunity_id",o.key),history);
  assert.equal(await count(env,"system_internal.ao_commands","opportunity_id",o.key),receiptCount);
  assert.equal((await rpc(owner,"resolve_ao_command_v1",{p_command_id:badCmd})).outcome,"unknown");
  assert.equal(await domainSnapshot(env),otherDomains,"stale command modified legacy domains");
  console.log("PASS: L1-09 QA-14/15/18 no-op timestamp/receipt/replay, stale atomic rollback, unknown receipt");
}
async function archiveRestore(owner){
  const o=await opportunity(owner,"L109 archive restore Opportunity");
  const a=await activity(owner,"L109 archive restore Activity");
  for(const [kind,key] of [["opportunity",o.key],["activity",a.key]]){
    const name=kind==="opportunity"?"set_opportunity_archived_v1":"set_activity_archived_v1";
    const keyProp=kind==="opportunity"?"p_opportunity_id":"p_activity_id";
    const read=kind==="opportunity"?getOpp:getAct;
    const a1=await rpc(owner,name,{p_command_id:id(),[keyProp]:key,p_expected_revision:"1",p_archived:true});
    assert.equal(a1.changed,true);
    assert((await read(owner,key)).archived_at,kind+": missing archived_at");
    const archiveRow=await read(owner,key);
    const noOp=await rpc(owner,name,{p_command_id:id(),[keyProp]:key,p_expected_revision:"2",p_archived:true});
    assert.equal(noOp.changed,false);
    assert.deepEqual(await read(owner,key),archiveRow,kind+": repeated archive changed timestamp");
    rejected(await owner.rpc(name,{p_command_id:id(),[keyProp]:key,p_expected_revision:"1",p_archived:false}),
      kind+" stale restoration","23514");
    const restored=await rpc(owner,name,{p_command_id:id(),[keyProp]:key,p_expected_revision:"2",p_archived:false});
    assert.equal(restored.changed,true);
    assert.equal((await read(owner,key)).archived_at,null,kind+": archived restoration failed");
    assert.equal(String((await read(owner,key)).revision),"3");
  }
  console.log("PASS: L1-09 QA-18 both root types archive/read/no-op/stale/restore");
}
async function timezoneProfile(env,owner){
  const clock={precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_offset_minutes:-240,source_zone:"America/New_York"};
  const o=await opportunity(owner,"L109 profile timezone invariance",{application_deadline:clock});
  const sqlUtc=()=>env.sql("SELECT deadline_at_utc::text FROM public.opportunities WHERE id='"+o.key+"'");
  const originally=await sqlUtc();
  const profile=ok(await owner.from("profiles").select("timezone").eq("user_id",env.owner.id).single(),"read disposable profile");
  try{
    const r=await owner.from("profiles").update({timezone:"Asia/Tokyo"}).eq("user_id",env.owner.id).select("timezone").single();
    assert.equal(ok(r,"update owner profile timezone").timezone,"Asia/Tokyo");
    assert.equal(await sqlUtc(),originally,"profile timezone change reinterpreted persisted UTC");
    const v=await getOpp(owner,o.key);assert.deepEqual(v.application_deadline,clock);
    const edit=await rpc(owner,"update_opportunity_v1",{p_command_id:id(),p_opportunity_id:o.key,
      p_expected_revision:"1",p_changes:{organization:"Another timezone test"}});
    assert.equal(edit.changed,true);
    assert.equal(await sqlUtc(),originally,"unrelated edit reinterpreted stored UTC after timezone change");
  } finally {
    ok(await owner.from("profiles").update({timezone:profile.timezone}).eq("user_id",env.owner.id),
      "restore disposable profile timezone");
  }
  console.log("PASS: L1-09 QA-09/10 real Profile timezone change cannot rewrite accepted UTC deadline");
}
async function modelParity(owner){
  const accepted=[
    {title:"L109 học bổng 😀",selection_outcome:"accepted"},
    {title:"L109 historically Closed",tracking_stage:"closed",closed_reason:"other",closed_note:"Ghi chú\r\nxuống dòng"},
    {title:"L109 year one",program_start:{precision:"year",year:1}},
    {title:"L109 leap day",program_start:{precision:"day",year:2024,month:2,day:29}},
    {title:"L109 year 9999",program_end:{precision:"year",year:9999}},
    {title:"L109 unknown",program_start:{precision:"unknown"}},
  ];
  for(const fields of accepted){
    const ts=model.normalizeOpportunity(fields,"create");
    assert.equal(ts.ok,true,"TypeScript expected valid: "+fields.title);
    const o=await opportunity(owner,fields.title,Object.fromEntries(Object.entries(fields).filter(([k])=>k!=="title")));
    const row=await getOpp(owner,o.key);
    for(const k of Object.keys(fields))assert.deepEqual(row[k],ts.value[k],fields.title+" TS/SQL parity "+k);
  }
  const rejects=[
    {title:"Invalid applicability",selection_applicability:"not_applicable",selection_outcome:"accepted"},
    {title:"Invalid closed note",tracking_stage:"saved",closed_reason:"other",closed_note:"why"},
    {title:"Invalid other missing",tracking_stage:"closed",closed_reason:"other"},
    {title:"Invalid order",program_start:{precision:"day",year:2030,month:2,day:3},
      program_end:{precision:"day",year:2029,month:1,day:1}},
    {title:"Invalid year zero",program_start:{precision:"year",year:0}},
    {title:"Invalid day",program_start:{precision:"day",year:2025,month:2,day:29}},
    {title:"Invalid extra date",program_start:{precision:"year",year:2026,extra:1}},
  ];
  for(const fields of rejects){
    const ts=model.normalizeOpportunity(fields,"create");
    assert.equal(ts.ok,false,"TypeScript expected invalid: "+fields.title);
    const key=id(),cmd=id();
    rejected(await owner.rpc("create_opportunity_v1",{p_command_id:cmd,p_opportunity_id:key,p_fields:fields}),
      "SQL accepted invalid TS state "+fields.title);
  }
  const intents=["confirmed_plan","confirmed_started","historical_completed","historical_ended_early"];
  for(const intent of intents){
    const ts=model.normalizeActivityCreate({title:"L109 "+intent,intent});
    assert.equal(ts.ok,true);
    const a=await activity(owner,"L109 "+intent,intent);
    const row=await getAct(owner,a.key);
    assert.equal(row.status,ts.value.fields.status);
    assert.equal(row.actual_start,ts.value.fields.actual_start);
    assert.equal(row.actual_end,ts.value.fields.actual_end);
  }
  console.log("PASS: L1-09 QA-06/07/08/11 SQL/TS parity selected valid and invalid creation corpora");
}
async function crossDomain(env,owner){
  const goal=id();
  await rpc(owner,"create_goal_v1",{p_command_id:id(),p_goal_id:goal,p_title:"L109 immutable Goal",p_description:null});
  const quest=await rpc(owner,"create_one_off_quest",{command_id:id(),origin:"web_ui",
    request:{title:"L109 immutable Quest",scheduled_at:"2031-11-03T11:00:00Z",default_reward_exp:0}});
  const before=await domainSnapshot(env);
  const o=await opportunity(owner,"L109 snapshot Opportunity"),a=await activity(owner,"L109 snapshot Activity");
  const link=await rpc(owner,"attach_ao_context_v1",{p_command_id:id(),
    p_source_kind:"opportunity",p_source_id:o.key,p_expected_revision:"1",p_target_kind:"goal",p_target_id:goal});
  assert.equal(link.changed,true);
  const questLink=await rpc(owner,"attach_ao_context_v1",{p_command_id:id(),
    p_source_kind:"activity",p_source_id:a.key,p_expected_revision:"1",p_target_kind:"quest",p_target_id:quest.quest_id});
  assert.equal(questLink.changed,true);
  const provenance=await rpc(owner,"set_activity_source_v1",{p_command_id:id(),p_activity_id:a.key,p_expected_revision:"2",
    p_expected_source_link_id:null,p_desired_opportunity_id:o.key,p_note:null});
  assert.equal(provenance.changed,true);
  await rpc(owner,"update_opportunity_v1",{p_command_id:id(),p_opportunity_id:o.key,
    p_expected_revision:"2",p_changes:{description:"Independent metadata"}});
  assert.equal(await domainSnapshot(env),before,
    "AO root/typed Goal/Quest links/provenance mutations changed legacy domain data");
  console.log("PASS: L1-09 QA-04/23/32 exact external-domain snapshots after Goal+Quest links, source and metadata");
}
export async function exerciseAoL109(env,owner){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/);
  await noOpAndStale(env,owner);
  await archiveRestore(owner);
  await timezoneProfile(env,owner);
  await modelParity(owner);
  await crossDomain(env,owner);
  console.log("PASS: L1-09 acceptance coverage SUBSET; full 35-row release signoff remains OPEN");
}
