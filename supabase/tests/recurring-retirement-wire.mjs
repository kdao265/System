// Only this runner's labelled disposable Auth/PostgREST/PostgreSQL environment.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { startAuthEnvironment } from "../../tests/helpers/auth-environment.mjs";
let env, owner, other, today;
const clients = [];
const id = () => randomUUID();
const day = (offset) => new Date(Date.parse(today + "T12:00:00Z") + offset * 86400000).toISOString().slice(0,10);
async function ok(name,args={}) {
  const {data,error}=await owner.rpc(name,args);
  assert.equal(error,null,`${name}: ${error?.code} ${error?.message}`); return data;
}
async function reject(name,args,code="23514",client=owner) {
  const result=await client.rpc(name,args);
  assert.equal(result.error?.code,code,`${name} should reject: ${result.error?.message}`);
}
const archiveArgs = (q, archived=true) => ({p_command_id:id(),p_quest_id:q,p_archived:archived,p_origin:"web_ui"});
const deleteArgs = (q) => ({p_command_id:id(),p_quest_id:q,p_origin:"web_ui"});
const pauseArgs = (q,paused=true) => ({command_id:id(),quest_id:q,paused,origin:"web_ui"});
async function create(extra={}) {
  return ok("create_recurring_quest",{command_id:id(),origin:"web_ui",request:{
    title:"Disposable recurring retirement",recurrence_mode:"daily",start_date:today,default_reward_exp:17,...extra}});
}
async function occurrences(q) {
  return JSON.parse(await env.sql(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY source_slot_date),'[]') FROM public.quest_occurrences o WHERE quest_id='${q}';`));
}
async function snapshot(q) {
  return JSON.parse(await env.sql(`SELECT jsonb_build_object(
    'definition',(SELECT to_jsonb(q)-'archived_at'-'deleted_at'-'updated_at' FROM public.quests q WHERE id='${q}'),
    'rules',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.quest_recurrence_rules r WHERE quest_id='${q}'),
    'occurrences',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.quest_occurrences o WHERE quest_id='${q}'),
    'history',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.quest_events e WHERE quest_id='${q}' AND event_type NOT IN ('archived','deleted')),
    'aliases',(SELECT jsonb_agg(to_jsonb(a) ORDER BY command_id) FROM system_internal.quest_completion_aliases a WHERE quest_id='${q}'),
    'exp',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.exp_ledger l),
    'milestones',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.level_milestones m),
    'unlocks',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.level_reward_unlocks u));`));
}
const completeArgs=(o)=>({command_id:id(),occurrence_id:o.id,expected_execution_cycle:o.execution_cycle,reported_completed_at:null,origin:"web_ui"});
const reopenArgs=(o)=>({command_id:id(),occurrence_id:o.id,expected_execution_cycle:o.execution_cycle,origin:"web_ui"});
before(async()=>{
  env=await startAuthEnvironment({buildApp:false});
  for(const account of [env.owner,env.other]) {
    const client=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}}); clients.push(client);
    assert.equal((await client.auth.signInWithPassword(account)).error,null);
  }
  [owner,other]=clients;
  assert.equal((await owner.from("profiles").update({timezone:"UTC"}).eq("user_id",env.owner.id)).error,null);
  const policy=await owner.from("level_policies").select("id").eq("policy_key","level_policy_v1").single();
  const grant=id();
  await env.sql(`INSERT INTO system_internal.operator_grants(id,user_id,capability) VALUES ('${grant}','${env.owner.id}','level_policy_assign');`);
  await ok("assign_level_policy",{target_user_id:env.owner.id,policy_id:policy.data.id,command_id:id(),origin:"internal"});
  await env.sql(`UPDATE system_internal.operator_grants SET revoked_at=now() WHERE id='${grant}';`);
  today=await env.sql("SELECT (now() AT TIME ZONE 'UTC')::date;");
  await env.sql(readFileSync(new URL("./recurring-retirement-catalog.sql",import.meta.url),"utf8"));
});
after(async()=>{for(const c of clients)c.auth.stopAutoRefresh(); await env?.close();});
test("SECURITY INVOKER archived list returns owner archives only under real authenticated RLS",async()=>{
  const active=(await create()).quest_id, archived=(await create()).quest_id, deleted=(await create()).quest_id;
  await ok("set_recurring_quest_archived_v1",archiveArgs(archived));
  await ok("set_recurring_quest_archived_v1",archiveArgs(deleted));
  await ok("delete_recurring_quest_v1",deleteArgs(deleted));
  const rows=await ok("list_archived_recurring_quests_v1");
  assert(rows.some(r=>r.quest_id===archived),"RLS must expose the owner's archived recurring series");
  assert(!rows.some(r=>[active,deleted].includes(r.quest_id)));
  await reject("list_archived_recurring_quests_v1",{},"42501",other);
  for(const table of ["quests","quest_recurrence_rules","quest_occurrences","quest_events"]){
    const result=await other.from(table).select("id").eq("user_id",env.owner.id);
    assert.equal(result.error,null);assert.deepEqual(result.data,[]);
  }
});
test("running series freezes exact past/today/future, completed and reopened history and positive EXP",async()=>{
  const q=(await create()).quest_id;
  for(const offset of [0,1,2]) await ok("materialize_quest_day",{p_day:day(offset)});
  const rows=await occurrences(q);
  // Retained past fixture, not a backfill operation.
  await env.sql(`UPDATE public.quest_occurrences SET source_slot_date='${day(-1)}' WHERE id='${rows[0].id}';`);
  const completed=completeArgs(rows[1]); await ok("complete_quest_occurrence",completed);
  const alias={...completed,command_id:id()}; await ok("complete_quest_occurrence",alias);
  const older=completeArgs(rows[2]); await ok("complete_quest_occurrence",older);
  const reopened=reopenArgs(rows[2]); await ok("reopen_quest_occurrence_v2",reopened);
  await ok("materialize_quest_day",{p_day:today});
  const original=await snapshot(q), exp=await ok("get_current_exp");
  const a=archiveArgs(q), receipt=await ok("set_recurring_quest_archived_v1",a);
  assert.equal(receipt.changed,true); assert.deepEqual(await snapshot(q),original);
  assert.deepEqual(await ok("set_recurring_quest_archived_v1",a),{...receipt,replay:true});
  assert.equal((await ok("set_recurring_quest_archived_v1",archiveArgs(q))).changed,false);
  assert((await ok("list_archived_recurring_quests_v1")).some(r=>r.quest_id===q));
  assert(!(await ok("list_recurring_quests")).some(r=>r.quest_id===q));
  for(const name of ["list_day_quest_occurrences","get_calendar_events"]) {
    const data=await ok(name,name.startsWith("list")?{p_day:day(1)}:{p_from:day(-1),p_to:day(2)}); assert(!data.some(r=>r.quest_id===q));
  }
  await ok("materialize_quest_day",{p_day:day(3)}); assert.deepEqual(await snapshot(q),original);
  for(const paused of [true,false]) await reject("set_quest_recurrence_pause",pauseArgs(q,paused));
  await reject("complete_quest_occurrence",{...completed,command_id:id()});
  await reject("complete_quest_occurrence",completeArgs(rows[0]));
  await reject("reopen_quest_occurrence_v2",reopenArgs(rows[1]));
  for(const args of [completed,alias,older]) assert.equal((await ok("complete_quest_occurrence",args)).replay,true);
  assert.equal((await ok("reopen_quest_occurrence_v2",reopened)).replay,true);
  const restore=archiveArgs(q,false); await ok("set_recurring_quest_archived_v1",restore);
  assert.deepEqual(await snapshot(q),original);
  assert((await ok("list_day_quest_occurrences",{p_day:day(1)})).some(r=>r.quest_id===q));
  assert((await ok("get_calendar_events",{p_from:day(1),p_to:day(1)})).some(r=>r.quest_id===q));
  await ok("materialize_quest_day",{p_day:day(-2)}); await ok("materialize_quest_day",{p_day:day(1)});
  assert.deepEqual(await snapshot(q),original);
  await ok("materialize_quest_day",{p_day:day(3)}); assert.equal((await occurrences(q)).length,5);
  const final=await snapshot(q); await ok("set_recurring_quest_archived_v1",archiveArgs(q));
  const d=deleteArgs(q),deleted=await ok("delete_recurring_quest_v1",d);
  assert.deepEqual(await snapshot(q),final); assert.equal(await ok("get_current_exp"),exp);
  assert.deepEqual(await ok("delete_recurring_quest_v1",d),{...deleted,replay:true});
  for(const args of [restore,a]) assert.equal((await ok("set_recurring_quest_archived_v1",args)).replay,true);
  for(const args of [completed,alias,older]) assert.equal((await ok("complete_quest_occurrence",args)).replay,true);
  assert.equal((await ok("reopen_quest_occurrence_v2",reopened)).replay,true);
  for(const table of ["quests","quest_recurrence_rules","quest_occurrences","quest_events"]) {
    const result=await owner.from(table).select("id").eq(table==="quests"?"id":"quest_id",q);
    assert.equal(result.error,null); assert.deepEqual(result.data,[]);
  }
  await reject("set_recurring_quest_archived_v1",archiveArgs(q,false)); await reject("delete_recurring_quest_v1",deleteArgs(q));
  await reject("set_quest_recurrence_pause",pauseArgs(q));
  await reject("set_quest_recurrence_pause",pauseArgs(q,false));
  await reject("complete_quest_occurrence",{...completed,command_id:id()}); await reject("reopen_quest_occurrence_v2",reopenArgs(rows[1]));
  await reject("complete_quest_occurrence",completeArgs(rows[0]));
  await ok("materialize_quest_day",{p_day:day(4)}); assert.deepEqual(await snapshot(q),final);
});
test("paused zero-occurrence series preserves pause and historical pause/resume replay",async()=>{
  const q=(await create({start_date:day(30)})).quest_id; await reject("delete_recurring_quest_v1",deleteArgs(q));
  const p=pauseArgs(q),r=pauseArgs(q,false),p2=pauseArgs(q);
  for(const args of [p,r,p2]) await ok("set_quest_recurrence_pause",args);
  const original=await snapshot(q);
  await ok("set_recurring_quest_archived_v1",archiveArgs(q));
  for(const args of [p,r,p2]) assert.equal((await ok("set_quest_recurrence_pause",args)).replay,true);
  await ok("set_recurring_quest_archived_v1",archiveArgs(q,false));
  await ok("materialize_quest_day",{p_day:day(30)}); assert.deepEqual(await snapshot(q),original);
  await ok("set_recurring_quest_archived_v1",archiveArgs(q)); await ok("delete_recurring_quest_v1",deleteArgs(q));
  for(const args of [p,r,p2]) assert.equal((await ok("set_quest_recurrence_pause",args)).replay,true);
  for(const paused of [true,false]) await reject("set_quest_recurrence_pause",pauseArgs(q,paused));
  assert.deepEqual(await snapshot(q),original);
});
test("ended/exhausted rules, command conflicts, authorization and one-off/Goal boundaries",async()=>{
  for(const fields of [{start_date:day(-5),end_date:day(-1)},{occurrence_limit:1}]) {
    const q=(await create(fields)).quest_id; await ok("materialize_quest_day",{p_day:today}); const original=await snapshot(q);
    const a=archiveArgs(q); await ok("set_recurring_quest_archived_v1",a);
    await reject("set_recurring_quest_archived_v1",{...a,p_archived:false},"23505");
    await reject("delete_recurring_quest_v1",{...deleteArgs(q),p_command_id:a.p_command_id},"23505");
    await ok("set_recurring_quest_archived_v1",archiveArgs(q,false)); await ok("materialize_quest_day",{p_day:day(1)});
    await reject("set_quest_recurrence_pause",{...pauseArgs(q),command_id:a.p_command_id},"23505");
    assert.deepEqual(await snapshot(q),original);
    await reject("delete_one_off_quest_v1",deleteArgs(q)); await reject("set_one_off_quest_archived_v1",archiveArgs(q));
    await reject("set_recurring_quest_archived_v1",archiveArgs(q),"42501",other);
    await reject("delete_recurring_quest_v1",deleteArgs(q),"42501",other); await reject("list_archived_recurring_quests_v1",{},"42501",other);
    const goal=id(); await ok("create_goal_v1",{p_command_id:id(),p_goal_id:goal,p_title:"Disposable",p_description:null});
    await reject("attach_goal_quest_v1",{p_command_id:id(),p_goal_id:goal,p_expected_revision:1,p_quest_id:q});
  }
  const one=await ok("create_one_off_quest",{command_id:id(),origin:"web_ui",request:{title:"One-off boundary",default_reward_exp:0,scheduled_at:today+"T12:00:00Z"}});
  await reject("set_recurring_quest_archived_v1",archiveArgs(one.quest_id)); await reject("delete_recurring_quest_v1",deleteArgs(one.quest_id));
});
test("retirement races serialize with materialization, completion, Reopen and pause",async()=>{
  for(const operation of ["materialize","complete","reopen","pause"]) {
    const q=(await create()).quest_id; await ok("materialize_quest_day",{p_day:today}); const o=(await occurrences(q))[0];
    if(operation==="reopen") await ok("complete_quest_occurrence",completeArgs(o));
    const [name,args]=operation==="materialize"?["materialize_quest_day",{p_day:day(1)}]:
      operation==="complete"?["complete_quest_occurrence",completeArgs(o)]:operation==="reopen"?["reopen_quest_occurrence_v2",reopenArgs(o)]:["set_quest_recurrence_pause",pauseArgs(q)];
    const [retired,command]=await Promise.all([owner.rpc("set_recurring_quest_archived_v1",archiveArgs(q)),owner.rpc(name,args)]);
    assert.equal(retired.error,null); assert([undefined,"23514"].includes(command.error?.code));
    const fixed=await snapshot(q);
    if(!command.error && operation!=="materialize") assert.equal((await ok(name,args)).replay,true);
    await ok("materialize_quest_day",{p_day:day(2)}); assert.deepEqual(await snapshot(q),fixed);
    await ok("delete_recurring_quest_v1",deleteArgs(q)); assert.deepEqual(await snapshot(q),fixed);
  }
});
test("archive and delete roll back their markers and receipts together on transaction failure",async()=>{
  const q=(await create()).quest_id;
  await ok("materialize_quest_day",{p_day:today});
  const original=await snapshot(q),archive=id(),deletion=id();
  await assert.rejects(env.sql(`BEGIN;
    SELECT set_config('request.jwt.claims','{"sub":"${env.owner.id}","role":"authenticated"}',true);
    SET LOCAL ROLE authenticated;
    SELECT public.set_recurring_quest_archived_v1('${archive}','${q}',true,'web_ui');
    SELECT public.delete_recurring_quest_v1('${deletion}','${q}','web_ui');
    DO $failure$ BEGIN RAISE EXCEPTION 'Intentional retirement transaction rollback'; END $failure$;
    COMMIT;`),/Intentional retirement transaction rollback/);
  assert.deepEqual(await snapshot(q),original);
  assert.equal(await env.sql(`SELECT count(*) FROM public.quests WHERE id='${q}' AND archived_at IS NULL AND deleted_at IS NULL;`),"1");
  assert.equal(await env.sql(`SELECT count(*) FROM public.quest_events WHERE command_id IN ('${archive}','${deletion}');`),"0");
  assert.equal((await ok("set_recurring_quest_archived_v1",{...archiveArgs(q),p_command_id:archive})).replay,false);
});
