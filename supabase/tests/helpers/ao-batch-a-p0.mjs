// Batch A: authorised fixture-only QA-10/12/23 checks. Review SQL is never edited.
// Runtime context must be the existing tmpfs/loopback Auth/PostgREST/PG runner.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import * as model from "../../../src/features/activities-opportunities/model.ts";
import { expectSqlRejection, expectRpcRejection, assertCandidate, evidenceSnapshot } from "./ao-residual-evidence.mjs";

const id=()=>randomUUID();
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
function good(response,label){assert.equal(response.error,null,label+": "+(response.error?.code??"")+" "+(response.error?.message??""));return response.data;}
const rpc=async(client,name,args)=>good(await client.rpc(name,args),name);
async function opportunity(c){const key=id();await rpc(c,"create_opportunity_v1",{p_command_id:id(),p_opportunity_id:key,p_fields:{title:"Batch A synthetic Opportunity "+key}});return key;}
async function activity(c){const key=id();await rpc(c,"create_activity_v1",{p_command_id:id(),p_activity_id:key,p_fields:{title:"Batch A synthetic Activity "+key,intent:"confirmed_plan"}});return key;}
async function quest(c,label){return (await rpc(c,"create_one_off_quest",{command_id:id(),origin:"web_ui",request:{title:label,scheduled_at:"2032-03-12T09:30:00Z",default_reward_exp:0}})).quest_id;}
const externalTables=["quests","quest_occurrences","quest_events","quest_recurrence_rules","goals","goal_quest_links","exp_ledger","schedule_events","books"];
async function domainSnapshot(env){return env.sql("SELECT jsonb_build_object("+externalTables.map(t=>q(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public."+t+" x)").join(",")+")::text;");}
async function pgReject(env,statement,expected,label,subjects){
  await expectSqlRejection(env,statement,expected,subjects,label);
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
      await pgReject(env,"UPDATE "+tableCase.table+" SET "+tableCase.column+"="+q(value)+"::jsonb WHERE id="+q(tableCase.key),"23514",label,[{kind:"opportunity",id:o},{kind:"activity",id:a}]);
      tested++;
    }
  }
  const badResources=[["resource scalar",'"https://example.org"'],["resource object",'{"label":"x"}'],["resource null","null"],["resource element wrong type",'[3]'],["resource extra keys",'[{"id":"11111111-1111-4111-8111-111111111111","label":"OK","url":"https://example.org","extra":"x"}]']];
  for(const [label,value] of badResources){
    await pgReject(env,"UPDATE public.activities SET resource_links="+q(value)+"::jsonb WHERE id="+q(a),"23514",label,[{kind:"opportunity",id:o},{kind:"activity",id:a}]);
    tested++;
  }
  for(const [label,sql,state] of [
    ["missing status","UPDATE public.activities SET status=NULL WHERE id="+q(a),"23502"],
    ["missing selection outcome","UPDATE public.opportunities SET selection_outcome=NULL WHERE id="+q(o),"23502"]
  ]){await pgReject(env,sql,state,label,[{kind:"opportunity",id:o},{kind:"activity",id:a}]);tested++;}
  const rootAfter=await env.sql("SELECT (SELECT to_jsonb(x)::text FROM public.opportunities x WHERE id="+q(o)+")||E'\\n'||(SELECT to_jsonb(x)::text FROM public.activities x WHERE id="+q(a)+");");
  assert.equal(rootAfter,rootBefore,"Invalid direct SQL changed AO roots");
  assert.equal(await env.sql("SELECT (SELECT count(*) FROM public.opportunity_history WHERE opportunity_id="+q(o)+")::text||':'||(SELECT count(*) FROM public.activity_history WHERE activity_id="+q(a)+")::text;"),histBefore);
  assert.equal(await domainSnapshot(env),externalBefore,"Invalid direct SQL changed external domains");
  console.log("PASS: Batch A QA-12 "+tested+" extra direct PostgreSQL wrong-shape/null/field tests and atomic snapshots; review of all constraints still required");
}

