// Strictly selected, read-only metadata from the same disposable PostgreSQL container.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
const exec = promisify(execFile);
export const host = 'unix:///var/run/docker.sock';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const txt = b => b.toString('utf8').trim();
// Docker child output is deliberately hidden: only an approved stage label reaches CI.
const stage = async (label, task) => {try {return await task();} catch(e) {throw Error(label+': '+e.message);}};
export async function docker(args, timeout=20000) {
  try { return (await exec('docker',['--host',host,...args],{
    encoding:'buffer',timeout,maxBuffer:8*1024*1024,windowsHide:true})).stdout; }
  catch(e) { throw Error(`Docker ${args[0]} ${args[1]??''} failed (${e.code??'unknown'})`); }
}
export async function dbs(){
  const out=txt(await docker(['ps','-a','--no-trunc','--filter','label=system.test=private-auth-v1','--format','{{.ID}}|{{.Names}}']));
  return out?out.split('\n').map(s=>s.split('|')).filter(([id,n])=>/^[a-f0-9]{64}$/.test(id)&&/^system-private-auth-[0-9a-f-]{36}-db$/.test(n)):[];
}
export async function capture(id,name,start){
  assert.match(id,/^[a-f0-9]{64}$/);
  const fields=txt(await docker(['inspect','--format',
    '{{.Id}}|{{.Image}}|{{.Config.Image}}|{{.HostConfig.NetworkMode}}|{{.State.StartedAt}}|{{index .Config.Labels "system.run"}}|{{index .Config.Labels "system.test"}}',id])).split('|');
  assert.equal(fields.length,7);
  const [cid,imageId,imageTag,network,startedAt,runId,label]=fields;
  assert.equal(cid,id);assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
  assert.equal(imageTag,'public.ecr.aws/supabase/postgres:17.6.1.166');
  assert.equal(label,'private-auth-v1');
  assert.match(runId,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(network,`system-private-auth-${runId}`);assert.equal(name,network+'-db');
  assert(Date.parse(startedAt)>=Date.parse(start)-2000,'Not a same-run container');
  const img=txt(await docker(['image','inspect','--format','{{.Id}}|{{.Os}}|{{.Architecture}}',imageId])).split('|');
  assert.equal(img[0],imageId);assert.equal(img[1],'linux');assert(img[2]);
  const repoDigests=JSON.parse(txt(await docker(['image','inspect','--format','{{json .RepoDigests}}',imageId])));
  // Server SQL needs only normal GUC/catalog access; pg_config view can be
  // superuser-only in PostgreSQL 17. Read installation flags from its CLI first.
  const sql=`SELECT jsonb_build_object('server_version',current_setting('server_version'),
    'timezone',current_setting('TimeZone'),
    'zones',(SELECT count(*) FROM pg_catalog.pg_timezone_names))::text;`;
  let pg;
  for(let i=0;i<60;i++){
    try { pg=JSON.parse(txt(await docker(['exec',id,'env','-i',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'psql','-X','-Atq','-h','/var/run/postgresql','-p','5432',
      '-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql]))); break; }
    catch(e){if(i===59)throw Error('PostgreSQL basic metadata unavailable: '+e.message);await sleep(500);}
  }
  assert.match(pg.server_version,/^17\.6(?:[.\s]|$)/);assert.equal(pg.timezone,'UTC');
  const path='PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  async function buildFlag(option,viewName){
    try {
      return {value:txt(await docker(['exec',id,'env','-i',path,'pg_config',option])),
        source:'pg_config CLI in the same identified container'};
    } catch {
      // pg_catalog.pg_config may be restricted to superusers. Its rejection is
      // never treated as proof of a build value; both failures block provenance.
      const query="SELECT setting FROM pg_catalog.pg_config WHERE name='"+viewName+"';";
      try {
        return {value:txt(await docker(['exec',id,'env','-i',path,'psql','-X','-Atq',
          '-h','/var/run/postgresql','-p','5432','-U','postgres','-d','postgres',
          '-v','ON_ERROR_STOP=1','-c',query])),
          source:'pg_catalog.pg_config view in the same identified container'};
      } catch(e){throw Error('Build metadata unavailable ('+viewName+'): CLI and view rejected');}
    }
  }
  const configure=await stage('postgres-build-flags',()=>buildFlag('--configure','CONFIGURE'));
  const version=await stage('postgres-build-version',()=>buildFlag('--version','VERSION'));
  assert.match(version.value,/PostgreSQL 17\.6\b/,'Build/client version differs from live PostgreSQL 17.6');
  const z=configure.value.match(/--with-system-tzdata=(?:'([^']+)'|"([^"]+)"|([^\s'";]+))/);
  assert(z,'Missing system tzdata build configuration');const root=z[1]??z[2]??z[3];
  assert.match(root,/^\/[a-zA-Z0-9_.+/-]+$/);assert(!root.includes('..'));
  const tzInfo=txt(await stage('tzdata-header',()=>docker(['exec',id,'/bin/sh','-c',`set -eu
    root="$1"; test -f "$root/tzdata.zi"
    head -n 1 "$root/tzdata.zi"; sha256sum "$root/tzdata.zi"
    printf 'RESOLVED=%s\\n' "$(readlink -f "$root")"`,'sh',root])));
  assert.match(tzInfo,/# version 20\d\d[a-z]/);
  const manifest=await stage('timezone-manifest',()=>docker(['exec',id,'/bin/sh','-c',`set -eu
    export LC_ALL=C; cd -- "$1"
    find -L . -type f -print0 | sort -z | xargs -0 -r sha256sum`,'sh',root],90000));
  const lines=manifest.toString('utf8').split('\n');
  assert.equal(lines.at(-1),'','Missing LF');assert.equal(lines.length-1,1807,'Timezone tree entries differ from reviewed baseline');
  assert(lines.slice(0,-1).every(x=>/^[a-f0-9]{64}  \.\/[a-zA-Z0-9_.+/-]+$/.test(x)),'Unexpected manifest');
  for(const zone of ['America/New_York','Europe/Berlin','Asia/Ho_Chi_Minh','Pacific/Auckland','UTC'])
    assert(lines.some(x=>x.endsWith('  ./'+zone)),'Missing zone '+zone);
  const aliases=await stage('timezone-aliases',()=>docker(['exec',id,'/bin/sh','-c',`set -eu
    export LC_ALL=C; cd -- "$1"
    find . -type l -print | sort | while IFS= read -r f; do
      printf '%s\\t%s\\n' "$f" "$(readlink "$f")"
    done`,'sh',root]));
  return {runId,manifest,aliases,identity:{cid,runId,network,startedAt,imageId,imageTag,
    image:{os:img[1],arch:img[2],repoDigests},postgres:pg,
    buildVersion:version.value,buildVersionSource:version.source,
    buildConfigureSource:configure.source,
    activeExecutable:'NOT_INSPECTED; server binary path linkage pending separate review',
    serverVersion:pg.server_version,tzRoot:root,tzInfo,manifestSha256:digest(manifest),
    manifestVersion:1,entries:lines.length-1,aliasesSha256:digest(aliases)}};
}
