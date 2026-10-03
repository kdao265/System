// Build an allowlisted source copy with synthetic loopback configuration, never .env files.
import assert from 'node:assert/strict';
import { cpSync,mkdirSync,mkdtempSync,symlinkSync,rmSync,unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join,resolve,dirname } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const parent=resolve(root,'.e2e');mkdirSync(parent,{recursive:true});
const directory=mkdtempSync(join(parent,'calendar-plan-build-'));
assert.equal(dirname(resolve(directory)),parent);
try{
  for(const file of ['src','public','next.config.ts','tsconfig.json','postcss.config.mjs','package.json','package-lock.json'])cpSync(join(root,file),join(directory,file),{recursive:true});
  symlinkSync(join(root,'node_modules'),join(directory,'node_modules'),process.platform==='win32'?'junction':'dir');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|CI)$/i.test(key)));
  Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-build-only',SYSTEM_OWNER_USER_ID:'11111111-1111-4111-8111-111111111111',NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production'});
  const code=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'build'],{cwd:directory,env,stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',done);
  });
  process.exitCode=code??1;
}finally{
  // Validate our generated source copy and unlink the dependency junction before removing it.
  assert.equal(dirname(resolve(directory)),parent);
  try{unlinkSync(join(directory,'node_modules'));}catch(error){if(error.code!=='ENOENT')throw error;}
  rmSync(directory,{recursive:true,force:true});
}