// Group 1 — QA-10: only the two unpaired rejection branches are new.
async function timezoneResidual(env,owner){
  const source=await opportunity(owner),subjects=[{kind:"opportunity",id:source}];
  const cases=[
    ["T10-01",{precision:"instant",source_date:"2026-11-01",source_time:"01:30",
      source_zone:"America/New_York"},"Invalid AO date"],
    ["T10-02",{precision:"instant",source_date:"2026-11-01",source_time:"01:30",
      source_zone:"Invalid/Zone",source_offset_minutes:0},"Unsupported AO timezone identifier"],
  ];
  for(const [label,deadline,message] of cases){
    assert.equal(model.parseDeadline(deadline).ok,false,label+" TS rejection");
    await expectRpcRejection(env,owner,"update_opportunity_v1",{
      p_command_id:id(),p_opportunity_id:source,p_expected_revision:"1",
      p_changes:{title:"Must roll back",application_deadline:deadline},
    },subjects,"22023",label+" owner",message);
    if(label==="T10-01"){
      // Bypass the RPC field validator, not constraints/RLS: fixture admin DML
      // proves that the storage trigger independently rejects missing offset.
      await expectSqlRejection(env,"UPDATE public.opportunities SET application_deadline="+
        q(JSON.stringify(deadline))+"::jsonb WHERE id="+q(source),"22023",subjects,
        label+" storage trigger",{message:"Invalid AO deadline spec"});
    }
  }
  console.log("PASS: Group 1 QA-10 T10-01 missing fold offset and T10-02 unsupported zone; complete rollback");
}

