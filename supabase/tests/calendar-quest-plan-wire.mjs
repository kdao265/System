// Own UUID-labelled tmpfs containers only; no supplied endpoint or credentials.
import assert from 'node:assert/strict';
import { randomUUID as id } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { startAuthEnvironment } from '../../tests/helpers/auth-environment.mjs';
let env, owner, other, today;
const clients=[];
async function ok(name,args={},client=owner) { const r=await client.rpc(name,args); assert.equal(r.error,null,`${name}: ${r.error?.code} ${r.error?.message}`); return r.data; }
async function denied(name,args,code='23514',client=owner) { const r=await client.rpc(name,args); assert.equal(r.error?.code,code,r.error?.message); }
const at=(time)=>`${today}T${time}:00Z`;
const detail=(o)=>ok('get_quest_occurrence_detail_v1',{p_occurrence_id:o});
const args=(d,start=at('09:20'),end=at('11:45'))=>({p_command_id:id(),p_occurrence_id:d.occurrence_id,
  p_expected_execution_cycle:d.execution_cycle,p_expected_scheduled_at:d.scheduled_at,p_expected_planned_end_at:d.planned_end_at,
  p_scheduled_at:start,p_planned_end_at:end,p_origin:'web_ui'});
const plan=(a)=>ok('set_quest_occurrence_plan_v1',a);
async function create(extra={}) { const r=await ok('create_one_off_quest',{command_id:id(),origin:'web_ui',request:{title:'Disposable plan',default_reward_exp:7,scheduled_at:at('08:00'),deadline_at:at('18:00'),...extra}}); return detail(r.occurrence_id); }
const complete=(d)=>ok('complete_quest_occurrence',{command_id:id(),occurrence_id:d.occurrence_id,expected_execution_cycle:d.execution_cycle,reported_completed_at:null,origin:'web_ui'});
const archive=(d)=>ok('set_one_off_quest_archived_v1',{p_command_id:id(),p_quest_id:d.quest_id,p_archived:true,p_origin:'web_ui'});
before(async()=>{
  env=await startAuthEnvironment({buildApp:false});
  for(const account of [env.owner,env.other]) { const c=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}}); clients.push(c); assert.equal((await c.auth.signInWithPassword(account)).error,null); }
  [owner,other]=clients;
  assert.equal((await owner.from('profiles').update({timezone:'UTC'}).eq('user_id',env.owner.id)).error,null);
  today=await env.sql("SELECT (now() AT TIME ZONE 'UTC')::date;");
  const policy=await owner.from('level_policies').select('id').eq('policy_key','level_policy_v1').single();
  const grant=id(); await env.sql(`INSERT INTO system_internal.operator_grants(id,user_id,capability) VALUES('${grant}','${env.owner.id}','level_policy_assign');`);
  await ok('assign_level_policy',{target_user_id:env.owner.id,policy_id:policy.data.id,command_id:id(),origin:'internal'});
  await env.sql(`UPDATE system_internal.operator_grants SET revoked_at=now() WHERE id='${grant}';`);
});
after(async()=>{ for(const c of clients)c.auth.stopAutoRefresh(); await env?.close(); });

