// Disposable-only, real two-session owner-lock regressions. Fixtures commit.
// Existing System Local/Cloud targets are rejected before any SQL connection.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const actor = randomUUID();
const operator = randomUUID();
const socket = process.platform === 'win32'
  ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
const children = new Set();
let verifiedContainer;
let interrupted;

// Every spawned process has error handlers, a deadline, a single close promise,
// and TERM -> KILL escalation. Completion promises never reject unobserved.
function launch(args, label, timeoutMs = 60000) {
  const child = spawn('docker', ['--host', socket, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const proc = { child, label, output: '', stderr: '', fault: null, closed: false, ending: false };
  children.add(proc);
  let killTimer;
  proc.terminate = () => {
    if (proc.closed || killTimer) return;
    proc.ending = true;
    child.stdin.destroy();
    child.kill('SIGTERM');
    killTimer = setTimeout(() => { if (!proc.closed) child.kill('SIGKILL'); }, 2000);
  };
  const timer = setTimeout(() => {
    proc.fault ??= new Error(`${label}: process timeout`);
    proc.terminate();
  }, timeoutMs);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { proc.output += chunk; });
  child.stderr.on('data', (chunk) => { proc.stderr += chunk; });
  child.on('error', () => { proc.fault ??= new Error(`${label}: child process error`); });
  for (const [name, stream] of [['stdin', child.stdin], ['stdout', child.stdout], ['stderr', child.stderr]]) {
    stream.on('error', () => {
      proc.fault ??= new Error(`${label}: ${name} error`);
      proc.terminate();
    });
  }
  proc.done = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      proc.closed = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (code !== 0) {
        proc.fault ??= new Error(
            `${label}: exit ${code}, signal ${signal}\n` +
            `PostgreSQL stderr:\n${proc.stderr.trim().slice(-4000) || "(empty)"}\n` +
            `Process stdout:\n${proc.output.trim().slice(-1000) || "(empty)"}`
        );
      }
      else if (!proc.ending) proc.fault ??= new Error(`${label}: unexpected session close`);
      resolve();
    });
  });
  proc.send = (sql) => {
    if (proc.closed || proc.ending || proc.fault) throw new Error(`${label}: session is not writable`);
    child.stdin.write(`${sql}\n`);
  };
  proc.close = async () => {
    if (!proc.closed && !proc.ending) {
      proc.ending = true;
      child.stdin.end('\\q\n');
    }
    await proc.done;
    if (proc.fault) throw proc.fault;
  };
  return proc;
}

function checkChildren() {
  if (interrupted) throw interrupted;
  for (const proc of children) if (proc.fault) throw proc.fault;
}

async function waitLine(proc, prefix, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    checkChildren();
    const lines = proc.output.split(/\r?\n/);
    lines.pop(); // Ignore a partial last line, including a partially received JSON value.
    const matches = lines.filter((line) => line.startsWith(prefix));
    if (matches.length > 1) throw new Error(`${proc.label}: duplicate ${prefix}`);
    if (matches.length === 1) return matches[0].slice(prefix.length);
    if (proc.closed) throw new Error(`${proc.label}: closed before ${prefix}`);
    if (Date.now() >= deadline) throw new Error(`${proc.label}: timed out waiting for ${prefix}`);
    await delay(25);
  }
}

async function runDocker(args, label, input = '', timeoutMs = 15000) {
  const proc = launch(args, label, timeoutMs);
  proc.ending = true;
  proc.child.stdin.end(input);
  await proc.done;
  if (proc.fault) throw proc.fault;
  return proc.output.trim();
}

function openSession(label) {
  checkChildren();
  assert.ok(verifiedContainer, 'Target verification must precede every SQL connection');
  // Explicit Unix socket, port, database, user, clean environment and no psqlrc:
  // neither host environment nor container PG* defaults can route this to Cloud.
  return launch(['exec', '-i', verifiedContainer, 'env', '-i',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    `PGAPPNAME=completion-alias-${label}`,
    'PGOPTIONS=-c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000',
    'psql', '-X', '-Atq', '-h', '/var/run/postgresql', '-p', '5432',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], label);
}

