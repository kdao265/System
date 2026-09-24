// Task: repair only the ADR-012 / Quest CR-07 concurrency regression and CI wiring.
// Runtime contract: GitHub-hosted Linux CI, a fresh run-scoped Supabase container,
// and its explicit immutable Docker ID. Never run this against a developer DB.
// Fixtures commit across connections; disposal belongs to `supabase stop --no-backup`.
// No history DELETEs, grants, migration changes, or dependencies are permitted here.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const actor = '00000000-0000-4000-8000-000000000901';
const operator = '00000000-0000-0000-0000-0000000000ee';
const fixtures = [
  { occurrence: '00000000-0000-4000-8000-000000000902', quest: '00000000-0000-4000-8000-000000000904',
    complete: '00000000-0000-4000-8000-000000000906', command: '00000000-0000-4000-8000-000000000909', amount: 10 },
  { occurrence: '00000000-0000-4000-8000-000000000903', quest: '00000000-0000-4000-8000-000000000905',
    complete: '00000000-0000-4000-8000-000000000907', command: '00000000-0000-4000-8000-000000000910', amount: 37 },
];
const staleCommand = '00000000-0000-4000-8000-000000000908';
const socket = 'unix:///var/run/docker.sock';
const children = new Set();
let verifiedContainer;
let interrupted;

function requireTarget() {
  const env = process.env;
  if (process.platform !== 'linux' || env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true'
      || env.RUNNER_ENVIRONMENT !== 'github-hosted'
      || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '')
      || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    throw new Error('Requires an explicitly configured disposable GitHub-hosted Linux CI run');
  }
  const project = `system-reopen-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  if (env.SUPABASE_CI_DISPOSABLE !== 'quest-reopen-v2'
      || env.SUPABASE_CI_PROJECT_ID !== project
      || env.SUPABASE_DB_CONTAINER !== `supabase_db_${project}`
      || !/^[a-f0-9]{64}$/.test(env.SUPABASE_CI_CONTAINER_ID ?? '')
      || (env.DOCKER_HOST && env.DOCKER_HOST !== socket) || env.DOCKER_CONTEXT) {
    throw new Error('Missing or unexpected disposable CI target configuration');
  }
  return { project, name: env.SUPABASE_DB_CONTAINER, id: env.SUPABASE_CI_CONTAINER_ID };
}

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
    `PGAPPNAME=reopen-v2-${label}`,
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

const authenticate = `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${actor}', true);`;
const reopen = (fixture, command) =>
  `public.reopen_quest_occurrence_v2('${command}', '${fixture.occurrence}', 1, 'web_ui')`;

async function verifyTarget() {
  const target = requireTarget(); // Must reject before even spawning Docker.
  // Inspect only nonsecret fields, and pin subsequent execs to the immutable ID.
  const info = JSON.parse(await runDocker(['inspect', '--type', 'container', '--format',
    '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}}}',
    target.id], 'verify disposable container'));
  assert.deepEqual(info, { id: target.id, name: `/${target.name}`, running: true, project: target.project },
    'Container identity, running state or Supabase project label mismatch');
  verifiedContainer = target.id;
}

async function prepareFixtures() {
  await execSql(`BEGIN;
  INSERT INTO auth.users (id) VALUES ('${actor}'), ('${operator}');
  INSERT INTO system_internal.operator_grants (user_id, capability)
  VALUES ('${operator}', 'level_policy_assign');
DO $setup$
DECLARE policy_id uuid;
BEGIN
    SELECT id INTO STRICT policy_id FROM public.level_policies
        WHERE policy_key = 'level_policy_v1' AND status = 'published';
    PERFORM set_config('request.jwt.claim.sub', '${operator}', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.assign_level_policy('${actor}', policy_id, gen_random_uuid(), 'internal');
    RESET ROLE;
END;
$setup$;
${fixtures.map((f) => `INSERT INTO public.quests (id, user_id, title, importance, default_reward_exp)
VALUES ('${f.quest}', '${actor}', 'Reopen V2 CI concurrency', 'side', ${f.amount});
INSERT INTO public.quest_occurrences
    (id, quest_id, user_id, status, execution_cycle, reward_exp_snapshot, scheduled_at, deadline_at)
VALUES ('${f.occurrence}', '${f.quest}', '${actor}', 'active', 1, ${f.amount},
    '2026-09-20T08:00:00Z', '2026-09-21T08:00:00Z');`).join('\n')}
COMMIT;`, 'fixtures');
  const output = await execSql(`BEGIN; ${authenticate}
${fixtures.map((f, i) => `SELECT 'COMPLETION_${i}=' || to_jsonb(public.complete_quest_occurrence(
    '${f.complete}', '${f.occurrence}', 1, '2026-09-20T09:00:00Z', 'web_ui'))::text;`).join('\n')}
COMMIT;`, 'complete');
  return fixtures.map((f, i) => {
    const lines = output.split(/\r?\n/).filter((line) => line.startsWith(`COMPLETION_${i}=`));
    assert.equal(lines.length, 1);
    const receipt = JSON.parse(lines[0].slice(`COMPLETION_${i}=`.length));
    assert.equal(receipt.command_id, f.complete);
    assert.equal(receipt.occurrence_id, f.occurrence);
    assert.equal(receipt.quest_id, f.quest);
    assert.equal(receipt.execution_cycle, 1);
    assert.equal(receipt.exp_amount, f.amount);
    assert.equal(receipt.replay, false);
    return receipt;
  });
}

