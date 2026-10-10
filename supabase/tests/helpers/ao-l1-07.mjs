// L1-07 authorized, disposable-only owner/privacy/concurrent-session QA.
// This suite MUST run only after the pinned review SQL is applied in the
// fixture-owned tmpfs PostgreSQL/Auth/PostgREST environment. No external URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const uuid = () => randomUUID();
const questSecret = "L107_PRIVATE_DELETED_QUEST_TITLE";
function ok(response, label) {
  assert.equal(response.error, null, label + ": " +
    (response.error?.code ?? "unknown") + " " + (response.error?.message ?? ""));
  return response.data;
}
function denied(response, label) {
  assert(response.error, label + ": unauthorized call returned without error");
}
function noSecret(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes(questSecret), label + ": deleted Quest private title leaked");
}
async function call(client, name, args, label = name) {
  return ok(await client.rpc(name, args), label);
}

function deniedCallMatrix(oppId, activityId) {
  const id = uuid();
  return [
    ["create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:uuid(),p_fields:{title:"Not allowed"}}],
    ["update_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:oppId,p_expected_revision:"1",p_changes:{title:"Not allowed"}}],
    ["set_opportunity_stage_v1",{p_command_id:uuid(),p_opportunity_id:oppId,p_expected_revision:"1",p_stage:"preparing",p_kind:"advance",p_details:{}}],
    ["record_opportunity_outcome_v1",{p_command_id:uuid(),p_opportunity_id:oppId,p_expected_revision:"1",p_outcome:"pending",p_kind:"new_decision",p_details:{}}],
    ["set_opportunity_archived_v1",{p_command_id:uuid(),p_opportunity_id:oppId,p_expected_revision:"1",p_archived:true}],
    ["create_activity_v1",{p_command_id:uuid(),p_activity_id:uuid(),p_fields:{title:"Not allowed",intent:"confirmed_plan"}}],
    ["update_activity_v1",{p_command_id:uuid(),p_activity_id:activityId,p_expected_revision:"1",p_changes:{title:"Not allowed"}}],
    ["transition_activity_v1",{p_command_id:uuid(),p_activity_id:activityId,p_expected_revision:"1",p_action:"start",p_details:{}}],
    ["correct_activity_status_v1",{p_command_id:uuid(),p_activity_id:activityId,p_expected_revision:"1",p_target_status:"upcoming",p_correction:{}}],
    ["set_activity_archived_v1",{p_command_id:uuid(),p_activity_id:activityId,p_expected_revision:"1",p_archived:true}],
    ["set_activity_source_v1",{p_command_id:uuid(),p_activity_id:activityId,p_expected_revision:"1",p_expected_source_link_id:null,p_desired_opportunity_id:null,p_note:null}],
    ["attach_ao_context_v1",{p_command_id:uuid(),p_source_kind:"opportunity",p_source_id:oppId,p_expected_revision:"1",p_target_kind:"quest",p_target_id:id}],
    ["detach_ao_context_v1",{p_command_id:uuid(),p_source_kind:"opportunity",p_source_id:oppId,p_expected_revision:"1",p_target_kind:"quest",p_link_id:id}],
    ["get_opportunity_v1",{p_opportunity_id:oppId}],
    ["list_opportunities_v1",{p_scope:"active",p_filters:{},p_cursor:null,p_limit:50}],
    ["get_activity_v1",{p_activity_id:activityId}],
    ["list_activities_v1",{p_scope:"active",p_filters:{},p_cursor:null,p_limit:50}],
    ["list_ao_history_v1",{p_subject_kind:"opportunity",p_subject_id:oppId,p_cursor:null,p_limit:50}],
    ["search_ao_link_candidates_v1",{p_source_kind:"opportunity",p_source_id:oppId,p_target_kind:"quest",p_query:"safe",p_after_id:null,p_limit:50}],
    ["resolve_ao_command_v1",{p_command_id:id}],
  ];
}
export async function exerciseAoL107(env, owner, other, anon) {
  assert.match(env.url, /^http:\/\/127\.0\.0\.1:\d+$/, "L1-07 must use harness loopback gateway");

  const opponent = createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.equal((await opponent.auth.signInWithPassword({
    email:env.owner.email,password:env.owner.password
  })).error,null,"second owner login failed");

  const oppId=uuid(),actId=uuid();
  await call(owner,"create_opportunity_v1",{p_command_id:uuid(),p_opportunity_id:oppId,
    p_fields:{title:"L1-07 concurrent owner fixture"}},"create L1-07 Opportunity");
  await call(owner,"create_activity_v1",{p_command_id:uuid(),p_activity_id:actId,
    p_fields:{title:"L1-07 access fixture",intent:"confirmed_plan"}},"create L1-07 Activity");

  // Real Auth+PostgREST calls, valid named signatures for all 13 writes + 7 reads.
  const matrix=deniedCallMatrix(oppId,actId);
  assert.equal(matrix.length,20,"exact AO RPC catalog coverage");
  for(const [name,args] of matrix){
    const otherResult=await other.rpc(name,args);
    assert.equal(otherResult.error?.code,"42501",name+" must reject non-owner before domain code");
    const anonResult=await anon.rpc(name,args);
    denied(anonResult,name+" anonymous");
    noSecret(anonResult,name+" anonymous error");
    noSecret(otherResult,name+" non-owner error");
  }
  console.log("PASS: L1-07 all 20 RPCs deny nonowner/anon (real Auth/PostgREST)");

  // No direct raw AO table access even for the authenticated configured owner.
  for(const table of ["opportunities","activities","activity_source_links",
    "opportunity_goal_links","opportunity_quest_links","activity_goal_links",
    "activity_quest_links","opportunity_history","activity_history"]){
    for(const client of [owner,other,anon]){
      denied(await client.from(table).select("id").limit(1),table+" raw SELECT");
    }
  }
  console.log("PASS: L1-07 nine AO public tables deny raw SELECT");

  // Two separately authenticated owner clients, distinct HTTP/PostgREST requests.
  const first=uuid(),second=uuid();
  const writes=await Promise.all([
    owner.rpc("update_opportunity_v1",{p_command_id:first,p_opportunity_id:oppId,
      p_expected_revision:"1",p_changes:{title:"L107 race A"}}),
    opponent.rpc("update_opportunity_v1",{p_command_id:second,p_opportunity_id:oppId,
      p_expected_revision:"1",p_changes:{title:"L107 race B"}}),
  ]);
  const successes=writes.filter(x=>x.error===null),failures=writes.filter(x=>x.error!==null);
  assert.equal(successes.length,1,"two-session stale revision: exactly one accepted");
  assert.equal(failures.length,1,"two-session stale revision: exactly one rejected");
  assert.equal(failures[0].error.code,"23514","race loser must be stale revision");
  const root=await call(owner,"get_opportunity_v1",{p_opportunity_id:oppId});
  assert.equal(String(root.root.revision),"2","two-session race must increment revision once");
  const acceptedId=writes[0].error===null?first:second;
  const rejectedId=writes[0].error===null?second:first;
  assert.equal((await call(owner,"resolve_ao_command_v1",{p_command_id:acceptedId})).outcome,"recorded");
  assert.equal((await call(owner,"resolve_ao_command_v1",{p_command_id:rejectedId})).outcome,"unknown");
  console.log("PASS: L1-07 two-session owner concurrency serializes at revision and receipt");

  // Two independent connections racing an exact identical create command.
  const createdId=uuid(),commandId=uuid();
  const createArgs={p_command_id:commandId,p_opportunity_id:createdId,
    p_fields:{title:"L107 simultaneous same-id create"}};
  const same=await Promise.all([
    owner.rpc("create_opportunity_v1",createArgs),
    opponent.rpc("create_opportunity_v1",createArgs)
  ]);
  assert.equal(same.filter(x=>x.error===null).length,2,"identical concurrent command must succeed/replay");
  assert.deepEqual(same.map(x=>x.data.replay).sort(),[false,true]);
  assert.equal(await env.sql("SELECT count(*) FROM public.opportunities WHERE id='"+createdId+"'"),"1");
  assert.equal(await env.sql("SELECT count(*) FROM system_internal.ao_commands WHERE command_id='"+commandId+"'"),"1");
  console.log("PASS: L1-07 concurrent exact create replay yields one root and one receipt");

  // Privacy across delete: an AO context must not prevent the independent Quest
  // deletion, must retain its link, and must NEVER project protected Quest title.
  const quest=await call(owner,"create_one_off_quest",{
    command_id:uuid(),origin:"web_ui",
    request:{title:questSecret,scheduled_at:"2031-05-05T10:00:00Z",default_reward_exp:0}
  },"create synthetic private Quest");
  const attached=await call(owner,"attach_ao_context_v1",{
    p_command_id:uuid(),p_source_kind:"opportunity",p_source_id:oppId,
    p_expected_revision:"2",p_target_kind:"quest",p_target_id:quest.quest_id
  },"attach Quest context");
  assert.equal(attached.changed,true);
  const linkQuery="SELECT id FROM public.opportunity_quest_links WHERE opportunity_id='"+oppId+
    "' AND quest_id='"+quest.quest_id+"' AND detached_at IS NULL";
  const firstLink=await env.sql(linkQuery);
  assert.match(firstLink,/^[0-9a-f-]{36}$/);
  const deleted=await call(owner,"delete_one_off_quest_v1",{
    p_command_id:uuid(),p_quest_id:quest.quest_id,p_origin:"web_ui"
  },"delete attached synthetic Quest");
  assert(deleted,"Quest deletion returned no receipt");
  assert.equal(await env.sql("SELECT count(*) FROM public.opportunity_quest_links WHERE id='"+firstLink+"'"),"1");
  const detail=await call(owner,"get_opportunity_v1",{p_opportunity_id:oppId});
  noSecret(detail,"AO detail after Quest deletion");
  assert(JSON.stringify(detail.contexts).includes("Quest đã xóa"),
    "deleted Quest must use neutral placeholder");
  noSecret(await call(owner,"list_ao_history_v1",{
    p_subject_kind:"opportunity",p_subject_id:oppId,p_cursor:null,p_limit:50
  }),"AO history after Quest deletion");
  noSecret(await call(owner,"resolve_ao_command_v1",{
    p_command_id:acceptedId
  }),"AO receipt after Quest deletion");
  noSecret(await call(owner,"search_ao_link_candidates_v1",{
    p_source_kind:"opportunity",p_source_id:oppId,p_target_kind:"quest",
    p_query:"L107",p_after_id:null,p_limit:50
  }),"AO candidate search after Quest deletion");
  console.log("PASS: L1-07 real Quest Delete preserves AO link and redacts context/history/receipt/search");

  // Exact old-link replay must not detach a different current link.
  const detCmd=uuid();
  const detArgs={p_command_id:detCmd,p_source_kind:"opportunity",p_source_id:oppId,
    p_expected_revision:"3",p_target_kind:"quest",p_link_id:firstLink};
  const det=await call(owner,"detach_ao_context_v1",detArgs,"detach L1");
  assert.equal(det.changed,true);
  // Deleted Quest cannot be newly attached: use a separate still-live Quest.
  const live=await call(owner,"create_one_off_quest",{
    command_id:uuid(),origin:"web_ui",
    request:{title:"L107 neutral live Quest",scheduled_at:"2031-05-06T10:00:00Z",default_reward_exp:0}
  },"create second synthetic Quest");
  const reattach=await call(owner,"attach_ao_context_v1",{
    p_command_id:uuid(),p_source_kind:"opportunity",p_source_id:oppId,
    p_expected_revision:"4",p_target_kind:"quest",p_target_id:live.quest_id
  },"attach new L2");
  assert.equal(reattach.changed,true);
  const replay=await call(opponent,"detach_ao_context_v1",detArgs,"replay previous detach L1");
  assert.equal(replay.replay,true);
  assert.equal(await env.sql("SELECT count(*) FROM public.opportunity_quest_links WHERE opportunity_id='"+
    oppId+"' AND quest_id='"+live.quest_id+"' AND detached_at IS NULL"),"1");
  console.log("PASS: L1-07 old detach replay retains newer live link");
}
