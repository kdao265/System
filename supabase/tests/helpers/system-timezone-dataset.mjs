// Deterministic semantic dataset. Pure in-memory generation; never reads a server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTzif, sha256, ruleLocalSeconds, yearOfDays } from './system-timezones.mjs';

export const GENERATOR = 'system-tz-generator-v1';
export const SEMANTICS = 'system-tz-v1';
export const PINNED_SOURCE = '95443126a5f831531c1be77148cbf23ce8e691bcc5af3611cafb936957492716';
export const source = JSON.parse(readFileSync(new URL('../fixtures/tzdb-2025b.json', import.meta.url), 'utf8'));
export const quote = s => `'${String(s).replaceAll("'", "''")}'`;
export const canonical = x => JSON.stringify(x);
export const digest = x => sha256(canonical(x));
const ordered = (a,b) => a < b ? -1 : a > b ? 1 : 0;

export function footerState(f, utc, full=false) {
  if (f.dst === null) return full ? {offset:f.std,specified:f.stdSpecified,isDst:false,abbreviation:f.stdName} : {offset:f.std,specified:f.stdSpecified};
  const year = yearOfDays(Math.floor(utc / 86400));
  const events = [];
  for (let y = year - 2; y <= year + 2; y++) {
    events.push({ at: ruleLocalSeconds(f.start,y)-f.std, offset:f.dst, specified:f.dstSpecified,isDst:true,abbreviation:f.dstName });
    events.push({ at: ruleLocalSeconds(f.end,y)-f.dst, offset:f.std, specified:f.stdSpecified,isDst:false,abbreviation:f.stdName });
  }
  events.sort((a,b)=>a.at-b.at || a.offset-b.offset);
  // Coincident end/start means no standard-time interval (all-year DST).
  const prior = events.filter(e=>e.at<=utc);
  const last = prior.at(-1);
  const same = prior.filter(e=>e.at===last.at);
  const state=same.length>1 ? {offset:f.dst,specified:f.dstSpecified,isDst:true,abbreviation:f.dstName} : {offset:last.offset,specified:last.specified,isDst:last.isDst,abbreviation:last.abbreviation};
  return full ? state : {offset:state.offset,specified:state.specified};
}

export const ruleArray = r => r ? [r.kind,r.month??0,r.week??0,r.weekday??0,r.day??0,r.shift] : null;
export function buildZone(name, parsed, tzifHash) {
  assert(/^[A-Za-z0-9_+./-]+$/.test(name) && !name.split('/').includes('..'), 'Unsafe zone name');
  const { transitions, localTypes, initial, footer } = parsed;
  const last = transitions.at(-1)?.utc ?? null;
  const future = footer ? (last === null ? '-infinity' : String(last)) : 'infinity';
  const rule = footer ? [footer.dst === null ? 'fixed' : 'dst',footer.std,footer.dst,
    footer.stdSpecified,footer.dstSpecified,ruleArray(footer.start),ruleArray(footer.end)]
    : ['none',null,null,null,null,null,null];
  if (footer && last !== null) {
    const state = footerState(footer,last,true), type = localTypes[transitions.at(-1).type];
    assert.equal(state.offset,type.offset, `${name}: footer offset inconsistent at final transition`);
    assert.equal(state.specified,type.specified, `${name}: footer semantics inconsistent`);
    assert.equal(state.isDst,type.isDst, `${name}: footer DST flag inconsistent`);
    assert.equal(state.abbreviation,type.abbreviation, `${name}: footer designation inconsistent`);
  }
  const eras=[];let start='-infinity',state=initial;
  const push = end => { if(start!==end)eras.push([start,end,state.offset,state.specified]); };
  for(let i=0;i<transitions.length;i++) {
    const t=transitions[i]; let next=localTypes[t.type];
    if(!footer && i===transitions.length-1)next={...next,specified:false};
    if(state.offset===next.offset&&state.specified===next.specified)continue;
    push(String(t.utc)); start=String(t.utc); state=next;
  }
  push('infinity');
  const offsets=[...new Set([...eras.map(e=>e[2]),...(footer?[footer.std,...(footer.dst===null?[]:[footer.dst])]:[])])].sort((a,b)=>a-b);
  const eraHash=sha256(eras.map(canonical).join('\n')+'\n');
  const offsetHash=digest(offsets),ruleHash=digest(rule);
  const manifest=[name,tzifHash,last===null?null:String(last),future,eras.length,offsets.length,eraHash,offsetHash,ruleHash];
  return {name,parsed,last,future,rule,eras,offsets,manifest,manifestHash:digest(manifest)};
}

export function buildDataset(input=source, {generator=GENERATOR,semantics=SEMANTICS,pinned=true}={}) {
  const names=input.zones.map(z=>z.name);assert.equal(new Set(names).size,names.length,'Duplicate zone');
  const zones=[...input.zones].sort((a,b)=>ordered(a.name,b.name)).map(({name,hex})=>{
    assert(/^(?:[0-9a-f]{2})+$/.test(hex),'Invalid TZif bytes');
    const bytes=Buffer.from(hex,'hex'); return buildZone(name,parseTzif(bytes),sha256(bytes));
  });
  const sourceHash=sha256(zones.map(z=>`${z.name}:${z.manifest[1]}\n`).join(''));
  if(pinned)assert.equal(sourceHash,PINNED_SOURCE,'Pinned TZif source changed');
  const datasetHash=sha256(zones.map(z=>`${z.name}:${z.manifestHash}\n`).join(''));
  const counts=[zones.length,zones.reduce((n,z)=>n+z.eras.length,0),zones.reduce((n,z)=>n+z.offsets.length,0)];
  const identity=[input.tzdb_version,sourceHash,datasetHash,generator,semantics,...counts];
  return {zones,sourceHash,datasetHash,counts,identity,releaseId:`${SEMANTICS}/${digest(identity)}`};
}

export const instantSql = value => ['infinity','-infinity'].includes(value) ? `${quote(value)}::timestamptz` : `to_timestamp(${value})`;
export function dataSql(d) {
  const id=quote(d.releaseId), json=x=>`${quote(canonical(x))}::jsonb`;
  const result=[`INSERT INTO system_internal.tzdb_release_v1(release_id,identity) VALUES (${id},${json(d.identity)});`];
  result.push('INSERT INTO system_internal.tzdb_zone_v1(release_id,zone_name,manifest,manifest_sha256) VALUES\n'+d.zones.map(z=>`(${id},${quote(z.name)},${json(z.manifest)},${quote(z.manifestHash)})`).join(',\n')+';');
  result.push('INSERT INTO system_internal.tzdb_offset_v1 VALUES\n'+d.zones.flatMap(z=>z.offsets.map(o=>`(${id},${quote(z.name)},${o})`)).join(',\n')+';');
  result.push('INSERT INTO system_internal.tzdb_era_v1 VALUES\n'+d.zones.flatMap(z=>z.eras.map(e=>`(${id},${quote(z.name)},${instantSql(e[0])},${instantSql(e[1])},${e[2]},${e[3]})`)).join(',\n')+';');
  result.push('INSERT INTO system_internal.tzdb_rule_v1 VALUES\n'+d.zones.map(z=>`(${id},${quote(z.name)},${instantSql(z.future)},${json(z.rule)})`).join(',\n')+';');
  return result.join('\n')+'\n';
}
