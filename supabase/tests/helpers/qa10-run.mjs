// CI-only wrapper; never owns or mutates Docker resources. Existing runner does cleanup.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { dbs,capture,docker,digest,host } from './qa10-capture.mjs';
const E=process.env;
const paths=['review/sql/REVIEW_ONLY_create_activities_opportunities_v1.sql',
  'tests/helpers/auth-environment.mjs','supabase/tests/ao-review-disposable-wire.mjs',
  'supabase/tests/helpers/ao-batch-a-p0.mjs','supabase/tests/helpers/ao-residual-evidence.mjs',
  'supabase/tests/helpers/ao-residual-p0-closure.mjs','supabase/tests/ao-catalog.sql',
  'src/features/activities-opportunities/model.ts','package-lock.json'];
const hashes=()=>Object.fromEntries(paths.map(p=>[p,digest(readFileSync(p))]));
async function main(){
  assert.equal(process.platform,'linux');assert.equal(E.CI,'true');
  assert.equal(E.GITHUB_EVENT_NAME,'pull_request');assert.equal(E.GITHUB_BASE_REF,'main');
  assert.equal(E.GITHUB_HEAD_REF,'test/ao-l1-06-disposable-qa');
  assert.equal(E.DOCKER_HOST,host);assert.equal(E.DOCKER_CONTEXT??'','');
  assert.equal(E.SYSTEM_E2E_PRESERVE??'','');assert.equal(E.AO_DISPOSABLE_QA_APPROVED,'YES');
  assert.match(E.AO_EXPECTED_PR_HEAD??'',/^[a-f0-9]{40}$/);
  assert.match(E.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(E.GITHUB_RUN_ID??'',/^\d+$/);
  assert.equal(digest(readFileSync(paths[0])),
    '409aef907f98887bd2a1486d412db2609f24dce611615fc33ee95c2cceac2772');
  assert(E.RUNNER_TEMP);const out=join(E.RUNNER_TEMP,'ao-qa10-provenance');
  assert(resolve(out).startsWith(resolve(E.RUNNER_TEMP)+'/'));mkdirSync(out);
  const before=hashes(),baseline=new Set((await dbs()).map(x=>x[0]));
  const startedAt=new Date().toISOString();
  const record={schema:'system.ao.qa10.same-run.v1',startedAt,status:'PENDING',
    github:{head:E.AO_EXPECTED_PR_HEAD,merge:E.GITHUB_SHA,run:E.GITHUB_RUN_ID,attempt:E.GITHUB_RUN_ATTEMPT},
    node:{version:process.versions.node,icu:process.versions.icu,tzdb:process.versions.tz},sources:before,
    limitation:'Finite zone corpus only; retained-data cross-upgrade rehearsal is NOT verified.'};
  const child=spawn(process.execPath,['supabase/tests/ao-review-disposable-wire.mjs'],{
    env:{...E,SYSTEM_E2E_PRESERVE:'0'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',s=>process.stdout.write(s));child.stderr.on('data',s=>process.stderr.write(s));
  const done=new Promise(resolve=>{child.once('error',()=>resolve(127));
    child.once('exit',(code,sig)=>resolve(code??(sig?128:127)));});
  let finished=false,proof=null,observerError=null;
  const watch=(async()=>{
    for(let i=0;i<360&&!finished;i++){
      const next=(await dbs()).filter(x=>!baseline.has(x[0]));
      assert(next.length<=1,'Ambiguous test container');
      if(next.length){proof=await capture(...next[0],startedAt);
        writeFileSync(join(out,'timezone-manifest-v1.sha256'),proof.manifest,{flag:'wx'});
        writeFileSync(join(out,'timezone-aliases.tsv'),proof.aliases,{flag:'wx'});
        console.log('QA-10 same-run manifest SHA-256: '+proof.identity.manifestSha256);return;}
      await sleep(500);
    }
    throw Error('No new owned DB observed');
  })().catch(e=>{observerError=e.message;console.error('QA-10 OBSERVER: '+e.message)});
  record.runtimeExit=await done;finished=true;await watch;
  if(proof){record.postgres=proof.identity;
    const containers=(await docker(['ps','-a','--no-trunc','--filter',
      'label=system.run='+proof.runId,'--format','{{.ID}}'])).toString('utf8').trim();
    const networks=(await docker(['network','ls','--filter',
      'label=system.run='+proof.runId,'--format','{{.ID}}'])).toString('utf8').trim();
    record.cleanup=!containers&&!networks?'PASS':'PENDING';
  }else record.cleanup='UNVERIFIED';
  record.observerError=observerError;
  record.integrity=JSON.stringify(before)===JSON.stringify(hashes())?'PASS':'FAIL';
  record.status=record.runtimeExit===0&&proof&&!observerError&&record.cleanup==='PASS'&&record.integrity==='PASS'?'PASS':'FAIL';
  record.finishedAt=new Date().toISOString();
  writeFileSync(join(out,'provenance.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  console.log('QA-10 PROVENANCE '+record.status+' runtime='+record.runtimeExit+' cleanup='+record.cleanup);
  if(record.status!=='PASS')process.exitCode=1;
}
await main();
