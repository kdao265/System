// Batch A: authorised fixture-only QA-10/12/23 checks. Review SQL is never edited.
// Runtime context must be the existing tmpfs/loopback Auth/PostgREST/PG runner.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import * as model from "../../../src/features/activities-opportunities/model.ts";

const id=()=>randomUUID();
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
function good(response,label){assert.equal(response.error,null,label+": "+(response.error?.code??"")+" "+(response.error?.message??""));return response.data;}
const rpc=async(client,name,args)=>good(await client.rpc(name,args),name);
function deny(response,label,code="23514"){assert(response.error,label+": unexpectedly succeeded");assert.equal(response.error.code,code,label+": unexpected SQLSTATE");}
async function opportunity(c){const key=id();await rpc(c,"create_opportunity_v1",{p_command_id:id(),p_opportunity_id:key,p_fields:{title:"Batch A synthetic Opportunity "+key}});return key;}
async function activity(c){const key=id();await rpc(c,"create_activity_v1",{p_command_id:id(),p_activity_id:key,p_fields:{title:"Batch A synthetic Activity "+key,intent:"confirmed_plan"}});return key;}
async function quest(c,label){return (await rpc(c,"create_one_off_quest",{command_id:id(),origin:"web_ui",request:{title:label,scheduled_at:"2032-03-12T09:30:00Z",default_reward_exp:0}})).quest_id;}
const externalTables=["quests","quest_occurrences","quest_events","quest_recurrence_rules","goals","goal_quest_links","exp_ledger","schedule_events","books"];
async function domainSnapshot(env){return env.sql("SELECT jsonb_build_object("+externalTables.map(t=>q(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public."+t+" x)").join(",")+")::text;");}
async function pgReject(env,statement,expected,label){
  assert.match(expected,/^[0-9A-Z]{5}$/);
  const sql="DO $check$ BEGIN BEGIN "+statement+
   "; RAISE EXCEPTION 'EXPECTED FAILURE NOT SEEN: "+label.replaceAll("'","")+" ' USING ERRCODE='P9999';"+
   " EXCEPTION WHEN SQLSTATE "+q(expected)+" THEN NULL; END; END $check$;";
  await env.sql(sql);
}

async function timezoneRules(env,owner){
  const node=process.versions;
  assert(node.node&&node.icu&&node.tz,"Node tzdb / ICU provenance must be available");
  const pg=await env.sql("SELECT current_setting('server_version')||';timezone='||current_setting('TimeZone')||';zones='||(SELECT count(*) FROM pg_catalog.pg_timezone_names)::text;");
  assert.match(pg,/^[0-9].*;timezone=.*;zones=[0-9]+$/);
  const cases=[
    ["New York winter",{precision:"instant",source_date:"2026-01-15",source_time:"12:00",source_zone:"America/New_York",source_offset_minutes:-300},true],
    ["New York summer",{precision:"instant",source_date:"2026-07-15",source_time:"12:00",source_zone:"America/New_York",source_offset_minutes:-240},true],
    ["New York spring gap",{precision:"instant",source_date:"2026-03-08",source_time:"02:30",source_zone:"America/New_York",source_offset_minutes:-300},false],
    ["New York fall fold EDT",{precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_zone:"America/New_York",source_offset_minutes:-240},true],
    ["New York fall fold EST",{precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_zone:"America/New_York",source_offset_minutes:-300},true],
    ["New York bad fold offset",{precision:"instant",source_date:"2026-11-01",source_time:"01:30",source_zone:"America/New_York",source_offset_minutes:-360},false],
    ["Berlin winter",{precision:"instant",source_date:"2026-01-15",source_time:"12:00",source_zone:"Europe/Berlin",source_offset_minutes:60},true],
    ["Berlin summer",{precision:"instant",source_date:"2026-07-15",source_time:"12:00",source_zone:"Europe/Berlin",source_offset_minutes:120},true],
    ["Berlin DST gap",{precision:"instant",source_date:"2026-03-29",source_time:"02:30",source_zone:"Europe/Berlin",source_offset_minutes:60},false],
    ["Ho Chi Minh",{precision:"instant",source_date:"2026-10-12",source_time:"12:00",source_zone:"Asia/Ho_Chi_Minh",source_offset_minutes:420},true],
    ["Auckland summer",{precision:"instant",source_date:"2026-01-15",source_time:"12:00",source_zone:"Pacific/Auckland",source_offset_minutes:780},true],
    ["Auckland winter",{precision:"instant",source_date:"2026-07-15",source_time:"12:00",source_zone:"Pacific/Auckland",source_offset_minutes:720},true],
  ];
  for(const [label,deadline,expectGood] of cases){
    const ts=model.parseDeadline(deadline);
    assert.equal(ts.ok,expectGood,"Node timezone semantics "+label);
    const key=id();
    const attempt=await owner.rpc("create_opportunity_v1",{p_command_id:id(),p_opportunity_id:key,
      p_fields:{title:"Batch A timezone "+label+" "+key,application_deadline:deadline}});
    assert.equal(attempt.error===null,ts.ok,"Node/Postgres tzdb mismatch "+label+" "+(attempt.error?.message??""));
    if(!ts.ok)continue;
    const actual=await env.sql("SELECT to_char(deadline_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM public.opportunities WHERE id="+q(key)+";");
    assert.equal(actual,new Date(ts.value.utcMilliseconds).toISOString().slice(0,19)+"Z","exact UTC "+label);
  }
  // PostgreSQL server_version identifies the runtime but is NOT a tzdata release.
  // Do not infer a universally locked timezone-rule database from this evidence.
  console.log("PASS: Batch A QA-10 "+cases.length+" paired Zone/UTC cases; Node="+node.node+", ICU="+node.icu+", Node tzdb="+node.tz+"; PostgreSQL runtime="+pg);
  console.log("OPEN: PostgreSQL container tzdb release and cross-version reproducibility not independently pinned; QA-10 stays PARTIAL");
}

async function directJsonConstraints(env,owner){
  const o=await opportunity(owner),a=await activity(owner);
  const rootBefore=await env.sql("SELECT (SELECT to_jsonb(x)::text FROM public.opportunities x WHERE id="+q(o)+")||E'\\n'||(SELECT to_jsonb(x)::text FROM public.activities x WHERE id="+q(a)+");");
  const histBefore=await env.sql("SELECT (SELECT count(*) FROM public.opportunity_history WHERE opportunity_id="+q(o)+")::text||':'||(SELECT count(*) FROM public.activity_history WHERE activity_id="+q(a)+")::text;");
  const externalBefore=await domainSnapshot(env);
  const badPartial=[
    ["JSON null","null"],["JSON string",'"2031"'],["JSON array","[]"],["JSON true","true"],
    ["missing precision",'{"year":2031}'],["extra keys",'{"precision":"year","year":2031,"extra":1}'],
    ["noninteger year",'{"precision":"year","year":2031.5}'],
    ["string year",'{"precision":"year","year":"2031"}'],
    ["invalid year zero",'{"precision":"year","year":0}'],
    ["missing month",'{"precision":"month","year":2031}'],
    ["impossible leap",'{"precision":"day","year":2031,"month":2,"day":29}'],
  ];
  let tested=0;
  for(const tableCase of [{table:"public.opportunities",column:"program_start",key:o},{table:"public.activities",column:"planned_start",key:a}]){
    for(const [label,value] of badPartial){
      await pgReject(env,"UPDATE "+tableCase.table+" SET "+tableCase.column+"="+q(value)+"::jsonb WHERE id="+q(tableCase.key),"23514",label);
      tested++;
    }
  }
  const badResources=[["resource scalar",'"https://example.org"'],["resource object",'{"label":"x"}'],["resource null","null"],["resource element wrong type",'[3]'],["resource extra keys",'[{"id":"11111111-1111-4111-8111-111111111111","label":"OK","url":"https://example.org","extra":"x"}]']];
  for(const [label,value] of badResources){
    await pgReject(env,"UPDATE public.activities SET resource_links="+q(value)+"::jsonb WHERE id="+q(a),"23514",label);
    tested++;
  }
  for(const [label,sql,state] of [
    ["missing status","UPDATE public.activities SET status=NULL WHERE id="+q(a),"23502"],
    ["missing selection outcome","UPDATE public.opportunities SET selection_outcome=NULL WHERE id="+q(o),"23502"]
  ]){await pgReject(env,sql,state,label);tested++;}
  const rootAfter=await env.sql("SELECT (SELECT to_jsonb(x)::text FROM public.opportunities x WHERE id="+q(o)+")||E'\\n'||(SELECT to_jsonb(x)::text FROM public.activities x WHERE id="+q(a)+");");
  assert.equal(rootAfter,rootBefore,"Invalid direct SQL changed AO roots");
  assert.equal(await env.sql("SELECT (SELECT count(*) FROM public.opportunity_history WHERE opportunity_id="+q(o)+")::text||':'||(SELECT count(*) FROM public.activity_history WHERE activity_id="+q(a)+")::text;"),histBefore);
  assert.equal(await domainSnapshot(env),externalBefore,"Invalid direct SQL changed external domains");
  console.log("PASS: Batch A QA-12 "+tested+" extra direct PostgreSQL wrong-shape/null/field tests and atomic snapshots; review of all constraints still required");
}

async function questEligibility(env,owner,other){
  const archived=await quest(owner,"Batch A archived synthetic Quest");
  await rpc(owner,"set_one_off_quest_archived_v1",{p_command_id:id(),p_quest_id:archived,p_archived:true,p_origin:"web_ui"});
  const deleted=await quest(owner,"Batch A deleted synthetic Quest");
  await rpc(owner,"delete_one_off_quest_v1",{p_command_id:id(),p_quest_id:deleted,p_origin:"web_ui"});
  // Recurring Quest domain requires an explicitly configured Profile timezone.
  // Set this only on the fixture owner through authenticated RLS, never on real profiles.
  const tzResult=await owner.from("profiles").update({timezone:"UTC"}).eq("user_id",env.owner.id);
  assert.equal(tzResult.error,null,"Batch A disposable Profile timezone setup");
  const start=await env.sql("SELECT ((now() AT TIME ZONE 'UTC')::date + 7)::text;");
  const recurring=(await rpc(owner,"create_recurring_quest",{command_id:id(),origin:"web_ui",request:{
    title:"Batch A recurring synthetic Quest",recurrence_mode:"daily",start_date:start,default_reward_exp:0}})).quest_id;
  const allowed=await quest(owner,"Batch A eligible one-off");
  const bound=await quest(owner,"Batch A legacy direct-goal-bound fixture");
  const goal=id();
  await rpc(owner,"create_goal_v1",{p_command_id:id(),p_goal_id:goal,p_title:"Batch A bound Goal",p_description:null});
  // This synthetic legacy form has no public creation route in V1. Fixture-only
  // SQL update is permitted only inside the disposable tmpfs test DB.
  await env.sql("UPDATE public.quests SET direct_goal_id="+q(goal)+" WHERE id="+q(bound)+";");
  const cases=[["archived one-off",archived],["deleted one-off",deleted],["recurring",recurring],["legacy direct goal",bound]];
  for(const kind of ["opportunity","activity"]){
    for(const [label,target] of cases){
      const source=kind==="opportunity"?await opportunity(owner):await activity(owner);
      const externalBefore=await domainSnapshot(env);
      const table="public."+kind+"_history";
      const column=kind+"_id";
      const rowBefore=(await rpc(owner,kind==="opportunity"?"get_opportunity_v1":"get_activity_v1",{
        [kind==="opportunity"?"p_opportunity_id":"p_activity_id"]:source})).root;
      const historyBefore=await env.sql("SELECT count(*) FROM "+table+" WHERE "+column+"="+q(source)+";");
      const cmd=id();
      deny(await owner.rpc("attach_ao_context_v1",{p_command_id:cmd,p_source_kind:kind,p_source_id:source,
        p_expected_revision:"1",p_target_kind:"quest",p_target_id:target}),kind+" "+label);
      const rowAfter=(await rpc(owner,kind==="opportunity"?"get_opportunity_v1":"get_activity_v1",{
        [kind==="opportunity"?"p_opportunity_id":"p_activity_id"]:source})).root;
      assert.deepEqual(rowAfter,rowBefore,kind+" "+label+" rejected changed root");
      assert.equal(await env.sql("SELECT count(*) FROM "+table+" WHERE "+column+"="+q(source)+";"),historyBefore);
      assert.equal(await env.sql("SELECT count(*) FROM system_internal.ao_commands WHERE command_id="+q(cmd)+";"),"0","rejected command left receipt");
      assert.equal(await domainSnapshot(env),externalBefore,"Rejected AO attach mutated Quest/Goal");
    }
    const src=kind==="opportunity"?await opportunity(owner):await activity(owner);
    const before=await domainSnapshot(env);
    const receipt=await rpc(owner,"attach_ao_context_v1",{p_command_id:id(),p_source_kind:kind,p_source_id:src,
      p_expected_revision:"1",p_target_kind:"quest",p_target_id:allowed});
    assert.equal(receipt.changed,true);
    assert.equal(await domainSnapshot(env),before,"Eligible AO attach altered Quest/Goal domains");
  }
  const foreign=await opportunity(owner),otherRoot=await opportunity(owner);
  const target=allowed;
  const foreignBefore=await domainSnapshot(env);
  const attempt=await other.rpc("attach_ao_context_v1",{p_command_id:id(),p_source_kind:"opportunity",p_source_id:foreign,
    p_expected_revision:"1",p_target_kind:"quest",p_target_id:target});
  assert(attempt.error,"nonowner Quest attach unexpectedly accepted");
  assert.equal(await domainSnapshot(env),foreignBefore);
  assert.equal((await rpc(owner,"get_opportunity_v1",{p_opportunity_id:otherRoot})).root.revision,"1");
  console.log("PASS: Batch A QA-23 "+(cases.length*2)+" Quest ineligible owner cases plus both eligible source types, nonowner and legacy bound fixture; archived/deleted/recurring privacy remains independently gated");
}

export async function exerciseAoBatchA(env,owner,other){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/,"Only harness-owned disposable loopback");
  await timezoneRules(env,owner);
  await directJsonConstraints(env,owner);
  await questEligibility(env,owner,other);
  console.log("PASS: Batch A scoped P0 tests QA-10/12/23; no business SQL, migration, release gating changed");
}
