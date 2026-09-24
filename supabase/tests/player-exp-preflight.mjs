// Execute the actual migration preflight against rollback-only local fixtures.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dockerSocket = 'unix:///var/run/docker.sock';
const timeoutMs = 60000;

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
            || env.DOCKER_HOST !== dockerSocket
            || env.DOCKER_CONTEXT) {
        throw new Error('Missing or unexpected disposable CI target configuration');
    }
    return { project, name: env.SUPABASE_DB_CONTAINER, id: env.SUPABASE_CI_CONTAINER_ID };
}

function runDocker(args, input = '') {
    const result = spawnSync('docker', ['--host', dockerSocket, ...args], {
        input,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`docker command failed: ${(result.stderr ?? '').trim()}`);
    }
    return result.stdout ?? '';
}

function verifyTarget() {
    const target = requireTarget();
    const output = runDocker(['inspect', '--type', 'container', '--format',
        '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}}}',
        target.id]);
    let info;
    try {
        info = JSON.parse(output.trim());
    } catch (error) {
        throw new Error(`Could not parse disposable container identity: ${error.message}`);
    }
    if (JSON.stringify(info) !== JSON.stringify({
        id: target.id,
        name: `/${target.name}`,
        running: true,
        project: target.project,
    })) {
        throw new Error('Container identity, running state or Supabase project label mismatch');
    }
    return target.id;
}

const migration = readFileSync(new URL('../migrations/20260919063117_create_exp_ledger.sql', import.meta.url), 'utf8');
const preflight = migration.match(/DO \$preflight\$[\s\S]*?\$preflight\$;/)?.[0];
if (!preflight) throw new Error('Migration preflight not found');
const expectRejection = `
DO $test$
DECLARE rejected boolean := false;
BEGIN
    BEGIN
        EXECUTE $migration$${preflight}$migration$;
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Existing completion history requires reviewed EXP reconciliation' THEN RAISE; END IF;
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Preflight accepted existing completion facts'; END IF;
END;
$test$;`;
const sql = `
BEGIN;
-- Requires a freshly reset local database; do not delete existing user data.
${preflight}
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000901');
INSERT INTO public.quests(id,user_id,title) VALUES
('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901','Preflight test');
INSERT INTO public.quest_occurrences(id,quest_id,user_id,reward_exp_snapshot) VALUES
('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901',0);
SAVEPOINT fixture;
-- Completed projection without ANY completed event must block.
UPDATE public.quest_occurrences SET status='completed',recorded_completed_at=now()
WHERE id='00000000-0000-4000-8000-000000000903';
${expectRejection}
ROLLBACK TO SAVEPOINT fixture;
-- Completed event with an unfinished projection must independently block.
INSERT INTO public.quest_events(quest_id,user_id,occurrence_id,event_type,actor_kind,actor_user_id,command_id,execution_cycle)
VALUES('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000901',
'00000000-0000-4000-8000-000000000903','completed','user','00000000-0000-4000-8000-000000000901',gen_random_uuid(),1);
${expectRejection}
ROLLBACK;
`;

// Verify the immutable target before opening any PostgreSQL connection.
const containerId = verifyTarget();
const result = runDocker(['exec', '-i', containerId, 'env', '-i',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'PGOPTIONS=-c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000',
    'psql', '-X', '-h', '/var/run/postgresql', '-p', '5432',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql);
process.stdout.write(result);
console.log('PASS: actual preflight accepts empty history and rejects each completion condition independently; fixtures rolled back.');
