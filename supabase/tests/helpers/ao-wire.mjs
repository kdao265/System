// L1-05 FUTURE WIRE TEST. Not run; needs separately authorized disposable Auth/PostgREST/PG.
// The env and clients MUST be created by tests/helpers/auth-environment.mjs. No external URL accepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function privateBoundary(value, label) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ['private deleted Quest content', 'secret deleted Quest reward'])
    assert(!serialized.includes(forbidden), `${label}: deleted Quest data leaked`);
}
function good(response, label) {
  assert.equal(response.error, null, `${label}: ${response.error?.code ?? 'unknown'} ${response.error?.message ?? ''}`);
  return response.data;
}
function revision(actual, expected) { assert.equal(actual, String(expected)); }
function isDenied(response) { return response.error !== null || response.data === null; }

export async function exerciseAoWire(env, owner, other, anon) {
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(env.url), 'Only isolated fixture gateway allowed');
  const invoke = (name, args) => owner.rpc(name,args);
  const oppId=randomUUID(), opCmd=randomUUID();
  const createOpp={p_command_id:opCmd,p_opportunity_id:oppId,p_fields:{title:'AO synthetic fellowship'}};
  const created=good(await invoke('create_opportunity_v1',createOpp),'create opportunity');
  assert.equal(created.changed,true);revision(created.revision_after,1);
  const afterCreate=good(await invoke('get_opportunity_v1',{p_opportunity_id:oppId}),'get opportunity');
  assert.equal(afterCreate.root.id,oppId);
  assert.equal(afterCreate.root.user_id,undefined);
  // R-01: multiline Closed note, normalized to LF by stage action, survives CHECK.
  // Historical root metadata and no-op checks are handled by SQL value corpus.
  const multilineOpp=randomUUID();
  good(await invoke('create_opportunity_v1',{
    p_command_id:randomUUID(),p_opportunity_id:multilineOpp,
    p_fields:{title:'AO multiline Closed',tracking_stage:'closed',
      closed_reason:'other',closed_note:'Line 1\r\nLine 2'}}),'create multiline Closed');
  assert.equal(good(await invoke('get_opportunity_v1',{p_opportunity_id:multilineOpp}),
    'get multiline Closed').root.closed_note,'Line 1\nLine 2');
  // The stage transition path must normalize Closed note as well as creation.
  const stageOpp=randomUUID();
  good(await invoke('create_opportunity_v1',{
    p_command_id:randomUUID(),p_opportunity_id:stageOpp,p_fields:{title:'Stage multiline'}}),
    'create stage multiline');
  const stageCmd=randomUUID();
  const stageParams={p_command_id:stageCmd,p_opportunity_id:stageOpp,p_expected_revision:'1',
    p_stage:'closed',p_kind:'advance',
    p_details:{closed_reason:'other',closed_note:'Step 1\r\nStep 2'}};
  const stageReceipt=good(await invoke('set_opportunity_stage_v1',stageParams),'Closed stage multiline');
  assert.equal(stageReceipt.changed,true);
  assert.equal(good(await invoke('get_opportunity_v1',{p_opportunity_id:stageOpp}),
    'Closed stage read').root.closed_note,'Step 1\nStep 2');
  // R-07: equivalent normalized intent with identical command identity is replay,
  // not a 23505 collision or a second accepted domain transition.
  const stageReplay=good(await invoke('set_opportunity_stage_v1',{
    ...stageParams,p_details:{...stageParams.p_details,closed_note:'Step 1\nStep 2'}
  }),'canonicalized Closed stage replay');
  assert.equal(stageReplay.replay,true);
  assert.equal(stageReplay.revision_after,stageReceipt.revision_after);
  assert.equal((await invoke('set_opportunity_stage_v1',{
    ...stageParams,p_details:{...stageParams.p_details,closed_note:'Different meaning'}
  })).error?.code,'23505','different canonical note must collide');


  const editCmd=randomUUID();
  const change={p_command_id:editCmd,p_opportunity_id:oppId,p_expected_revision:'1',p_changes:{title:'AO synthetic updated'}};
  const update=good(await invoke('update_opportunity_v1',change),'update opportunity');
  revision(update.revision_after,2);
  const replayCreate=good(await invoke('create_opportunity_v1',createOpp),'create replay after edit');
  assert.equal(replayCreate.replay,true);
  revision(replayCreate.revision_after,1);
  const conflict=await invoke('create_opportunity_v1',{...createOpp,p_fields:{title:'Malicious reused command'}});
  assert.equal(conflict.error?.code,'23505','same command ID + different intent must reject');
  const stale=await invoke('update_opportunity_v1',{...change,p_command_id:randomUUID()});
  assert.equal(stale.error?.code,'23514','new stale command must reject');
  const accepted=good(await invoke('resolve_ao_command_v1',{p_command_id:opCmd}),'receipt read');
  assert.equal(accepted.outcome,'recorded');
  privateBoundary(accepted,'receipt');
  const missing=good(await invoke('resolve_ao_command_v1',{p_command_id:randomUUID()}),'unknown receipt');
  assert.equal(missing.outcome,'unknown','missing receipt cannot mean a confirmed rejection');
  const archiveCmd=randomUUID();
  const archiveArgs={p_command_id:archiveCmd,p_opportunity_id:oppId,p_expected_revision:'2',p_archived:true};
  good(await invoke('set_opportunity_archived_v1',archiveArgs),'archive opportunity');
  const archived=good(await invoke('get_opportunity_v1',{p_opportunity_id:oppId}),'get archived');
  assert(archived.root.archived_at);
  assert((await invoke('update_opportunity_v1',{
    p_command_id:randomUUID(),p_opportunity_id:oppId,p_expected_revision:'3',p_changes:{title:'Disallowed'}})).error);
  assert.equal(good(await invoke('set_opportunity_archived_v1',archiveArgs),'archive replay').replay,true);

  const actId=randomUUID(),actCmd=randomUUID();
  const createAct={p_command_id:actCmd,p_activity_id:actId,p_fields:{title:'AO synthetic activity',intent:'confirmed_plan'}};
  const made=good(await invoke('create_activity_v1',createAct),'create activity');
  revision(made.revision_after,1);
  const current=good(await invoke('get_activity_v1',{p_activity_id:actId}),'read activity');
  assert.equal(current.root.status,'upcoming');
  assert(current.root.participation_confirmed_at,'confirmed_plan should have DB-owned timestamp');
  // R-02: Activity multiline confirmation note must survive table CHECK as LF.
  const multilineAct=randomUUID();
  good(await invoke('create_activity_v1',{
    p_command_id:randomUUID(),p_activity_id:multilineAct,
    p_fields:{title:'AO multiline Activity',intent:'confirmed_plan',
      confirmation_note:'Attend\r\nPresent'}}),'create multiline confirmation');
  assert.equal(good(await invoke('get_activity_v1',{p_activity_id:multilineAct}),
    'get multiline confirmation').root.confirmation_note,'Attend\nPresent');

  const srcCmd=randomUUID();
  const source=good(await invoke('set_activity_source_v1',{
    p_command_id:srcCmd,p_activity_id:actId,p_expected_revision:'1',
    p_expected_source_link_id:null,p_desired_opportunity_id:null,p_note:null,
  }),'no-op source');
  assert.equal(source.changed,false);

  // R-03: derived list is an explicit bounded preview, even when currently empty.
  const preview=good(await invoke('get_opportunity_v1',{p_opportunity_id:oppId}),'derived preview').derived_activities;
  assert.deepEqual(preview,{items:[],has_more:false,continuation:null});

  // Bound filters: NULL may NOT disable SQL LIMIT; test default and invalid page sizes.
  const listArgs={p_scope:'active',p_filters:{},p_cursor:null,p_limit:50};
  const listed=good(await invoke('list_activities_v1',listArgs),'list activities');
  assert.equal(listed.version,1); assert(Array.isArray(listed.items));
  assert(listed.items.length<=50);
  assert((await invoke('list_activities_v1',{...listArgs,p_limit:null})).error);
  assert((await invoke('list_activities_v1',{...listArgs,p_limit:101})).error);
  // R-04: malformed filter must produce a stable validation error, not a UUID cast trace.
  const malformedSource=await invoke('list_activities_v1',{
    ...listArgs,p_filters:{source_opportunity_id:'not-a-uuid'}});
  assert.equal(malformedSource.error?.code,'22023');
  const wrongTypeSource=await invoke('list_activities_v1',{
    ...listArgs,p_filters:{source_opportunity_id:42}});
  assert.equal(wrongTypeSource.error?.code,'22023');

  // F-01: list DTO must match explicit allowlist, not only an identity cursor.
  const activityCard=listed.items.find(item=>item.id===actId);
  assert(activityCard,'created Activity must appear in the owner list');
  assert.equal(activityCard.title,'AO synthetic activity');
  assert.equal(activityCard.status,'upcoming');
  assert.equal(activityCard.organization,null);
  assert.equal(activityCard.category,null);
  assert(!Object.hasOwn(activityCard,'notes'),'do not leak full root notes in list cards');
  const archivedOppList=good(await invoke('list_opportunities_v1',
    {p_scope:'archived',p_filters:{},p_cursor:null,p_limit:50}),'list archived opportunities');
  const opportunityCard=archivedOppList.items.find(item=>item.id===oppId);
  assert(opportunityCard,'archived Opportunity must appear in owner archived list');
  assert.equal(opportunityCard.title,'AO synthetic updated');
  assert.equal(opportunityCard.tracking_stage,'saved');
  assert.equal(opportunityCard.selection_outcome,'unknown');
  assert(!Object.hasOwn(opportunityCard,'description'));
  privateBoundary(good(await invoke('get_activity_v1',{p_activity_id:actId}),'get activity'),'activity');

  // F-02: a date can be explicitly cleared, and repeating the same clear is a no-op.
  const decisionId=randomUUID();
  const explicitDate={precision:'day',year:2026,month:10,day:10};
  good(await invoke('create_opportunity_v1',{
    p_command_id:randomUUID(),p_opportunity_id:decisionId,
    p_fields:{title:'Synthetic date-clear opportunity',decision_at:explicitDate}}),'create dated opportunity');
  const clearDecision=good(await invoke('record_opportunity_outcome_v1',{
    p_command_id:randomUUID(),p_opportunity_id:decisionId,p_expected_revision:'1',
    p_outcome:'pending',p_kind:'new_decision',p_details:{decision_at:null}
  }),'clear Opportunity decision date');
  assert.equal(clearDecision.changed,true);revision(clearDecision.revision_after,2);
  const clearedDecision=good(await invoke('get_opportunity_v1',{p_opportunity_id:decisionId}),'read decision clear');
  assert.equal(clearedDecision.root.decision_at,null,'JSON null must persist as SQL NULL');
  const repeatDecision=good(await invoke('record_opportunity_outcome_v1',{
    p_command_id:randomUUID(),p_opportunity_id:decisionId,p_expected_revision:'2',
    p_outcome:'pending',p_kind:'correction',p_details:{decision_at:null}
  }),'repeat decision date clear');
  assert.equal(repeatDecision.changed,false);revision(repeatDecision.revision_after,2);

  const correctionId=randomUUID();
  good(await invoke('create_activity_v1',{
    p_command_id:randomUUID(),p_activity_id:correctionId,
    p_fields:{title:'Synthetic actual-date correction',intent:'confirmed_started'}}),'create correction Activity');
  good(await invoke('correct_activity_status_v1',{
    p_command_id:randomUUID(),p_activity_id:correctionId,p_expected_revision:'1',
    p_target_status:'ongoing',p_correction:{actual_start:explicitDate,actual_end:explicitDate}
  }),'set actual dates');
  const clearActual=good(await invoke('correct_activity_status_v1',{
    p_command_id:randomUUID(),p_activity_id:correctionId,p_expected_revision:'2',
    p_target_status:'upcoming',p_correction:{actual_start:null,actual_end:null,reason:'Sửa trạng thái đã nhập nhầm'}
  }),'clear both actual dates');
  assert.equal(clearActual.changed,true);revision(clearActual.revision_after,3);
  const actualRoot=good(await invoke('get_activity_v1',{p_activity_id:correctionId}),'read actual dates clear');
  assert.equal(actualRoot.root.actual_start,null);
  assert.equal(actualRoot.root.actual_end,null);
  // R-06: correction reason must be visible through owner-scoped history API.
  const correctionHistory=good(await invoke('list_ao_history_v1',{
    p_subject_kind:'activity',p_subject_id:correctionId,p_cursor:null,p_limit:50
  }),'list correction history');
  assert(correctionHistory.items.some(item => item.event_type==='correct_activity_status_v1'
    && item.reason==='Sửa trạng thái đã nhập nhầm'),'correction reason missing from immutable history');
  privateBoundary(correctionHistory,'correction history');
  const repeatActual=good(await invoke('correct_activity_status_v1',{
    p_command_id:randomUUID(),p_activity_id:correctionId,p_expected_revision:'3',
    p_target_status:'upcoming',p_correction:{actual_start:null,actual_end:null}
  }),'repeat both actual clears');
  assert.equal(repeatActual.changed,false);revision(repeatActual.revision_after,3);

  for (const [name,args] of [
    ['get_opportunity_v1',{p_opportunity_id:oppId}],
    ['resolve_ao_command_v1',{p_command_id:opCmd}],
    ['list_opportunities_v1',{p_scope:'active',p_filters:{},p_cursor:null,p_limit:50}],
    ['create_opportunity_v1',{p_command_id:randomUUID(),p_opportunity_id:randomUUID(),p_fields:{title:'Unauthorized'}}],
  ]) for(const client of [other,anon]) {
    const response=await client.rpc(name,args);
    assert(isDenied(response) || (name.startsWith('list_')&&response.data?.items?.length===0),`${name}: other/anon leaked`);
  }

  // Confirm commit-then-lost-response by intercepting a *fixture-owned* HTTP response.
  const token=(await owner.auth.getSession()).data.session?.access_token;
  assert(token,'disposable owner auth token missing');
  let dropped=false;
  const lossy=createClient(env.url,env.key,{accessToken:async()=>token,global:{fetch:async(url,opts)=>{
    const response=await fetch(url,opts);
    assert(response.ok,'loss test must first get committed response');
    await response.arrayBuffer();dropped=true;
    throw new TypeError('Synthetic response lost after successful commit');
  }}});
  const lateId=randomUUID(), lateCmd=randomUUID();
  const late={p_command_id:lateCmd,p_opportunity_id:lateId,p_fields:{title:'lost acknowledgement'}};
  assert((await lossy.rpc('create_opportunity_v1',late)).error);
  assert(dropped);
  const original=good(await invoke('resolve_ao_command_v1',{p_command_id:lateCmd}),'resolve after lost HTTP');
  assert.equal(original.outcome,'recorded');
  assert.equal(good(await invoke('create_opportunity_v1',late),'exact retry').replay,true);
  return {passedScopes:['owner','nonowner','anon','replay','stale','identity-reuse','archive','list-bounds','lost-response']};
}
