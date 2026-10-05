// All database writes are confined to a new UUID-labelled disposable environment.
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {before,after,test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {startAuthEnvironment} from '../../tests/helpers/auth-environment.mjs';
import {buildDataset,dataSql,footerState,quote,source} from './helpers/system-timezone-dataset.mjs';
import {parseFooter,civilFromDays,daysFromCivil} from './helpers/system-timezones.mjs';
import {decodeOracle,oracleOffset,oracleResolve,oracleRule,tzifFixture} from './helpers/system-timezone-oracle.mjs';
let env,owner,release,legacyBefore,legacyId;
const d=buildDataset();
const json=x=>quote(JSON.stringify(x))+'::jsonb';
const day='2035-06-01';
const claims=user=>`SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true); SELECT set_config('request.jwt.claim.sub','${user}',true);`;
const rpc=async(name,args={})=>{const r=await owner.rpc(name,args);assert.equal(r.error,null,`${name}: ${r.error?.message}`);return r.data;};
const profile=async name=>{const r=await owner.from('profiles').update({timezone:name}).eq('user_id',env.owner.id);assert.equal(r.error,null);};
const create=async(extra={})=>rpc('create_recurring_quest_v2',{command_id:id(),origin:'web_ui',request:{title:'Timezone acceptance',recurrence_mode:'daily',start_date:day,...extra}});
const archive=async q=>rpc('set_recurring_quest_archived_v1',{p_command_id:id(),p_quest_id:q,p_archived:true,p_origin:'web_ui'});
const materialize=p_day=>rpc('materialize_quest_day_v2',{p_day});
const rows=async q=>JSON.parse(await env.sql(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY source_slot_date),'[]') FROM public.quest_occurrences o WHERE quest_id='${q}'`));
const lookup=async(z,L)=>JSON.parse(await env.sql(`SELECT row_to_json(r) FROM system_internal.resolve_recurring_local_v1(${quote(L)}::timestamp,${quote(z)}) r`));
before(async()=>{
 env=await startAuthEnvironment({buildApp:false,beforeRecurringSchedule:async({sql,owner:user})=>{
  await sql(`UPDATE public.profiles SET timezone='UTC' WHERE user_id='${user.id}';`);
  legacyId=JSON.parse(await sql(`BEGIN;${claims(user.id)} SET LOCAL ROLE authenticated;
   SELECT to_jsonb(public.create_recurring_quest('${id()}',${json({title:'Before timezone migration',recurrence_mode:'daily',start_date:day})},'web_ui'));COMMIT;`).then(s=>s.split('\n').find(s=>s.startsWith('{')&&s.includes('quest_id')))).quest_id;
  await sql(`BEGIN;${claims(user.id)} SET LOCAL ROLE authenticated;SELECT public.materialize_quest_day('${day}');COMMIT;`);
  legacyBefore=await sql(`SELECT to_jsonb(o) FROM public.quest_occurrences o WHERE quest_id='${legacyId}';`);
 }});
 owner=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});assert.equal((await owner.auth.signInWithPassword(env.owner)).error,null);
 release=await env.sql('SELECT system_internal.tzdb_active_release_v1();');
 const policy=await owner.from('level_policies').select('id').eq('policy_key','level_policy_v1').single();assert.equal(policy.error,null);
 const grant=id();await env.sql(`INSERT INTO system_internal.operator_grants(id,user_id,capability) VALUES('${grant}','${env.owner.id}','level_policy_assign')`);
 await rpc('assign_level_policy',{target_user_id:env.owner.id,policy_id:policy.data.id,command_id:id(),origin:'internal'});
 await env.sql(`UPDATE system_internal.operator_grants SET revoked_at=now() WHERE id='${grant}'`);
});
after(async()=>{owner?.auth.stopAutoRefresh();await env?.close();});

test('populated migration preserves occurrences byte-for-byte, adds only NULL provenance',async()=>{
 const [o]=await rows(legacyId);assert.equal(o.source_tzdb_release_id,null);delete o.source_tzdb_release_id;
 assert.deepEqual(o,JSON.parse(legacyBefore));await archive(legacyId);
});

test('all 598 zones: historical UTC boundaries match independent raw TZif oracle',async()=>{
 const cases=[];
 for(const z of source.zones){const raw=decodeOracle(z.hex);
  for(const [t] of raw.transitions)for(const delta of [-1,0,1])cases.push([z.name,t+delta,oracleOffset(raw,t+delta)]);
 }
 for(let i=0;i<cases.length;i+=1200){const batch=cases.slice(i,i+1200);
  const got=JSON.parse(await env.sql(`WITH inputs AS MATERIALIZED(SELECT * FROM (VALUES ${batch.map(([z,u],n)=>`(${n},${quote(z)},${u}::bigint)`).join(',')}) v(n,z,u)),
   contexts AS MATERIALIZED(SELECT z,system_internal.tzdb_context_v1(${quote(release)},z) c FROM (SELECT DISTINCT z FROM inputs) x)
   SELECT jsonb_agg(jsonb_build_array(i.n,s.offset_seconds,s.specified) ORDER BY i.n) FROM inputs i JOIN contexts c USING(z)
   CROSS JOIN LATERAL system_internal.tzdb_offset_at_v1(c.c,to_timestamp(i.u)) s;`));
  for(const [n,o,s] of got)assert.deepEqual({offset:o,specified:s},batch[n][2],batch[n][0]+':'+batch[n][1]);
 }
 console.log(`SQL/raw TZif historical checks: ${cases.length}`);
});

test('future SQL resolution: independent boundaries for every DST zone plus full-range samples',async()=>{
 const cases=[];
 for(const z of source.zones){const raw=decodeOracle(z.hex);const parsed=d.zones.find(x=>x.name===z.name);
  if(parsed.rule[0]==='dst')for(const y of [2050,2400,9999]){
   const [,a,b]=raw.footer.split(',');for(const r of [a,b])for(const delta of [-1,0,1]){
    const L=oracleRule(r,y)+delta;cases.push([z.name,L,oracleResolve(raw,L)]);
   }
  }
  for(const L of [daysFromCivil(1,1,1)*86400,daysFromCivil(9999,12,31)*86400+86399])cases.push([z.name,L,oracleResolve(raw,L)]);
 }
 for(let i=0;i<cases.length;i+=600){const batch=cases.slice(i,i+600);
  const got=JSON.parse(await env.sql(`WITH inputs AS MATERIALIZED(SELECT * FROM (VALUES ${batch.map(([z,L],n)=>`(${n},${quote(z)},${L}::bigint)`).join(',')}) v(n,z,L)),
   contexts AS MATERIALIZED(SELECT z,system_internal.tzdb_context_v1(${quote(release)},z) c FROM (SELECT DISTINCT z FROM inputs) x)
   SELECT jsonb_agg(jsonb_build_array(i.n,r.classification,extract(epoch FROM r.instant)::bigint) ORDER BY i.n)
   FROM inputs i JOIN contexts c USING(z) CROSS JOIN LATERAL system_internal.tzdb_resolve_v1(c.c,to_timestamp(i.L) AT TIME ZONE 'UTC') r;`));
  for(const [n,c,u] of got)assert.deepEqual({classification:c,instant:u},batch[n][2],batch[n][0]+':'+batch[n][1]);
 }
 console.log(`SQL independent future/local-range checks: ${cases.length}`);
});

test('SQL synthetic POSIX grammar, leap rules, signed clocks and astronomical years',async()=>{
 const probes=[];for(const y of [-1,0,1,1900,2023,2024,9999,10000,10002])for(const r of ['J59','J60','J61','59','60','365','M2.5.0','M3.5.0/-1','M3.4.4/26','M3.4.4/50','M12.5.6/167:59:59']){
  const {parseRule}=await import('./helpers/system-timezones.mjs');const p=parseRule(r);probes.push([[p.kind,p.month??0,p.week??0,p.weekday??0,p.day??0,p.shift],y,oracleRule(r,y)]);
 }
 const got=JSON.parse(await env.sql(`SELECT jsonb_agg(system_internal.tzdb_rule_seconds_v1(r,y) ORDER BY n) FROM (VALUES ${probes.map(([r,y],n)=>`(${json(r)},${y},${n})`).join(',')}) v(r,y,n)`));
 assert.deepEqual(got,probes.map(p=>p[2]));
 for(const [text,stamp,want] of [['AAA0BBB,M1.1.0/2,M1.1.0/2:30','2024-06-01',3600],['XXX3EDT4,0/0,J365/23','2024-01-01 03:00',-14400]]){
  const f=parseFooter(text);const r=['dst',f.std,f.dst,f.stdSpecified,f.dstSpecified,...[f.start,f.end].map(p=>[p.kind,p.month??0,p.week??0,p.weekday??0,p.day??0,p.shift])];
  assert.equal(Number(await env.sql(`SELECT (system_internal.tzdb_future_v1(${json(r)},${quote(stamp+'Z')}::timestamptz)).offset_seconds`)),want);
 }
 console.log(`SQL independent rule fixtures: ${probes.length+2}`);
});

test('SQL synthetic TZif type 0, empty/fixed/transitionless footers and triple preimages',async()=>{
 const bytes=[['Test/Type0',{types:[{offset:1200,dst:true},{offset:0}],transitions:[[0,1]],footer:'UTC0'}],
 ['Test/Empty',{transitions:[[0,0]],footer:''}],['Test/NoFooter',{footer:''}],
 ['Test/Fixed',{footer:'AAA-2'}],['Test/Triple',{types:[{offset:7200},{offset:3600},{offset:0}],transitions:[[0,1],[1800,2],[86400,2]],footer:'UTC0'}],
 ['Test/TransitionlessDST',{footer:'AAA0BBB,M3.2.0,M11.1.0'}]];
 const synthetic=buildDataset({tzdb_version:'test-tzif',zones:bytes.map(([name,x])=>({name,hex:tzifFixture(x).toString('hex')}))},{pinned:false});
 await env.sql(`BEGIN;${dataSql(synthetic)}UPDATE system_internal.tzdb_release_v1 SET sealed=true WHERE release_id=${quote(synthetic.releaseId)};COMMIT;`);
 for(const [name,stamp,want] of [['Test/Type0','1969-12-31 23:59:59',1200],['Test/NoFooter','2500-01-01',0],['Test/Fixed','0001-01-01',7200],['Test/TransitionlessDST','2500-07-01',3600]])
  assert.equal(Number(await env.sql(`SELECT (system_internal.tzdb_offset_at_v1(system_internal.tzdb_context_v1(${quote(synthetic.releaseId)},${quote(name)}),${quote(stamp+'Z')}::timestamptz)).offset_seconds`)),want);
 assert.equal(await env.sql(`SELECT classification FROM system_internal.tzdb_resolve_v1(system_internal.tzdb_context_v1(${quote(synthetic.releaseId)},'Test/Empty'),'1970-01-01 12:00')`),'unsupported_timezone_semantics');
 assert.equal(await env.sql(`SELECT classification FROM system_internal.tzdb_resolve_v1(system_internal.tzdb_context_v1(${quote(synthetic.releaseId)},'Test/Triple'),'1970-01-01 01:06:40')`),'ambiguous_local_time');
 assert.equal(await env.sql(`SELECT extract(epoch FROM future_start)::bigint FROM system_internal.tzdb_rule_v1 WHERE release_id=${quote(synthetic.releaseId)} AND zone_name='Test/Triple'`),'86400');
});

test('provider TEST-ONLY oracle: future transition gaps/folds and historical seconds',async()=>{
 const inputs=[['America/New_York','2050-03-13 00:30'],['America/New_York','2050-03-13 02:30'],['America/New_York','2050-11-06 01:30'],
 ['Europe/London','2050-03-27 01:30'],['Europe/Paris','2050-03-27 02:30'],['Australia/Sydney','2050-10-02 02:30'],
 ['Australia/Lord_Howe','2050-10-02 02:15'],['Pacific/Auckland','2050-09-25 02:30'],['Atlantic/Azores','2050-03-27 00:30'],
 ['Asia/Gaza','2500-04-01 02:30'],['America/Nuuk','2500-03-28 23:30'],['Europe/Paris','1900-01-01 12:00'],['Africa/Monrovia','1900-01-01 12:00'],['Pacific/Apia','2011-12-30 12:00']];
 for(const [z,L] of inputs){const got=JSON.parse(await env.sql(`WITH oracle AS(SELECT count(*) n,min(u) instant FROM (SELECT (${quote(L)}::timestamp AT TIME ZONE 'UTC')-s*interval '1 second' u FROM generate_series(-93600,93600) s) x WHERE u AT TIME ZONE ${quote(z)}=${quote(L)}::timestamp)
  SELECT jsonb_build_object('mine',r.classification,'expected',CASE n WHEN 0 THEN 'nonexistent_local_time' WHEN 1 THEN 'unique' ELSE 'ambiguous_local_time' END,'same',r.instant IS NOT DISTINCT FROM CASE WHEN n=1 THEN o.instant END) FROM oracle o,system_internal.resolve_recurring_local_v1(${quote(L)}::timestamp,${quote(z)}) r;`));
  assert.equal(got.mine,got.expected,z+L);assert(got.same,z+L);
 }
 console.log(`Independent PostgreSQL oracle cases: ${inputs.length}`);
});

test('corruption is fatal PZ002, never a DST issue or partial materialization',async()=>{
 await profile('America/New_York');const q=await create({local_start_time:'09:00',local_end_time:'10:00',planned_end_day_offset:0});
 const faults=[
  'DELETE FROM system_internal.tzdb_active_v1',
  `DELETE FROM system_internal.tzdb_release_v1 WHERE release_id=${quote(release)}`,
  `UPDATE system_internal.tzdb_release_v1 SET identity=jsonb_set(identity,'{2}','"bad"') WHERE release_id=${quote(release)}`,
  `DELETE FROM system_internal.tzdb_zone_v1 WHERE release_id=${quote(release)} AND zone_name='America/New_York'`,
  `DELETE FROM system_internal.tzdb_offset_v1 WHERE release_id=${quote(release)} AND zone_name='America/New_York' AND offset_seconds=-18000`,
  `DELETE FROM system_internal.tzdb_era_v1 WHERE release_id=${quote(release)} AND zone_name='America/New_York' AND utc_start='-infinity'`,
  `UPDATE system_internal.tzdb_era_v1 SET utc_end=utc_end+interval '1 second' WHERE release_id=${quote(release)} AND zone_name='America/New_York' AND utc_end<>'infinity'`,
  `DELETE FROM system_internal.tzdb_rule_v1 WHERE release_id=${quote(release)} AND zone_name='America/New_York'`,
  `UPDATE system_internal.tzdb_rule_v1 SET rule=jsonb_set(rule,'{5,5}','0') WHERE release_id=${quote(release)} AND zone_name='America/New_York'`,
  `UPDATE system_internal.tzdb_rule_v1 SET future_start='infinity' WHERE release_id=${quote(release)} AND zone_name='America/New_York'`,
  `INSERT INTO system_internal.tzdb_era_v1 SELECT release_id,zone_name,utc_start+interval '1 second',utc_end,offset_seconds,specified FROM system_internal.tzdb_era_v1 WHERE release_id=${quote(release)} AND zone_name='America/New_York' AND isfinite(utc_start) ORDER BY utc_start LIMIT 1`,
  `UPDATE system_internal.tzdb_zone_v1 SET manifest=jsonb_set(manifest,'{5}','999') WHERE release_id=${quote(release)} AND zone_name='America/New_York'`,
 ];
 for(const fault of faults){await env.sql(`BEGIN;SET LOCAL session_replication_role=replica;${fault};SET LOCAL session_replication_role=origin;
  ${claims(env.owner.id)} SET LOCAL ROLE authenticated;
  DO $t$ BEGIN BEGIN PERFORM public.materialize_quest_day_v2('${day}'); RAISE EXCEPTION 'Expected PZ002'; EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL; END; END $t$;ROLLBACK;`,'supabase_admin');
  assert.equal((await rows(q.quest_id)).length,0);
 }
 await archive(q.quest_id);await profile('UTC');console.log(`Fatal corruption cases: ${faults.length}`);
});

test('an unknown release reference is fatal corruption, never an unsupported zone',async()=>{
 // PZ003 means "this Profile zone is outside the release"; a release that does not
 // exist at all is dataset corruption and must not be reported as a product issue.
 // The disposable psql harness captures stdout only, so RAISE WARNING/NOTICE output is
 // not observable. Each SQLSTATE is therefore read back from a caught exception whose
 // message is deliberately prefixed with the state.
 const state=async(releaseSql,zoneSql)=>{
  try{
   await env.sql(`DO $t$ BEGIN BEGIN PERFORM system_internal.tzdb_context_v1(${releaseSql},${zoneSql});
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'STATE=%',SQLSTATE USING ERRCODE='P0001'; END; END $t$;`);
   return 'ok';
  }catch(error){const found=/STATE=(\S+)/.exec(String(error));return found?found[1]:String(error);}
 };
 assert.equal(await state(quote('system-tz-v1/'+'0'.repeat(64)),quote('America/New_York')),'PZ002');
 assert.equal(await state(quote(release),quote('America/New_York')),'ok');
 assert.equal(await state(quote(release),'NULL'),'PZ001');
 // A release defines the supported set: any name outside it is PZ003, a product outcome,
 // never PZ002. Prefer a name that is a valid provider zone but absent from this release,
 // because that is the ADR's narrowing case; otherwise any name outside the set proves the
 // same distinction. 'Factory' is NOT used: it is published and its issue is unspecified
 // semantics rather than membership.
 const absent=await env.sql(`SELECT coalesce((SELECT n.name FROM pg_catalog.pg_timezone_names n
   WHERE n.name NOT LIKE 'posix/%' AND n.name NOT LIKE 'right/%' AND n.name<>'localtime'
   AND NOT EXISTS(SELECT 1 FROM system_internal.tzdb_zone_v1 z
    WHERE z.release_id=${quote(release)} AND z.zone_name=n.name) ORDER BY n.name LIMIT 1),'No/SuchZone')`);
 assert.equal(await state(quote(release),quote(absent)),'PZ003');
 // The same distinction must hold at the public boundary, for a real, storable Profile zone.
 // This release publishes the whole provider catalogue, so the ADR's narrowing case is
 // produced deterministically with a test-only subset release publishing 'UTC' only.
 const narrow=buildDataset({tzdb_version:'test-narrow',zones:[{name:'UTC',hex:tzifFixture({types:[{offset:0}],footer:'UTC0'}).toString('hex')}]},{pinned:false});
 await env.sql(`BEGIN;${dataSql(narrow)}UPDATE system_internal.tzdb_release_v1 SET sealed=true WHERE release_id=${quote(narrow.releaseId)};COMMIT;`);
 await env.sql(`UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(narrow.releaseId)}`);
 await profile('America/New_York');
 try{assert.equal((await owner.rpc('materialize_quest_day_v2',{p_day:day})).error.code,'PZ003');}
 finally{await env.sql(`UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(release)}`);await profile('UTC');}
});

test('private tables, helper ACLs, ownership and immutability',async()=>{
 const security=JSON.parse(await env.sql(`SELECT jsonb_build_object('rls',bool_and(c.relrowsecurity),'no_access',bool_and(NOT has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')))
  FROM pg_class c CROSS JOIN unnest(ARRAY['anon','authenticated','service_role','quest_command_owner']) r WHERE c.relnamespace='system_internal'::regnamespace AND c.relname LIKE 'tzdb_%' AND c.relkind='r'`));
 assert.deepEqual(security,{rls:true,no_access:true});
 assert.equal(await env.sql(`SELECT bool_or(has_function_privilege(r,p.oid,'EXECUTE')) FROM pg_proc p CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE p.pronamespace='system_internal'::regnamespace AND p.proname LIKE 'tzdb_%'`),'f');
 assert.equal(await env.sql(`SELECT bool_and(proconfig @> ARRAY['search_path=pg_catalog']) FROM pg_proc WHERE pronamespace='system_internal'::regnamespace AND proname LIKE 'tzdb_%'`),'t');
 for(const sql of ['DELETE FROM system_internal.tzdb_offset_v1',`UPDATE system_internal.tzdb_release_v1 SET identity=identity`, 'TRUNCATE system_internal.tzdb_era_v1'])await assert.rejects(env.sql(sql),/immutable/);
 // Slot identity is (quest_id, source_slot_date) alone: activating a new release can never
 // create a second occurrence for one slot, nor regenerate an occurrence that exists.
 const slot=await env.sql(`SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid='public.uq_recurring_slot'::regclass`);
 assert.match(slot,/\(quest_id, source_slot_date\)/);
 assert.doesNotMatch(slot,/source_tzdb_release_id/);
});

test('today_local derives from the SYSTEM release offset, never a provider zone',async()=>{
 // With p_day omitted the batch must derive today from SYSTEM offset_at(evaluated).
 // The expected value is computed independently in Node from the pinned TZif bytes,
 // so agreement cannot come from the provider's tzdata or from shared production code.
 for(const zone of ['UTC','America/New_York','Asia/Kolkata','Pacific/Kiritimati','Australia/Lord_Howe']){
  await profile(zone);
  const parsed=d.zones.find(z=>z.name===zone);
  const before=Date.now()/1000;
  const r=await owner.rpc('materialize_quest_day_v2',{});
  const after=Date.now()/1000;
  assert.equal(r.error,null,r.error?.message);
  assert.equal(r.data.timezone,zone);
  // Bounds are inclusive of the open ends, so '-infinity'/'infinity' never reach Number().
  const atOrAfter=(t,bound)=>bound==='-infinity'||(bound!=='infinity'&&t>=Number(bound));
  const beforeBound=(t,bound)=>bound==='infinity'||(bound!=='-infinity'&&t<Number(bound));
  const oracleDay=t=>{
   const offset=parsed.future!=='infinity'&&atOrAfter(t,parsed.future)
    ?footerState(parsed.parsed.footer,t).offset
    :parsed.eras.find(e=>atOrAfter(t,e[0])&&beforeBound(t,e[1]))[2];
   const c=civilFromDays(Math.floor((t+offset)/86400));
   return `${String(c.year).padStart(4,'0')}-${String(c.month).padStart(2,'0')}-${String(c.day).padStart(2,'0')}`;
  };
  assert.equal(r.data.day,oracleDay(before),zone+' before');
  assert.equal(r.data.day,oracleDay(after),zone+' after');
 }
 await profile('UTC');
});

test('client-safe range and unspecified semantics are slot-local; no capacity consumed',async()=>{
 await profile('America/New_York');const timed=await create({local_start_time:'23:00',local_end_time:'23:30',planned_end_day_offset:0});const untimed=await create();
 const r=await materialize('9999-12-31');assert.equal(r.created_count,1);assert(r.issues.some(i=>i.reason==='unsupported_instant_range'&&i.quest_id===timed.quest_id));
 assert.equal((await rows(timed.quest_id)).length,0);assert.equal((await rows(untimed.quest_id))[0].source_tzdb_release_id,release);
 assert.equal((await rpc('get_recurring_quest_detail_v1',{p_quest_id:timed.quest_id})).materialized_occurrence_count,0);
 await archive(timed.quest_id);await archive(untimed.quest_id);
 assert.equal((await lookup('Asia/Tokyo','0001-01-01 00:00')).classification,'unique');
 assert.match((await lookup('Asia/Tokyo','0001-01-01 00:00')).instant,/BC/);
 await profile('Factory');const unknown=await create({local_start_time:'09:00',local_end_time:'10:00',planned_end_day_offset:0});
 const x=await materialize(day);assert.equal(x.created_count,0);assert(x.issues.some(i=>i.reason==='unsupported_timezone_semantics'));assert.equal((await rows(unknown.quest_id)).length,0);
 await archive(unknown.quest_id);await profile('UTC');
});

test('the lowest local date resolves to a BC instant while a past source date never materializes',async()=>{
 // tzdb's oldest era is local mean time. In the easternmost published zone that offset
 // is positive, so local 0001-01-01 00:00 there resolves to an instant before 0001-01-01Z.
 // Local input dates stay 0001-01-01..9999-12-31 and the resolver reports the true
 // instant; the client-safe window is enforced at materialization, not at lookup.
 const pick=JSON.parse(await env.sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('zone',zone_name,'offset',offset_seconds)),'[]'::jsonb)
  FROM (SELECT zone_name,offset_seconds FROM system_internal.tzdb_era_v1 WHERE release_id=${quote(release)}
   AND utc_start='-infinity' AND specified AND offset_seconds>0 ORDER BY offset_seconds DESC,zone_name LIMIT 1) x`))[0];
 assert.ok(pick,`expected an east-of-UTC oldest era in ${release}`);
 assert.ok(pick.offset>0,`expected a positive oldest-era offset, got ${pick.zone} ${pick.offset}`);
 await profile(pick.zone);
 try{
  const edge=await lookup(pick.zone,'0001-01-01 00:00');
  assert.equal(edge.classification,'unique');
  assert.match(edge.instant,/BC/,`0001-01-01T00:00 local in ${pick.zone} must resolve before 0001-01-01Z`);
  // The first local wall time whose instant is already inside the client-safe window.
  const clock=[Math.floor(pick.offset/3600),Math.floor(pick.offset%3600/60),pick.offset%60]
   .map(n=>String(n).padStart(2,'0')).join(':');
  const safe=await lookup(pick.zone,'0001-01-01 '+clock);
  assert.equal(safe.classification,'unique');
  assert.doesNotMatch(safe.instant,/BC/,`0001-01-01T${clock} local is already client-safe`);
  // A past source date is additionally ineligible, so neither series may materialize
  // and neither may consume occurrence capacity.
  const timed=await create({local_start_time:'00:00',local_end_time:'00:30',planned_end_day_offset:0});
  const untimed=await create();
  await materialize('0001-01-01');
  for(const q of [timed,untimed]){
   assert.equal((await rows(q.quest_id)).length,0);
   assert.equal((await rpc('get_recurring_quest_detail_v1',{p_quest_id:q.quest_id})).materialized_occurrence_count,0);
  }
  await archive(timed.quest_id);await archive(untimed.quest_id);
 }finally{await profile('UTC');}
});

