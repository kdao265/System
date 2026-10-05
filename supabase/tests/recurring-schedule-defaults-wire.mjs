import assert from 'node:assert/strict';
import { randomUUID as id } from 'node:crypto';
import { before,after,afterEach,test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { startAuthEnvironment } from '../../tests/helpers/auth-environment.mjs';
let env,owner,other,anon,today;
const clients=[],series=[];
const schedule={local_start_time:'09:20',local_end_time:'11:45',planned_end_day_offset:0};
async function rpc(name,args={},client=owner){return client.rpc(name,args);}
async function ok(name,args={},client=owner){const r=await rpc(name,args,client);assert.equal(r.error,null,`${name}: ${r.error?.message}`);return r.data;}
async function reject(name,args,code='23514',client=owner){const r=await rpc(name,args,client);assert.equal(r.error?.code,code,r.error?.message);}
const day=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const zone=async timezone=>assert.equal((await owner.from('profiles').update({timezone}).eq('user_id',env.owner.id)).error,null);
async function create(extra={},legacy=false){const args={command_id:id(),origin:'web_ui',request:{title:'Schedule defaults test',recurrence_mode:'daily',start_date:today,...extra}};
 const receipt=await ok(legacy?'create_recurring_quest':'create_recurring_quest_v2',args);series.push(receipt.quest_id);return {receipt,args};}
const detail=q=>ok('get_recurring_quest_detail_v1',{p_quest_id:q});
const rows=q=>env.sql(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY source_slot_date),'[]') FROM public.quest_occurrences o WHERE quest_id='${q}';`).then(JSON.parse);
const materialize=d=>ok('materialize_quest_day_v2',{p_day:d});
const editArgs=(q,revision,tuple=schedule)=>({p_command_id:id(),p_quest_id:q,p_expected_rule_revision:revision,
 p_local_start_time:tuple?.local_start_time??null,p_local_end_time:tuple?.local_end_time??null,p_planned_end_day_offset:tuple?.planned_end_day_offset??null,p_origin:'web_ui'});
const edit=(q,revision,tuple)=>ok('set_recurring_quest_schedule_defaults_v1',editArgs(q,revision,tuple));
const pause=(q,paused)=>ok('set_quest_recurrence_pause',{command_id:id(),quest_id:q,paused,origin:'web_ui'});
const archive=(q,value)=>ok('set_recurring_quest_archived_v1',{p_command_id:id(),p_quest_id:q,p_archived:value,p_origin:'web_ui'});
before(async()=>{
 env=await startAuthEnvironment({buildApp:false,testMigrationHistory:true});
 for(const account of [env.owner,env.other]){const c=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(c);assert.equal((await c.auth.signInWithPassword(account)).error,null);}
 [owner,other]=clients;anon=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(anon);
 await zone('UTC');today=await env.sql("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date;");
});
afterEach(async()=>{for(const q of series.splice(0)){const d=await detail(q);if(d)await archive(q,true);}await zone('UTC');});
after(async()=>{for(const c of clients)c.auth.stopAutoRefresh();await env?.close();});

test('schema rejects partial, seconds, 24:00, invalid offsets and nominal intervals',async()=>{
 const {receipt:r}=await create();
 for(const set of ["local_start_time='09:00'","local_end_time='10:00'","planned_end_day_offset=0",
  "local_start_time='09:00:01',local_end_time='10:00',planned_end_day_offset=0",
  "local_start_time='09:00:00.1',local_end_time='10:00',planned_end_day_offset=0",
  "local_start_time='24:00',local_end_time='01:00',planned_end_day_offset=1",
  "local_start_time='09:00',local_end_time='10:00',planned_end_day_offset=2",
  "local_start_time='09:00',local_end_time='09:00',planned_end_day_offset=0",
  "local_start_time='23:00',local_end_time='01:00',planned_end_day_offset=0",
  "local_start_time='09:00',local_end_time='11:00',planned_end_day_offset=1"])
  await assert.rejects(env.sql(`UPDATE public.quest_recurrence_rules SET ${set} WHERE quest_id='${r.quest_id}';`),/ck_rule_schedule/);
 await edit(r.quest_id,1,{local_start_time:'09:00',local_end_time:'09:00',planned_end_day_offset:1});
 assert.equal((await detail(r.quest_id)).rule.revision,2);
});
test('migration refuses incompatible dormant starts without altering them',async()=>{
 const {receipt:r}=await create();
 const sql=readFileSync(new URL('../migrations/20261004120000_recurring_schedule_defaults_v1.sql',import.meta.url),'utf8');
 const preflight=sql.slice(sql.indexOf('DO $preflight$'),sql.indexOf('$preflight$;')+12);
 await assert.rejects(env.sql(`BEGIN; ALTER TABLE public.quest_recurrence_rules DROP CONSTRAINT ck_rule_schedule_tuple; UPDATE public.quest_recurrence_rules SET local_start_time='09:00' WHERE quest_id='${r.quest_id}'; ${preflight} ROLLBACK;`),/dormant non-null local_start_time/);
 assert.equal((await detail(r.quest_id)).rule.local_start_time,null);
});
test('untimed creation is zero-occurrence manageable and materializes draft, preserving null estimate',async()=>{
 const {receipt:r}=await create();assert.equal((await detail(r.quest_id)).materialized_occurrence_count,0);assert.deepEqual(await rows(r.quest_id),[]);
 await materialize(today);const [o]=await rows(r.quest_id);assert.equal(o.status,'draft');assert.equal(o.scheduled_at,null);assert.equal(o.planned_end_at,null);assert.equal(o.estimated_duration_minutes_snapshot,null);
});
test('exact Ho Chi Minh interval is scheduled; estimate/deadline/counter remain independent',async()=>{
 await zone('Asia/Ho_Chi_Minh');const date='2026-10-05';assert(today<=date,'fixed acceptance date must still be eligible');
 const {receipt:r}=await create({...schedule,start_date:date,default_estimated_duration_minutes:37});
 await materialize(date);const [o]=await rows(r.quest_id);
 assert.equal(o.scheduled_at,'2026-10-05T02:20:00+00:00');assert.equal(o.planned_end_at,'2026-10-05T04:45:00+00:00');
 assert.equal(o.status,'scheduled');assert.equal(o.deadline_at,null);assert.equal(o.source_timezone,'Asia/Ho_Chi_Minh');assert.equal(o.source_slot_date,date);assert.equal(o.recurrence_revision,1);assert.equal(o.estimated_duration_minutes_snapshot,37);
 await materialize(date);assert.deepEqual(await rows(r.quest_id),[o]);assert.equal((await detail(r.quest_id)).materialized_occurrence_count,1);
});
test('overnight last source date may end the next day and Calendar reads do not generate',async()=>{
 await zone('Asia/Ho_Chi_Minh');const date='2026-10-05';const {receipt:r}=await create({start_date:date,end_date:date,local_start_time:'23:00',local_end_time:'01:00',planned_end_day_offset:1});
 await ok('get_calendar_events_v2',{p_from:date,p_to:'2026-10-06'});assert.deepEqual(await rows(r.quest_id),[]);
 await materialize(date);const [o]=await rows(r.quest_id);assert.equal(o.scheduled_at,'2026-10-05T16:00:00+00:00');assert.equal(o.planned_end_at,'2026-10-05T18:00:00+00:00');
 assert((await ok('get_calendar_events_v2',{p_from:'2026-10-06',p_to:'2026-10-06'})).some(e=>e.entry_id===o.id));
 await materialize('2026-10-06');assert.equal((await rows(r.quest_id)).length,1);
});
test('weekly selected weekdays and anchor/end bounds',async()=>{
 const {receipt:r}=await create({...schedule,recurrence_mode:'weekly',weekdays:[1],start_date:'2032-03-01',end_date:'2032-03-08'});
 for(const d of ['2032-02-23','2032-03-01','2032-03-02','2032-03-08','2032-03-15'])await materialize(d);
 assert.deepEqual((await rows(r.quest_id)).map(o=>o.source_slot_date),['2032-03-01','2032-03-08']);
});
test('monthly fallback includes leap February then returns to day 31',async()=>{
 const {receipt:r}=await create({...schedule,recurrence_mode:'monthly',month_day:31,start_date:'2032-01-01'});
 for(const d of ['2032-02-28','2032-02-29','2032-03-30','2032-03-31','2032-04-30'])await materialize(d);
 assert.deepEqual((await rows(r.quest_id)).map(o=>o.source_slot_date),['2032-02-29','2032-03-31','2032-04-30']);
});
for(const [local,z,result] of [
 ['2026-03-08 02:30','America/New_York','nonexistent_local_time'],['2026-11-01 01:30','America/New_York','ambiguous_local_time'],
 ['2026-04-05 01:45','Australia/Lord_Howe','ambiguous_local_time'],['2026-10-04 02:15','Australia/Lord_Howe','nonexistent_local_time'],
 ['2011-12-30 12:00','Pacific/Apia','nonexistent_local_time'],['1900-01-01 12:00','Europe/Paris','unique'],
 ['0001-01-01 12:00','UTC','unique'],['9999-12-31 12:00','America/New_York','unique']])
 test(`strict resolver ${local} ${z}`,async()=>{const r=JSON.parse(await env.sql(`SELECT row_to_json(r) FROM system_internal.resolve_recurring_local_v1('${local}','${z}') r;`));assert.equal(r.classification,result);if(result!=='unique')assert.equal(r.instant,null);if(z==='Europe/Paris')assert.equal(r.instant,'1900-01-01T11:50:39+00:00');});
test('mixed DST failures are slot-local, exact warnings consume no count; correction retries eligible slots',async()=>{
 await zone('America/New_York');const date='2030-03-10';
 const {receipt:a}=await create({...schedule,start_date:date,local_start_time:'02:30',occurrence_limit:1});
 const {receipt:b}=await create({...schedule,start_date:date,local_start_time:'01:00',local_end_time:'02:30'});
 const {receipt:c}=await create({...schedule,start_date:date});
 const report=await materialize(date);assert.deepEqual(Object.keys(report).sort(),['created_count','day','issues','timezone','version']);assert.equal(report.version,2);assert.equal(report.timezone,'America/New_York');assert.equal(report.created_count,1);assert.equal(report.issues.length,2);
 const expected={quest_id:a.quest_id,recurrence_rule_id:a.recurrence_rule_id,rule_revision:1,source_slot_date:date,local_start_time:'02:30',local_end_time:'11:45',planned_end_day_offset:0,endpoint:'start',reason:'nonexistent_local_time'};
 assert.deepEqual(report.issues.find(i=>i.quest_id===a.quest_id),expected);assert.equal(report.issues.find(i=>i.quest_id===b.quest_id).endpoint,'end');
 assert.equal((await rows(c.quest_id)).length,1);assert.equal((await detail(a.quest_id)).materialized_occurrence_count,0);
 assert.equal((await materialize(date)).created_count,0);await edit(a.quest_id,1,schedule);await materialize(date);
 assert.equal((await rows(a.quest_id))[0].recurrence_revision,2);assert.equal((await detail(a.quest_id)).materialized_occurrence_count,1);
});
test('valid interval spanning DST retains endpoints, not nominal elapsed duration',async()=>{
 await zone('America/New_York');const {receipt:r}=await create({start_date:'2030-03-10',local_start_time:'01:00',local_end_time:'04:00',planned_end_day_offset:0});
 await materialize('2030-03-10');const [o]=await rows(r.quest_id);assert.equal(Date.parse(o.planned_end_at)-Date.parse(o.scheduled_at),2*3600000);
});
test('set replace clear and no-op revision/audit semantics preserve other series fields',async()=>{
 const {receipt:r}=await create({default_reward_exp:5,default_estimated_duration_minutes:17});const initial=await detail(r.quest_id);
 const set=await edit(r.quest_id,1,schedule);assert(set.changed);assert.equal(set.after.revision,2);assert.equal(set.before.revision,1);
 const noop=await edit(r.quest_id,2,schedule);assert(!noop.changed);assert.equal(noop.after.revision,2);assert(noop.event_id);
 await reject('set_recurring_quest_schedule_defaults_v1',editArgs(r.quest_id,1,schedule));
 await pause(r.quest_id,true);const paused=await detail(r.quest_id);await edit(r.quest_id,2,{...schedule,local_start_time:'08:00'});
 const cleared=await edit(r.quest_id,3,null);assert.equal(cleared.after.revision,4);assert.equal(cleared.after.local_start_time,null);
 const current=await detail(r.quest_id);assert(current.paused);assert.equal(current.rule.stopped_at,paused.rule.stopped_at);assert.equal(current.materialized_occurrence_count,initial.materialized_occurrence_count);
 for(const k of ['recurrence_type','interval_count','weekdays','month_day','anchor_date','end_date','occurrence_limit'])assert.deepEqual(current.rule[k],initial.rule[k]);
});
test('edit exact receipt replays after later changes and permanent retirement; conflicting reuse fails',async()=>{
 const {receipt:r}=await create();const args=editArgs(r.quest_id,1);const receipt=await ok('set_recurring_quest_schedule_defaults_v1',args);
 await edit(r.quest_id,2,null);await archive(r.quest_id,true);await ok('delete_recurring_quest_v1',{p_command_id:id(),p_quest_id:r.quest_id,p_origin:'web_ui'});
 assert.deepEqual(await ok('set_recurring_quest_schedule_defaults_v1',args),{...receipt,replay:true});
 await reject('set_recurring_quest_schedule_defaults_v1',{...args,p_local_start_time:'08:00'},'23505');
 await reject('set_recurring_quest_schedule_defaults_v1',{...args,p_command_id:id(),p_expected_rule_revision:3});
 assert.equal(await detail(r.quest_id),null);
});
for(const legacy of [true,false])test(`${legacy?'legacy':'V2'} accepted creation survives revisions, cadence changes, pause, retirement and missing Profile timezone`,async()=>{
 const {receipt:r,args}=await create(legacy?{}:schedule,legacy);await edit(r.quest_id,1,legacy?schedule:null);await pause(r.quest_id,true);await pause(r.quest_id,false);
 // A retained creation receipt must not use mutable cadence either (future command compatibility).
 await env.sql(`UPDATE public.quest_recurrence_rules SET anchor_date=anchor_date+1 WHERE id='${r.recurrence_rule_id}';`);
 await archive(r.quest_id,true);await archive(r.quest_id,false);await archive(r.quest_id,true);await ok('delete_recurring_quest_v1',{p_command_id:id(),p_quest_id:r.quest_id,p_origin:'web_ui'});
 await zone(null);const name=legacy?'create_recurring_quest':'create_recurring_quest_v2';
 assert.deepEqual(await ok(name,args),{...r,replay:true});await reject(name,{...args,request:{...args.request,title:'Changed'}},'23505');
 await reject(legacy?'create_recurring_quest_v2':'create_recurring_quest',args,legacy?'23505':'22023');
});
test('existing manually edited and cleared occurrences win before new DST defaults',async()=>{
 await zone('America/New_York');const d='2030-03-10';const {receipt:r}=await create({...schedule,start_date:d});await materialize(d);
 const [o]=await rows(r.quest_id);await ok('set_quest_occurrence_plan_v1',{p_command_id:id(),p_occurrence_id:o.id,p_expected_execution_cycle:1,p_expected_scheduled_at:o.scheduled_at,p_expected_planned_end_at:o.planned_end_at,p_scheduled_at:null,p_planned_end_at:null,p_origin:'web_ui'});
 const preserved=await rows(r.quest_id);await edit(r.quest_id,1,{...schedule,local_start_time:'02:30'});const result=await materialize(d);
 assert.equal(result.issues.length,0);assert.deepEqual(await rows(r.quest_id),preserved);assert.equal(preserved[0].status,'draft');
 await materialize('2030-03-11');assert.equal((await rows(r.quest_id))[1].recurrence_revision,2);
});
test('legacy integer materializer delegates same defaults and slot identity',async()=>{
 const {receipt:r}=await create(schedule);assert.equal(await ok('materialize_quest_day',{p_day:today}),1);assert.equal((await materialize(today)).created_count,0);assert.equal((await rows(r.quest_id))[0].status,'scheduled');
});
test('concurrent generation preserves last capacity and competing edits accept only one revision',async()=>{
 const {receipt:r}=await create({...schedule,occurrence_limit:1});await Promise.all([materialize(today),materialize(day(1)),materialize(today)]);
 assert.equal((await rows(r.quest_id)).length,1);assert.equal((await detail(r.quest_id)).materialized_occurrence_count,1);
 const result=await Promise.all([rpc('set_recurring_quest_schedule_defaults_v1',editArgs(r.quest_id,1,null)),rpc('set_recurring_quest_schedule_defaults_v1',editArgs(r.quest_id,1,{...schedule,local_start_time:'08:00'}))]);
 assert.equal(result.filter(r=>!r.error).length,1);assert.equal(result.find(r=>r.error).error.code,'23514');
});
for(const action of ['edit','pause','archive','delete'])test(`materialize versus ${action} serializes without mixed state`,async()=>{
 const {receipt:r}=await create(schedule);
 if(action==='delete')await archive(r.quest_id,true);
 const operation=action==='edit'?edit(r.quest_id,1,{...schedule,local_start_time:'08:00'}):action==='pause'?pause(r.quest_id,true):action==='archive'?archive(r.quest_id,true):ok('delete_recurring_quest_v1',{p_command_id:id(),p_quest_id:r.quest_id,p_origin:'web_ui'});
 await Promise.all([materialize(today),operation]);const occurrences=await rows(r.quest_id);
 assert(occurrences.length<=1);if(action==='delete')assert.equal(occurrences.length,0);
 for(const o of occurrences)assert.equal(o.scheduled_at,`${today}T${o.recurrence_revision===1?'09:20':'08:00'}:00+00:00`);
 const captured=await rows(r.quest_id);if(action!=='edit')await materialize(day(1));assert.deepEqual(await rows(r.quest_id),captured);
});
test('owner guards, RLS, private helpers and public grants remain restricted',async()=>{
 const {receipt:r}=await create();
 for(const client of [other,anon])for(const [name,args] of [['get_recurring_quest_detail_v1',{p_quest_id:r.quest_id}],['materialize_quest_day_v2',{p_day:today}],['create_recurring_quest_v2',{command_id:id(),request:{title:'Denied',recurrence_mode:'daily',start_date:today},origin:'web_ui'}],['set_recurring_quest_schedule_defaults_v1',editArgs(r.quest_id,1)]])assert((await rpc(name,args,client)).error);
 const names=['materialize_quest_day_v2','create_recurring_quest_v2','set_recurring_quest_schedule_defaults_v1','get_recurring_quest_detail_v1'];
 const catalog=JSON.parse(await env.sql(`SELECT jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'owner',pg_get_userbyid(proowner),'path',proconfig,'guard',position('system_private.require_owner()' IN prosrc)>0,'anon',has_function_privilege('anon',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (${names.map(n=>`'${n}'`).join(',')});`));
 assert.equal(catalog.length,4);for(const c of catalog){assert(c.guard);assert(!c.anon);assert(!c.service);assert.deepEqual(c.path,['search_path=pg_catalog']);assert.equal(c.definer,!c.name.startsWith('get_'));if(c.definer)assert.equal(c.owner,'quest_command_owner');}
 assert.equal(await env.sql("SELECT bool_or(has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE pronamespace='system_internal'::regnamespace AND proname IN ('resolve_recurring_local_v1','materialize_quest_day_v2','create_recurring_quest_v2','valid_recurring_schedule_v1','recurring_rule_snapshot_v1');"),'f');
 assert.equal(await env.sql("SELECT has_column_privilege('authenticated','public.quest_recurrence_rules','local_end_time','UPDATE');"),'f');
});
