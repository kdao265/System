// Standalone diagnosis: one owned, network-isolated, tmpfs-only image fixture.
// No external DB target, passwords, environment dump, or application SQL.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
const exec = promisify(execFile);
const host = process.platform === 'win32'
  ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
assert(!process.env.DOCKER_CONTEXT && (!process.env.DOCKER_HOST || process.env.DOCKER_HOST === host));
assert.equal(process.env.AO_DISPOSABLE_QA_APPROVED, 'YES');
const name = 'qa10-diagnose-' + randomUUID();
const image = 'public.ecr.aws/supabase/postgres:17.6.1.166';
async function docker(args, env = process.env) {
  try { return (await exec('docker', ['--host', host, ...args],
    { env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout.trim(); }
  catch (error) {
    // Commands below emit only approved metadata; never return stderr/argv/env.
    if (args[0] === 'exec') console.log(error.stdout ?? '');
    throw Error('Diagnostic Docker operation failed: ' + args[0]);
  }
}
let id;
try {
  id = await docker(['run', '-d', '--pull=never', '--name', name, '--network', 'none',
    '--label', 'system.test=qa10-diagnose', '--tmpfs', '/var/lib/postgresql/data:rw',
    '-e', 'POSTGRES_PASSWORD', image], { ...process.env, POSTGRES_PASSWORD: randomBytes(32).toString('hex') });
  assert.match(id, /^[a-f0-9]{64}$/);
  let ready = false;
  for (let i = 0; i < 180; i++) {
    if ((await docker(['logs', id])).includes('ready for start up')) { ready = true; break; }
    await sleep(500);
  }
  assert(ready, 'Disposable PostgreSQL not ready');
  console.log(await docker(['inspect', '--format', '{{.Id}}|{{.Image}}|{{.HostConfig.NetworkMode}}', id]));
  const sql = `SELECT jsonb_build_object('version',version(),
    'data_directory',current_setting('data_directory'),
    'postmaster_start',pg_postmaster_start_time(),
    'backend_pid',pg_backend_pid(),
    'backend_stat',pg_read_file('/proc/self/stat',0,4096),
    'backend_sha256',encode(sha256(pg_read_binary_file('/proc/self/exe')),'hex'),
    'build',(SELECT jsonb_object_agg(name,setting) FROM pg_catalog.pg_config
      WHERE name IN ('VERSION','BINDIR','CONFIGURE','SHAREDIR')))::text;`;
  const metadata=JSON.parse(await docker(['exec', id, 'env', '-i',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'psql', '-X', '-Atq', '-h', '/var/run/postgresql', '-U', 'supabase_admin',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]));
  console.log(JSON.stringify(metadata));
  const cliConfigure=await docker(['exec',id,'env','-i',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','pg_config','--configure']);
  assert.equal(cliConfigure,metadata.build.CONFIGURE.trim(),'CLI/server compiled configuration differs');
  const prefix=metadata.build.CONFIGURE.match(/'--prefix=(\/[a-zA-Z0-9_.+/-]+)'/)?.[1];
  assert(prefix && !prefix.includes('..'),'Unrecognized original build prefix');
  console.log(await docker(['exec', '--user', 'postgres', id, 'env', '-i',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '/bin/bash', '-c', `set -euo pipefail
    pid=$(head -n 1 /var/lib/postgresql/data/postmaster.pid)
    printf 'comm='; cat /proc/$pid/comm
    printf 'uid='; sed -n '/^Uid:/p' /proc/$pid/status
    printf 'live='; readlink -f /proc/$pid/exe
    printf 'PATH-pg_config='; command -v pg_config
    printf 'resolved-pg_config='; readlink -f "$(command -v pg_config)"
    b=$(pg_config --bindir)
    printf 'bindir=%s\\n' "$b"
    sha256sum /proc/$pid/exe "$b/postgres" "$1/bin/postgres" "$(command -v pg_config)" "$1/bin/pg_config"
    test "$(sha256sum /proc/$pid/exe | cut -d ' ' -f 1)" = "$(sha256sum "$1/bin/postgres" | cut -d ' ' -f 1)"
    test "$(sha256sum "$(command -v pg_config)" | cut -d ' ' -f 1)" = "$(sha256sum "$1/bin/pg_config" | cut -d ' ' -f 1)"
    printf 'launcher-prefix='; head -c 4 "$b/postgres"; printf '\\n'
    if test "$(head -c 2 "$b/postgres")" = '#!'; then cat "$b/postgres"; fi
  `,'bash',prefix]));
  console.log('CLI/server CONFIGURE agrees; original-build postgres and pg_config copies verified by SHA-256');
} finally {
  if (id) {
    assert.equal(await docker(['inspect', '--format', '{{.Name}}|{{index .Config.Labels "system.test"}}', id]),
      '/' + name + '|qa10-diagnose');
    await docker(['rm', '-f', id]);
    console.log('Owned diagnostic fixture removed');
  }
}