// Inspect from the lock holder itself after RESET ROLE. The command still runs
// as authenticated; the harness never asks authenticated to SELECT FOR UPDATE.
// The owner advisory lock remains held across SET/RESET ROLE until COMMIT.
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

async function runRace(fixture, sameCommand) {
  const label = sameCommand ? 'same' : 'stale';
  const first = openSession(`${label}-first`);
  const second = openSession(`${label}-second`);
  first.send(`BEGIN; SET LOCAL ROLE quest_command_owner;
SELECT progression_internal.lock_owner('${actor}');
RESET ROLE;
SELECT 'FIRST_PID=' || pg_backend_pid();`);
  const firstPid = Number(await waitLine(first, 'FIRST_PID='));
  second.send(`BEGIN; ${authenticate}
SELECT 'SECOND_PID=' || pg_backend_pid();
${sameCommand ? `SELECT 'RECEIPT=' || to_jsonb(${reopen(fixture, fixture.command)})::text;` : `
DO $reject$
BEGIN
    BEGIN
        PERFORM ${reopen(fixture, staleCommand)};
        RAISE EXCEPTION 'Expected stale rejection';
    EXCEPTION WHEN SQLSTATE '23514' THEN
        IF SQLERRM <> 'Stale quest reopen cycle' THEN RAISE; END IF;
    END;
END;
$reject$;
SELECT 'STALE_REJECTED=23514:Stale quest reopen cycle';`}
COMMIT;
SELECT 'SECOND_DONE=committed';`);
  const secondPid = Number(await waitLine(second, 'SECOND_PID='));
  // A PID/start marker identifies the connection; ONLY pg_locks evidence above
  // permits the first command and COMMIT to proceed.
  await proveOwnerWait(first, firstPid, secondPid);
  first.send(`${authenticate}
SELECT 'RECEIPT=' || to_jsonb(${reopen(fixture, fixture.command)})::text;
COMMIT;
SELECT 'FIRST_DONE=committed';`);
  const fresh = JSON.parse(await waitLine(first, 'RECEIPT='));
  await waitLine(first, 'FIRST_DONE=');
  const replay = sameCommand ? JSON.parse(await waitLine(second, 'RECEIPT=')) : null;
  if (!sameCommand) assert.equal(await waitLine(second, 'STALE_REJECTED='), '23514:Stale quest reopen cycle');
  await waitLine(second, 'SECOND_DONE=');
  // Await both close paths even when one fails; close() is idempotent.
  const closed = await Promise.allSettled([first.close(), second.close()]);
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
  assert.equal(fresh.replay, false);
  if (sameCommand) assert.deepEqual(replay, { ...fresh, replay: true }, 'Entire replay receipt must match');
  else assert.ok(!second.output.includes('RECEIPT='), 'Stale command must not return a receipt');
  return fresh;
}

