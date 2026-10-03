import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
const root=new URL('../src/',import.meta.url);
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const mocksUrl=`data:text/javascript,${encodeURIComponent(`
 export let response={data:null,error:null},calls=[],account='${user}',paths=[];
 export function configure(r,a='${user}'){response=r;account=a;calls=[];paths=[];}
 export async function requireUser(){if(!account)throw new Error('auth-required');return {id:account};}
 export async function createServerSupabaseClient(){return {rpc:async(...a)=>{calls.push(a);if(response instanceof Error)throw response;return response;}};}
 export function revalidatePath(p){paths.push(p);} export function unstable_rethrow(){}
`)}`;
registerHooks({resolve(s,c,next){if(c.parentURL?.startsWith(root.href)){
  if(['@/features/auth/session','@/lib/supabase/server','next/cache','next/navigation'].includes(s))return {url:mocksUrl,shortCircuit:true};
  if(s.startsWith('@/')||s.startsWith('./')){const u=new URL((s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL)).href+'.ts');if(existsSync(u))return {url:u.href,shortCircuit:true};}
}return next(s,c);}});
const {parseCalendarV2,entriesForDay}=await import('../src/features/calendar/model.ts');
const {timelineSpan,timelineLanes}=await import('../src/features/calendar/view.ts');
const {parseOccurrenceDetail,preparePlan,validPlanRequest,validPlanReceipt,OccurrenceReadGeneration}=await import('../src/features/quests/plan-model.ts');
const {PlanRecovery,PLAN_PREFIX}=await import('../src/features/quests/plan-recovery.ts');
const {readOccurrenceDetail,saveOccurrencePlan}=await import('../src/features/quests/plan-actions.ts');
const {en,vi}=await import('../src/lib/localization/dictionaries.ts');
const mocks=await import(mocksUrl);
const start='2026-10-03T09:20:00Z',end='2026-10-03T11:45:00Z',deadline='2026-10-03T18:00:00Z';
const entry={source:'quest_occurrence',entry_id:user,quest_id:other,title:'Quest',status:'draft',start_at:start,end_at:end,
  all_day:false,start_date:null,end_date:null,category:null,notes:null,source_slot_date:'2026-10-03',execution_cycle:1,reward_exp_snapshot:5,occurrence_id:user,deadline_at:deadline};
const detail={version:1,occurrence_id:user,quest_id:other,title:'Quest',description:'Current definition',notes:null,status:'draft',scheduled_at:start,planned_end_at:end,
  deadline_at:deadline,execution_cycle:1,reward_exp_snapshot:5,estimated_duration_minutes_snapshot:30,source_slot_date:null,source_timezone:null,recurrence_rule_id:null,
  recurrence_revision:null,recurrence_mode:'one_off',rule:null,goal:null,plannable:true};
