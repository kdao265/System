// L1-07 Phase B: test-only. Run solely inside the pinned, loopback, disposable
// Auth/PostgREST/PostgreSQL harness. No Cloud, external DB URL, or migration writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deniedCallMatrix } from "./ao-l1-07.mjs";

const uuid=()=>randomUUID();
const escaped=(s)=>s.replaceAll("'","''");
function ok(r,label){assert.equal(r.error,null,`${label}: ${r.error?.code??""} ${r.error?.message??""}`);return r.data;}
async function rpc(client,name,args){return ok(await client.rpc(name,args),name);}
function reject(r,code,label){assert(r.error,`${label}: unexpectedly accepted`);if(code)assert.equal(r.error.code,code,label);}
function snapshotSql(){
  const tables=["quests","quest_occurrences","quest_events","goals","goal_quest_links","exp_ledger","schedule_events","books"];
  return `SELECT jsonb_build_object(${tables.map(t=>`'${t}',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.${t} x)`).join(",")})::text;`;
}
async function snapshot(env){return env.sql(snapshotSql());}
async function bounded(r,name,args){
  // A PostgreSQL deadlock should fail, not hang the GitHub job until timeout.
  const controller=new AbortController();
  const timeout=AbortSignal.timeout(12000);
  const opts={signal:AbortSignal.any([controller.signal,timeout])};
  try {return await r.rpc(name,args,opts);} finally {controller.abort();}
}
function ids(page){return page.items.map(x=>x.id);}
async function pageAll(client,kind,filter,limit=50){
  const results=[],seen=new Set();let cursor=null;
  for(let n=0;n<8;n++){
    const data=await rpc(client,`list_${kind}_v1`,{p_scope:"active",p_filters:filter,p_cursor:cursor,p_limit:limit});
    assert(data.items.length<=limit,`${kind} exceeded limit`);
    for(const row of data.items){assert(!seen.has(row.id),`${kind} repeated ${row.id}`);seen.add(row.id);results.push(row);}
    if(data.next_cursor===null)return results;
    assert(data.items.length===limit,`${kind} emitted premature cursor`);
    assert(typeof data.next_cursor.created_at==="string" && data.next_cursor.id,`${kind} malformed cursor`);
    cursor=data.next_cursor;
  }
  throw Error(`${kind} pagination did not terminate`);
}
async function setupDenseRows(env,ownerId,sourceId){
  assert.match(ownerId,/^[a-f0-9-]{36}$/);assert.match(sourceId,/^[a-f0-9-]{36}$/);
  // Synthetic bulk load in a fresh tmpfs test database, deliberately NOT through
  // the business RPC: this is a keyset stress corpus, not an action-layer claim.
  // Identical UUID-stable timestamps and 1-microsecond offsets stress QA-30.
  const base=`'2031-02-03 04:05:06.123456+00'::timestamptz`;
  await env.sql(`INSERT INTO public.opportunities
    (id,user_id,title,created_at,updated_at)
    SELECT gen_random_uuid(),'${ownerId}'::uuid,
      'L107B dense opportunity '||lpad(n::text,3,'0'),
      ${base} + ((n%3)*interval '1 microsecond'),
      ${base} + ((n%3)*interval '1 microsecond')
    FROM generate_series(1,63) AS n;`);
  await env.sql(`INSERT INTO public.activities
    (id,user_id,title,status,created_at,updated_at,participation_confirmed_at)
    SELECT gen_random_uuid(),'${ownerId}'::uuid,
      'L107B dense activity '||lpad(n::text,3,'0'),'upcoming',
      ${base} + ((n%3)*interval '1 microsecond'),
      ${base} + ((n%3)*interval '1 microsecond'),now()
    FROM generate_series(1,63) AS n;`);
  await env.sql(`INSERT INTO public.activity_source_links(user_id,activity_id,opportunity_id)
    SELECT '${ownerId}'::uuid,a.id,'${sourceId}'::uuid
    FROM public.activities a WHERE a.user_id='${ownerId}'::uuid
    AND a.title LIKE 'L107B dense activity %';`);
}