test('catalog: guarded invoker reads, RLS executor write and no anonymous privileges',async()=>{
  const rows=JSON.parse(await env.sql(`SELECT jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'stable',provolatile='s','owner',pg_get_userbyid(proowner),'guard',position('system_private.require_owner()' in prosrc)>0,'path',proconfig)) FROM pg_proc WHERE proname IN ('get_calendar_events_v2','get_quest_occurrence_detail_v1','set_quest_occurrence_plan_v1');`));
  assert.equal(rows.length,3);
  for(const row of rows){assert(row.guard);assert.deepEqual(row.path,['search_path=pg_catalog']);if(row.name.startsWith('get_')){assert(!row.definer);assert(row.stable);}else{assert(row.definer);assert.equal(row.owner,'quest_command_owner');}}
  assert.equal(await env.sql("SELECT has_column_privilege('authenticated','public.quest_occurrences','planned_end_at','UPDATE');"),'f');
  assert.equal(await env.sql("SELECT rolbypassrls FROM pg_roles WHERE rolname='quest_command_owner';"),'f');
  for(const signature of ['get_calendar_events_v2(date,date)','get_quest_occurrence_detail_v1(uuid)','set_quest_occurrence_plan_v1(uuid,uuid,integer,timestamptz,timestamptz,timestamptz,timestamptz,text)'])
    for(const role of ['anon','service_role']) assert.equal(await env.sql(`SELECT has_function_privilege('${role}','public.${signature}','EXECUTE');`),'f');
});
test('constraint rejects missing start, equal/reversed/nonfinite end; allows unknown end',async()=>{
  const d=await create();
  for(const set of [`scheduled_at=NULL,planned_end_at='${at('11:45')}'`,`planned_end_at='${at('08:00')}'`,`planned_end_at='${at('07:00')}'`,"planned_end_at='infinity'"])
    await assert.rejects(env.sql(`UPDATE public.quest_occurrences SET ${set} WHERE id='${d.occurrence_id}';`),/ck_occurrence_planned_interval/);
  await plan(args(d,at('09:20'),null)); assert.equal((await detail(d.occurrence_id)).planned_end_at,null);
});
test('exact 09:20–11:45 plan preserves deadline, reward, cycle, status and EXP',async()=>{
  const d=await create(), exp=await ok('get_current_exp'); const receipt=await plan(args(d)); const after=await detail(d.occurrence_id);
  assert.equal(Date.parse(after.planned_end_at)-Date.parse(after.scheduled_at),145*60000);
  for(const k of ['deadline_at','reward_exp_snapshot','execution_cycle','status','source_slot_date','source_timezone'])assert.deepEqual(after[k],d[k]);
  assert.equal(await ok('get_current_exp'),exp); assert(receipt.changed);
  const rows=await ok('get_calendar_events_v2',{p_from:today,p_to:today}), row=rows.find(r=>r.entry_id===d.occurrence_id);
  assert.equal(row.end_at,after.planned_end_at);assert.equal(row.deadline_at,d.deadline_at);assert.equal(row.occurrence_id,d.occurrence_id);
});
test('planned finish may exceed deadline; planned start must preserve existing deadline constraint',async()=>{
  const d=await create();await plan(args(d,at('17:00'),at('19:00')));
  await denied('set_quest_occurrence_plan_v1',args(await detail(d.occurrence_id),at('19:00'),at('20:00')));
});
test('overnight overlap and timezone display changes preserve absolute plan',async()=>{
  const next=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  const d=await create({deadline_at:null});await plan(args(d,at('23:30'),next+'T01:00:00Z'));
  assert((await ok('get_calendar_events_v2',{p_from:next,p_to:next})).some(r=>r.entry_id===d.occurrence_id));
  const saved=await detail(d.occurrence_id);
  await owner.from('profiles').update({timezone:'Asia/Ho_Chi_Minh'}).eq('user_id',env.owner.id);
  assert.deepEqual(await detail(d.occurrence_id),saved);
  await owner.from('profiles').update({timezone:'UTC'}).eq('user_id',env.owner.id);
});
test('recurring planning preserves provenance/count, remains ineligible for Goal and reads never generate',async()=>{
  const r=await ok('create_recurring_quest',{command_id:id(),origin:'web_ui',request:{title:'Recurring plan',recurrence_mode:'daily',start_date:today,default_reward_exp:4}});
  const count=()=>env.sql(`SELECT materialized_occurrence_count FROM public.quests WHERE id='${r.quest_id}';`);
  await ok('get_calendar_events_v2',{p_from:today,p_to:today});assert.equal(await count(),'0');
  await ok('materialize_quest_day',{p_day:today});
  const oid=await env.sql(`SELECT id FROM public.quest_occurrences WHERE quest_id='${r.quest_id}';`),d=await detail(oid),n=await count();
  await plan(args(d));const after=await detail(oid);
  for(const k of ['source_slot_date','source_timezone','recurrence_rule_id','recurrence_revision','execution_cycle','reward_exp_snapshot','status'])assert.deepEqual(after[k],d[k]);
  assert.equal(await count(),n);assert.equal(after.goal,null);
  const goal=id();await ok('create_goal_v1',{p_command_id:id(),p_goal_id:goal,p_title:'Main',p_description:null});
  await denied('attach_goal_quest_v1',{p_command_id:id(),p_goal_id:goal,p_expected_revision:1,p_quest_id:d.quest_id});
});
test('detail exposes current definition text and current Goal relation, detach removes it',async()=>{
  const d=await create({description:'Current description',notes:'Current notes'}),g=id();
  await ok('create_goal_v1',{p_command_id:id(),p_goal_id:g,p_title:'Main',p_description:null});
  const link=await ok('attach_goal_quest_v1',{p_command_id:id(),p_goal_id:g,p_expected_revision:1,p_quest_id:d.quest_id});
  const read=await detail(d.occurrence_id);assert.equal(read.goal.id,g);assert.equal(read.notes,'Current notes');assert.equal(read.description,'Current description');
  await ok('detach_goal_quest_v1',{p_command_id:id(),p_goal_id:g,p_expected_revision:link.revision_after,p_link_id:link.link_id});
  assert.equal((await detail(d.occurrence_id)).goal,null);
});
test('exact replay, conflicting reuse, stale values and replay after completion',async()=>{
  const d=await create(),a=args(d),r=await plan(a);assert.deepEqual(await plan(a),{...r,replay:true});
  await denied('set_quest_occurrence_plan_v1',{...a,p_planned_end_at:at('12:00')},'23505');
  await denied('set_quest_occurrence_plan_v1',args(d));
  await complete(await detail(d.occurrence_id));assert.deepEqual(await plan(a),{...r,replay:true});
  await denied('set_quest_occurrence_plan_v1',args(await detail(d.occurrence_id)));
});
test('archive/delete fail closed but accepted plan replay survives permanent retirement',async()=>{
  const d=await create(),a=args(d),r=await plan(a);await archive(d);
  assert.equal(await detail(d.occurrence_id),null);await denied('set_quest_occurrence_plan_v1',{...a,p_command_id:id()});
  await ok('delete_one_off_quest_v1',{p_command_id:id(),p_quest_id:d.quest_id,p_origin:'web_ui'});
  assert.equal(await detail(d.occurrence_id),null);assert.deepEqual(await plan(a),{...r,replay:true});
  await denied('set_quest_occurrence_plan_v1',{...a,p_command_id:id()});
});
test('non-owner and anonymous calls denied and direct reads isolated',async()=>{
  const d=await create();await denied('get_quest_occurrence_detail_v1',{p_occurrence_id:d.occurrence_id},'42501',other);
  await denied('set_quest_occurrence_plan_v1',args(d),'42501',other);
  await denied('get_calendar_events_v2',{p_from:today,p_to:today},'42501',other);
  assert.deepEqual((await other.from('quest_occurrences').select('id').eq('id',d.occurrence_id)).data,[]);
  const anon=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(anon);
  await denied('get_quest_occurrence_detail_v1',{p_occurrence_id:d.occurrence_id},'42501',anon);
});
test('two edits from same expected plan have one winner',async()=>{
  const d=await create();const results=await Promise.all([owner.rpc('set_quest_occurrence_plan_v1',args(d)),owner.rpc('set_quest_occurrence_plan_v1',args(d,at('10:00'),at('12:00')))]);
  assert.equal(results.filter(r=>!r.error).length,1);assert.equal(results.find(r=>r.error).error.message,'Stale occurrence plan');
});
test('planning serializes with completion, Reopen and archive',async()=>{
  for(const action of ['complete','reopen','archive']){
    let d=await create();if(action==='reopen'){await complete(d);d=await detail(d.occurrence_id);}
    const mutate=action==='complete'?()=>complete(d):action==='archive'?()=>archive(d):()=>ok('reopen_quest_occurrence_v2',{command_id:id(),occurrence_id:d.occurrence_id,expected_execution_cycle:d.execution_cycle,origin:'web_ui'});
    const [p]=await Promise.all([owner.rpc('set_quest_occurrence_plan_v1',args(d)),mutate()]);
    assert([undefined,'23514'].includes(p.error?.code));
    if(action==='reopen')assert(p.error,'Old completed cycle must never plan after Reopen');
  }
});
test('rollback removes both plan and its audit receipt',async()=>{
  const d=await create(),a=args(d);
  await assert.rejects(env.sql(`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${env.owner.id}","role":"authenticated"}',true);SET LOCAL ROLE authenticated;
    SELECT public.set_quest_occurrence_plan_v1('${a.p_command_id}','${d.occurrence_id}',1,'${d.scheduled_at}',NULL,'${at('09:20')}','${at('11:45')}','web_ui');
    DO $fail$ BEGIN RAISE EXCEPTION 'Intentional plan rollback'; END $fail$;COMMIT;`),/Intentional plan rollback/);
  assert.deepEqual(await detail(d.occurrence_id),d);assert.equal(await env.sql(`SELECT count(*) FROM public.quest_events WHERE command_id='${a.p_command_id}';`),'0');
});
test('clear only scheduled date becomes draft; a deadline or active status stays intact',async()=>{
  const d=await create({deadline_at:null});await plan(args(d,null,null));assert.equal((await detail(d.occurrence_id)).status,'draft');
  const due=await create();await plan(args(due,null,null));assert.equal((await detail(due.occurrence_id)).status,'scheduled');
  const active=await create();await env.sql(`UPDATE public.quest_occurrences SET status='active' WHERE id='${active.occurrence_id}';`);
  await plan(args(active,null,null));assert.equal((await detail(active.occurrence_id)).status,'active');
});