const request={userId:user,commandId:other,occurrenceId:user,executionCycle:1,expectedStart:start,expectedEnd:end,start:'2026-10-03T10:00:00Z',end:'2026-10-03T12:00:00Z'};
const receipt={version:1,command_id:other,occurrence_id:user,quest_id:other,execution_cycle:1,event_id:user,before:{scheduled_at:start,planned_end_at:end,status:'draft'},after:{scheduled_at:request.start,planned_end_at:request.end,status:'draft'},changed:true,replay:false};
test('V2 parser enforces exact fields and occurrence identity; deadline remains separate',()=>{
  assert.deepEqual(parseCalendarV2([entry]),[entry]);assert.notEqual(entry.end_at,entry.deadline_at);
  for(const e of [{...entry,extra:1},{...entry,occurrence_id:other},{...entry,execution_cycle:null},{...entry,status:'invented'},{...entry,end_at:start}])assert.equal(parseCalendarV2([e]),null);
  const legacy={...entry};delete legacy.deadline_at;assert.equal(parseCalendarV2([legacy]),null);assert.equal(parseCalendarV2([entry,entry]),null);
});
test('start-only V2 Quest has no fabricated end or height',()=>{
  const e={...entry,end_at:null};assert.deepEqual(parseCalendarV2([e]),[e]);assert.equal(timelineSpan(e,['2026-10-03'],'UTC').height,0);
});
test('09:20–11:45 and one-minute geometry are exact and independent of deadline',()=>{
  const span=timelineSpan(entry,['2026-10-03'],'UTC');assert(Math.abs(span.top-560/60*44)<1e-9);assert(Math.abs(span.height-145/60*44)<1e-9);
  const short=timelineSpan({...entry,end_at:'2026-10-03T09:21:00Z'},['2026-10-03'],'UTC');assert(Math.abs(short.height-44/60)<1e-9);
  assert.deepEqual(timelineSpan({...entry,deadline_at:null},['2026-10-03'],'UTC'),span);
});
test('overnight Quest uses half-open membership and clipped geometry',()=>{
  const e={...entry,start_at:'2026-10-03T23:30:00Z',end_at:'2026-10-04T01:00:00Z'};
  assert.equal(entriesForDay([e],'2026-10-04','UTC').length,1);
  assert.equal(timelineSpan(e,['2026-10-03'],'UTC').height,22);assert.equal(timelineSpan(e,['2026-10-04'],'UTC').height,44);
  assert.equal(entriesForDay([{...e,end_at:'2026-10-04T00:00:00Z'}],'2026-10-04','UTC').length,0);
});
test('mixed overlap lanes reuse touching intervals',()=>{assert.deepEqual(timelineLanes([{top:0,height:20},{top:5,height:10},{top:20,height:5}]),{lanes:[0,1,0],count:2});});
test('detail parser is occurrence-scoped and rejects malformed provenance/Goal',()=>{
  assert.deepEqual(parseOccurrenceDetail(detail,user),detail);
  for(const d of [{...detail,occurrence_id:other},{...detail,extra:1},{...detail,source_slot_date:'2026-10-03'},{...detail,plannable:false},{...detail,goal:{id:'bad',title:'Main',archived:false}}])assert.equal(parseOccurrenceDetail(d,user),null);
});
test('late A response cannot overwrite B or a later refresh of B',()=>{
  const g=new OccurrenceReadGeneration(),a=g.begin(),b=g.begin();assert(!g.accepts(a));assert(g.accepts(b));g.cancel();assert(!g.accepts(b));
});
test('plan validation preserves unknown end, rejects gaps/folds and end-before-start',()=>{
  assert.deepEqual(preparePlan('2026-10-03T09:20','2026-10-03T11:45','UTC'),{start:'2026-10-03T09:20:00.000Z',end:'2026-10-03T11:45:00.000Z'});
  assert.deepEqual(preparePlan('','','UTC'),{start:null,end:null});assert.equal(preparePlan('','2026-10-03T11:45','UTC'),null);
  assert.equal(preparePlan('2026-10-03T09:20','2026-10-03T09:20','UTC'),null);
  for(const time of ['2026-03-08T02:30','2026-11-01T01:30'])assert.equal(preparePlan(time,'','America/New_York'),null);
  assert(validPlanRequest(request));assert(!validPlanRequest({...request,userId:undefined}));assert(!validPlanRequest({...request,executionCycle:0}));
});
test('receipt must bind the exact command, cycle and before/after instants',()=>{
  assert(validPlanReceipt(receipt,request));assert(!validPlanReceipt({...receipt,execution_cycle:2},request));assert(!validPlanReceipt({...receipt,after:{...receipt.after,planned_end_at:end}},request));
  assert(!validPlanReceipt({...receipt,changed:false},request));assert(!validPlanReceipt({...receipt,after:{...receipt.after,status:'completed'}},request));
});
function memory(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function recovery(storage,send,account=user){return new PlanRecovery(account,{storage:()=>storage,lock:async(_k,fn)=>fn(),send});}
test('lost committed response survives reload and retries exact command',async()=>{
  const storage=memory(),sent=[];const first=recovery(storage,async(r)=>{sent.push(r);throw new Error('lost response');});first.recover();await first.submit(request);
  assert.deepEqual(first.getSnapshot().pending,request);
  const next=recovery(storage,async(r,retry)=>{assert(retry);sent.push(r);return {outcome:'success'};});next.recover();await next.submit();
  assert.deepEqual(sent,[request,request]);assert.equal(storage.getItem(PLAN_PREFIX+user),null);
});
test('pending other-tab command is never overwritten by a new plan',async()=>{
  const storage=memory();storage.setItem(PLAN_PREFIX+user,JSON.stringify(request));let sent=0;
  const c=recovery(storage,async()=>{sent++;return {outcome:'success'};});c.recover();await c.submit({...request,commandId:user});
  assert.equal(sent,0);assert.deepEqual(c.getSnapshot().pending,request);
});
test('account changes preserve saved request and prevent further sends',async()=>{
  const storage=memory();const c=recovery(storage,async()=>({outcome:'rejected',reason:'account'}));c.recover();await c.submit(request);
  assert(c.getSnapshot().blocked);assert(storage.getItem(PLAN_PREFIX+user));
  const next=recovery(storage,async()=>{throw new Error('must not send');},other);next.recover();assert.equal(next.getSnapshot().pending,null);
});
test('storage failure and corrupt saved request fail closed before network',async()=>{
  let calls=0;for(const storage of [{getItem:()=>null,setItem:()=>{throw new Error('quota');}}, {getItem:()=>'{bad'}]){
    const c=recovery(storage,async()=>{calls++;return {outcome:'success'};});c.recover();await c.submit(request);assert(c.getSnapshot().blocked);
  }assert.equal(calls,0);
});
test('duplicate synchronous submissions send once and save before sending',async()=>{
  const storage=memory();let finish,calls=0;const c=recovery(storage,async(r)=>{calls++;assert.deepEqual(JSON.parse(storage.getItem(PLAN_PREFIX+user)),r);return new Promise(resolve=>finish=resolve);});c.recover();
  const running=c.submit(request);await c.submit(request);finish({outcome:'success'});await running;assert.equal(calls,1);
});
test('server actions enforce account and auth; sanitized unknown/rejected results',async()=>{
  mocks.configure({data:detail,error:null});assert.deepEqual(await readOccurrenceDetail(user,user),detail);assert.equal(mocks.calls[0][0],'get_quest_occurrence_detail_v1');
  mocks.configure({data:receipt,error:null});assert.equal((await saveOccurrencePlan(request)).outcome,'success');assert(mocks.paths.includes('/calendar'));
  mocks.configure({error:{code:'23514',message:'Stale occurrence plan'}});assert.equal((await saveOccurrencePlan(request)).reason,'stale');assert.equal((await saveOccurrencePlan(request,true)).outcome,'unknown');
  mocks.configure(new Error('private diagnostic'));assert.deepEqual(await saveOccurrencePlan(request),{outcome:'unknown'});
  mocks.configure({},other);assert.equal((await saveOccurrencePlan(request)).reason,'account');assert.equal(mocks.calls.length,0);
  mocks.configure({},null);await assert.rejects(saveOccurrencePlan(request),/auth-required/);
});
test('English/Vietnamese detail copy has matching keys and intact Unicode',()=>{
  assert.deepEqual(Object.keys(en.questDetail),Object.keys(vi.questDetail));assert.equal(vi.questDetail.plannedEnd,'Kết thúc dự kiến');assert(!JSON.stringify(vi.questDetail).includes('\ufffd'));
});
test('migration is additive and harness applies it after historical activation/retirement',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261003180000_calendar_quest_plan_v1.sql',import.meta.url),'utf8');
  assert(!/CREATE OR REPLACE|planned_start_at|UPDATE public\.quests\b|UPDATE public\.exp_ledger\b/.test(sql));
  assert.match(sql,/CHECK \(\s*planned_end_at IS NULL OR/);assert.match(sql,/'occurrence_edited'/);
  const harness=readFileSync(new URL('helpers/auth-environment.mjs',import.meta.url),'utf8');assert(harness.indexOf('new URL(occurrencePlanning,')>harness.indexOf('new URL(recurringRetirement,'));
});
