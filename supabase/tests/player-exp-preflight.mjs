// Execute the actual migration preflight against rollback-only local fixtures.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
const result = spawnSync('docker', ['exec', '-i', 'supabase_db_System', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('PASS: actual preflight accepts empty history and rejects each completion condition independently; fixtures rolled back.');