async function testPaging(env,owner){
  const opp=uuid();
  await rpc(owner,"create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:opp,
    p_fields:{title:"L107B provenance source"}});
  await setupDenseRows(env,env.owner.id,opp);
  for(const [kind,prefix] of [["opportunities","L107B dense opportunity"],["activities","L107B dense activity"]]){
    const filter={search:prefix};
    const listed=await pageAll(owner,kind,filter,50);
    assert.equal(listed.length,63,`${kind}: 63-row pagination`);
    const expected=JSON.parse(await env.sql(`SELECT jsonb_agg(id ORDER BY created_at DESC,id DESC)
       FROM public.${kind} WHERE title LIKE '${escaped(prefix)} %';`));
    assert.deepEqual(ids({items:listed}),expected,`${kind} keyset order at microsecond/UUID ties`);
    const first=await rpc(owner,`list_${kind}_v1`,
      {p_scope:"active",p_filters:filter,p_cursor:null,p_limit:50});
    assert.equal(first.items.length,50);assert(first.next_cursor,`${kind} continuation`);
    assert.match(first.next_cursor.created_at,/\.\d{6}(?:\+00:00|Z)$/, `${kind} microseconds`);
    const all100=await pageAll(owner,kind,filter,100);
    assert.deepEqual(ids({items:all100}),expected,`${kind} max limit 100`);
    const bad=[
      {p_scope:"active",p_filters:filter,p_cursor:null,p_limit:null},
      {p_scope:"active",p_filters:filter,p_cursor:null,p_limit:101},
      {p_scope:"active",p_filters:filter,p_cursor:{created_at:"bad",id:uuid()},p_limit:50},
      {p_scope:"active",p_filters:{unexpected:true},p_cursor:null,p_limit:50},
    ];
    for(const [i,args] of bad.entries())reject(await owner.rpc(`list_${kind}_v1`,args),"22023",`${kind} bad cursor/filter/limit ${i}`);
  }
  const d=await rpc(owner,"get_opportunity_v1",{p_opportunity_id:opp});
  assert.equal(d.derived_activities.items.length,50,"preview capped at 50");
  assert.equal(d.derived_activities.has_more,true,"preview must advertise more rows");
  assert.equal(d.derived_activities.continuation.rpc,"list_activities_v1");
  const linked=await pageAll(owner,"activities",{source_opportunity_id:opp},50);
  assert.equal(linked.length,63,"all 63 linked activities accessible by source filter");
  console.log("PASS: L1-07B QA-29/30/31 dense 63+63 keyset microseconds and 63-link continuation");
}

async function testHistory(env,owner){
  const id=uuid();
  await rpc(owner,"create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:id,p_fields:{title:"L107B history 0"}});
  for(let n=1;n<=53;n++)
    await rpc(owner,"update_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:id,
      p_expected_revision:String(n),p_changes:{title:`L107B history ${n}`}});
  let cursor=null,seen=new Set(),total=0;
  for(let i=0;i<3;i++){
    const x=await rpc(owner,"list_ao_history_v1",{p_subject_kind:"opportunity",p_subject_id:id,p_cursor:cursor,p_limit:50});
    assert(x.items.length<=50);for(const event of x.items){assert(!seen.has(event.id),"duplicate history");seen.add(event.id);total++;}
    if(!x.next_cursor)break;
    cursor=x.next_cursor;
  }
  assert.equal(total,54,"53 edits + creation must appear across history pages");
  assert.equal(await env.sql(`SELECT count(*) FROM public.opportunity_history WHERE opportunity_id='${id}'`),"54");
  console.log("PASS: L1-07B QA-31 history 54 rows without repeats/drops");
}