test('Schedule V2 preserves timed notes and authoritative all-day dates',async()=>{
  for(const allDay of [false,true]){
    const event=id();await ok('create_schedule_event',{p_event_id:event,p_title:'Schedule compatibility',p_start_at:at('09:00'),p_end_at:allDay?null:at('10:00'),p_all_day:allDay,p_category:'Class',p_notes:'Schedule note'});
    const a=(await ok('get_calendar_events',{p_from:today,p_to:today})).find(r=>r.entry_id===event);
    const b=(await ok('get_calendar_events_v2',{p_from:today,p_to:today})).find(r=>r.entry_id===event);
    const {occurrence_id,deadline_at,...rest}=b;assert.equal(occurrence_id,null);assert.equal(deadline_at,null);assert.deepEqual(rest,a);
  }
});
test('planning races permanent one-off deletion and recurring retirement without resurrecting data',async()=>{
  const d=await create(),a=args(d);
  const [p]=await Promise.all([owner.rpc('set_quest_occurrence_plan_v1',a),ok('delete_one_off_quest_v1',{p_command_id:id(),p_quest_id:d.quest_id,p_origin:'web_ui'})]);
  assert([undefined,'23514'].includes(p.error?.code));assert.equal(await detail(d.occurrence_id),null);
  if(!p.error)assert.equal((await plan(a)).replay,true);
  const q=await ok('create_recurring_quest',{command_id:id(),origin:'web_ui',request:{title:'Retirement race',recurrence_mode:'daily',start_date:today,default_reward_exp:0}});
  await ok('materialize_quest_day',{p_day:today});const oid=await env.sql(`SELECT id FROM public.quest_occurrences WHERE quest_id='${q.quest_id}';`);
  const r=await detail(oid),b=args(r);
  const [rp]=await Promise.all([owner.rpc('set_quest_occurrence_plan_v1',b),ok('set_recurring_quest_archived_v1',{p_command_id:id(),p_quest_id:q.quest_id,p_archived:true,p_origin:'web_ui'})]);
  assert([undefined,'23514'].includes(rp.error?.code));
  await ok('delete_recurring_quest_v1',{p_command_id:id(),p_quest_id:q.quest_id,p_origin:'web_ui'});
  await denied('set_quest_occurrence_plan_v1',{...b,p_command_id:id()});if(!rp.error)assert.equal((await plan(b)).replay,true);
});
test('accepted no-op and earlier plan remain replayable after later plan and Reopen',async()=>{
  const d=await create(),noop=args(d,d.scheduled_at,null),receipt=await plan(noop);assert.equal(receipt.changed,false);
  const a=args(d);const first=await plan(a);await plan(args(await detail(d.occurrence_id),at('10:00'),at('12:00')));
  assert.deepEqual(await plan(a),{...first,replay:true});assert.deepEqual(await plan(noop),{...receipt,replay:true});
  await complete(await detail(d.occurrence_id));await ok('reopen_quest_occurrence_v2',{command_id:id(),occurrence_id:d.occurrence_id,expected_execution_cycle:1,origin:'web_ui'});
  assert.deepEqual(await plan(a),{...first,replay:true});
  const fresh=await detail(d.occurrence_id);assert.equal(fresh.execution_cycle,2);await plan(args(fresh));
});
test('planning preserves every non-plan occurrence field and definition field',async()=>{
  const d=await create();
  const snapshot=()=>env.sql(`SELECT jsonb_build_object('quest',(SELECT to_jsonb(q) FROM public.quests q WHERE id='${d.quest_id}'),'occurrence',(SELECT to_jsonb(o)-'scheduled_at'-'planned_end_at'-'updated_at' FROM public.quest_occurrences o WHERE id='${d.occurrence_id}'));`);
  const before=await snapshot();await plan(args(d));assert.equal(await snapshot(),before);
  await denied('set_quest_occurrence_plan_v1',{...args(await detail(d.occurrence_id)),p_origin:'untrusted'},'22023');
});
