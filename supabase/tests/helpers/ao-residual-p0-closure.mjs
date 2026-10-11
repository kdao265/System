// SYSTEM AO Residual P0 Closure — scoped test-only disposable PG/Auth/PostgREST evidence.
// NEVER point this suite at a caller-supplied URL or a production/local DB.
// AO review-only business SQL, migration order, and release gates are untouched.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
const uid=()=>randomUUID();
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
function ok(r,label){assert.equal(r.error,null,label+": "+(r.error?.code??"")+" "+(r.error?.message??""));return r.data;}
const rpc=(c,name,args)=>c.rpc(name,args).then(r=>ok(r,name));
function rejected(result,label,code){assert(result.error,label+" unexpectedly succeeded");if(code)assert.equal(result.error.code,code,label);}
async function opportunity(owner,fields={}){const id=uid();await rpc(owner,"create_opportunity_v1",{p_command_id:uid(),p_opportunity_id:id,p_fields:{title:"P0 residual Opportunity "+id,...fields}});return id;}
async function activity(owner,fields={}){const id=uid();await rpc(owner,"create_activity_v1",{p_command_id:uid(),p_activity_id:id,p_fields:{title:"P0 residual Activity "+id,intent:"confirmed_plan",...fields}});return id;}
async function detail(owner,kind,id){return rpc(owner,kind==="opportunity"?"get_opportunity_v1":"get_activity_v1",{[kind==="opportunity"?"p_opportunity_id":"p_activity_id"]:id});}
const domainTables=["quests","quest_occurrences","quest_events","goals","goal_quest_links","exp_ledger","schedule_events","books"];
async function snapshot(env){return env.sql("SELECT jsonb_build_object("+domainTables.map(t=>q(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public."+t+" x)").join(",")+")::text;");}
async function expectDbReject(env,dml,sqlstate){
  assert.match(sqlstate,/^[0-9A-Z]{5}$/);
  // Only catch the *specific* expected error; a different SQLSTATE or an
  // unexpectedly successful DML causes this disposable test to fail.
  const plsql="DO $check$ BEGIN BEGIN "+dml+
    "; RAISE EXCEPTION 'EXPECTED PG CONSTRAINT REJECTION DID NOT OCCUR' USING ERRCODE='P9999';"+
    " EXCEPTION WHEN SQLSTATE "+q(sqlstate)+" THEN NULL; END; END $check$;";
  await env.sql(plsql);
}
async function catalogPrivileges(env){
  // Enumerate every non-AO ordinary/partitioned table in the public schema,
  // rather than testing only a hand-picked handful of external tables.
  const forbidden=await env.sql(
    "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') "+
    "AND c.relname NOT IN ('opportunities','activities','activity_source_links',"+
    "'opportunity_goal_links','opportunity_quest_links','activity_goal_links','activity_quest_links',"+
    "'opportunity_history','activity_history') AND "+
    "(has_table_privilege('ao_command_owner',c.oid,'INSERT') OR "+
    "has_table_privilege('ao_command_owner',c.oid,'UPDATE') OR "+
    "has_table_privilege('ao_command_owner',c.oid,'DELETE'));");
  assert.equal(Number(forbidden),0,"AO executor must have no direct cross-domain DML privileges");
  assert.equal(await env.sql("SELECT rolcanlogin::text||':'||rolbypassrls::text||':'||rolinherit::text FROM pg_roles WHERE rolname='ao_command_owner';"),
    "false:false:false","AO executor should be isolated");
  console.log("PASS: Residual P0 QA-04 full public non-AO table DML privilege enumeration");
}
async function rootConstraints(env,owner){
  const o=await opportunity(owner),a=await activity(owner);
  const rowBefore=await env.sql("SELECT to_jsonb(o)::text FROM public.opportunities o WHERE id="+q(o));
  const actBefore=await env.sql("SELECT to_jsonb(a)::text FROM public.activities a WHERE id="+q(a));
  const histBefore=await env.sql("SELECT (SELECT count(*) FROM public.opportunity_history WHERE opportunity_id="+q(o)+")::text||':'||(SELECT count(*) FROM public.activity_history WHERE activity_id="+q(a)+")::text;");
  const expBefore=await snapshot(env);
  const bad=[
    ["opportunity invalid applicability","UPDATE public.opportunities SET selection_applicability='not_applicable',selection_outcome='accepted' WHERE id="+q(o),"23514"],
    ["opportunity title SQL NULL","UPDATE public.opportunities SET title=NULL WHERE id="+q(o),"23502"],
    ["opportunity JSONB null","UPDATE public.opportunities SET program_start='null'::jsonb WHERE id="+q(o),"23514"],
    ["opportunity invalid resource URL","UPDATE public.opportunities SET resource_links='[{\"id\":\"11111111-1111-4111-8111-111111111111\",\"label\":\"bad\",\"url\":\"http://example.org\"}]'::jsonb WHERE id="+q(o),"23514"],
    ["opportunity revision nonpositive","UPDATE public.opportunities SET revision=0 WHERE id="+q(o),"23514"],
    ["activity forbidden actual in upcoming","UPDATE public.activities SET actual_start='{\"precision\":\"day\",\"year\":2030,\"month\":2,\"day\":1}'::jsonb WHERE id="+q(a),"23514"],
    ["activity reverse planned dates","UPDATE public.activities SET planned_start='{\"precision\":\"day\",\"year\":2030,\"month\":2,\"day\":2}'::jsonb,planned_end='{\"precision\":\"day\",\"year\":2030,\"month\":2,\"day\":1}'::jsonb WHERE id="+q(a),"23514"],
    ["activity invalid status","UPDATE public.activities SET status='nonexistent' WHERE id="+q(a),"23514"],
    ["bigint revision overflow","UPDATE public.activities SET revision=9223372036854775807::bigint+1 WHERE id="+q(a),"22003"]
  ];
  for(const [label,dml,expected] of bad){
    await expectDbReject(env,dml,expected);
    assert.equal(await env.sql("SELECT to_jsonb(o)::text FROM public.opportunities o WHERE id="+q(o)),rowBefore,label+" changed Opportunity root");
    assert.equal(await env.sql("SELECT to_jsonb(a)::text FROM public.activities a WHERE id="+q(a)),actBefore,label+" changed Activity root");
  }
  assert.equal(await env.sql("SELECT (SELECT count(*) FROM public.opportunity_history WHERE opportunity_id="+q(o)+")::text||':'||(SELECT count(*) FROM public.activity_history WHERE activity_id="+q(a)+")::text;"),histBefore);
  assert.equal(await snapshot(env),expBefore,"direct SQL rejection affected legacy domains");
  console.log("PASS: Residual P0 QA-12 nine direct SQL constraint/JSONB/null/overflow negatives atomic");
}
async function contextIntervals(env,owner){
  const goal=uid();
  await rpc(owner,"create_goal_v1",{p_command_id:uid(),p_goal_id:goal,p_title:"P0 residual Goal",p_description:null});
  const quest=(await rpc(owner,"create_one_off_quest",{command_id:uid(),origin:"web_ui",
    request:{title:"P0 residual Quest",scheduled_at:"2032-02-12T09:30:00Z",default_reward_exp:0}})).quest_id;
  const externalBefore=await snapshot(env);
  for(const kind of ["opportunity","activity"]){
    for(const targetKind of ["goal","quest"]){
      const source=kind==="opportunity"?await opportunity(owner):await activity(owner);
      const target=targetKind==="goal"?goal:quest;
      const table="public."+kind+"_"+targetKind+"_links";
      const sourceCol=kind+"_id",targetCol=targetKind+"_id";
      const base={p_source_kind:kind,p_source_id:source,p_target_kind:targetKind};
      const first=await rpc(owner,"attach_ao_context_v1",{...base,p_target_id:target,
        p_command_id:uid(),p_expected_revision:"1"});
      assert.equal(first.changed,true);
      const current1=(await detail(owner,kind,source)).contexts.find(c=>c.target_kind===targetKind);
      assert(current1?.link_id,"missing initial context ID");
      const firstLink=current1.link_id;
      const detach=await rpc(owner,"detach_ao_context_v1",{...base,p_link_id:firstLink,
        p_command_id:uid(),p_expected_revision:"2"});
      assert.equal(detach.changed,true);
      const next=await rpc(owner,"attach_ao_context_v1",{...base,p_target_id:target,
        p_command_id:uid(),p_expected_revision:"3"});
      assert.equal(next.changed,true);
      const after=await detail(owner,kind,source);
      const current2=after.contexts.filter(c=>c.target_kind===targetKind);
      assert.equal(current2.length,1,"only one current context");
      assert.notEqual(current2[0].link_id,firstLink,"reattach must create new interval");
      assert.equal(String(after.root.revision),"4");
      const intervals=JSON.parse(await env.sql(
        "SELECT jsonb_agg(jsonb_build_object('id',id,'attached_at',attached_at,'detached_at',detached_at) ORDER BY attached_at,id)::text FROM "+
        table+" WHERE "+sourceCol+"="+q(source)+" AND "+targetCol+"="+q(target)+";"));
      assert.equal(intervals.length,2);
      assert.equal(intervals.filter(x=>x.detached_at===null).length,1);
      assert.equal(intervals.filter(x=>x.detached_at!==null).length,1);
      for(const x of intervals)if(x.detached_at!==null)assert(new Date(x.detached_at)>=new Date(x.attached_at));
      const historyTable="public."+kind+"_history";
      const events=await env.sql("SELECT count(*) FROM "+historyTable+" WHERE "+sourceCol+"="+q(source)+";");
      assert.equal(Number(events),4,"create + attach + detach + reattach immutable events");
      const noop=await rpc(owner,"attach_ao_context_v1",{...base,p_target_id:target,p_command_id:uid(),p_expected_revision:"4"});
      assert.equal(noop.changed,false);
      assert.equal(Number(await env.sql("SELECT count(*) FROM "+historyTable+" WHERE "+sourceCol+"="+q(source)+";")),4);
    }
  }
  assert.equal(await snapshot(env),externalBefore,"AO relink touched Quest/Goal/EXP/Calendar/Library");
  console.log("PASS: Residual P0 QA-21 four typed N:N detach/reattach histories, interval IDs, revision/no-op and domain snapshot");
}
async function archivedEligibility(env,owner,other){
  const goal=uid();
  await rpc(owner,"create_goal_v1",{p_command_id:uid(),p_goal_id:goal,p_title:"P0 residual Archived Goal",p_description:null});
  await rpc(owner,"set_goal_archived_v1",{p_command_id:uid(),p_goal_id:goal,p_expected_revision:"1",p_archived:true});
  const o=await opportunity(owner);
  const base={p_source_kind:"opportunity",p_source_id:o,p_target_kind:"goal",p_expected_revision:"1"};
  rejected(await owner.rpc("attach_ao_context_v1",{...base,p_command_id:uid(),p_target_id:goal}),"archived Goal attach","23514");
  rejected(await owner.rpc("attach_ao_context_v1",{...base,p_command_id:uid(),p_target_id:uid()}),"missing Goal attach","23514");
  rejected(await other.rpc("attach_ao_context_v1",{...base,p_command_id:uid(),p_target_id:goal}),"nonowner Goal attach");
  const a=await activity(owner);
  await rpc(owner,"set_activity_archived_v1",{p_command_id:uid(),p_activity_id:a,p_expected_revision:"1",p_archived:true});
  const quest=(await rpc(owner,"create_one_off_quest",{command_id:uid(),origin:"web_ui",
    request:{title:"P0 residual Eligible",scheduled_at:"2032-02-12T10:30:00Z",default_reward_exp:0}})).quest_id;
  rejected(await owner.rpc("attach_ao_context_v1",{p_command_id:uid(),p_source_kind:"activity",p_source_id:a,
    p_expected_revision:"2",p_target_kind:"quest",p_target_id:quest}),"archived AO cannot edit contexts");
  const root=await detail(owner,"opportunity",o);
  assert.equal(root.contexts.length,0);
  assert.equal(String(root.root.revision),"1");
  console.log("PASS: Residual P0 QA-23 archived/missing Goal, nonowner and archived AO source denial");
}
export async function exerciseAoResidualP0(env,owner,outsider){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/);
  await catalogPrivileges(env);
  await rootConstraints(env,owner);
  await contextIntervals(env,owner);
  await archivedEligibility(env,owner,outsider);
  console.log("PASS: Residual P0 bounded SQL/relationship/ACL suite; QA-01 migration and QA-09 UI remain gated");
}
