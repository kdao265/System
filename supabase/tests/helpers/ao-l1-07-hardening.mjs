// L1-07 Final Hardening. Disposable fixture-only PostgreSQL/PostgREST/Auth.
 // No external database targets, no migration writes, no release permission.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const uuid=()=>randomUUID();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function good(result,label){
  assert.equal(result.error,null,label+": "+(result.error?.code??"")+" "+(result.error?.message??""));
  return result.data;
}
async function rpc(client,name,args,label=name){return good(await client.rpc(name,args),label);}
function denied(r,code,label){assert(r.error,label+": unexpectedly succeeded");if(code)assert.equal(r.error.code,code,label);}
function redacted(value,secret,label){
  assert(!JSON.stringify(value).includes(secret),label+": deleted Quest title exposed");
}
async function freshOwnerSession(env){
  const client=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});
  good(await client.auth.signInWithPassword({email:env.owner.email,password:env.owner.password}),
    "second owner Auth session");
  return client;
}
async function newOpportunity(client,label){
  const id=uuid();
  await rpc(client,"create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:id,p_fields:{title:label}});
  return id;
}
async function newActivity(client,label){
  const id=uuid();
  await rpc(client,"create_activity_v1",{
    p_command_id:uuid(),p_activity_id:id,p_fields:{title:label,intent:"confirmed_plan"}});
  return id;
}
async function newQuest(client,label){
  return rpc(client,"create_one_off_quest",{
    command_id:uuid(),origin:"web_ui",
    request:{title:label,scheduled_at:"2031-07-14T10:00:00Z",default_reward_exp:0}});
}
async function sqlCount(env,query){return Number(await env.sql("SELECT count(*) FROM "+query+";"));}
async function waitForLocks(env,expected,label){
  const query="pg_locks WHERE locktype='advisory' AND "+(expected===0?"granted":"NOT granted");
  for(let n=0;n<65;n++){
    if(await sqlCount(env,query)>=expected && (expected!==0 || await sqlCount(env,query)===1))return;
    await sleep(100);
  }
  throw Error(label+": PostgreSQL lock state did not reach "+expected);
}
async function orderedOwnerLockRace(env,first,second,label){
  // A separate fixture-owned psql transaction occupies the exact advisory key
  // used by progression_internal.lock_owner(uuid). It holds for 12s. Verify
  // PostgREST caller #1 is waiting before starting caller #2, then verify two
  // blocked advisory locks before releasing. Timing alone is NOT the proof.
  const ownerId=env.owner.id;
  assert.match(ownerId,/^[a-f0-9-]{36}$/);
  const key="hashtextextended('system.v1.progression.owner:"+ownerId+"',0)";
  const holder=env.sql("BEGIN; SELECT pg_advisory_xact_lock("+key+"); SELECT pg_sleep(12); COMMIT;")
    .then(()=>null,error=>error);
  let one=null,two=null,checked=false;
  try{
    // The only granted advisory key in this otherwise idle disposable fixture
    // is our deliberately held owner lock.
    await waitForLocks(env,0,label+" owner-lock holder");
    const query="pg_locks WHERE locktype='advisory' AND NOT granted";
    assert.equal(await sqlCount(env,query),0,label+" unexpected pre-existing waiter");
    one=first();
    await waitForLocks(env,1,label+" first waiter");
    assert.equal(await sqlCount(env,query),1,label+" first waiter count");
    two=second();
    await waitForLocks(env,2,label+" second waiter");
    assert.equal(await sqlCount(env,query),2,label+" second waiter count");
    checked=true;
  }finally{
    const holderError=await holder;
    assert.equal(holderError,null,label+": fixture lock holder failed");
  }
  assert(checked,label+": did not observe sequential PostgreSQL lock queue");
  const [a,b]=await Promise.all([one,two]);
  return [a,b];
}
function request(client,name,args){return ()=>client.rpc(name,args,{signal:AbortSignal.timeout(30000)});}
async function lockOrderRaces(env,owner){
  const other=await freshOwnerSession(env);
  for(const firstKind of ["attach","delete"]){
    const source=await newOpportunity(owner,"Final quest-delete "+firstKind);
    const q=await newQuest(owner,"Final synthetic race Quest");
    const attach=request(owner,"attach_ao_context_v1",{
      p_command_id:uuid(),p_source_kind:"opportunity",p_source_id:source,
      p_expected_revision:"1",p_target_kind:"quest",p_target_id:q.quest_id});
    const remove=request(other,"delete_one_off_quest_v1",{
      p_command_id:uuid(),p_quest_id:q.quest_id,p_origin:"web_ui"});
    const [first,second]=await orderedOwnerLockRace(env,
      firstKind==="attach"?attach:remove,firstKind==="attach"?remove:attach,
      "Quest Delete "+firstKind);
    good(first,"first Quest race "+firstKind);
    if(firstKind==="delete")denied(second,"23514","attach after confirmed delete");
    else good(second,"delete after confirmed attach");
    const links=await sqlCount(env,"public.opportunity_quest_links WHERE opportunity_id='"+source+
      "' AND quest_id='"+q.quest_id+"' AND detached_at IS NULL");
    assert.equal(links,firstKind==="attach"?1:0,"Quest delete order link invariant");
    assert.equal(await env.sql("SELECT deleted_at IS NOT NULL FROM public.quests WHERE id='"+q.quest_id+"'"),"true",
      "Quest delete outcome was not persisted");
  }
  console.log("PASS: L1-07 Final QA-24 advisory lock wait-queue attach/Quest Delete both orders");

  for(const firstKind of ["attach","archive"]){
    const source=await newOpportunity(owner,"Final Goal archive "+firstKind),goal=uuid();
    await rpc(owner,"create_goal_v1",{p_command_id:uuid(),p_goal_id:goal,
      p_title:"Final synthetic Goal",p_description:null});
    const attach=request(owner,"attach_ao_context_v1",{
      p_command_id:uuid(),p_source_kind:"opportunity",p_source_id:source,
      p_expected_revision:"1",p_target_kind:"goal",p_target_id:goal});
    const archive=request(other,"set_goal_archived_v1",{
      p_command_id:uuid(),p_goal_id:goal,p_expected_revision:"1",p_archived:true});
    const [first,second]=await orderedOwnerLockRace(env,
      firstKind==="attach"?attach:archive,firstKind==="attach"?archive:attach,
      "Goal Archive "+firstKind);
    good(first,"first Goal race "+firstKind);
    if(firstKind==="archive")denied(second,"23514","attach after Goal Archive");
    else good(second,"Goal Archive after attach");
    assert.equal(await env.sql("SELECT archived_at IS NOT NULL FROM public.goals WHERE id='"+goal+"'"),"true");
    assert.equal(await sqlCount(env,"public.opportunity_goal_links WHERE opportunity_id='"+source+
      "' AND goal_id='"+goal+"' AND detached_at IS NULL"),firstKind==="attach"?1:0);
  }
  console.log("PASS: L1-07 Final QA-25 advisory lock wait-queue AO attach/Goal Archive both orders");

  for(const firstKind of ["source","archive"]){
    const source=await newOpportunity(owner,"Final source archive "+firstKind);
    const activity=await newActivity(owner,"Final source race");
    const link=request(owner,"set_activity_source_v1",{
      p_command_id:uuid(),p_activity_id:activity,p_expected_revision:"1",
      p_expected_source_link_id:null,p_desired_opportunity_id:source,p_note:null});
    const archive=request(other,"set_opportunity_archived_v1",{
      p_command_id:uuid(),p_opportunity_id:source,p_expected_revision:"1",p_archived:true});
    const [first,second]=await orderedOwnerLockRace(env,
      firstKind==="source"?link:archive,firstKind==="source"?archive:link,
      "Source Archive "+firstKind);
    good(first,"first Source race "+firstKind);
    if(firstKind==="archive")denied(second,"23514","new source after archived Opportunity");
    else good(second,"archive after source link");
    assert.equal(await env.sql("SELECT archived_at IS NOT NULL FROM public.opportunities WHERE id='"+source+"'"),"true");
    assert.equal(await sqlCount(env,"public.activity_source_links WHERE activity_id='"+activity+
      "' AND opportunity_id='"+source+"' AND detached_at IS NULL"),firstKind==="source"?1:0);
  }
  console.log("PASS: L1-07 Final QA-25 advisory lock wait-queue source/Opportunity Archive both orders");
}

async function assertHistorySafe(owner,kind,id,secret){
  let cursor=null,seen=new Set();
  for(let n=0;n<12;n++){
    const page=await rpc(owner,"list_ao_history_v1",{
      p_subject_kind:kind,p_subject_id:id,p_cursor:cursor,p_limit:1});
    redacted(page,secret,kind+" history page");
    for(const h of page.items){assert(!seen.has(h.id),"repeated history entry");seen.add(h.id);}
    if(!page.next_cursor){assert(seen.size>=2,"expected contextual history");return;}
    cursor=page.next_cursor;
  }
  throw Error(kind+" history did not terminate");
}
async function privacySurface(env,owner,other,anon){
  const secret="FINAL_PRIVATE_QUEST_"+uuid().replaceAll("-","");
  const opp=await newOpportunity(owner,"Final privacy Opportunity");
  const act=await newActivity(owner,"Final privacy Activity");
  const q=await newQuest(owner,secret);
  const oCmd=uuid(),aCmd=uuid(),sCmd=uuid();
  good(await owner.rpc("attach_ao_context_v1",{
    p_command_id:oCmd,p_source_kind:"opportunity",p_source_id:opp,
    p_expected_revision:"1",p_target_kind:"quest",p_target_id:q.quest_id}),"Opportunity attach");
  good(await owner.rpc("attach_ao_context_v1",{
    p_command_id:aCmd,p_source_kind:"activity",p_source_id:act,
    p_expected_revision:"1",p_target_kind:"quest",p_target_id:q.quest_id}),"Activity attach");
  good(await owner.rpc("set_activity_source_v1",{
    p_command_id:sCmd,p_activity_id:act,p_expected_revision:"2",
    p_expected_source_link_id:null,p_desired_opportunity_id:opp,p_note:null}),"Activity source");
  await rpc(owner,"delete_one_off_quest_v1",{
    p_command_id:uuid(),p_quest_id:q.quest_id,p_origin:"web_ui"});
  const expected={id:q.quest_id,deleted:true,label:"Quest đã xóa"};
  for(const [kind,id] of [["opportunity",opp],["activity",act]]){
    const x=await rpc(owner,"get_"+kind+"_v1",{["p_"+kind+"_id"]:id});
    redacted(x,secret,kind+" root/contexts/source/derived");
    const link=x.contexts.find(c=>c.target_kind==="quest" && c.target?.id===q.quest_id);
    assert(link,kind+": retained Quest context missing");
    assert.deepEqual(link.target,expected,kind+": deleted Quest projection not neutral");
    await assertHistorySafe(owner,kind,id,secret);
    const listed=await rpc(owner,kind==="opportunity"?"list_opportunities_v1":"list_activities_v1",{
      p_scope:"active",p_filters:{},p_cursor:null,p_limit:100});
    redacted(listed,secret,kind+" active list");
    assert(listed.items.some(item=>item.id===id),kind+" missing from list");
    const candidate=await rpc(owner,"search_ao_link_candidates_v1",{
      p_source_kind:kind,p_source_id:id,p_target_kind:"quest",
      p_query:secret,p_after_id:null,p_limit:50});
    redacted(candidate,secret,kind+" candidate");
    assert.deepEqual(candidate.items,[],kind+" deleted Quest returned as candidate");
    const rejected=await owner.rpc("attach_ao_context_v1",{
      p_command_id:uuid(),p_source_kind:kind,p_source_id:id,
      p_expected_revision:kind==="opportunity"?"2":"3",
      p_target_kind:"quest",p_target_id:q.quest_id});
    denied(rejected,"23514",kind+" deleted Quest reattach");
    redacted(rejected,secret,kind+" rejected error");
  }
  const linked=await rpc(owner,"list_activities_v1",{
    p_scope:"active",p_filters:{source_opportunity_id:opp},p_cursor:null,p_limit:50});
  redacted(linked,secret,"source-filter derived Activities");
  assert(linked.items.some(item=>item.id===act),"source provenance disappeared");
  const oppDetail=await rpc(owner,"get_opportunity_v1",{p_opportunity_id:opp});
  redacted(oppDetail.derived_activities,secret,"Opportunity derived preview");
  assert(oppDetail.derived_activities.items.some(item=>item.id===act));
  for(const cmd of [oCmd,aCmd,sCmd]){
    const receipt=await rpc(owner,"resolve_ao_command_v1",{p_command_id:cmd});
    redacted(receipt,secret,"command receipt");
    assert.equal(receipt.outcome,"recorded");
  }
  for(const client of [other,anon]){
    for(const [name,args] of [["get_opportunity_v1",{p_opportunity_id:opp}],
      ["get_activity_v1",{p_activity_id:act}],
      ["resolve_ao_command_v1",{p_command_id:oCmd}]]){
      const r=await client.rpc(name,args);
      redacted(r,secret,"nonowner/anon "+name);
      assert(r.error || r.data===null,"private subject accessible to nonowner/anon");
    }
  }
  console.log("PASS: L1-07 Final QA-27 deleted Quest redacted in both roots, contexts, lists, source, derived, history, candidates, receipts, errors");
}
export async function exerciseAoL107Hardening(env,owner,other,anon){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/,"disposable loopback only");
  await privacySurface(env,owner,other,anon);
  await lockOrderRaces(env,owner);
  console.log("PASS: L1-07 Final test suite complete; deployment readiness requires separate review/signoff");
}