test('immutable second release, atomic activation, retained identity/replay and one release per batch',async()=>{
 const a=await create({local_start_time:'09:00',local_end_time:'10:00',planned_end_day_offset:0});const b=await create();
 await materialize('2036-01-01');const old=(await rows(a.quest_id))[0];assert.equal(old.source_tzdb_release_id,release);
 const second=buildDataset({tzdb_version:'test-2',zones:[{name:'UTC',hex:tzifFixture({types:[{offset:3600}],footer:'NEW-1'}).toString('hex')}]},{pinned:false});
 await env.sql(`BEGIN;${dataSql(second)}UPDATE system_internal.tzdb_release_v1 SET sealed=true WHERE release_id=${quote(second.releaseId)};COMMIT;`);
 await env.sql(`BEGIN;UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(second.releaseId)};ROLLBACK;`);
 assert.equal(await env.sql('SELECT system_internal.tzdb_active_release_v1()'),release);
 // Flip inside a test-only occurrence trigger after the first insert. The batch
 // must still use its captured old release even when a later statement sees activation.
 await env.sql(`CREATE FUNCTION public.test_flip_timezone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$ BEGIN UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(second.releaseId)};RETURN NEW;END $f$;
  CREATE TRIGGER test_flip_timezone AFTER INSERT ON public.quest_occurrences FOR EACH ROW EXECUTE FUNCTION public.test_flip_timezone();`);
 await materialize('2036-01-02');await env.sql('DROP TRIGGER test_flip_timezone ON public.quest_occurrences;DROP FUNCTION public.test_flip_timezone();');
 for(const q of [a,b])assert.equal((await rows(q.quest_id)).at(-1).source_tzdb_release_id,release);
 assert.equal(await env.sql('SELECT system_internal.tzdb_active_release_v1()'),second.releaseId);
 assert.equal((await materialize('2036-01-01')).created_count,0);await materialize('2036-01-03');
 const newer=(await rows(a.quest_id)).at(-1);assert.equal(newer.source_tzdb_release_id,second.releaseId);assert.match(newer.scheduled_at,/08:00:00/);
 assert.deepEqual((await rows(a.quest_id))[0],old);
 assert.equal(await env.sql(`SELECT (system_internal.tzdb_offset_at_v1(system_internal.tzdb_context_v1(${quote(release)},'UTC'),'2036-01-03Z')).offset_seconds`),'0');
 await profile('America/New_York');const rejected=await owner.rpc('materialize_quest_day_v2',{p_day:day});assert.equal(rejected.error.code,'PZ003');
 await env.sql(`UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(release)}`);await profile('UTC');
 await archive(a.quest_id);await archive(b.quest_id);
});