// Group 2 — QA-23: reuse existing targets; new legacy forms are fixture-only.
// No Project table, constraint/trigger/RLS disabling, or production setup path.
async function questEligibility(env,owner,other){
  const archived=await quest(owner,"Batch A archived synthetic Quest");
  await rpc(owner,"set_one_off_quest_archived_v1",{p_command_id:id(),p_quest_id:archived,p_archived:true,p_origin:"web_ui"});
  const deleted=await quest(owner,"Batch A deleted synthetic Quest");
  await rpc(owner,"delete_one_off_quest_v1",{p_command_id:id(),p_quest_id:deleted,p_origin:"web_ui"});
  const tzResult=await owner.from("profiles").update({timezone:"UTC"}).eq("user_id",env.owner.id);
  assert.equal(tzResult.error,null,"Batch A disposable Profile timezone setup");
  const start=await env.sql("SELECT ((now() AT TIME ZONE 'UTC')::date + 7)::text;");
  const recurring=(await rpc(owner,"create_recurring_quest",{command_id:id(),origin:"web_ui",request:{
    title:"Batch A recurring synthetic Quest",recurrence_mode:"daily",start_date:start,default_reward_exp:0}})).quest_id;
  const allowed=await quest(owner,"Batch A eligible one-off");
  const bound=await quest(owner,"Batch A legacy direct-goal-bound fixture");
  const goal=id(),goalTitle="Batch A bound Goal "+goal;
  await rpc(owner,"create_goal_v1",{p_command_id:id(),p_goal_id:goal,p_title:goalTitle,p_description:null});
  await env.sql("UPDATE public.quests SET direct_goal_id="+q(goal)+" WHERE id="+q(bound)+";");
  const cases=[
    {label:"archived one-off",target:archived,query:"Batch A archived synthetic Quest"},
    {label:"deleted one-off",target:deleted,query:"Batch A deleted synthetic Quest",searchCovered:true},
    {label:"recurring",target:recurring,query:"Batch A recurring synthetic Quest"},
    {label:"legacy direct goal",target:bound,query:"Batch A legacy direct-goal-bound fixture"},
  ];

  // T23-01/02/03: parent fields are nullable UUIDs. ck_quest_parent and
  // ck_occurrence_parent allow exactly these isolated synthetic attributions.
  const project=id();
  for(const [label,table,column,value] of [
    ["T23-01","quests","project_id",project],
    ["T23-02","quest_occurrences","direct_goal_id_snapshot",goal],
    ["T23-03","quest_occurrences","project_id_snapshot",project],
  ]){
    const title=label+" legacy "+id(),target=await quest(owner,title);
    const key=table==="quests"?"id":"quest_id";
    const updated=await env.sql("WITH changed AS (UPDATE public."+table+" SET "+column+"="+q(value)+
      " WHERE "+key+"="+q(target)+" AND user_id="+q(env.owner.id)+" RETURNING id) SELECT count(*) FROM changed;");
    assert.equal(updated,"1",label+" exactly one fixture row");
    cases.push({label,target,query:title});
  }
  // T23-04: real same-owner rule, while definition stays one_off. The recurrence
  // fields on the sole occurrence stay NULL. This reaches the EXISTS-rule guard.
  const ruleTitle="T23-04 retained rule "+id(),ruleTarget=await quest(owner,ruleTitle);
  await env.sql("INSERT INTO public.quest_recurrence_rules(id,quest_id,user_id,recurrence_type,anchor_date) VALUES ("+
    [q(id()),q(ruleTarget),q(env.owner.id),"'daily'","'2032-03-12'"].join(",")+");");
  cases.push({label:"T23-04",target:ruleTarget,query:ruleTitle});

  // T23-05: new definition without occurrence; never delete a retained occurrence.
  const zero=id(),zeroTitle="T23-05 zero occurrences "+id();
  await env.sql("INSERT INTO public.quests(id,user_id,title) VALUES ("+
    [q(zero),q(env.owner.id),q(zeroTitle)].join(",")+");");
  cases.push({label:"T23-05",target:zero,query:zeroTitle});
  const missing=id();
  assert.equal(await env.sql("SELECT count(*) FROM public.quests WHERE id="+q(missing)),"0");
  cases.push({label:"T23-06",target:missing,query:"T23-06 absent "+missing});

  // T23-07: configured OWNER calls AO; targets belong to the existing OUTSIDER.
  // Setup through the harness administrator only; no singleton/policy changes.
  const foreignGoal=id(),foreignQuest=id(),foreignTitle="Foreign-private-"+id();
  const foreignDescription="Foreign-description-"+id();
  await env.sql("INSERT INTO public.goals(id,user_id,title,description) VALUES ("+
    [q(foreignGoal),q(env.other.id),q(foreignTitle),q(foreignDescription)].join(",")+"); "+
    "INSERT INTO public.quests(id,user_id,title,description,default_reward_exp) VALUES ("+
    [q(foreignQuest),q(env.other.id),q(foreignTitle),q(foreignDescription),"914273"].join(",")+"); "+
    "INSERT INTO public.quest_occurrences(id,quest_id,user_id,reward_exp_snapshot) VALUES ("+
    [q(id()),q(foreignQuest),q(env.other.id),"914273"].join(",")+");");
  const markers=[foreignTitle,foreignDescription,"914273"];
  cases.push({label:"T23-07 Quest",target:foreignQuest,query:foreignTitle,markers});
  cases.push({label:"T23-07 Goal",target:foreignGoal,targetKind:"goal",query:foreignTitle,markers});

  // Verify new Quest fixtures reach the intended target branch, rather than
  // accidentally rejecting because their setup left a missing/wrong-owner row.
  for(const fixture of cases.filter(c=>/^T23-0[1-5]$/.test(c.label)||c.label==="T23-07 Quest")){
    const state=JSON.parse(await env.sql("SELECT jsonb_build_object("+
      "'owner',q.user_id,'mode',q.recurrence_mode,'archived',q.archived_at,'deleted',q.deleted_at,"+
      "'goal',q.direct_goal_id,'project',q.project_id,"+
      "'rules',(SELECT count(*) FROM public.quest_recurrence_rules r WHERE r.quest_id=q.id AND r.user_id=q.user_id),"+
      "'occurrences',(SELECT coalesce(jsonb_agg(jsonb_build_object('goal',o.direct_goal_id_snapshot,"+
      "'project',o.project_id_snapshot,'rule',o.recurrence_rule_id,'revision',o.recurrence_revision,"+
      "'slot',o.source_slot_date,'zone',o.source_timezone) ORDER BY o.id),'[]'::jsonb)"+
      " FROM public.quest_occurrences o WHERE o.quest_id=q.id AND o.user_id=q.user_id))::text "+
      "FROM public.quests q WHERE q.id="+q(fixture.target)+";"));
    assert.deepEqual(state,{
      owner:fixture.label==="T23-07 Quest"?env.other.id:env.owner.id,mode:"one_off",archived:null,deleted:null,
      goal:null,project:fixture.label==="T23-01"?project:null,rules:fixture.label==="T23-04"?1:0,
      occurrences:fixture.label==="T23-05"?[]:[{
        goal:fixture.label==="T23-02"?goal:null,project:fixture.label==="T23-03"?project:null,
        rule:null,revision:null,slot:null,zone:null,
      }],
    },fixture.label+" isolated eligibility precondition");
  }
  assert.equal(await env.sql("SELECT user_id::text FROM public.goals WHERE id="+q(foreignGoal)),env.other.id);

  // ck_occurrence_origin + fk_occurrence_rule_owner imply a recurrence-origin
  // occurrence has a same-owner rule, rejected by EXISTS above. Without a rule,
  // uq_one_off_occurrence prevents >1 ordinary occurrence. Do not disable these
  // constraints to manufacture isolated quartet or >1/no-rule branch fixtures.
  for(const kind of ["opportunity","activity"]){
    for(const fixture of cases){
      const source=kind==="opportunity"?await opportunity(owner):await activity(owner);
      const targetKind=fixture.targetKind??"quest";
      await expectRpcRejection(env,owner,"attach_ao_context_v1",{
        p_command_id:id(),p_source_kind:kind,p_source_id:source,p_expected_revision:"1",
        p_target_kind:targetKind,p_target_id:fixture.target,
      },[{kind,id:source}],"23514",kind+" "+fixture.label,"AO contextual target not eligible",fixture.markers??[]);
      if(!fixture.searchCovered)await assertCandidate(env,owner,kind,source,targetKind,
        fixture.target,fixture.query,false,fixture.markers??[]);
    }
    const src=kind==="opportunity"?await opportunity(owner):await activity(owner);
    await assertCandidate(env,owner,kind,src,"quest",allowed,"Batch A eligible one-off",true);
    await assertCandidate(env,owner,kind,src,"goal",goal,goalTitle,true);
    const before=await domainSnapshot(env);
    const receipt=await rpc(owner,"attach_ao_context_v1",{p_command_id:id(),p_source_kind:kind,p_source_id:src,
      p_expected_revision:"1",p_target_kind:"quest",p_target_id:allowed});
    assert.equal(receipt.changed,true);
    assert.equal(await domainSnapshot(env),before,"Eligible AO attach altered external domains");
  }
  const source=await opportunity(owner),otherRoot=await opportunity(owner);
  await expectRpcRejection(env,other,"attach_ao_context_v1",{
    p_command_id:id(),p_source_kind:"opportunity",p_source_id:source,
    p_expected_revision:"1",p_target_kind:"quest",p_target_id:allowed,
  },[{kind:"opportunity",id:source},{kind:"opportunity",id:otherRoot}],"42501","existing nonowner caller rejection");
  console.log("PASS: Group 2 QA-23 T23-01..08 plus reused target classes; both sources, candidates, full rollback/privacy");
}
// T23-09 — IMPLEMENTED, RUNTIME NOT VERIFIED.
// Quest Archive owns its external writes; only AO state is invariant across it.
// Reuse full post-archive snapshots for the later rejected AO attach.
async function questArchiveRetention(env, owner) {
  for (const kind of ["opportunity", "activity"]) {
    const label = "T23-09 " + kind;
    const title = label + " retained Quest " + id();
    const target = await quest(owner, title);
    const makeSource = kind === "opportunity" ? opportunity : activity;
    const source = await makeSource(owner), freshSource = await makeSource(owner);
    const subjects = [{ kind, id: source }, { kind, id: freshSource }];
    const attachCommand = id(), archiveCommand = id();
    const attached = await rpc(owner, "attach_ao_context_v1", {
      p_command_id: attachCommand, p_source_kind: kind, p_source_id: source,
      p_expected_revision: "1", p_target_kind: "quest", p_target_id: target,
    });
    assert.equal(attached.changed, true, label + ": initial attach");
    const read = () => rpc(owner, "get_" + kind + "_v1", { ["p_" + kind + "_id"]: source });
    const beforeView = await read();
    const before = JSON.parse(await evidenceSnapshot(env, subjects, archiveCommand));
    const prefix = kind + ":" + source + ":";
    // evidenceSnapshot uses kind:id keys for every scoped AO row collection.
    // External tables intentionally remain outside this archive comparison.
    const aoOnly = state => Object.fromEntries(Object.entries(state)
      .filter(([key]) => key === "commands" || key.startsWith(kind + ":")));
    assert.equal(before[prefix + "root"].length, 1, label + ": root present");
    assert.equal(String(before[prefix + "root"][0].revision), "2", label + ": attached revision");
    assert.equal(before[prefix + "root"][0].archived_at, null, label + ": active source");
    assert.equal(before[kind + ":" + freshSource + ":quest"].length, 0, label + ": fresh source has no link");
    assert.equal(before.commands.filter(row => row.command_id === attachCommand).length, 1,
      label + ": attach receipt captured");
    assert.equal(before.commands.filter(row => row.command_id === archiveCommand).length, 0,
      label + ": no preexisting AO archive receipt");
    const links = before[prefix + "quest"];
    assert.equal(links.length, 1, label + ": exactly one retained interval");
    const link = links[0];
    assert.equal(link[kind + "_id"], source);
    assert.equal(link.quest_id, target);
    assert.equal(link.user_id, env.owner.id);
    assert.equal(link.detached_at, null);
    assert.equal(beforeView.contexts.length, 1, label + ": one context projection");
    const context = beforeView.contexts[0];
    assert.equal(context.link_id, link.id);
    assert.equal(context.target_kind, "quest");
    assert.deepEqual(context.target, { id: target, deleted: false, label: title, archived: false });

    const archived = await rpc(owner, "set_one_off_quest_archived_v1", {
      p_command_id: archiveCommand, p_quest_id: target, p_archived: true, p_origin: "web_ui",
    });
    assert.equal(archived.changed, true, label + ": actual archive transition");
    const afterArchiveSnapshot = await evidenceSnapshot(env, subjects, archiveCommand);
    const afterArchive = JSON.parse(afterArchiveSnapshot);
    assert.deepEqual(aoOnly(afterArchive), aoOnly(before),
      label + ": archive must preserve roots/revisions/history/receipts/all scoped links");
    const archivedQuest = afterArchive.quests.find(row => row.id === target);
    assert(archivedQuest?.archived_at, label + ": stored Quest archived");
    assert.equal(archivedQuest.deleted_at, null, label + ": archive is not delete");
    const archiveEvents = afterArchive.quest_events.filter(row => row.command_id === archiveCommand);
    assert.equal(archiveEvents.length, 1, label + ": Quest-owned archive event");
    assert.equal(archiveEvents[0].quest_id, target);
    assert.equal(archiveEvents[0].event_type, "archived");
    assert.deepEqual(afterArchive.quest_events.filter(row => row.command_id !== archiveCommand),
      before.quest_events, label + ": existing Quest history retained");
    const afterView = await read();
    assert.deepEqual(afterView.root, beforeView.root, label + ": unchanged owner-visible AO root");
    const archivedContexts = [{ ...context, target: { ...context.target, archived: true } }];
    assert.deepEqual(afterView.contexts, archivedContexts, label + ": live archived label, not deleted redaction");
    await assertCandidate(env, owner, kind, source, "quest", target, title, false);

    // Setup and successful Quest Archive precede this full cross-domain baseline.
    await expectRpcRejection(env, owner, "attach_ao_context_v1", {
      p_command_id: id(), p_source_kind: kind, p_source_id: freshSource,
      p_expected_revision: "1", p_target_kind: "quest", p_target_id: target,
    }, subjects, "23514", label + ": fresh attach after archive", "AO contextual target not eligible");
    assert.equal(await evidenceSnapshot(env, subjects, archiveCommand), afterArchiveSnapshot,
      label + ": post-archive state retained after search/rejected attach");
    const finalView = await read();
    assert.deepEqual(finalView.root, beforeView.root, label + ": original root still intact");
    assert.deepEqual(finalView.contexts, archivedContexts, label + ": original link still projected");
    console.log("PASS: " + label + " retained link/projection, AO invariance, candidate exclusion and fresh-attach rollback");
  }
}

export async function exerciseAoBatchA(env,owner,other){
  assert.match(env.url,/^http:\/\/127\.0\.0\.1:\d+$/,"Only harness-owned disposable loopback");
  await timezoneRules(env,owner);
  await timezoneResidual(env,owner);
  await directJsonConstraints(env,owner);
  await questEligibility(env,owner,other);
  await questArchiveRetention(env,owner);
  console.log("PASS: Batch A scoped P0 tests QA-10/12/23; no business SQL, migration, release gating changed");
}