async function assertState(fixture, completion, receipt) {
  const state = JSON.parse(await execSql(`SELECT jsonb_build_object(
    'occurrence', (SELECT to_jsonb(o) FROM public.quest_occurrences o WHERE id = '${fixture.occurrence}'),
    'events', (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]') FROM public.quest_events e
        WHERE occurrence_id = '${fixture.occurrence}'),
    'ledger', (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]') FROM public.exp_ledger l
        WHERE user_id = '${actor}' AND (source_id IN
          (SELECT id FROM public.quest_events WHERE occurrence_id = '${fixture.occurrence}')
          OR reverses_entry_id = '${completion.exp_entry_id}'))
  );`, 'assert-state'));
  assert.equal(state.events.length, 3, 'Only completed, correction and reopened events');
  const oneEvent = (type) => {
    const matches = state.events.filter((event) => event.event_type === type);
    assert.equal(matches.length, 1, `Exactly one ${type}`);
    return matches[0];
  };
  const completed = oneEvent('completed');
  const correction = oneEvent('completion_corrected');
  const reopened = oneEvent('reopened');
  for (const event of state.events) {
    assert.equal(event.user_id, actor);
    assert.equal(event.quest_id, fixture.quest);
    assert.equal(event.occurrence_id, fixture.occurrence);
    assert.equal(event.actor_user_id, actor);
    assert.equal(event.payload_version, 1);
  }
  assert.equal(completed.id, completion.completed_event_id);
  assert.equal(completed.command_id, fixture.complete);
  assert.equal(completed.execution_cycle, 1);
  assert.equal(completed.payload.exp.ledger_entry_id, completion.exp_entry_id);
  assert.equal(completed.payload.exp.amount, fixture.amount);
  assert.equal(correction.command_id, fixture.command);
  assert.equal(correction.execution_cycle, 1);
  assert.equal(correction.related_event_id, completed.id);
  assert.equal(reopened.command_id, fixture.command);
  assert.equal(reopened.execution_cycle, 2);
  assert.equal(reopened.related_event_id, correction.id);
  assert.deepEqual(reopened.payload, { prior_status: 'completed', new_status: 'scheduled',
    prior_execution_cycle: 1, new_execution_cycle: 2 });
  assert.equal(state.ledger.length, 2, 'Exactly one credit and one reversal');
  const credit = state.ledger.find((entry) => entry.id === completion.exp_entry_id);
  const reversal = state.ledger.find((entry) => entry.id === receipt.reversal_entry_id);
  assert.ok(credit && reversal && credit !== reversal);
  assert.equal(credit.user_id, actor);
  assert.equal(credit.source_type, 'quest_completion');
  assert.equal(credit.source_id, completed.id);
  assert.equal(credit.reason, 'completion_reward');
  assert.equal(credit.amount, fixture.amount);
  assert.equal(credit.reverses_entry_id, null);
  assert.equal(reversal.user_id, actor);
  assert.equal(reversal.source_type, 'quest_completion_reversal');
  assert.equal(reversal.source_id, correction.id);
  assert.equal(reversal.reason, 'completion_reward_reversal');
  assert.equal(reversal.amount, -credit.amount);
  assert.equal(reversal.reverses_entry_id, credit.id);
  assert.deepEqual(correction.payload, {
    correction: { undo: true, original_completion_event_id: completed.id },
    exp: { source_type: 'quest_completion_reversal', source_id: correction.id,
      reason: 'completion_reward_reversal', amount: -fixture.amount,
      original_credit_entry_id: credit.id, reversal_entry_id: reversal.id },
  });
  assert.deepEqual(receipt, { command_id: fixture.command, occurrence_id: fixture.occurrence,
    quest_id: fixture.quest, undone_cycle: 1, correction_event_id: correction.id,
    reopened_event_id: reopened.id, reversal_entry_id: reversal.id, reversed_amount: -fixture.amount,
    original_credit_entry_id: credit.id, replay: false });
  const occurrence = state.occurrence;
  assert.equal(occurrence.user_id, actor);
  assert.equal(occurrence.quest_id, fixture.quest);
  assert.equal(occurrence.status, 'scheduled');
  assert.equal(occurrence.execution_cycle, 2);
  assert.equal(occurrence.reward_exp_snapshot, fixture.amount);
  for (const field of ['recorded_completed_at', 'reported_completed_at', 'failure_reason']) {
    assert.equal(occurrence[field], null, `Cleared ${field}`);
  }
  assert.equal(Date.parse(occurrence.scheduled_at), Date.parse('2026-09-20T08:00:00Z'));
  assert.equal(Date.parse(occurrence.deadline_at), Date.parse('2026-09-21T08:00:00Z'));
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
  const completions = await prepareFixtures();
  for (const [index, fixture] of fixtures.entries()) {
    const receipt = await runRace(fixture, index === 0);
    await assertState(fixture, completions[index], receipt);
  }
  const totals = JSON.parse(await execSql(`SELECT jsonb_build_object(
    'events', (SELECT count(*) FROM public.quest_events WHERE user_id = '${actor}'),
    'stale_events', (SELECT count(*) FROM public.quest_events WHERE command_id = '${staleCommand}'),
    'ledger', (SELECT count(*) FROM public.exp_ledger WHERE user_id = '${actor}'),
    'exp', (SELECT sum(amount) FROM public.exp_ledger WHERE user_id = '${actor}')
  );`, 'assert-totals'));
  assert.deepEqual(totals, { events: 6, stale_events: 0, ledger: 4, exp: 0 });
  checkChildren();
  console.log('PASS: proven owner-lock contention, exact same-command replay and different-command stale rejection');
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL: ${error.message}`);
  for (const proc of children) proc.terminate();
  // Killing a docker exec client alone may leave its backend alive. Stop ONLY
  // the verified disposable container to terminate all server work on failure.
  if (verifiedContainer) {
    try {
      await runDocker(['stop', '--time', '5', verifiedContainer], 'stop failed disposable container');
    } catch {
      console.error('Container stop failed; CI must dispose the isolated project with --no-backup');
    }
  }
} finally {
  for (const proc of children) if (!proc.closed) proc.terminate();
  await Promise.all([...children].map((proc) => proc.done));
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
}