async function security(env,owner,other,anon){
  // This is a destructive *disposable-fixture-only* configuration toggle, with
  // mandatory finally restoration, never any real database.
  const names=deniedCallMatrix(uuid(),uuid());
  assert.equal(names.length,20,"exact 20 AO RPCs under missing owner");
  for(const client of [owner,other,anon]){
    for(const schema of ["system_internal","system_private"]){
      reject(await client.schema(schema).rpc("ao_assert_owner_v1"),null,"internal schema must not be exposed");
    }
  }
  await env.sql("DELETE FROM system_private.owner_configuration WHERE singleton=true;");
  try {
    for(const [name,args] of names){
      for(const client of [owner,other,anon]){
        const r=await client.rpc(name,args);
        if(client===anon)reject(r,null,"missing owner anonymous "+name);
        else reject(r,"42501","missing owner "+name);
      }
    }
  }finally{
    await env.sql(`INSERT INTO system_private.owner_configuration(user_id) VALUES ('${env.owner.id}');`);
  }
  // Recovered owner must work; anon/nonowner continue fail closed.
  await rpc(owner,"list_opportunities_v1",{p_scope:"active",p_filters:{},p_cursor:null,p_limit:1});
  console.log("PASS: L1-07 Final QA-28/34 missing owner configuration denies all 20 AO RPCs across owner/nonowner/anon");
}
async function newQuest(owner,label){
  return rpc(owner,"create_one_off_quest",{command_id:uuid(),origin:"web_ui",
    request:{title:label,scheduled_at:"2031-09-03T10:00:00Z",default_reward_exp:0}});
}
async function newOpp(owner,label){
  const id=uuid();await rpc(owner,"create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:id,p_fields:{title:label}});return id;
}
async function newActivity(owner,label){
  const id=uuid();await rpc(owner,"create_activity_v1",{p_command_id:uuid(),p_activity_id:id,p_fields:{title:label,intent:"confirmed_plan"}});return id;
}
async function concurrently(left,right,leftFirst){
  // Launch order is deterministic; actual PG lock acquisition order is *not*
  // asserted. See remaining QA-24/25 targeted lock-order test gate.
  const a=leftFirst?[left,right]:[right,left];
  const res=await Promise.all(a.map(f=>f()));
  return leftFirst?res:[res[1],res[0]];
}
async function testRaces(env,owner){
  const otherClient=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});
  ok(await otherClient.auth.signInWithPassword({email:env.owner.email,password:env.owner.password}),"second owner session login");
  for(const aFirst of [true,false]){
    const opp=await newOpp(owner,"L107B quest/delete race");
    const quest=await newQuest(owner,"L107B race disposable Quest");
    const a=()=>bounded(owner,"attach_ao_context_v1",{
      p_command_id:uuid(),p_source_kind:"opportunity",p_source_id:opp,
      p_expected_revision:"1",p_target_kind:"quest",p_target_id:quest.quest_id});
    const d=()=>bounded(otherClient,"delete_one_off_quest_v1",{
      p_command_id:uuid(),p_quest_id:quest.quest_id,p_origin:"web_ui"});
    const [link,del]=await concurrently(a,d,aFirst);
    ok(del,"Quest Delete concurrent");
    if(link.error)assert(["23514","P0002"].includes(link.error.code),"invalid attach error");
    else assert(link.data.changed,"accepted attach not changed");
    const state=JSON.parse(await env.sql(`SELECT jsonb_build_object(
       'deleted',(SELECT deleted_at IS NOT NULL FROM public.quests WHERE id='${quest.quest_id}'),
       'links',(SELECT count(*) FROM public.opportunity_quest_links WHERE opportunity_id='${opp}' AND quest_id='${quest.quest_id}' AND detached_at IS NULL))::text;`));
    assert.equal(state.deleted,true,"Quest Delete blocked by link");
    assert.equal(Number(state.links),link.error?0:1,"unexpected contextual link after delete race");
  }
  for(const aFirst of [true,false]){
    const opp=await newOpp(owner,"L107B goal/archive race");
    const goalId=uuid();
    await rpc(owner,"create_goal_v1",{p_command_id:uuid(),p_goal_id:goalId,p_title:"L107B goal",p_description:null});
    const a=()=>bounded(owner,"attach_ao_context_v1",{p_command_id:uuid(),p_source_kind:"opportunity",
      p_source_id:opp,p_expected_revision:"1",p_target_kind:"goal",p_target_id:goalId});
    const d=()=>bounded(otherClient,"set_goal_archived_v1",{
      p_command_id:uuid(),p_goal_id:goalId,p_expected_revision:"1",p_archived:true});
    const [link,archived]=await concurrently(a,d,aFirst);
    ok(archived,"Goal Archive concurrent");
    if(link.error)assert(["23514","P0002"].includes(link.error.code),"invalid Goal attach error");
    else assert(link.data.changed,"accepted Goal attach no-op");
    assert.equal(await env.sql(`SELECT (archived_at IS NOT NULL)::text FROM public.goals WHERE id='${goalId}'`),"true");
  }
  for(const aFirst of [true,false]){
    const source=await newOpp(owner,"L107B source/archive race");
    const act=await newActivity(owner,"L107B activity source race");
    const a=()=>bounded(owner,"set_activity_source_v1",{
      p_command_id:uuid(),p_activity_id:act,p_expected_revision:"1",
      p_expected_source_link_id:null,p_desired_opportunity_id:source,p_note:null});
    const d=()=>bounded(otherClient,"set_opportunity_archived_v1",{
      p_command_id:uuid(),p_opportunity_id:source,p_expected_revision:"1",p_archived:true});
    const [link,archived]=await concurrently(a,d,aFirst);
    ok(archived,"Source Opportunity Archive concurrent");
    if(link.error)assert(["23514","P0002"].includes(link.error.code),"invalid source attach error");
    else assert(link.data.changed,"source attach no-op");
    assert.equal(await env.sql(`SELECT (archived_at IS NOT NULL)::text FROM public.opportunities WHERE id='${source}'`),"true");
    const late=await owner.rpc("set_activity_source_v1",{p_command_id:uuid(),p_activity_id:act,
      p_expected_revision:link.error?"1":"2",p_expected_source_link_id:null,p_desired_opportunity_id:source,p_note:null});
    reject(late,null,"cannot create new source link from archived Opportunity");
  }
  console.log("PASS: L1-07B QA-24/25 bidirectional launch-order races (lock-order instrumentation remains open)");
}

export async function exerciseAoL107PhaseB(env,owner,other,anon){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/);
  const baseline=await snapshot(env);
  await testPaging(env,owner);
  await testHistory(env,owner);
  assert.equal(await snapshot(env),baseline,
    "AO-only pagination/history/root/context operations altered external domain tables");
  console.log("PASS: L1-07B QA-32 exact external-domain snapshot parity after AO-only operations");
  await security(env,owner,other,anon);
  await testRaces(env,owner);
  console.log("PASS: L1-07B disposable partial Phase B; deterministic opposite owner-lock acquisition, full privacy and owner-config 20x matrix remain open");
}
