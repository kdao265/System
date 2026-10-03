import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
const root=new URL("../src/",import.meta.url);
const mocks=`data:text/javascript,${encodeURIComponent(`
export const calls=[],invalidations=[];
export let response,account='10000000-0000-4000-8000-000000000001';
export async function requireUser(){return {id:account};}
export async function getAuthenticatedUser(){return {id:account};}
export function unstable_rethrow(){}
export async function createServerSupabaseClient(){return {rpc:async(name,args)=>{calls.push({name,args});return response(name,args);}};}
export function revalidatePath(path){invalidations.push(path);}
export function configure(fn,user='10000000-0000-4000-8000-000000000001'){response=fn;account=user;calls.length=0;invalidations.length=0;}
`)}`;
const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.startsWith(root.href)){
    if(["@/features/auth/session","@/lib/supabase/server","next/cache","next/navigation"].includes(specifier)) return {url:mocks,shortCircuit:true};
    if(specifier.startsWith("@/"))return {url:new URL(specifier.slice(2)+".ts",root).href,shortCircuit:true};
    if(specifier.startsWith("./"))return next(specifier+".ts",context);
  }return next(specifier,context);
}});
const {validateRecurringRetirementReceipt:valid,parseArchivedRecurringQuests:parse,RECURRING_RETIREMENT_PREFIX:prefix}=await import("../src/features/quests/recurring-retirement-model.ts");
const {manageRecurringQuest}=await import("../src/features/quests/recurring-retirement-action.ts");
const {getArchivedRecurringQuests}=await import("../src/features/quests/recurring-retirement-data.ts");
const {QuestManagementLifecycle,MANAGEMENT_PREFIX}=await import("../src/features/quests/management-lifecycle.ts");
const {configure,calls,invalidations}=await import(mocks);hooks.deregister();
const user="10000000-0000-4000-8000-000000000001",quest="20000000-0000-4000-8000-000000000001",command="30000000-0000-4000-8000-000000000001",event="40000000-0000-4000-8000-000000000001";
const instant="2026-10-03T01:00:00Z";
const receipt=(operation="archive")=>({version:1,command_id:command,quest_id:quest,operation,archived_at:operation==="restore"?null:instant,deleted_at:operation==="delete"?instant:null,event_id:event,changed:true,replay:false});
function form(operation="archive",mode="new") {const f=new FormData(); for(const [k,v]of Object.entries({expected_account:user,quest_id:quest,command_id:command,operation,mode}))f.set(k,v);return f;}
class Storage{values=new Map();getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,v);}removeItem(k){this.values.delete(k);}}
function setup(send=async()=>({outcome:"unknown",operation:"archive"})){
  const storage=new Storage(),sent=[];let tail=Promise.resolve();
  const deps={storage:()=>storage,uuid:()=>command,lock:(fn)=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;},send:async(p,f)=>{sent.push(Object.fromEntries(f));return send(p,f);}};
  return {storage,sent,make:()=>new QuestManagementLifecycle(user,deps,prefix)};
}
test("retirement receipts bind exact command, target, operation and lifecycle shape",()=>{
  for(const op of ["archive","restore","delete"]){
    assert(valid(receipt(op),command,quest,op));
    for(const patch of [{extra:true},{version:2},{command_id:event},{quest_id:event},{operation:"bad"},{event_id:"bad"},{changed:"true"},{replay:1},{archived_at:op==="restore"?instant:null},{deleted_at:op==="delete"?null:instant}])assert(!valid({...receipt(op),...patch},command,quest,op));
  }
});
test("archived recurring parser is separate and rejects extra, duplicate or malformed rows",()=>{
  const row={quest_id:quest,title:"Routine",recurrence_mode:"daily",recurrence_type:"daily",paused:true,anchor_date:"2026-10-01",end_date:null,weekdays:null,month_day:null,occurrence_limit:null,default_reward_exp:17,materialized_occurrence_count:"2",last_slot_date:"2026-10-03",archived_at:instant};
  assert.deepEqual(parse([row]),[row]);assert.deepEqual(parse([]),[]);
  for(const rows of [null,[row,row],[{...row,extra:true}],[{...row,archived_at:null}],[{...row,paused:"true"}]])assert.equal(parse(rows),null);
});
for(const operation of ["archive","restore","delete"])test(`${operation} dispatches supplied identity and refreshes all projections`,async()=>{
  configure(()=>({data:receipt(operation),error:null}));
  assert.equal((await manageRecurringQuest({},form(operation))).outcome,"success");
  assert.deepEqual(calls,[{name:operation==="delete"?"delete_recurring_quest_v1":"set_recurring_quest_archived_v1",args:{p_command_id:command,p_quest_id:quest,p_origin:"web_ui",...(operation==="delete"?{}:{p_archived:operation==="archive"})}}]);
  assert.deepEqual(invalidations,["/dashboard","/calendar","/goals"]);
});
test("action rejects account/shape before transport; invalid receipt stays uncertain",async()=>{
  configure(()=>({data:{...receipt(),event_id:"bad"},error:null}));
  assert.equal((await manageRecurringQuest({},form())).outcome,"unknown");
  const invalid=form();invalid.delete("command_id");calls.length=0;
  assert.equal((await manageRecurringQuest({},invalid)).outcome,"rejected");assert.equal(calls.length,0);
  configure(()=>{throw Error("must not send");},event);
  assert.equal((await manageRecurringQuest({},form())).outcome,"rejected");assert.equal(calls.length,0);
});
test("first lifecycle rejection is safe; retry rejection remains unknown",async()=>{
  configure(()=>({error:{code:"23514",message:"Archive recurring Quest before permanent deletion"}}));
  assert.equal((await manageRecurringQuest({},form("delete"))).outcome,"rejected");
  assert.equal((await manageRecurringQuest({},form("delete","retry"))).outcome,"unknown");
});
test("archived loader only calls its dedicated read and fails closed",async()=>{
  configure(()=>({data:[],error:null}));assert.deepEqual(await getArchivedRecurringQuests(),[]);
  assert.equal(calls[0].name,"list_archived_recurring_quests_v1");
  configure(()=>({data:[{}],error:null}));assert.equal(await getArchivedRecurringQuests(),null);
});
for(const operation of ["archive","delete"])test(`lost ${operation} reload recovers globally without a visible card`,async()=>{
  const h=setup();const c=h.make();await c.recover();await c.submit(quest,operation,"Routine");
  const bytes=h.storage.getItem(prefix+user);assert(bytes);assert.equal(h.storage.getItem(MANAGEMENT_PREFIX+user),null);
  const recovered=h.make();await recovered.recover();await recovered.retry();
  assert.equal(h.sent[1].command_id,command);assert.equal(h.sent[1].operation,operation);assert.equal(h.sent[1].mode,"retry");
  assert.equal(h.storage.getItem(prefix+user),bytes);
});
test("cross-tab retirement coordination preserves unresolved identity",async()=>{
  const h=setup(),a=h.make(),b=h.make();await a.recover();await b.recover();
  await Promise.all([a.submit(quest,"archive","Routine"),b.submit(quest,"delete","Routine")]);
  assert.equal(h.sent.length,1);assert.equal(b.getSnapshot().phase,"uncertain");
});
test("default one-off and recurring namespaces recover independently for the same account",async()=>{
  const storage=new Storage(),sent=[];
  const deps={storage:()=>storage,uuid:()=>command,lock:async(fn)=>fn(),send:async(p,f)=>{sent.push(Object.fromEntries(f));return {outcome:"unknown",operation:"archive"};}};
  const one=new QuestManagementLifecycle(user,deps),recurring=new QuestManagementLifecycle(user,deps,prefix);
  await one.recover();await recurring.recover();
  await one.submit(quest,"archive","One-off");await recurring.submit(event,"delete","Recurring");
  assert.equal(MANAGEMENT_PREFIX,"system.quest-management.pending.v1:");assert.notEqual(prefix,MANAGEMENT_PREFIX);
  assert.equal(JSON.parse(storage.getItem(MANAGEMENT_PREFIX+user)).questId,quest);
  assert.equal(JSON.parse(storage.getItem(prefix+user)).questId,event);
  const reload=new QuestManagementLifecycle(user,deps,prefix);await reload.recover();await reload.retry();
  assert.equal(sent.at(-1).quest_id,event);assert(storage.getItem(MANAGEMENT_PREFIX+user));
  const changed=new QuestManagementLifecycle(event,deps,prefix);await changed.recover();
  assert.equal(changed.getSnapshot().pending,undefined);
  reload.deactivate();const count=sent.length;await reload.retry();assert.equal(sent.length,count);
});
test("new migration preserves one-off source and places fresh recurring guards after replay",()=>{
  const sql=readFileSync(new URL("../supabase/migrations/20261003120000_recurring_quest_archive_delete_v1.sql",import.meta.url),"utf8");
  assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?FUNCTION public\.(?:delete_one_off|set_one_off)/);
  const helper=sql.slice(sql.indexOf("CREATE FUNCTION system_internal"),sql.indexOf("CREATE FUNCTION public.set_recurring"));
  assert.doesNotMatch(helper,/(?:UPDATE|INSERT INTO|DELETE FROM) public\.(?:exp_ledger|quest_occurrences|quest_recurrence_rules)/);
  assert.match(helper,/lock_owner\(actor\)/);assert.match(helper,/FOR UPDATE/);
  assert(helper.indexOf("'replay',true")<helper.indexOf("IF q.deleted_at IS NOT NULL"));
  for(const name of ["complete_quest_occurrence","reopen_quest_occurrence_v2"]){
    const body=sql.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;'))[0];
    assert(body.indexOf("Retired recurring")>body.indexOf(name==="complete_quest_occurrence"?"RETURN system_internal.completion_receipt":"true);"));
  }
});
