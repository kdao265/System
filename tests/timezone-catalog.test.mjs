import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {parseFooter,parseRule,parseTzif,ruleLocalSeconds,sha256} from '../supabase/tests/helpers/system-timezones.mjs';
import {buildDataset,buildZone,footerState,source} from '../supabase/tests/helpers/system-timezone-dataset.mjs';
import {oracleRule,oracleOffset,decodeOracle,tzifFixture} from '../supabase/tests/helpers/system-timezone-oracle.mjs';
const d=buildDataset();
const epoch=s=>Date.parse(s+'Z')/1000;

test('pinned source, deterministic manifests and full semantic identity',()=>{
 assert.deepEqual(buildDataset(),d);assert.deepEqual(d.counts,[598,41242,2073]);
 assert.equal(new Set(d.zones.map(z=>z.manifest[1])).size,341);
 const src={...source,zones:[...source.zones].reverse()};assert.equal(buildDataset(src).releaseId,d.releaseId);
 assert.notEqual(buildDataset(source,{semantics:'test-semantic-version'}).releaseId,d.releaseId);
 assert.throws(()=>buildDataset({...source,zones:source.zones.slice(1)}),/Pinned/);
 assert.match(readFileSync(new URL('../supabase/migrations/20261004120000_recurring_schedule_defaults_v1.sql',import.meta.url),'utf8'),new RegExp(d.releaseId));
});

test('strict POSIX syntax, omitted 02:00, zero and negative DST, extended times',()=>{
 assert.equal(parseRule('M3.2.0').shift,7200);
 assert.equal(parseFooter('AZO1AZOST0,M3.5.0/0,M10.5.0/1').dst,0);
 assert.equal(parseFooter('IST-1GMT0,M10.5.0,M3.5.0/1').dst,0);
 assert.equal(parseRule('M3.4.4/50').shift,180000);
 assert.equal(parseRule('M3.5.0/-167:59:59').shift,-604799);
 for(const s of ['EST5EDT','ABC0,junk','ABC25','AAA0BBB,M13.1.0,M1.1.0','AAA0BBB,M3.2.0/2/3,M11.1.0','AAA0BBB,M3.2.0/2u,M11.1.0','AAA0BBB,M3.2.0/168,M11.1.0'])assert.throws(()=>parseFooter(s),s);
});

test('independent J59/J60/J61 and ordinal leap-day fixtures',()=>{
 for(const [y,r,expected] of [[2023,'J59','2023-02-28'],[2023,'J60','2023-03-01'],[2023,'J61','2023-03-02'],[2024,'J59','2024-02-28'],[2024,'J60','2024-03-01'],[2024,'J61','2024-03-02'],[2024,'59','2024-02-29'],[2024,'60','2024-03-01'],[2023,'59','2023-03-01'],[2023,'365','2024-01-01']]){
  assert.equal(ruleLocalSeconds(parseRule(r+'/0'),y),epoch(expected+'T00:00:00'));
 }
});

test('independent Mm.w.d, signed shifts and adjacent astronomical years',()=>{
 let n=0;
 for(const y of [-1,0,1,99,100,400,1900,1970,2000,2023,2024,9999,10000,10002])
 for(const r of ['M1.1.0','M2.5.0','M3.5.0/-1','M3.4.4/26','M3.4.4/50','M12.5.6/167:59:59','J60','365']){
  assert.equal(ruleLocalSeconds(parseRule(r),y),oracleRule(r,y),y+':'+r);n++;
 }
 console.log('Independent calendar fixtures:',n);
});

test('TZif type 0, fixed/empty/transitionless footers and unspecified metadata',()=>{
 const bytes=tzifFixture({types:[{offset:3600,dst:true},{offset:0}],transitions:[[0,1]],footer:'UTC0'});
 const z=parseTzif(bytes);assert.equal(z.initial.offset,3600);assert.equal(z.initial.isDst,true);
 const empty=parseTzif(tzifFixture({types:[{offset:0}],transitions:[[0,0]],footer:''}));
 assert.equal(buildZone('Test/Empty',empty,sha256(bytes)).eras.at(-1)[3],false);
 const noTransitions=parseTzif(tzifFixture({types:[{offset:0}],footer:'AAA-2'}));
 assert.equal(buildZone('Test/Fixed',noTransitions,sha256(bytes)).future,'-infinity');
 assert.equal(footerState(noTransitions.footer,0).offset,7200);
 assert.equal(parseFooter('<-00>0').stdSpecified,false);
 assert.equal(parseTzif(tzifFixture({types:[{offset:0,specified:false}],footer:'<-00>0'})).initial.specified,false);
 assert.equal(parseTzif(tzifFixture({version:0})).footer,null);
 const bad=Buffer.from(bytes);bad[5]=1;assert.throws(()=>parseTzif(bad));assert.throws(()=>parseTzif(bytes.subarray(0,-1)));
});

test('UTC event ordering and all-year DST synthetic footers',()=>{
 const close=parseFooter('AAA0BBB,M1.1.0/2,M1.1.0/2:30');
 assert.equal(footerState(close,epoch('2024-06-01T00:00:00')).offset,3600);
 const all=parseFooter('XXX3EDT4,0/0,J365/23');
 for(const s of ['2023-01-01T03:00:00','2023-06-01T00:00:00','2024-01-01T03:00:00','2024-12-31T23:00:00'])assert.equal(footerState(all,epoch(s)).offset,-14400);
});

test('all historical boundaries against independent raw TZif decoding',()=>{
 let checks=0;
 for(const z of d.zones){const raw=decodeOracle(source.zones.find(v=>v.name===z.name).hex);
  for(const t of raw.transitions)for(const delta of [-1,0,1]){
   const u=t[0]+delta;let actual;
   if(z.future!=='infinity'&&(z.future==='-infinity'||u>=Number(z.future)))actual=footerState(z.parsed.footer,u);
   else {let lo=0,hi=z.eras.length;while(lo+1<hi){const m=(lo+hi)>>1;if(Number(z.eras[m][0])<=u)lo=m;else hi=m;}const e=z.eras[lo];actual={offset:e[2],specified:e[3]};}
   assert.deepEqual(actual,oracleOffset(raw,u),z.name+':'+u);checks++;
  }
 }
 console.log('Independent raw transition checks:',checks);
});

test('400-year future cycle across every DST footer, independently derived boundaries',()=>{
 let checks=0;
 for(const z of d.zones){if(z.rule[0]!=='dst')continue;const raw=decodeOracle(source.zones.find(v=>v.name===z.name).hex);
  const [,start,end]=raw.footer.split(',');
  for(let y=2400;y<2800;y++)for(const [r,o] of [[start,z.rule[1]],[end,z.rule[2]]])for(const delta of [-1,0,1]){
   const u=oracleRule(r,y)-o+delta;assert.deepEqual(footerState(z.parsed.footer,u),oracleOffset(raw,u),z.name+':'+u);checks++;
  }
 }
 console.log('Independent full Gregorian cycle future checks:',checks);
});
