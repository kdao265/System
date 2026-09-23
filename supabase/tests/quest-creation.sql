\set ON_ERROR_STOP on
-- Transactional behavior/security suite for one-off Quest creation.
-- Run only against a disposable local database; this file never commits.
BEGIN;
GRANT quest_command_owner TO CURRENT_USER;
CREATE SCHEMA creation_test;
CREATE FUNCTION creation_test.assert_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END;
$fn$;
CREATE FUNCTION creation_test.reject(statement text, states text[], label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN IF SQLSTATE = ANY(states) THEN RETURN; END IF;
        RAISE EXCEPTION 'Unexpected %: % %', label, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected rejection: %', label;
END;
$fn$;
CREATE FUNCTION creation_test.fail_after_staging() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.event_type = 'scheduled' THEN
        RAISE EXCEPTION 'test failure after Quest rows staged' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$fn$;
GRANT USAGE ON SCHEMA creation_test TO authenticated, anon, quest_command_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA creation_test TO authenticated, anon, quest_command_owner;

DO $behavior$
DECLARE
    a uuid := '00000000-0000-0000-0000-00000000c001';
    b uuid := '00000000-0000-0000-0000-00000000c002';
    command uuid := '10000000-0000-4000-8000-00000000c001';
    changed uuid := '10000000-0000-4000-8000-00000000c002';
    extra_command uuid := '10000000-0000-4000-8000-00000000c003';
    tamper_actor_command uuid := '10000000-0000-4000-8000-00000000c004';
    tamper_cycle_command uuid := '10000000-0000-4000-8000-00000000c005';
    explicit_null_command uuid := '10000000-0000-4000-8000-00000000c006';
    definition_sibling_command uuid := '10000000-0000-4000-8000-00000000c007';
    occurrence_sibling_command uuid := '10000000-0000-4000-8000-00000000c008';
    rollback_command uuid := '10000000-0000-4000-8000-00000000c009';
    r public.quest_creation_receipt;
    r2 public.quest_creation_receipt;
    q uuid; created_id uuid; event_count integer; rows_before integer; v jsonb; v_count bigint;
BEGIN
    INSERT INTO auth.users (id) VALUES (a), (b) ON CONFLICT (id) DO NOTHING;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;

    r := public.create_one_off_quest(command,
        '{"title":"Minimal","scheduled_at":"2026-10-01T09:00:00Z"}'::jsonb, 'web_ui');
    PERFORM creation_test.assert_true(r.replay = false AND r.reward_exp_snapshot = 0
        AND r.execution_cycle = 1, 'minimal receipt normalization');
    SELECT count(*) INTO event_count FROM public.quest_events WHERE command_id = command AND user_id = a;
    PERFORM creation_test.assert_true(event_count = 2, 'exactly two events');
    PERFORM creation_test.assert_true(
        (SELECT count(*) FROM public.quest_events
            WHERE command_id = command AND user_id = a AND event_type = 'created'
                AND occurrence_id IS NULL AND execution_cycle IS NULL
                AND actor_kind = 'user' AND actor_user_id = a AND payload_version = 1) = 1
        AND (SELECT count(*) FROM public.quest_events
            WHERE command_id = command AND user_id = a AND event_type = 'scheduled'
                AND occurrence_id = r.occurrence_id AND execution_cycle = 1
                AND actor_kind = 'user' AND actor_user_id = a AND payload_version = 1) = 1,
        'exact created and scheduled event pair');
    SELECT payload INTO v FROM public.quest_events
        WHERE id = r.definition_created_event_id;
    PERFORM creation_test.assert_true(v->>'origin' = 'web_ui'
        AND v->'after'->'definition'->>'default_reward_exp' = '0',
        'definition payload V1 normalized after');
    SELECT payload INTO v FROM public.quest_events
        WHERE id = r.occurrence_scheduled_event_id;
    PERFORM creation_test.assert_true(v->>'origin' = 'web_ui'
        AND v->'after'->'occurrence'->>'status' = 'scheduled'
        AND v->'after'->'occurrence'->>'reward_exp_snapshot' = '0',
        'occurrence payload V1 normalized after');
    SELECT materialized_occurrence_count INTO v_count FROM public.quests WHERE id = r.quest_id;
    PERFORM creation_test.assert_true(v_count = 1, 'counter is one');
    SELECT jsonb_build_object('q', q.title, 'status', o.status) INTO v
        FROM public.quests q JOIN public.quest_occurrences o ON o.quest_id=q.id
        WHERE q.id=r.quest_id;
    PERFORM creation_test.assert_true(v = '{"q":"Minimal","status":"scheduled"}'::jsonb, 'stored status');
    PERFORM creation_test.assert_true(
        (SELECT direct_goal_id IS NULL AND project_id IS NULL
            AND default_penalty_snapshot IS NULL AND recurrence_mode = 'one_off'
         FROM public.quests WHERE id = r.quest_id)
        AND (SELECT recurrence_rule_id IS NULL AND recurrence_revision IS NULL
            AND source_slot_date IS NULL AND source_timezone IS NULL
            AND direct_goal_id_snapshot IS NULL AND project_id_snapshot IS NULL
            AND penalty_snapshot IS NULL
         FROM public.quest_occurrences WHERE id = r.occurrence_id),
        'one-off and unavailable fields remain null');

    r2 := public.create_one_off_quest(command,
        '{"title":"Minimal","default_reward_exp":null,"scheduled_at":"2026-10-01T09:00:00+00:00"}'::jsonb, 'telegram');
    PERFORM creation_test.assert_true(r2.replay AND r2.quest_id = r.quest_id
        AND r2.definition_created_event_id = r.definition_created_event_id, 'canonical replay');
    PERFORM creation_test.assert_true((SELECT payload->>'origin' FROM public.quest_events WHERE id=r.definition_created_event_id)='web_ui', 'origin immutable');
    PERFORM creation_test.reject(format($sql$SELECT public.create_one_off_quest('%s','{"title":"Changed","scheduled_at":"2026-10-01T09:00:00Z"}','web_ui')$sql$, command), ARRAY['23505'], 'changed command reuse');

    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x"}'', ''web_ui'')', ARRAY['22023'], 'missing schedule');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"2026-10-02T09:00:00Z","deadline_at":"2026-10-01T09:00:00Z"}'', ''web_ui'')', ARRAY['22023'], 'deadline before start');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"2026-10-02T09:00:00Z","default_reward_exp":-1}'', ''web_ui'')', ARRAY['22023'], 'negative reward');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","deadline_at":"2026-10-02T09:00:00Z","project_id":"00000000-0000-0000-0000-000000000001"}'', ''web_ui'')', ARRAY['22023'], 'project rejected');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","deadline_at":"2026-10-02T09:00:00Z","default_penalty_snapshot":{}}'', ''web_ui'')', ARRAY['22023'], 'penalty rejected');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","deadline_at":"2026-10-02T09:00:00Z"}'', ''invalid'')', ARRAY['22023'], 'origin rejected');

    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","deadline_at":"2026-10-02T09:00:00Z"}'', ''web_ui'')', ARRAY['42501'], 'missing auth');
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    r2 := public.create_one_off_quest(command,
        '{"title":"Owner B","deadline_at":"2026-10-02T09:00:00Z"}'::jsonb, 'web_ui');
    PERFORM creation_test.assert_true(r2.replay = false AND r2.quest_id <> r.quest_id, 'owner-scoped command identity');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);

    SELECT id INTO q FROM public.quests WHERE id = r.quest_id;
    created_id := gen_random_uuid();
    INSERT INTO public.quest_events (id, quest_id, user_id, event_type, actor_kind, actor_user_id, command_id, payload_version, payload)
        VALUES (created_id, q, a, 'created', 'user', a, changed, 1, '{"origin":"web_ui","after":{"definition":{}}}');
    RESET ROLE;
    PERFORM creation_test.reject(format($sql$SELECT public.create_one_off_quest('%s','{"title":"x","deadline_at":"2026-10-02T09:00:00Z"}','web_ui')$sql$, changed), ARRAY['23505'], 'partial pair rejection');
    DELETE FROM public.quest_events WHERE id=created_id;

    -- Explicit null reward is also normalized on a fresh creation.
    SET LOCAL ROLE authenticated;
    r2 := public.create_one_off_quest(explicit_null_command,
        '{"title":"Explicit zero","default_reward_exp":null,"deadline_at":"2026-10-02T10:00:00Z"}'::jsonb, 'web_ui');
    RESET ROLE;
    PERFORM creation_test.assert_true(r2.replay = false AND r2.reward_exp_snapshot = 0
        AND (SELECT default_reward_exp = 0 FROM public.quests WHERE id = r2.quest_id),
        'fresh explicit-null reward normalization');

    SELECT count(*) INTO event_count FROM public.quest_events WHERE user_id=a;
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"rollback","deadline_at":"2026-10-02","tags":[1]}''::jsonb, ''web_ui'')', ARRAY['22023'], 'rollback input');
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quests WHERE title='rollback')=0, 'rollback definition');
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quest_events WHERE user_id=a)=event_count, 'rollback history');

    -- Absolute timestamp validation and integral numeric boundaries.
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"2026-10-02"}'', ''web_ui'')', ARRAY['22023'], 'date-only timestamp');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"2026-10-02T09:00:00"}'', ''web_ui'')', ARRAY['22023'], 'timezone-less timestamp');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"today"}'', ''web_ui'')', ARRAY['22023'], 'relative timestamp');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"infinity"}'', ''web_ui'')', ARRAY['22023'], 'infinite timestamp');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"2026-02-30T09:00:00Z"}'', ''web_ui'')', ARRAY['22023'], 'malformed timestamp');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"2026-10-02T09:00:00Z","default_reward_exp":1.5}'', ''web_ui'')', ARRAY['22023'], 'fractional reward');
    PERFORM creation_test.reject('SELECT public.create_one_off_quest(gen_random_uuid(), ''{"title":"x","scheduled_at":"2026-10-02T09:00:00Z","default_reward_exp":2147483648}'', ''web_ui'')', ARRAY['22003'], 'overflowing reward');

    -- Authenticated owner RLS cannot read another owner's Quest rows.
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM creation_test.assert_true(
        (SELECT count(*) FROM public.quests WHERE id = r.quest_id) = 0
        AND (SELECT count(*) FROM public.quest_occurrences WHERE id = r.occurrence_id) = 0
        AND (SELECT count(*) FROM public.quest_events WHERE id = r.definition_created_event_id) = 0,
        'cross-owner SELECT invisibility');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);

    -- Same instant with another offset is the same canonical replay request.
    r2 := public.create_one_off_quest(extra_command,
        '{"title":"Offset","scheduled_at":"2026-10-02T16:00:00+07:00"}'::jsonb, 'web_ui');
    r := public.create_one_off_quest(extra_command,
        '{"title":"Offset","scheduled_at":"2026-10-02T09:00:00Z"}'::jsonb, 'mobile');
    PERFORM creation_test.assert_true(r.replay AND r.quest_id = r2.quest_id, 'equivalent absolute timestamp replay');

    -- Extra historical events invalidate an otherwise matching pair.
    RESET ROLE;
    INSERT INTO public.quest_events (quest_id, user_id, event_type, actor_kind, actor_user_id,
        command_id, payload_version, payload)
        VALUES (r2.quest_id, a, 'cancelled', 'user', a, extra_command, 1, '{"origin":"web_ui","after":{}}');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM creation_test.reject('SELECT public.create_one_off_quest('''||extra_command||''', ''{"title":"Offset","scheduled_at":"2026-10-02T09:00:00Z"}'', ''web_ui'')', ARRAY['23505'], 'extra historical event');
    RESET ROLE;

    -- Tampered actor and cycle metadata are not accepted as replay history.
    SET LOCAL ROLE authenticated;
    r2 := public.create_one_off_quest(tamper_actor_command,
        '{"title":"Actor tamper","deadline_at":"2026-10-03T09:00:00Z"}'::jsonb, 'web_ui');
    RESET ROLE;
    UPDATE public.quest_events SET actor_kind = 'system', actor_user_id = NULL
        WHERE id = r2.definition_created_event_id;
    SET LOCAL ROLE authenticated;
    PERFORM creation_test.reject('SELECT public.create_one_off_quest('''||tamper_actor_command||''', ''{"title":"Actor tamper","deadline_at":"2026-10-03T09:00:00Z"}'', ''web_ui'')', ARRAY['23505'], 'tampered actor');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    r2 := public.create_one_off_quest(tamper_cycle_command,
        '{"title":"Cycle tamper","deadline_at":"2026-10-04T09:00:00Z"}'::jsonb, 'web_ui');
    RESET ROLE;
    UPDATE public.quest_events SET execution_cycle = 2
        WHERE id = r2.occurrence_scheduled_event_id;
    SET LOCAL ROLE authenticated;
    PERFORM creation_test.reject('SELECT public.create_one_off_quest('''||tamper_cycle_command||''', ''{"title":"Cycle tamper","deadline_at":"2026-10-04T09:00:00Z"}'', ''web_ui'')', ARRAY['23505'], 'tampered cycle');
    RESET ROLE;

    -- Sibling keys inside the nested after objects invalidate replay.
    SET LOCAL ROLE authenticated;
    r2 := public.create_one_off_quest(definition_sibling_command,
        '{"title":"Definition sibling","deadline_at":"2026-10-06T09:00:00Z"}'::jsonb, 'web_ui');
    RESET ROLE;
    UPDATE public.quest_events
        SET payload = jsonb_set(payload, '{after,extra}', 'true'::jsonb)
        WHERE id = r2.definition_created_event_id;
    SELECT count(*) INTO rows_before FROM public.quests;
    SET LOCAL ROLE authenticated;
    PERFORM creation_test.reject('SELECT public.create_one_off_quest('''||definition_sibling_command||''', ''{"title":"Definition sibling","deadline_at":"2026-10-06T09:00:00Z"}'', ''web_ui'')', ARRAY['23505'], 'definition after sibling');
    RESET ROLE;
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quests) = rows_before, 'definition sibling replay creates no rows');
    SET LOCAL ROLE authenticated;
    r2 := public.create_one_off_quest(occurrence_sibling_command,
        '{"title":"Occurrence sibling","deadline_at":"2026-10-07T09:00:00Z"}'::jsonb, 'web_ui');
    RESET ROLE;
    UPDATE public.quest_events
        SET payload = jsonb_set(payload, '{after,extra}', 'true'::jsonb)
        WHERE id = r2.occurrence_scheduled_event_id;
    SELECT count(*) INTO rows_before FROM public.quests;
    SET LOCAL ROLE authenticated;
    PERFORM creation_test.reject('SELECT public.create_one_off_quest('''||occurrence_sibling_command||''', ''{"title":"Occurrence sibling","deadline_at":"2026-10-07T09:00:00Z"}'', ''web_ui'')', ARRAY['23505'], 'occurrence after sibling');
    RESET ROLE;
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quests) = rows_before, 'occurrence sibling replay creates no rows');

    -- Trigger a failure after definition and occurrence rows are staged; all
    -- staged rows must roll back with the command transaction.
    SELECT count(*) INTO event_count FROM public.quest_events WHERE user_id = a;
    CREATE TRIGGER creation_test_fail_after_staging
        BEFORE INSERT ON public.quest_events
        FOR EACH ROW EXECUTE FUNCTION creation_test.fail_after_staging();
    SET LOCAL ROLE authenticated;
    PERFORM creation_test.reject('SELECT public.create_one_off_quest('''||rollback_command||''', ''{"title":"staged rollback","deadline_at":"2026-10-05T09:00:00Z"}'', ''web_ui'')', ARRAY['P0001'], 'post-staging failure');
    RESET ROLE;
    DROP TRIGGER creation_test_fail_after_staging ON public.quest_events;
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quest_events WHERE user_id = a) = event_count, 'staged event count rollback');
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quest_events WHERE user_id = a AND command_id = rollback_command) = 0, 'rollback command has no events');
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quests WHERE title='staged rollback')=0, 'staged definition rollback');
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quest_occurrences o JOIN public.quests q ON q.id=o.quest_id WHERE q.title='staged rollback')=0, 'staged occurrence rollback');
    PERFORM creation_test.assert_true((SELECT count(*) FROM public.quest_events e JOIN public.quests q ON q.id=e.quest_id WHERE q.title='staged rollback')=0, 'staged event rollback');
    RAISE NOTICE 'Quest creation behavior tests passed';
END;
$behavior$;

REVOKE quest_command_owner FROM CURRENT_USER;
ROLLBACK;