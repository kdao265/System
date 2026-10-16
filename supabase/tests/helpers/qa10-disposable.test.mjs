// Opt-in integration checks own every resource; never accepts external DB targets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture, docker, host, serverMetadata, liveIdentity, assertStable, manifestScript, aliasesScript } from './qa10-capture.mjs';
const exec=promisify(execFile);
test('real image: wrapper mismatch, linked backend/build and stable timezone manifest',{
  skip:process.env.AO_DISPOSABLE_QA_APPROVED!=='YES',timeout:180000,
},async()=>{
  assert(!process.env.DOCKER_CONTEXT && (!process.env.DOCKER_HOST || process.env.DOCKER_HOST===host));
  const runId=randomUUID(),network='system-private-auth-'+runId,name=network+'-db';
  const labels=['--label','system.test=private-auth-v1','--label','system.run='+runId];
  const startedAt=new Date().toISOString();let id,networkId;
  try {
    networkId=(await docker(['network','create','--internal',...labels,network])).toString().trim();
    // Password is generated in child env; never retained in command text or logs.
    try {
      id=(await exec('docker',['--host',host,'run','-d','--pull=never','--name',name,
        '--network',network,...labels,'--tmpfs','/var/lib/postgresql/data:rw',
        '-e','POSTGRES_PASSWORD','public.ecr.aws/supabase/postgres:17.6.1.166'],{
        env:{...process.env,POSTGRES_PASSWORD:randomBytes(32).toString('hex')},windowsHide:true,
      })).stdout.trim();
    } catch {throw Error('Owned diagnostic fixture could not start');}
    assert.match(id,/^[a-f0-9]{64}$/);
    let ready=false;
    for(let n=0;n<180;n++) {
      if((await docker(['logs',id])).toString().includes('ready for start up')) {ready=true;break;}
      await sleep(500);
    }
    assert(ready,'Final postmaster did not become ready');
    let progress;
    const proof=await capture(id,name,startedAt,{diagnostic:value=>{progress=structuredClone(value);}});
    assert.equal(proof.identity.entries,1807);
    assert.notEqual(proof.identity.activeExecutable.sha256,proof.identity.cliDiagnostic.launcherSha256,
      'Known image must reproduce the old wrapper-versus-ELF comparison failure');
    assert.equal(progress.manifestSha256,proof.identity.manifestSha256);
    const pg=await serverMetadata(id);
    assertStable(proof.identity.activeExecutable,await liveIdentity(id,pg));
    assert.equal(proof.identity.originalBuild.sha256,proof.identity.activeExecutable.sha256,
      'Live postmaster ELF must byte-equal the original-build executable');
    // The compiled original-build prefix is the only acceptable comparison
    // target; injected launcher bytes for that path fail closed, never pass.
    const prefix=proof.identity.originalBuild.prefix;
    await assert.rejects(capture(id,name,startedAt,{run:async(args,...rest)=>{
      if(args[0]==='exec'&&args.at(-1)===prefix)
        return Buffer.from('23212f62696e2f62617368\n'+prefix+'/bin/postgres\n'+
          'b'.repeat(64)+'  '+prefix+'/bin/postgres\n');
      return docker(args,...rest);
    }}),/Original-build postgres is not an ELF executable/);
    // Fault injection at Docker boundary: absence of procfs never gets a CLI fallback.
    await assert.rejects(capture(id,name,startedAt,{run:async(args,...rest)=>{
      if(args.includes('--user')) throw Error('simulated procfs denial');
      return docker(args,...rest);
    }}),/postmaster-procfs-as-postgres/);
    // Exercise the actual production scripts against failed traversal, cycles,
    // dangling links and aliases into an external directory in our own fixture.
    const tree=(script,root)=>docker(['exec',id,'/bin/bash','-c',script,'bash',root]);
    await assert.rejects(tree(manifestScript,'/qa10-nonexistent'));
    await docker(['exec',id,'/bin/sh','-c',`set -eu
      mkdir -p /tmp/qa10-cycle /tmp/qa10-dangling /tmp/qa10-links /tmp/qa10-external
      ln -s . /tmp/qa10-cycle/loop
      ln -s /qa10-missing /tmp/qa10-dangling/link
      printf zone > /tmp/qa10-external/zone
      ln -s zone /tmp/qa10-external/alias
      ln -s /tmp/qa10-external /tmp/qa10-links/directory`]);
    await assert.rejects(tree(manifestScript,'/tmp/qa10-cycle'));
    await assert.rejects(tree(aliasesScript,'/tmp/qa10-dangling'));
    const nested=(await tree(aliasesScript,'/tmp/qa10-links')).toString();
    assert(nested.includes('./directory/alias\tzone\t/tmp/qa10-external/zone\n'));
    const out=mkdtempSync(join(tmpdir(),'system-qa10-evidence-'));
    writeFileSync(join(out,'identity.json'),JSON.stringify(proof.identity,null,2)+'\n');
    writeFileSync(join(out,'timezone-manifest-v1.sha256'),proof.manifest);
    writeFileSync(join(out,'timezone-aliases.tsv'),proof.aliases);
    console.log('QA-10 disposable evidence: '+out);
  } finally {
    if(id) {
      const ownership=(await docker(['inspect','--format','{{.Name}}|{{index .Config.Labels "system.run"}}',id])).toString().trim();
      assert.equal(ownership,'/'+name+'|'+runId);await docker(['rm','-f',id]);
    }
    if(networkId) {
      const ownership=(await docker(['network','inspect','--format','{{.Name}}|{{index .Labels "system.run"}}',networkId])).toString().trim();
      assert.equal(ownership,network+'|'+runId);await docker(['network','rm',networkId]);
    }
  }
});
