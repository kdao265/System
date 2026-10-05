// Final performance gate: authenticated calls, fresh slots, varied schedules and Profile zones.
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createClient} from '@supabase/supabase-js';
import {startAuthEnvironment} from '../../tests/helpers/auth-environment.mjs';
const env=await startAuthEnvironment({buildApp:false});
try {
 const owner=createClient(env.url,env.key,{auth:{persistSession:false,autoRefreshToken:false}});
 assert.equal((await owner.auth.signInWithPassword(env.owner)).error,null);
 const zones=['America/New_York','Europe/Paris','Australia/Lord_Howe','Pacific/Auckland','Atlantic/Azores'];
 const date=(year,n)=>{const d=new Date(0);d.setUTCFullYear(year,6,1+n);d.setUTCHours(12,0,0,0);return d.toISOString().slice(0,10);};
 const limits=await env.sql("SELECT rolconfig::text FROM pg_roles WHERE rolname='authenticated'");assert.match(limits,/statement_timeout=8s/);
 const release=await env.sql('SELECT system_internal.tzdb_active_release_v1()');
 const result=[];let live=0,cursor=0;
 for(const target of [1,10,50,100]){
  assert.equal((await owner.from('profiles').update({timezone:'UTC'}).eq('user_id',env.owner.id)).error,null);
  while(live<target){const hour=String(8+live%8).padStart(2,'0'),end=String(9+live%8).padStart(2,'0'),minute=live%2?'40':'20';
   const r=await owner.rpc('create_recurring_quest_v2',{command_id:id(),origin:'web_ui',request:{title:'Bench '+live,recurrence_mode:'daily',start_date:'2030-01-01',local_start_time:hour+':'+minute,local_end_time:end+':'+minute,planned_end_day_offset:0}});
   assert.equal(r.error,null,r.error?.message);live++;
  }
  for(const [workload,year] of [['explicit',2035],['future',2500]]){
   const timings=[];
   for(const zone of zones){
    assert.equal((await owner.from('profiles').update({timezone:zone}).eq('user_id',env.owner.id)).error,null);
    const slot=date(year,cursor++);
    const placement=await env.sql("SELECT future_start "+(workload==='explicit'?'>':'<')+" '"+slot+"Z'::timestamptz FROM system_internal.tzdb_rule_v1 WHERE release_id='"+release+"' AND zone_name='"+zone+"'");assert.equal(placement,'t',workload+zone);
    const begin=performance.now();const r=await owner.rpc('materialize_quest_day_v2',{p_day:slot});const elapsed=performance.now()-begin;
    assert.equal(r.error,null,r.error?.message);assert.equal(r.data.created_count,target);assert.equal(r.data.issues.length,0);timings.push(elapsed);
   }
   const slot=date(year,cursor++);
   const sql=await env.sql("BEGIN;SET LOCAL statement_timeout='8s';SELECT set_config('request.jwt.claims','{\"sub\":\""+env.owner.id+"\",\"role\":\"authenticated\"}',true);SELECT set_config('request.jwt.claim.sub','"+env.owner.id+"',true);SET LOCAL ROLE authenticated;EXPLAIN (ANALYZE,TIMING OFF,COSTS OFF) SELECT public.materialize_quest_day_v2('"+slot+"');ROLLBACK;");
   const row={workload,series:target,calls:5,median_ms:Math.round([...timings].sort((a,b)=>a-b)[2]),min_ms:Math.round(Math.min(...timings)),max_ms:Math.round(Math.max(...timings)),sql_ms:Number(sql.match(/Execution Time: ([\d.]+)/)[1])};
   if(target===100)assert(row.max_ms<4000&&row.sql_ms<4000,'Four-second gate failed: '+JSON.stringify(row));result.push(row);
  }
 }
 console.table(result);
 console.log('Five zones per size/workload; times vary by series. One Profile zone per batch is the product contract.');
 console.log('PASS: both 100-series workloads <4 seconds; fresh identities, real HTTP/authentication, unchanged 8s timeout');
 console.log('Storage:',await env.sql("SELECT jsonb_object_agg(relname,pg_total_relation_size(oid)) FROM pg_class WHERE relnamespace='system_internal'::regnamespace AND relname LIKE 'tzdb_%' AND relkind='r'"));
 owner.auth.stopAutoRefresh();
}finally{await env.close();}
