// REVIEW-ONLY. Pure string/structure checks; never execute SQL or start containers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./sql/REVIEW_ONLY_create_activities_opportunities_v1.sql', import.meta.url), 'utf8');
const tables = [
  'public.opportunities','public.activities','public.activity_source_links',
  'public.opportunity_goal_links','public.opportunity_quest_links',
  'public.activity_goal_links','public.activity_quest_links',
  'public.opportunity_history','public.activity_history','system_internal.ao_commands',
];
const writes = [
  'create_opportunity_v1','update_opportunity_v1','set_opportunity_stage_v1',
  'record_opportunity_outcome_v1','set_opportunity_archived_v1',
  'create_activity_v1','update_activity_v1','transition_activity_v1',
  'correct_activity_status_v1','set_activity_archived_v1',
  'set_activity_source_v1','attach_ao_context_v1','detach_ao_context_v1',
];
const reads = [
  'get_opportunity_v1','list_opportunities_v1','get_activity_v1',
  'list_activities_v1','list_ao_history_v1',
  'search_ao_link_candidates_v1','resolve_ao_command_v1',
];
const matches = regex => [...source.matchAll(regex)];

test('release blocker intentionally prevents applying review-only SQL', () => {
  assert.match(source.slice(0,1000), /RAISE EXCEPTION 'BLOCKED: AO G-01 refinement review-only/);
  assert(source.indexOf("RAISE EXCEPTION 'BLOCKED:") < source.indexOf('CREATE TABLE public.opportunities'));
  assert.match(source, /USING ERRCODE = '0A000'/);
});
test('only 10 explicitly approved AO tables are created', () => {
  assert.deepEqual(matches(/\bCREATE TABLE\s+([\w.]+)/g).map(x=>x[1]).sort(),[...tables].sort());
});
test('exactly 13 mutation RPC and seven read RPC names', () => {
  assert.deepEqual(matches(/\bCREATE FUNCTION public\.(\w+)\(/g).map(x=>x[1]).sort(),[...writes,...reads].sort());
});
test('RLS enabled for every AO table', () => {
  for (const table of tables) assert(source.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`),table);
});
test('configured-owner restrictive policies cover every AO table', () => {
  for(const table of tables) assert(source.includes(`CREATE POLICY system_single_owner ON ${table} AS RESTRICTIVE`), table);
});
test('private AO executor has no login/bypass RLS, no cross-domain writes',()=>{
  assert.match(source,/CREATE ROLE ao_command_owner\s+NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
  assert.doesNotMatch(source,/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:quests|quest_occurrences|quest_events|goal_quest_links|goals|exp_ledger|schedule_events)\b/i);
});
test('fixed public names and no dynamic SQL dispatcher',()=>{
  for(const name of writes) assert(source.includes(`system_internal.ao_run_v1('${name}',`), name);
  assert.doesNotMatch(source,/CREATE FUNCTION public\.execute_ao_command/i);
});
test('transaction-wide owner lock before accepted-command lookup and row locks',()=>{
  const segment = source.slice(source.indexOf('CREATE FUNCTION system_internal.ao_run_v1'),source.indexOf('CREATE FUNCTION system_internal.ao_require_context_target_v1'));
  assert(segment.indexOf('progression_internal.lock_owner(v_actor)') < segment.indexOf('SELECT * INTO v_prior'));
  assert(segment.indexOf('SELECT * INTO v_prior') < segment.indexOf('FOR UPDATE'));
});
test('accepted replay checks canonical request; immutable command/history DDL',()=>{
  assert(source.includes('v_prior.canonical_request IS DISTINCT FROM'));
  assert(source.includes("RETURN v_prior.result || jsonb_build_object('replay',true)"));
  for(const table of ['system_internal.ao_commands','public.opportunity_history','public.activity_history'])
    assert(source.includes(`CREATE TABLE ${table}`),table);
  assert(source.includes('DEFERRABLE INITIALLY DEFERRED'));
});
test('historical link intervals and unique current links',()=>{
  for(const t of tables.filter(x=>x.endsWith('_links'))) {
    assert(source.includes(`CREATE TABLE ${t}`));
    assert(source.includes(`BEFORE UPDATE OR DELETE ON ${t}`), t);
  }
  assert(source.includes('WHERE id=v_link'));
});
test('deleted Quest projection uses a fixed neutral placeholder',()=>{
  assert(source.includes("'deleted', true, 'label', 'Quest đã xóa'"));
  assert(source.includes('system_internal.ao_quest_safe_label_v1'));
});
test('AO public RPCs have security-definer and explicit ACL declaration',()=>{
  for (const name of [...writes,...reads]) {
    assert(source.includes(`ALTER FUNCTION public.${name}(`),name);
    assert(source.includes(`GRANT EXECUTE ON FUNCTION public.${name}(`),name);
  }
  assert.equal(matches(/\bSECURITY DEFINER SET search_path=pg_catalog AS \$fn\$/g).length>=20,true);
});
test('no historical migration/Quest engine SQL replacements',()=>{
  assert.doesNotMatch(source,/\bCREATE OR REPLACE\b|\bDROP TABLE\b|\bDROP FUNCTION\b/i);
});
test('latest G-01 has an IANA/UTC resolver while retaining the unconditional release guard',()=>{
  assert(source.includes('CREATE FUNCTION system_internal.ao_deadline_spec_valid_v1('));
  assert(source.includes('CREATE FUNCTION system_internal.ao_deadline_resolve_v1('));
  assert(source.includes('pg_catalog.pg_timezone_names'));
  assert(source.includes('AT TIME ZONE zone_text'));
  assert.doesNotMatch(source,/IF p = 'instant' THEN RETURN false/);
});
test('pagination disallows NULL sizes and implements overflow keyset',()=>{
  assert(source.includes('p_limit IS NULL'));
  assert(source.includes('v_has_extra:=true'));
});


// F-01/F-02 regression assertions target THIS exact SQL candidate, not prior handoffs.
function extractListBuilders(sql) {
  const body=sql.slice(sql.indexOf('CREATE FUNCTION system_internal.ao_read_list_v1('),
    sql.indexOf('CREATE FUNCTION public.get_opportunity_v1('));
  assert(body.length>2500,'missing AO list function');
  const builders=[...body.matchAll(/result_row:=jsonb_build_object\(([\s\S]*?)\);/g)].map(m=>m[1]);
  assert.equal(builders.length,2,'must have exactly two root list builders');
  return builders;
}
function assertCompleteAllowlist(sql) {
  const [op,act]=extractListBuilders(sql);
  for(const k of ['title','category','organization','tracking_stage','selection_outcome'])
    assert(op.includes(`'${k}',rec.${k}`),`opportunity list missing ${k}`);
  for(const k of ['title','category','organization','status'])
    assert(act.includes(`'${k}',rec.${k}`),`activity list missing ${k}`);
  for(const builder of [op,act]) {
    assert.doesNotMatch(builder,/\b(?:to_jsonb\(rec\)|row_to_json\(rec\)|'notes'|'description'|'eligibility_notes'|'benefits_notes')/);
    for(const k of ['id','revision','archived_at','created_at','updated_at'])
      assert(builder.includes(`'${k}',rec.${k}`)||k==='revision'&&builder.includes("'revision',rec.revision::text"),k);
  }
}
function assertNullableCorrection(sql) {
  for(const field of ['decision_at','actual_start','actual_end']){
    const clean=`NULLIF(v_detail->'${field}','null'::jsonb)`;
    assert(sql.includes(`ao_partial_valid_v1(${clean})`),`${field}: explicit JSON null must validate`);
    assert(sql.includes(`IS DISTINCT FROM ${clean}`),`${field}: revision must compare normalized SQL NULL`);
    assert(sql.includes(`THEN ${clean} ELSE ${field} END`),`${field}: update must write SQL NULL`);
  }
}
test('F-01: allowlisted root-list DTO includes required display fields, no notes',()=>{
  assertCompleteAllowlist(source);
});
test('F-02: date corrections normalize JSON null consistently in validation/change/write',()=>{
  assertNullableCorrection(source);
});
test('F-01 negative mutation: removing a root display field fails static contract',()=>{
  assert.throws(()=>assertCompleteAllowlist(source.replace("'tracking_stage',rec.tracking_stage,",'')));
});
test('F-02 negative mutation: old direct JSON null write fails static contract',()=>{
  assert.throws(()=>assertNullableCorrection(source.replace("THEN NULLIF(v_detail->'actual_start','null'::jsonb) ELSE actual_start END",
    "THEN v_detail->'actual_start' ELSE actual_start END")));
});


// R-01 through R-05 regressions. Source-only checks, never assert PostgreSQL PASS.
function checkMultilineContracts(sql) {
  for(const f of ['closed_note','confirmation_note'])
    assert(sql.includes(`ao_text_valid_v1(${f},2000,false,true)`),`${f} root multiline constraint`);
  assert.match(sql,/is_long:=\s*k=ANY\(ARRAY\[[^\]]*'closed_note'/);
  assert.match(sql,/v_stage_note:=replace\(replace\(v_stage_note,E'\\r\\n',E'\\n'\),E'\\r',E'\\n'\)/);
  assert.match(sql,/v_stage_note,2000,false,true/);
  assert.match(sql,/closed_note=CASE WHEN v_stage='closed' THEN v_stage_note ELSE NULL END/);
}
test('R-01/R-02 SQL multiline constraints and lifecycle normalization match TS',()=>checkMultilineContracts(source));
test('R-01/R-02 negative mutation: old single-line constraint rejected',()=>{
  assert.throws(()=>checkMultilineContracts(source.replace('ao_text_valid_v1(confirmation_note,2000,false,true)',
    'ao_text_valid_v1(confirmation_note,2000,false,false)')));
  assert.throws(()=>checkMultilineContracts(source.replace('v_stage_note,2000,false,true',
    'v_stage_note,2000,false,false')));
});
function checkPreview(sql){
  const body=sql.slice(sql.indexOf('CREATE FUNCTION system_internal.ao_derived_activities_v1'),
    sql.indexOf('-- Post-definition ACLs;'));
  assert.match(body,/LIMIT 51/);
  assert.match(body,/LIMIT 50/);
  assert.match(body,/'items'/);
  assert.match(body,/'has_more'/);
  assert.match(body,/'continuation'/);
  assert.match(body,/'source_opportunity_id',p_opportunity_id/);
  assert.match(body,/'scopes',jsonb_build_array\('active','archived'\)/);
}
test('R-03 bounded preview explicitly signals truncation and separate-scope continuation',()=>checkPreview(source));
test('R-03 negative mutation: dropped has_more rejected',()=>{
  const body=source.slice(source.indexOf('CREATE FUNCTION system_internal.ao_derived_activities_v1'),
    source.indexOf('-- Post-definition ACLs;'));
  assert.throws(()=>checkPreview(source.replace(body,body.replace("'has_more',", "'limited',"))));
});
function checkUuidFilter(sql) {
  const body=sql.slice(sql.indexOf('CREATE FUNCTION system_internal.ao_read_list_v1'),
    sql.indexOf('CREATE FUNCTION public.get_opportunity_v1'));
  assert.match(body,/source_opportunity_id'\) !~\* '\^\[0-9a-f\]\{8\}/);
  const validated=body.indexOf("'source_opportunity_id') !~*");
  const cast=body.indexOf("'source_opportunity_id')::uuid");
  assert(validated>0&&cast>validated,'UUID shape guard before PostgreSQL cast');
}
test('R-04 malformed source UUID is guarded before cast',()=>checkUuidFilter(source));
test('R-04 negative mutation: missing shape check rejected',()=>{
  assert.throws(()=>checkUuidFilter(source.replace("'source_opportunity_id') !~*", "'source_opportunity_id') /* missing */ !~*")));
});
function checkCursorVolatility(sql){
  const start=sql.indexOf('CREATE FUNCTION system_internal.ao_cursor_v1');
  const end=sql.indexOf('CREATE FUNCTION system_internal.ao_read_list_v1');
  const body=sql.slice(start,end);
  assert.match(body,/RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER/);
  assert.doesNotMatch(body,/LANGUAGE plpgsql IMMUTABLE/);
  assert.match(body,/invalid_datetime_format OR datetime_field_overflow/);
}
test('R-05 timestamptz cursor validator is STABLE and maps malformed time to 22023',()=>checkCursorVolatility(source));
test('R-05 negative mutation: IMMUTABLE cursor rejected',()=>{
  assert.throws(()=>checkCursorVolatility(source.replace('CREATE FUNCTION system_internal.ao_cursor_v1(p_cursor jsonb,p_date_field text)\nRETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER',
    'CREATE FUNCTION system_internal.ao_cursor_v1(p_cursor jsonb,p_date_field text)\nRETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER')));
});