async function execSql(sql, label) {
  const proc = openSession(label);
  proc.send(sql);
  await proc.close();
  checkChildren();
  return proc.output.trim();
}

async function proveOwnerWait(first, firstPid, secondPid) {
  assert.ok(Number.isSafeInteger(firstPid) && firstPid > 0);
  assert.ok(Number.isSafeInteger(secondPid) && secondPid > 0);
  assert.notEqual(firstPid, secondPid, 'Two distinct PostgreSQL backends required');
  const deadline = Date.now() + 10000;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const marker = `WAIT_${attempt}=`;
    first.send(`SELECT pg_catalog.pg_stat_clear_snapshot();
    SELECT '${marker}' || EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks held
      JOIN pg_catalog.pg_locks waiting ON waiting.locktype = held.locktype
        AND waiting.database = held.database AND waiting.classid = held.classid
        AND waiting.objid = held.objid AND waiting.objsubid = held.objsubid
      JOIN pg_catalog.pg_stat_activity activity ON activity.pid = waiting.pid
      WHERE held.pid = ${firstPid} AND waiting.pid = ${secondPid}
        AND held.locktype = 'advisory' AND held.granted AND NOT waiting.granted
        AND held.mode = 'ExclusiveLock' AND waiting.mode = 'ExclusiveLock'
        AND held.database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
        AND held.classid = ((hashtextextended('system.v1.progression.owner:${actor}', 0) >> 32)
          & 4294967295)::oid
        AND held.objid = (hashtextextended('system.v1.progression.owner:${actor}', 0)
          & 4294967295)::oid AND held.objsubid = 1
        AND activity.wait_event_type = 'Lock' AND activity.wait_event = 'advisory'
        AND ${firstPid} = ANY(pg_catalog.pg_blocking_pids(${secondPid}))
    )::text;`);
    if (await waitLine(first, marker) === 'true') {
      console.log(`Verified backend ${secondPid} waits on backend ${firstPid}'s owner advisory lock`);
      return;
    }
    await delay(50);
  }
  throw new Error('No proven owner advisory lock contention before deadline');
}