test('unspecified historical interval skips only affected series in the same batch',async()=>{
 const t=daysFromCivil(2035,6,1)*86400;
 const fixture=buildDataset({tzdb_version:'test-unspecified',zones:[{name:'UTC',hex:tzifFixture({
  types:[{offset:0},{offset:0,specified:false}],transitions:[[t+36000,1],[t+39600,0]],footer:'UTC0'
 }).toString('hex')}]},{pinned:false});
 await env.sql(`BEGIN;${dataSql(fixture)}UPDATE system_internal.tzdb_release_v1 SET sealed=true WHERE release_id=${quote(fixture.releaseId)};
 UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(fixture.releaseId)};COMMIT;`);
 const good=await create({local_start_time:'09:00',local_end_time:'09:30',planned_end_day_offset:0});
 const bad=await create({local_start_time:'10:00',local_end_time:'10:30',planned_end_day_offset:0});
 const r=await materialize(day);assert.equal(r.created_count,1);assert(r.issues.every(i=>i.quest_id===bad.quest_id&&i.reason==='unsupported_timezone_semantics'));
 assert.equal((await rows(bad.quest_id)).length,0);assert.equal((await rows(good.quest_id))[0].source_tzdb_release_id,fixture.releaseId);
 await archive(good.quest_id);await archive(bad.quest_id);await env.sql(`UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(release)}`);
});

