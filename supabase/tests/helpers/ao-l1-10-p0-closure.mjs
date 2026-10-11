// L1-10 P0 acceptance gap coverage: test-only, owner-authenticated RPCs and
// fixture-owned PostgreSQL checks. Never call external services or Cloud DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as model from "../../../src/features/activities-opportunities/model.ts";
const uid=()=>randomUUID();
function good(r,label){assert.equal(r.error,null,label+": "+(r.error?.code??"")+" "+(r.error?.message??""));return r.data;}
async function rpc(c,name,args){return good(await c.rpc(name,args),name);}
function fail(r,label){assert(r.error,label+": unexpectedly accepted");}
async function opportunity(c,title,fields={}){
  const key=uid();
  await rpc(c,"create_opportunity_v1",{p_command_id:uid(),p_opportunity_id:key,p_fields:{title,...fields}});
  return key;
}
async function activity(c,title,intent="confirmed_plan"){
  const key=uid();
  await rpc(c,"create_activity_v1",{p_command_id:uid(),p_activity_id:key,p_fields:{title,intent}});
  return key;
}
async function root(c,kind,key){
  return (await rpc(c,kind==="opportunity"?"get_opportunity_v1":"get_activity_v1",
    {[kind==="opportunity"?"p_opportunity_id":"p_activity_id"]:key})).root;
}
async function createGoal(c){
  const key=uid();
  await rpc(c,"create_goal_v1",{p_command_id:uid(),p_goal_id:key,p_title:"L110 synthetic Goal",p_description:null});
  return key;
}
async function createQuest(c){
  const receipt=await rpc(c,"create_one_off_quest",{command_id:uid(),origin:"web_ui",
    request:{title:"L110 synthetic Quest",scheduled_at:"2031-12-15T10:00:00Z",default_reward_exp:0}});
  return receipt.quest_id;
}
async function queryFailure(env,sql,expected){
  // The failed direct DML is caught inside an ephemeral psql transaction. A
  // successful write or a different SQLSTATE propagates as test failure.
  const state={foreign_key_violation:"23503",unique_violation:"23505",check_violation:"23514"}[expected];
  assert(state,"unsupported expected SQLSTATE");
  await env.sql("DO $test$ BEGIN BEGIN "+sql+"; RAISE EXCEPTION 'EXPECTED SQL FAILURE MISSING'; EXCEPTION WHEN SQLSTATE '"+state+
    "' THEN NULL; END; END $test$;");
}
async function stageMatrix(c){
  const states=[...model.OPPORTUNITY_STAGES],kinds=["advance","reopen","correction"];
  let checked=0;
  for(const current of states){
    for(const kind of kinds){
      for(const target of states){
        const key=await opportunity(c,"L110 "+current+" "+kind+" "+target);
        let rev=1;
        if(current!=="saved"){
          await rpc(c,"set_opportunity_stage_v1",{p_command_id:uid(),p_opportunity_id:key,
            p_expected_revision:"1",p_stage:current,p_kind:"advance",p_details:current==="closed"?{closed_reason:"other",closed_note:"Synthetic"}:{}});
          rev++;
        }
        const ts=model.opportunityStageTransition(current,target,kind);
        const result=await c.rpc("set_opportunity_stage_v1",{p_command_id:uid(),p_opportunity_id:key,
          p_expected_revision:String(rev),p_stage:target,p_kind:kind,
          p_details:target==="closed"?{closed_reason:"other",closed_note:"Synthetic"}:{}});
        if(ts.ok){
          good(result,"stage "+current+"/"+kind+"/"+target);
          assert.equal((await root(c,"opportunity",key)).tracking_stage,target);
        }else{
          fail(result,"stage should reject "+current+"/"+kind+"/"+target);
          assert.equal((await root(c,"opportunity",key)).tracking_stage,current);
        }
        checked++;
      }
    }
  }
  assert.equal(checked,48);
  console.log("PASS: L1-10 QA-06/19 all 48 Opportunity stage-kind-target TS/SQL matrix combinations");
}
async function activityMatrix(c){
  const actions=[...model.ACTIVITY_ACTIONS],statuses=[...model.ACTIVITY_STATUSES];
  let checked=0;
  for(const status of statuses){
    for(const action of actions){
      const intent={upcoming:"confirmed_plan",ongoing:"confirmed_started",
        paused:"confirmed_started",completed:"historical_completed",
        ended_early:"historical_ended_early",cancelled_before_start:"confirmed_plan"}[status];
      const key=await activity(c,"L110 "+status+" "+action,intent);
      let rev=1;
      if(status==="paused"||status==="cancelled_before_start"){
        const prep=await rpc(c,"transition_activity_v1",{p_command_id:uid(),p_activity_id:key,
          p_expected_revision:"1",p_action:status==="paused"?"pause":"cancel_before_start",p_details:{}});
        assert(prep.changed);rev++;
      }
      const ts=model.activityTransition(status,action);
      const result=await c.rpc("transition_activity_v1",{p_command_id:uid(),p_activity_id:key,
        p_expected_revision:String(rev),p_action:action,p_details:{}});
      if(ts.ok){
        good(result,"activity "+status+"/"+action);
        assert.equal((await root(c,"activity",key)).status,ts.value);
      }else{
        fail(result,"activity should reject "+status+"/"+action);
        assert.equal((await root(c,"activity",key)).status,status);
      }
      checked++;
    }
  }
  assert.equal(checked,36);
  console.log("PASS: L1-10 QA-07/20 all 36 Activity status-action TS/SQL transitions");
}
async function resourcesAndDates(c){
  const httpsLink=n=>({id:uid(),label:"Tài liệu "+n,url:"https://example.org/"+n});
  const valid=[
    {title:"L110 links 30",resource_links:Array.from({length:30},(_,i)=>httpsLink(i))},
    {title:"L110 Unicode 240",description:"Chú thích\r\nngắt dòng",notes:"Ghi chú\rthứ hai"},
    {title:"L110 civil month",program_start:{precision:"month",year:2024,month:2}},
    {title:"L110 civil partial unknown",program_start:{precision:"unknown"}},
    {title:"L110 min year",program_start:{precision:"day",year:1,month:1,day:1}},
    {title:"L110 max year",program_end:{precision:"day",year:9999,month:12,day:31}},
  ];
  for(const value of valid){
    const ts=model.normalizeOpportunity(value,"create");
    assert(ts.ok,"TS expected valid "+value.title);
    const {title,...fields}=value;
    const key=await opportunity(c,title,fields);
    const row=await root(c,"opportunity",key);
    for(const prop of Object.keys(value))assert.deepEqual(row[prop],ts.value[prop],"field parity "+value.title+"/"+prop);
  }
  const invalid=[
    {title:"L110 duplicate links",resource_links:(()=>{const link=httpsLink(1);return [link,link];})()},
    {title:"L110 insecure link",resource_links:[{id:uid(),label:"Unsafe",url:"http://example.org"}]},
    {title:"L110 31 links",resource_links:Array.from({length:31},(_,i)=>httpsLink(i))},
    {title:"L110 invalid leap",program_start:{precision:"day",year:1900,month:2,day:29}},
    {title:"L110 extra keys",program_end:{precision:"month",year:2026,month:2,day:1}},
    {title:"L110 year above",program_end:{precision:"year",year:10000}},
    {title:"L110 null title",notes:"a",title:null},
  ];
  for(const value of invalid){
    assert.equal(model.normalizeOpportunity(value,"create").ok,false,"TS unexpectedly valid "+value.title);
    fail(await c.rpc("create_opportunity_v1",{p_command_id:uid(),p_opportunity_id:uid(),p_fields:value}),
      "SQL unexpectedly accepted "+value.title);
  }
  console.log("PASS: L1-10 QA-08/11/12 6 accepted + 7 rejected owner RPC value/date/resource parity cases");
}
async function constraints(env,c){
  const source=await opportunity(c,"L110 FK source"),act=await activity(c,"L110 FK activity");
  const goal=await createGoal(c),quest=await createQuest(c),other=env.other.id;
  const types=[
    ["opportunity_goal_links","opportunity_id",source,"goal_id",goal],
    ["opportunity_quest_links","opportunity_id",source,"quest_id",quest],
    ["activity_goal_links","activity_id",act,"goal_id",goal],
    ["activity_quest_links","activity_id",act,"quest_id",quest],
    ["activity_source_links","activity_id",act,"opportunity_id",source],
  ];
  const owner=env.owner.id;
  for(const [table,sourceKey,sourceId,targetKey,targetId] of types){
    const name="public."+table;
    const base="INSERT INTO "+name+"(user_id,"+sourceKey+","+targetKey+") VALUES ('";
    await queryFailure(env,base+other+"','"+sourceId+"','"+targetId+"')","foreign_key_violation");
    await env.sql(base+owner+"','"+sourceId+"','"+targetId+"');");
    await queryFailure(env,base+owner+"','"+sourceId+"','"+targetId+"')","unique_violation");
    const link=await env.sql("SELECT id FROM "+name+" WHERE "+sourceKey+"='"+sourceId+
      "' AND "+targetKey+"='"+targetId+"' AND detached_at IS NULL;");
    assert.match(link,/^[a-f0-9-]{36}$/);
    await queryFailure(env,"UPDATE "+name+" SET attached_at=attached_at + interval '1 second' WHERE id='"+link+"'",
      "check_violation");
    await queryFailure(env,"DELETE FROM "+name+" WHERE id='"+link+"'","check_violation");
    await env.sql("UPDATE "+name+" SET detached_at=now() WHERE id='"+link+"';");
    await queryFailure(env,"UPDATE "+name+" SET detached_at=now() WHERE id='"+link+"'","check_violation");
    assert.equal(await env.sql("SELECT count(*) FROM "+name+" WHERE id='"+link+"'"),"1");
  }
  console.log("PASS: L1-10 QA-21 all five FK/unique/interval immutability direct SQL negative matrices");
}
async function actualDates(c){
  const a=await activity(c,"L110 correction dates","confirmed_started");
  const date={precision:"day",year:2031,month:1,day:15};
  const before=await root(c,"activity",a);
  const set=await rpc(c,"correct_activity_status_v1",{p_command_id:uid(),p_activity_id:a,
    p_expected_revision:"1",p_target_status:"ongoing",p_correction:{reason:"Correct actual start",actual_start:date}});
  assert(set.changed);
  assert.deepEqual((await root(c,"activity",a)).actual_start,date);
  const noOp=await rpc(c,"correct_activity_status_v1",{p_command_id:uid(),p_activity_id:a,
    p_expected_revision:"2",p_target_status:"ongoing",p_correction:{actual_start:date}});
  assert.equal(noOp.changed,false);
  const clear=await rpc(c,"correct_activity_status_v1",{p_command_id:uid(),p_activity_id:a,
    p_expected_revision:"2",p_target_status:"ongoing",p_correction:{actual_start:null}});
  assert(clear.changed);
  assert.equal((await root(c,"activity",a)).actual_start,null);
  assert.equal((await root(c,"activity",a)).actual_end,before.actual_end);
  const bad=await c.rpc("correct_activity_status_v1",{p_command_id:uid(),p_activity_id:a,
    p_expected_revision:"3",p_target_status:"upcoming",p_correction:{actual_start:date}});
  fail(bad,"upcoming may not retain actual start");
  assert.equal((await root(c,"activity",a)).status,"ongoing");
  console.log("PASS: L1-10 QA-20 actual date set/no-op/clear, omitted field, and upcoming invariant");
}
export async function exerciseAoL110(env,owner){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/);
  await stageMatrix(owner);
  await activityMatrix(owner);
  await resourcesAndDates(owner);
  await actualDates(owner);
  await constraints(env,owner);
  console.log("PASS: L1-10 scoped P0 matrices; QA-01 migration packaging and unexecuted release scenarios still OPEN");
}