async function verifyTarget() {
  const env = process.env;
  const id = env.COMPLETION_ALIAS_DISPOSABLE_ID || env.SUPABASE_CI_CONTAINER_ID;
  assert.match(id ?? '', /^[a-f0-9]{64}$/, 'Explicit immutable disposable container ID required');
  assert.ok(!env.DOCKER_CONTEXT && (!env.DOCKER_HOST || env.DOCKER_HOST === socket), 'Unexpected Docker routing');
  if (env.COMPLETION_ALIAS_DISPOSABLE_ID) {
    const info = JSON.parse(await runDocker(['inspect', '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"label":{{json (index .Config.Labels "system.test")}},"network":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}},"ports":{{json .HostConfig.PortBindings}}}', id], 'verify isolated tmpfs target'));
    assert.match(info.name, /^\/system-completion-alias-test-[0-9]{8}[a-z]$/);
    assert.equal(info.id, id);
    assert.equal(info.running, true);
    assert.equal(info.label, 'completion-alias-v1');
    assert.equal(info.network, 'none');
    assert.deepEqual(info.mounts, []);
    assert.deepEqual(Object.keys(info.tmpfs), ['/var/lib/postgresql/data']);
    assert.ok(info.ports === null || Object.keys(info.ports).length === 0);
  } else {
    assert.equal(process.platform, 'linux');
    for (const key of ['CI','GITHUB_ACTIONS']) assert.equal(env[key], 'true');
    assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
    assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9][0-9]*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9][0-9]*$/);
    const project = `system-reopen-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
    assert.equal(env.SUPABASE_CI_DISPOSABLE, 'quest-reopen-v2');
    assert.equal(env.SUPABASE_CI_PROJECT_ID, project);
    assert.equal(env.SUPABASE_DB_CONTAINER, `supabase_db_${project}`);
    const info = JSON.parse(await runDocker(['inspect', '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}}}', id], 'verify CI target'));
    assert.deepEqual(info, { id, name: `/${env.SUPABASE_DB_CONTAINER}`, running: true, project });
  }
  verifiedContainer = id;
}

const authenticate = `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${actor}', true);`;
const complete = (f, command) => `public.complete_quest_occurrence('${command}', '${f.occurrence_id}', 1, NULL, 'web_ui')`;
const reopen = (f, command) => `public.reopen_quest_occurrence_v2('${command}', '${f.occurrence_id}', 1, 'web_ui')`;
const create = (command) => `public.create_one_off_quest('${command}', '{"title":"Alias concurrency","default_reward_exp":37,"scheduled_at":"2026-09-26T08:00:00Z"}', 'web_ui')`;
const resolve = (f, command) => `public.get_quest_completion_resolution_v1('${command}', '${f.occurrence_id}', 1)`;
async function rpc(expression) {
  const output = await execSql(`BEGIN; ${authenticate}
SELECT 'RESULT=' || to_jsonb(${expression})::text; COMMIT;`, 'rpc');
  return JSON.parse(output.split(/\r?\n/).find((line) => line.startsWith('RESULT=')).slice(7));
}
async function fixture(completed = true) {
  const f = await rpc(create(randomUUID()));
  if (completed) f.completion = await rpc(complete(f, randomUUID()));
  return f;
}
async function runRace(firstExpression, secondExpression, rejection = null, rollback = false) {
  const first = openSession('first');
  const second = openSession('second');
  first.send(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('system.v1.progression.owner:${actor}',0));
SELECT 'FIRST_PID=' || pg_backend_pid();`);
  const firstPid = Number(await waitLine(first, 'FIRST_PID='));
  second.send(`BEGIN; ${authenticate} SELECT 'SECOND_PID=' || pg_backend_pid();
${rejection ? `DO $reject$ BEGIN
  BEGIN PERFORM ${secondExpression}; RAISE EXCEPTION 'Expected rejection';
  EXCEPTION WHEN SQLSTATE '${rejection[0]}' THEN IF SQLERRM <> '${rejection[1]}' THEN RAISE; END IF; END;
END $reject$; SELECT 'RESULT=' || '{"rejected":true}';`
: `SELECT 'RESULT=' || to_jsonb(${secondExpression})::text;`}
COMMIT; SELECT 'DONE=committed';`);
  const secondPid = Number(await waitLine(second, 'SECOND_PID='));
  await proveOwnerWait(first, firstPid, secondPid);
  first.send(`${authenticate} SELECT 'RESULT=' || to_jsonb(${firstExpression})::text;
${rollback ? 'ROLLBACK' : 'COMMIT'}; SELECT 'DONE=finished';`);
  const a = JSON.parse(await waitLine(first, 'RESULT='));
  const b = JSON.parse(await waitLine(second, 'RESULT='));
  await waitLine(first, 'DONE=');
  await waitLine(second, 'DONE=');
  const closed = await Promise.allSettled([first.close(), second.close()]);
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
  return [a,b];
}
async function assertState(f, aliases, reopened = false) {
  const state = JSON.parse(await execSql(`SELECT jsonb_build_object(
    'completed', (SELECT count(*) FROM public.quest_events WHERE occurrence_id = '${f.occurrence_id}' AND event_type = 'completed'),
    'events', (SELECT count(*) FROM public.quest_events WHERE occurrence_id = '${f.occurrence_id}'),
    'credits', (SELECT count(*) FROM public.exp_ledger WHERE source_type = 'quest_completion' AND source_id = '${f.completion.completed_event_id}'),
    'reversals', (SELECT count(*) FROM public.exp_ledger WHERE reverses_entry_id = '${f.completion.exp_entry_id}'),
    'aliases', (SELECT count(*) FROM system_internal.quest_completion_aliases WHERE completed_event_id = '${f.completion.completed_event_id}'),
    'cycle', (SELECT execution_cycle FROM public.quest_occurrences WHERE id = '${f.occurrence_id}'),
    'status', (SELECT status FROM public.quest_occurrences WHERE id = '${f.occurrence_id}')
  );`, 'state'));
  assert.deepEqual(state, { completed: 1, events: reopened ? 4 : 2, credits: 1,
    reversals: reopened ? 1 : 0, aliases, cycle: reopened ? 2 : 1, status: reopened ? 'scheduled' : 'completed' });
}
const onSignal = (signal) => {
  interrupted ??= new Error(`Interrupted by ${signal}`);
  for (const proc of children) proc.terminate();
};
const onInt = () => onSignal('SIGINT');
const onTerm = () => onSignal('SIGTERM');
process.on('SIGINT', onInt);
process.on('SIGTERM', onTerm);
try {
  await verifyTarget();
  await execSql(`BEGIN;
INSERT INTO auth.users(id) VALUES ('${actor}'), ('${operator}');
INSERT INTO system_internal.operator_grants(user_id,capability) VALUES ('${operator}', 'level_policy_assign');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${operator}',true);
SELECT public.assign_level_policy('${actor}', (SELECT id FROM public.level_policies WHERE policy_key='level_policy_v1' AND status='published'), gen_random_uuid(), 'internal');
COMMIT;`, 'setup');
  const conflict = ['23505','Conflicting quest command reuse'];
  const stale = ['23514','Stale quest completion cycle'];
  {
    const f = await fixture(false), b = randomUUID();
    const [canonical, alias] = await runRace(complete(f, randomUUID()), complete(f, b));
    assert.equal(canonical.replay, false);
    assert.deepEqual(alias, { ...canonical, command_id: b, replay: true });
    f.completion = canonical;
    await assertState(f, 1);
  }
  {
    const f = await fixture(), b = randomUUID();
    const [a, repeated] = await runRace(complete(f,b), complete(f,b));
    assert.deepEqual(a,repeated);
    assert.deepEqual(a,{ ...f.completion, command_id:b, replay:true });
    await assertState(f,1);
  }
  {
    const f = await fixture(), b = randomUUID();
    const [lost] = await runRace(complete(f,b), reopen(f,randomUUID()));
    assert.deepEqual(await rpc(complete(f,b)), lost, 'Lost alias response resolves after reopen');
    await assertState(f,1,true);
  }
  {
    const f = await fixture(), b = randomUUID();
    await runRace(reopen(f,randomUUID()), complete(f,b), stale);
    const result = await rpc(resolve(f,b));
    assert.equal(result.outcome,'unrecorded_superseded');
    assert.equal(result.receipt,null);
    assert.equal(result.canonical_receipt.command_id,f.completion.command_id);
    await assertState(f,0,true);
  }
  for (const kind of ['create','reopen']) {
    for (const aliasFirst of [true,false]) {
      const f = await fixture(), b = randomUUID();
      const competing = kind === 'create' ? create(b) : reopen(f,b);
      await runRace(aliasFirst ? complete(f,b) : competing, aliasFirst ? competing : complete(f,b), conflict);
      await assertState(f,aliasFirst ? 1 : 0, !aliasFirst && kind === 'reopen');
    }
  }
  {
    const f = await fixture(), b = randomUUID();
    await runRace(complete(f,b), reopen(f,randomUUID()), null, true);
    assert.equal((await rpc(resolve(f,b))).outcome,'unrecorded_superseded');
    await assertState(f,0,true);
  }
  for (const aliasFirst of [true,false]) {
    const f = await fixture(), b = randomUUID();
    const [first,result] = await runRace(aliasFirst ? complete(f,b) : reopen(f,randomUUID()), resolve(f,b));
    assert.equal(result.outcome,aliasFirst ? 'recorded' : 'unrecorded_superseded');
    if (aliasFirst) assert.deepEqual(result.receipt,first);
    else assert.equal(result.receipt,null);
    await assertState(f,aliasFirst ? 1 : 0,!aliasFirst);
  }
  checkChildren();
  console.log('PASS: 11 proven two-session races; alias/reopen ordering, namespace conflicts, rollback and resolution');
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL: ${error.message}`);
  for (const proc of children) proc.terminate();
  if (verifiedContainer) {
    try {
      await runDocker(['stop', '--time', '5', verifiedContainer], 'stop failed disposable container');
    } catch {
      console.error('Failed to stop the verified disposable test container');
    }
  }
} finally {
  for (const proc of children) if (!proc.closed) proc.terminate();
  await Promise.all([...children].map((proc) => proc.done));
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
}
