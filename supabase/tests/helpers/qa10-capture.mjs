// Read-only provenance from one owned disposable PostgreSQL container.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
export const host = process.platform === 'win32'
  ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const txt = b => b.toString('utf8').trim();
const path = 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const zones = ['America/New_York','Europe/Berlin','Asia/Ho_Chi_Minh','Pacific/Auckland','UTC'];
export const manifestScript=`set -euo pipefail
  export LC_ALL=C; cd -- "$1"
  find -L . -type f -print0 | sort -z | xargs -0 -r sha256sum`;
export const aliasesScript=`set -euo pipefail
  export LC_ALL=C; cd -- "$1"
  find -L . -print0 | sort -z | while IFS= read -r -d '' f; do
    if test -L "$f"; then
      test -e "$f"
      target=$(readlink "$f"); resolved=$(readlink -f "$f")
      printf '%s\\t%s\\t%s\\n' "$f" "$target" "$resolved"
    fi
  done`;
const stage = async (label, task) => {
  try { return await task(); } catch {
    const error=Error('QA-10 stage failed: '+label);
    error.code='QA10_PROBE_UNAVAILABLE';throw error;
  }
};
export async function docker(args, timeout=20000) {
  try { return (await exec('docker',['--host',host,...args],{
    encoding:'buffer',timeout,maxBuffer:8*1024*1024,windowsHide:true})).stdout; }
  catch(e) { throw Error(`Docker ${args[0]} failed (${e.code??'unknown'})`); }
}
export async function dbs(){
  const out=txt(await docker(['ps','-a','--no-trunc','--filter','label=system.test=private-auth-v1','--format','{{.ID}}|{{.Names}}']));
  return out?out.split('\n').map(s=>s.split('|')).filter(([id,n])=>/^[a-f0-9]{64}$/.test(id)&&/^system-private-auth-[0-9a-f-]{36}-db$/.test(n)):[];
}
function safePath(p) {
  assert.match(p,/^\/[a-zA-Z0-9_.+/-]+$/,'Unsafe evidence path');
  assert(!p.split('/').some(x=>x==='..'||x==='.'),'Noncanonical evidence path');
  return p;
}
export function procIdentity(stat) {
  // comm can contain spaces/parentheses and is not necessarily "postgres".
  const m=stat.trim().match(/^([1-9][0-9]*) \(.*\) (.+)$/);
  assert(m,'Malformed proc stat');
  const fields=m[2].split(/\s+/);
  assert(fields.length>=20 && /^[0-9]+$/.test(fields[1]) && /^[0-9]+$/.test(fields[19]),'Incomplete proc stat');
  return {pid:Number(m[1]),parentPid:Number(fields[1]),startTicks:fields[19]};
}
export function systemTzRoot(configure) {
  const matches=[...configure.matchAll(/--with-system-tzdata=(?:'([^']+)'|"([^"]+)"|([^\s'"]+))/g)];
  assert.equal(matches.length,1,'Missing or ambiguous system tzdata configuration');
  return safePath(matches[0][1]??matches[0][2]??matches[0][3]);
}
// Exactly one compiled --prefix names the original build whose on-disk
// executable must byte-equal the live server ELF. Taken from the running
// backend's own pg_config view, never from an invoker-supplied path.
export function buildPrefix(configure) {
  const matches=[...configure.matchAll(/--prefix=(?:'([^']+)'|"([^"]+)"|([^\s'"]+))/g)];
  assert.equal(matches.length,1,'Missing or ambiguous original build prefix');
  return safePath(matches[0][1]??matches[0][2]??matches[0][3]);
}
// The original-build copy at $prefix/bin/postgres must be an ELF whose bytes
// equal the live postmaster ELF. A launcher script (for example the PATH
// bindir "postgres" wrapper in this image) can never satisfy this check.
export function originalBuildElf(prefix,live,output) {
  const lines=txt(output).split('\n');
  assert.equal(lines.length,3,'Incomplete original-build evidence');
  const [magic,resolved,hashLine]=lines;
  assert.equal(magic,'7f454c46','Original-build postgres is not an ELF executable');
  safePath(resolved);
  const m=hashLine.match(/^([a-f0-9]{64})  (\/[a-zA-Z0-9_.+/-]+)$/);
  assert(m,'Malformed original-build hash');
  assert.equal(m[2],prefix+'/bin/postgres','Original-build hash is not for the prefix executable');
  assert.equal(m[1],live.sha256,'Live server ELF differs from the original-build ELF');
  return {prefix,executable:resolved,sha256:m[1]};
}
export function validateManifest(manifest,expectedEntries=1807) {
  const lines=manifest.toString('utf8').split('\n');
  assert.equal(lines.pop(),'','Missing manifest LF');
  assert.equal(lines.length,expectedEntries,'Timezone tree entries differ from reviewed baseline');
  let previous=''; const entries=new Map();
  for(const line of lines) {
    const m=line.match(/^([a-f0-9]{64})  (\.\/[a-zA-Z0-9_.+/-]+)$/);
    assert(m,'Unexpected manifest serialization');
    assert(m[2]>previous,'Unsorted or duplicate manifest path'); previous=m[2];
    assert(!m[2].slice(2).split('/').some(x=>x==='..'||x==='.'),'Unsafe manifest path');
    entries.set(m[2].slice(2),m[1]);
  }
  for(const zone of [...zones,'tzdata.zi']) assert(entries.has(zone),'Missing timezone file '+zone);
  return entries;
}
export function assertStable(before,after) {
  assert.deepEqual(after,before,'Postmaster/container identity changed during observation');
}
// One backend returns its compiled build metadata AND hashes its own executable.
// The existing fixture admin is used only for these fixed read-only metadata calls.
// No CLI fallback, grants, environment reads or application data access.
export const metadataSql=`SELECT jsonb_build_object(
  'server_version',current_setting('server_version'),'timezone',current_setting('TimeZone'),
  'data_directory',current_setting('data_directory'),
  'postmaster_start',pg_postmaster_start_time()::text,
  'postmaster_start_epoch',floor(extract(epoch from pg_postmaster_start_time()))::bigint,
  'backend_pid',pg_backend_pid(),'backend_stat',pg_read_file('/proc/self/stat',0,4096),
  'backend_sha256',encode(sha256(pg_read_binary_file('/proc/self/exe')),'hex'),
  'build',(SELECT jsonb_object_agg(name,setting) FROM pg_catalog.pg_config
    WHERE name IN ('VERSION','CONFIGURE','BINDIR','SHAREDIR')))::text;`;
export async function serverMetadata(id,run=docker,sql=metadataSql) {
  return JSON.parse(txt(await stage('server-compiled-build-and-self-executable',()=>run([
    'exec',id,'env','-i',path,'psql','-X','-Atq','-h','/var/run/postgresql','-p','5432',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql]))));
}
export async function liveIdentity(id,pg,run=docker,diagnostic=()=>{}) {
  const data=safePath(pg.data_directory);
  assert.match(pg.backend_sha256,/^[a-f0-9]{64}$/);
  const backend=procIdentity(pg.backend_stat);
  assert.equal(backend.pid,pg.backend_pid,'SQL backend PID differs from procfs');
  const script=`set -eu
    sed -n '1,3p' "$1/postmaster.pid"
    pid=$(head -n 1 "$1/postmaster.pid")
    case "$pid" in ''|*[!0-9]*) exit 1;; esac
    cat "/proc/$pid/stat"
    readlink -f "/proc/$pid/exe"
    sha256sum "/proc/$pid/exe"
    cat "/proc/$pid/stat"
    sed -n '1,3p' "$1/postmaster.pid"`;
  // Same UID is needed under Docker's ptrace restrictions. No capabilities added.
  const lines=txt(await stage('postmaster-procfs-as-postgres',()=>run([
    'exec','--user','postgres',id,'env','-i',path,'/bin/sh','-c',script,'sh',data]))).split('\n');
  assert.equal(lines.length,10,'Incomplete postmaster evidence');
  const [pid,directory,epoch,stat,executable,hash,statAfter,...pidAfter]=lines;
  safePath(executable);
  assert.match(hash,/^[a-f0-9]{64}  \/proc\/[1-9][0-9]*\/exe$/,'Malformed procfs hash');
  diagnostic({backend,backendSha256:pg.backend_sha256,postmaster:procIdentity(stat),
    postmasterAfter:procIdentity(statAfter),executable,postmasterSha256:hash.slice(0,64)});
  assert.deepEqual(pidAfter,[pid,directory,epoch],'Postmaster PID file changed');
  assert.match(pid,/^[1-9][0-9]*$/); assert.equal(directory,data);
  assert.match(epoch,/^[1-9][0-9]*$/);
  assert.equal(Number(epoch),pg.postmaster_start_epoch,'SQL and PID file start time differ');
  const proc=procIdentity(stat); assertStable(proc,procIdentity(statAfter));
  assert.equal(proc.pid,Number(pid)); assert.equal(backend.parentPid,proc.pid,'SQL backend is not a child of this postmaster');
  assert.equal(hash,pg.backend_sha256+'  /proc/'+pid+'/exe','Backend/postmaster executable bytes differ');
  const state=JSON.parse(txt(await stage('container-running-state',()=>run(['inspect','--format',
    '{"startedAt":{{json .State.StartedAt}},"running":{{.State.Running}},"restarts":{{.RestartCount}}}',id]))));
  assert.equal(state.running,true); assert.equal(state.restarts,0,'Container restarted');
  return {pid:proc.pid,startTicks:proc.startTicks,postmasterStart:pg.postmaster_start,
    dataDirectory:data,executable,sha256:pg.backend_sha256,container:state};
}
export async function capture(id,name,start,{run=docker,diagnostic=()=>{}}={}) {
  assert.match(id,/^[a-f0-9]{64}$/);
  const fields=txt(await run(['inspect','--format',
    '{{.Id}}|{{.Image}}|{{.Config.Image}}|{{.HostConfig.NetworkMode}}|{{.State.StartedAt}}|{{index .Config.Labels "system.run"}}|{{index .Config.Labels "system.test"}}',id])).split('|');
  assert.equal(fields.length,7);
  const [cid,imageId,imageTag,network,startedAt,runId,label]=fields;
  assert.equal(cid,id);assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
  assert.equal(imageTag,'public.ecr.aws/supabase/postgres:17.6.1.166');
  assert.equal(label,'private-auth-v1');assert.match(runId,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(network,`system-private-auth-${runId}`);assert.equal(name,network+'-db');
  assert(Date.parse(startedAt)>=Date.parse(start)-2000,'Not a same-run container');
  const img=txt(await run(['image','inspect','--format','{{.Id}}|{{.Os}}|{{.Architecture}}',imageId])).split('|');
  assert.equal(img[0],imageId);assert.equal(img[1],'linux');assert(img[2]);
  const repoDigests=JSON.parse(txt(await run(['image','inspect','--format','{{json .RepoDigests}}',imageId])));
  const identity={cid,runId,network,startedAt,imageId,imageTag,image:{os:img[1],arch:img[2],repoDigests}};
  diagnostic(identity);
  const pg=await serverMetadata(id,run);
  assert.match(pg.server_version,/^17\.6(?:[.\s]|$)/);assert.equal(pg.timezone,'UTC');
  assert.equal(pg.build.VERSION,'PostgreSQL 17.6');
  identity.build=pg.build;diagnostic(identity);
  const live=await liveIdentity(id,pg,run,probe=>{identity.processProbe=probe;diagnostic(identity);});
  identity.activeExecutable=live;
  identity.buildSource='pg_catalog.pg_config in backend hashing /proc/self/exe; parent/hash linked to postmaster';
  diagnostic(identity);
  // Authoritative binary evidence: the compiled original-build prefix names the
  // on-disk ELF that the live postmaster bytes must equal. The PATH bindir
  // "postgres" may be a launcher script and is never used for this comparison.
  const prefix=buildPrefix(pg.build.CONFIGURE);
  identity.originalBuild=originalBuildElf(prefix,live,await stage('original-build-elf',()=>run([
    'exec','--user','postgres',id,'env','-i',path,'/bin/sh','-c',`set -eu
      p="$1/bin/postgres"
      test -f "$p"
      od -An -tx1 -N4 "$p" | tr -d ' '
      readlink -f "$p"
      sha256sum "$p"`,'sh',prefix])));
  diagnostic(identity);
  // CLI paths/launcher hashes explain packaging; they are NOT acceptance evidence.
  const cli=txt(await stage('cli-packaging-diagnostics',()=>run(['exec',id,'env','-i',path,'/bin/sh','-c',`set -eu
    command -v pg_config
    readlink -f "$(command -v pg_config)"
    b=$(pg_config --bindir); printf '%s\\n' "$b"
    readlink -f "$b/postgres"
    sha256sum "$b/postgres"`]))).split('\n');
  assert.equal(cli.length,5);cli.slice(0,4).forEach(safePath);
  assert.match(cli[4],/^[a-f0-9]{64}  \/[a-zA-Z0-9_.+/-]+$/);
  identity.cliDiagnostic={path:cli[0],resolvedPath:cli[1],bindir:cli[2],launcher:cli[3],launcherSha256:cli[4].slice(0,64)};
  const root=systemTzRoot(pg.build.CONFIGURE); identity.tzRoot=root; diagnostic(identity);
  const tree=(script,label)=>stage(label,()=>run(['exec',id,'env','-i',path,'/bin/bash','-c',script,'bash',root],90000));
  const manifest=await tree(manifestScript,'timezone-manifest');
  const entries=validateManifest(manifest);
  const aliases=await tree(aliasesScript,'timezone-aliases');
  const aliasLines=aliases.toString('utf8').split('\n');
  assert.equal(aliasLines.pop(),'','Missing aliases LF');
  for(const line of aliasLines)
    assert.match(line,/^\.\/[a-zA-Z0-9_.+/-]+\t[a-zA-Z0-9_.+/-]+\t\/[a-zA-Z0-9_.+/-]+$/,'Unsafe alias serialization');
  const resolvedRoot=safePath(txt(await run(['exec',id,'readlink','-f',root])));
  const header=txt(await run(['exec',id,'head','-n','1',root+'/tzdata.zi']));
  assert.match(header,/^# version 20\d\d[a-z]$/);
  // Independent reads from inside a fresh server backend bind manifest bytes to
  // the server filesystem, rather than a host timezone tree or another container.
  const selected=[...zones,'tzdata.zi'];
  const checks=selected.map(z=>`'${z}',encode(sha256(pg_read_binary_file('${root}/${z}')),'hex')`).join(',');
  const serverHashes=await serverMetadata(id,run,`SELECT jsonb_build_object(${checks})::text;`);
  for(const z of selected) assert.equal(serverHashes[z],entries.get(z),'Server/manifest file mismatch: '+z);
  assert.deepEqual(await tree(manifestScript,'timezone-manifest-repeat'),manifest,'Timezone files changed during capture');
  assert.deepEqual(await tree(aliasesScript,'timezone-aliases-repeat'),aliases,'Timezone aliases changed during capture');
  const after=await serverMetadata(id,run);
  assert.deepEqual(after.build,pg.build,'Server build changed during capture');
  assertStable(live,await liveIdentity(id,after,run));
  Object.assign(identity,{serverVersion:pg.server_version,tzInfo:{header,resolvedRoot,serverHashes},
    manifestSha256:digest(manifest),manifestVersion:1,entries:entries.size,aliasesSha256:digest(aliases),
    aliasesFormat:'relative-path<TAB>link-target<TAB>resolved-path<LF>'});
  diagnostic(identity);
  return {runId,manifest,aliases,identity};
}