test('occurrence release survives planning, Complete/Reopen, retirement and accepted replay',async()=>{
 const request={command_id:id(),origin:'web_ui',request:{title:'Provenance lifecycle',recurrence_mode:'daily',start_date:day,local_start_time:'09:00',local_end_time:'10:00',planned_end_day_offset:0}};
 const q=await rpc('create_recurring_quest_v2',request);await materialize(day);let o=(await rows(q.quest_id))[0];
 const completion={command_id:id(),occurrence_id:o.id,expected_execution_cycle:o.execution_cycle,reported_completed_at:null,origin:'web_ui'};
 await rpc('complete_quest_occurrence',completion);
 const reopen={command_id:id(),occurrence_id:o.id,expected_execution_cycle:o.execution_cycle,origin:'web_ui'};
 await rpc('reopen_quest_occurrence_v2',reopen);o=(await rows(q.quest_id))[0];
 await rpc('set_quest_occurrence_plan_v1',{p_command_id:id(),p_occurrence_id:o.id,p_expected_execution_cycle:o.execution_cycle,
  p_expected_scheduled_at:o.scheduled_at,p_expected_planned_end_at:o.planned_end_at,p_scheduled_at:null,p_planned_end_at:null,p_origin:'web_ui'});
 await archive(q.quest_id);await rpc('set_recurring_quest_archived_v1',{p_command_id:id(),p_quest_id:q.quest_id,p_archived:false,p_origin:'web_ui'});
 await archive(q.quest_id);await rpc('delete_recurring_quest_v1',{p_command_id:id(),p_quest_id:q.quest_id,p_origin:'web_ui'});
 const other=await env.sql(`SELECT release_id FROM system_internal.tzdb_release_v1 WHERE release_id<>${quote(release)} ORDER BY release_id LIMIT 1`);
 await env.sql(`UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(other)}`);
 assert.deepEqual(await rpc('create_recurring_quest_v2',request),{...q,replay:true});
 assert.equal((await rpc('complete_quest_occurrence',completion)).replay,true);
 assert.equal((await rpc('reopen_quest_occurrence_v2',reopen)).replay,true);
 assert.equal((await rows(q.quest_id))[0].source_tzdb_release_id,release);
 await assert.rejects(env.sql(`UPDATE public.quest_occurrences SET source_tzdb_release_id=NULL WHERE id='${o.id}'`),/provenance is immutable/);
 await env.sql(`UPDATE system_internal.tzdb_active_v1 SET release_id=${quote(release)}`);
});
