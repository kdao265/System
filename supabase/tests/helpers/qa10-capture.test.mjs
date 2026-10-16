import assert from 'node:assert/strict';
import test from 'node:test';
import { procIdentity, systemTzRoot, buildPrefix, originalBuildElf, validateManifest, assertStable, liveIdentity } from './qa10-capture.mjs';

const hash='a'.repeat(64);
const stat=(pid=1,parent=0,ticks='123',comm='.postgres-wrapp')=>
  `${pid} (${comm}) S ${parent} ${Array(17).fill('0').join(' ')} ${ticks} 0\n`;
const pg={backend_pid:42,backend_stat:stat(42,1),backend_sha256:hash,
  data_directory:'/data',postmaster_start_epoch:100,postmaster_start:'2026-10-16 00:00:00.123+00'};
const procOutput=(overrides={})=>{
  const o={pid:'1',epoch:'100',directory:'/data',stat:stat().trim(),after:stat().trim(),
    executable:'/nix/store/package/bin/.postgres-wrapped',hash,...overrides};
  return Buffer.from([o.pid,o.directory,o.epoch,o.stat,o.executable,
    o.hash+'  /proc/'+o.pid+'/exe',o.after,o.pid,o.directory,o.epoch].join('\n')+'\n');
};
const runWith=(output,state={startedAt:'2026-10-16T00:00:00Z',running:true,restarts:0})=>
  async args=>args[0]==='exec'?output:Buffer.from(JSON.stringify(state));

test('wrapped/truncated names, spaces and parentheses are not identity criteria',()=>{
  assert.deepEqual(procIdentity(stat(42,1,'123','wrapped (worker)')), {pid:42,parentPid:1,startTicks:'123'});
});
test('reject incomplete proc stat',()=>assert.throws(()=>procIdentity('1 (postgres) S 0')));
test('same version and different pathname are permitted only with actual matching backend/master bytes',async()=>{
  const result=await liveIdentity('a'.repeat(64),pg,runWith(procOutput()));
  assert.equal(result.sha256,hash);assert(result.executable.endsWith('/.postgres-wrapped'));
});
for(const [label,override] of [
  ['different executable bytes',{hash:'b'.repeat(64)}],
  ['wrong PID file process',{pid:'2'}],
  ['stale start epoch',{epoch:'99'}],
  ['different data directory',{directory:'/other'}],
  ['PID reuse during procfs reads',{after:stat(1,0,'124').trim()}],
  ['deleted executable',{executable:'/bin/postgres (deleted)'}],
]) test('reject '+label,async()=>assert.rejects(liveIdentity('a'.repeat(64),pg,runWith(procOutput(override)))));
test('backend parent must be identified postmaster',async()=>{
  await assert.rejects(liveIdentity('a'.repeat(64),{...pg,backend_stat:stat(42,2)},runWith(procOutput())));
});
test('inaccessible procfs blocks without exposing child stderr',async()=>{
  await assert.rejects(liveIdentity('a'.repeat(64),pg,async()=>{throw Error('SECRET sentinel');}),
    e=>e.message==='QA-10 stage failed: postmaster-procfs-as-postgres');
});
test('contradictory executable evidence is retained before failing closed',async()=>{
  let observed;
  await assert.rejects(liveIdentity('a'.repeat(64),pg,runWith(procOutput({hash:'b'.repeat(64)})),
    probe=>{observed=probe;}));
  assert.equal(observed.backendSha256,hash);
  assert.equal(observed.postmasterSha256,'b'.repeat(64));
});
test('container restart and stopped container block',async()=>{
  for(const state of [{running:true,restarts:1},{running:false,restarts:0}])
    await assert.rejects(liveIdentity('a'.repeat(64),pg,runWith(procOutput(),state)));
});
test('start ticks and full SQL start timestamp reject restarts even in the same epoch second',()=>{
  for(const changed of [{ticks:'124',start:'same'},{ticks:'123',start:'different'}])
    assert.throws(()=>assertStable({ticks:'123',start:'same'},changed));
});
test('select exactly one compiled system timezone root',()=>{
  assert.equal(systemTzRoot(" '--with-system-tzdata=/nix/store/tz/share/zoneinfo'"),'/nix/store/tz/share/zoneinfo');
  for(const value of ['', '--with-system-tzdata=/one --with-system-tzdata=/two',
    '--with-system-tzdata=/one/../two','--with-system-tzdata=/one;bad']) {
    assert.throws(()=>systemTzRoot(value));
  }
});
const names=['America/New_York','Asia/Ho_Chi_Minh','Europe/Berlin','Pacific/Auckland','UTC','tzdata.zi'];
const manifest=Buffer.from(names.map(n=>hash+'  ./'+n+'\n').join(''));
test('manifest retains raw LF and independently checkable file hashes',()=>{
  assert.equal(validateManifest(manifest,6).get('UTC'),hash);
});
for(const [label,bytes,count] of [
  ['missing final LF',manifest.subarray(0,-1),6],
  ['CRLF serialization',Buffer.from(manifest.toString().replaceAll('\n','\r\n')),6],
  ['duplicate paths',Buffer.concat([manifest,manifest.subarray(0,manifest.indexOf(10)+1)]),7],
  ['partial traversal',manifest,1807],
  ['missing required file',Buffer.from(manifest.toString().replace('UTC','UTD')),6],
]) test('reject '+label,()=>assert.throws(()=>validateManifest(bytes,count)));
test('select exactly one compiled original build prefix',()=>{
  assert.equal(buildPrefix("'--prefix=/nix/store/pkg-17.6' '--with-system-tzdata=/tz'"),'/nix/store/pkg-17.6');
  assert.equal(buildPrefix("--prefix='/nix/store/pkg-17.6' '--bindir=/usr/bin'"),'/nix/store/pkg-17.6');
  for(const value of ['','no prefix at all','--prefix=/one --prefix=/two',
    "'--prefix=/one/../two'","'--prefix=relative/path'","'--prefix=/one;bad'"])
    assert.throws(()=>buildPrefix(value));
});
const liveElf={sha256:hash,executable:'/nix/store/other/bin/.postgres-wrapped'};
const elfOutput=(magic='7f454c46',sha=hash,path='/nix/store/pkg/bin/postgres')=>
  Buffer.from(magic+'\n'+path+'\n'+sha+'  '+path+'\n');
test('original-build ELF bytes, not the pathname, must equal the live server ELF',()=>{
  const evidence=originalBuildElf('/nix/store/pkg',liveElf,elfOutput());
  assert.equal(evidence.sha256,hash);
  assert.equal(evidence.executable,'/nix/store/pkg/bin/postgres');
  assert.equal(evidence.prefix,'/nix/store/pkg');
});
for(const [label,output] of [
  // 23212f62 is "#!b": a shell launcher can never carry the live ELF's hash.
  ['launcher script bytes',elfOutput('23212f62')],
  ['different original-build bytes',elfOutput('7f454c46','b'.repeat(64))],
  ['executable deleted between path and hash reads',Buffer.from('7f454c46\n/nix/store/pkg/bin/postgres\n'+hash+'  /nix/store/pkg/bin/postgres (deleted)\n')],
  ['hash for another path',elfOutput('7f454c46',hash,'/nix/other/bin/postgres')],
  ['traversal in resolved path',elfOutput('7f454c46',hash,'/nix/store/pkg/../evil/bin/postgres')],
  ['truncated evidence',Buffer.from('7f454c46\n/nix/store/pkg/bin/postgres\n')],
]) test('reject '+label+' from original-build evidence',()=>assert.throws(()=>originalBuildElf('/nix/store/pkg',liveElf,output)));
