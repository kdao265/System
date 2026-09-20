\set ON_ERROR_STOP on
-- Level/Reward behavior tests. Disposable LOCAL database only: every fixture, temporary
-- role membership, guard disable/enable and privilege change rolls back at the end.
-- Synthetic owner EXP rows stand in for accepted Quest completion credits so progression
-- recognition can be exercised while the public Quest commands remain deferred.
BEGIN;
GRANT quest_command_owner TO CURRENT_USER;
GRANT progression_command_owner TO CURRENT_USER;
GRANT level_policy_assignment_owner TO CURRENT_USER;
CREATE SCHEMA level_test;
GRANT USAGE ON SCHEMA level_test TO authenticated, anon, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;

CREATE FUNCTION level_test.assert_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
    IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
END;
$fn$;

CREATE FUNCTION level_test.reject(statement text, states text[], label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = ANY(states) THEN RETURN; END IF;
        RAISE EXCEPTION 'Unexpected error for %: % %', label, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected rejection: %', label;
END;
$fn$;

-- Admin fixtures: bypass only the Quest-source receipt trigger to create ledger evidence.
-- SECURITY DEFINER keeps trigger maintenance owner-only even when the calling
-- role is switched for behavioral scenarios.
CREATE FUNCTION level_test.credit(p_user uuid, p_amount bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE entry uuid := gen_random_uuid();
BEGIN
    ALTER TABLE public.exp_ledger DISABLE TRIGGER exp_ledger_validate_insert;
    INSERT INTO public.exp_ledger (id, user_id, source_type, source_id, reason, amount)
        VALUES (entry, p_user, 'quest_completion', gen_random_uuid(), 'completion_reward', p_amount);
    ALTER TABLE public.exp_ledger ENABLE TRIGGER exp_ledger_validate_insert;
    RETURN entry;
END;
$fn$;

CREATE FUNCTION level_test.reversal(p_credit uuid, p_amount bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE entry uuid := gen_random_uuid(); owner_id uuid;
BEGIN
    SELECT user_id INTO owner_id FROM public.exp_ledger WHERE id = p_credit;
    ALTER TABLE public.exp_ledger DISABLE TRIGGER exp_ledger_validate_insert;
    INSERT INTO public.exp_ledger (id, user_id, source_type, source_id, reason, amount, reverses_entry_id)
        VALUES (entry, owner_id, 'quest_completion_reversal', gen_random_uuid(),
            'completion_reward_reversal', p_amount, p_credit);
    ALTER TABLE public.exp_ledger ENABLE TRIGGER exp_ledger_validate_insert;
    RETURN entry;
END;
$fn$;

CREATE FUNCTION level_test.policy(p_key text) RETURNS uuid
LANGUAGE sql AS $fn$
    SELECT id FROM public.level_policies WHERE policy_key = p_key;
$fn$;

CREATE FUNCTION level_test.configure_request(
    p_level integer, p_title text, p_category text DEFAULT 'treat',
    p_cost numeric DEFAULT NULL, p_label text DEFAULT NULL, p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql AS $fn$
    SELECT jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
        'required_level', p_level, 'title', p_title,
        'description', p_description, 'category', p_category,
        'estimated_cost', p_cost, 'currency_label', p_label));
$fn$;

CREATE FUNCTION level_test.update_request(
    p_reward uuid, p_revision bigint, p_changes jsonb
) RETURNS jsonb
LANGUAGE sql AS $fn$
    SELECT jsonb_build_object('operation', 'updateLevelReward',
        'reward_definition_id', p_reward, 'expected_revision', p_revision, 'changes', p_changes);
$fn$;

CREATE FUNCTION level_test.archive_request(p_reward uuid, p_revision bigint) RETURNS jsonb
LANGUAGE sql AS $fn$
    SELECT jsonb_build_object('operation', 'cancelLevelReward',
        'reward_definition_id', p_reward, 'expected_revision', p_revision);
$fn$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA level_test TO authenticated, anon, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;

DO $tests$
DECLARE
    a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
    op uuid := gen_random_uuid();
    p1 uuid; p2 uuid; p3 uuid;
    rec public.progression_policy_assignments;
    replay public.progression_policy_assignments;
    res public.level_reward_command_result; retry public.level_reward_command_result;
    d1 uuid; d2 uuid; d3 uuid; d4 uuid; dB uuid;
    u1 uuid; u2 uuid; u3 uuid; uB uuid;
    e1 uuid; e2 uuid; r2 uuid; e3 uuid; r3 uuid; eC uuid;
    cD1 uuid; cD2 uuid; cD3 uuid; cD4 uuid; cI uuid; cR uuid; cU uuid; cB uuid; cE uuid; cG uuid;
    st public.progression_status; item public.level_reward_listing;
    before_exp numeric; after_exp numeric; bad jsonb; key text; value jsonb; s1 uuid; s2 uuid; s3 uuid; sB uuid;
BEGIN
    INSERT INTO auth.users (id) VALUES (a), (b), (c), (op);
    INSERT INTO system_internal.operator_grants (user_id, capability)
        VALUES (op, 'level_policy_assign');
    p1 := level_test.policy('level_policy_v1');
    PERFORM level_test.assert_true(p1 IS NOT NULL, 'seeded level_policy_v1 exists');

    -- Second published version for reassignment coverage (test-only configuration).
    INSERT INTO public.level_policies (policy_key, version, name, status)
        VALUES ('level_test_v2', 99, 'Level reward test v2', 'draft') RETURNING id INTO p2;
    INSERT INTO public.level_thresholds (policy_id, level, required_exp)
        SELECT p2, lvl, (50 * (lvl - 1))::numeric FROM generate_series(1, 5) AS g(lvl);
    PERFORM progression_internal.publish_level_policy(p2);

    -- Owner c has pre-policy EXP; owner a starts at zero.
    eC := level_test.credit(c, 980100);

    -- LR-AC-01: no assigned policy returns an explicit unavailable state.
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.available = false AND st.current_exp = 0
        AND st.current_level IS NULL AND st.highest_level IS NULL
        AND st.policy_id IS NULL AND st.next_level IS NULL, 'unassigned progression unavailable');
    PERFORM level_test.assert_true(NOT EXISTS (SELECT 1 FROM public.list_level_rewards()),
        'unassigned reward listing empty');
    PERFORM level_test.assert_true(NOT EXISTS (SELECT 1 FROM public.get_reward_history()), 'unassigned history empty');
    PERFORM level_test.reject('SELECT public.assign_level_policy(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),''web_ui'')',
        ARRAY['42501'], 'missing capability cannot assign');
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    PERFORM level_test.reject(format('SELECT public.assign_level_policy(%L,%L,%L,%L)', b, p1, gen_random_uuid(), 'web_ui'),
        ARRAY['42501'], 'self assignment without capability');
    SET LOCAL ROLE anon;
    PERFORM level_test.reject('SELECT public.get_progression_status()', ARRAY['42501'], 'anon status denied');
    PERFORM level_test.reject('SELECT * FROM public.level_reward_definitions', ARRAY['42501'], 'anon definitions denied');
    PERFORM level_test.reject('SELECT * FROM public.level_reward_events', ARRAY['42501'], 'anon events denied');
    PERFORM level_test.reject('SELECT * FROM system_internal.operator_grants', ARRAY['42501'], 'anon grants denied');
    RESET ROLE;


    -- Authorized cross-owner assignment with atomic baseline recognition (target != actor).
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    cE := gen_random_uuid();
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.assign_level_policy(%L,%L,%L,%L)', a, p1, cE, 'forged'),
        ARRAY['22023'], 'invalid origin rejected');
    rec := public.assign_level_policy(a, p1, cE, 'internal');
    PERFORM level_test.assert_true(rec.user_id = a AND rec.actor_user_id = op AND rec.origin = 'internal'
        AND rec.command_id = cE AND rec.policy_id = p1 AND rec.assignment_sequence = 1
        AND rec.evaluated_exp = 0, 'assignment receipt binds target and actor');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    PERFORM level_test.assert_true((SELECT count(*) = 1 FROM public.level_milestones WHERE user_id = a),
        'baseline milestone recognized once');
    PERFORM level_test.assert_true((SELECT cause_kind = 'policy_assignment' AND cause_ledger_entry_id IS NULL
        AND evaluated_exp = 0 AND actor_user_id = op AND origin = 'internal' AND policy_id = p1 AND level = 1
        FROM public.level_milestones WHERE user_id = a), 'assignment milestone evidence');
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    replay := public.assign_level_policy(a, p1, cE, 'automation');
    PERFORM level_test.assert_true(replay.id = rec.id AND replay.origin = 'internal'
        AND replay.recorded_at = rec.recorded_at, 'assignment replay preserves original receipt');
    PERFORM level_test.reject(format('SELECT public.assign_level_policy(%L,%L,%L,%L)', a, p2, cE, 'internal'),
        ARRAY['23505'], 'conflicting assignment command');
    PERFORM level_test.reject(format('SELECT public.assign_level_policy(%L,%L,%L,%L)', b, gen_random_uuid(), gen_random_uuid(), 'internal'),
        ARRAY['23514'], 'unpublished policy rejected');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.available AND st.current_level = 1 AND st.highest_level = 1
        AND st.current_exp = 0 AND st.current_level_required_exp = 0
        AND st.next_level = 2 AND st.next_level_required_exp = 100
        AND st.policy_key = 'level_policy_v1' AND st.policy_version = 1, 'baseline progression status');
    RESET ROLE;

    -- Capability revocation is re-checked inside every call, including replays.
    UPDATE system_internal.operator_grants SET revoked_at = now()
        WHERE user_id = op AND capability = 'level_policy_assign';
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.assign_level_policy(%L,%L,%L,%L)', b, p1, gen_random_uuid(), 'internal'),
        ARRAY['42501'], 'revoked capability cannot assign');
    PERFORM level_test.reject(format('SELECT public.assign_level_policy(%L,%L,%L,%L)', a, p1, cE, 'internal'),
        ARRAY['42501'], 'revoked capability cannot replay');
    RESET ROLE;
    INSERT INTO system_internal.operator_grants (user_id, capability) VALUES (op, 'level_policy_assign');
    PERFORM level_test.reject(format('INSERT INTO system_internal.operator_grants (user_id, capability) VALUES (%L,''level_policy_assign'')', op),
        ARRAY['23505'], 'duplicate active grant rejected');
    PERFORM level_test.reject('UPDATE system_internal.operator_grants SET user_id = gen_random_uuid()',
        ARRAY['55000'], 'grant identity immutable');
    PERFORM level_test.reject('UPDATE system_internal.operator_grants SET revoked_at = now() WHERE revoked_at IS NOT NULL',
        ARRAY['55000'], 'repeated revocation rejected');
    PERFORM level_test.reject('DELETE FROM system_internal.operator_grants', ARRAY['55000'], 'grant delete rejected');
    PERFORM level_test.reject('TRUNCATE system_internal.operator_grants', ARRAY['55000'], 'grant truncate rejected');
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    SET LOCAL ROLE authenticated;
    replay := public.assign_level_policy(a, p1, cE, 'web_assistant');
    PERFORM level_test.assert_true(replay.id = rec.id, 'replay allowed after regrant');
    RESET ROLE;


    -- LR-AC-03: accepted progress recognizes every missing reached Level once.
    e1 := level_test.credit(a, 400);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE quest_command_owner;
    PERFORM progression_internal.recognize_after_exp(e1, 'internal');
    PERFORM progression_internal.recognize_after_exp(e1, 'internal');
    RESET ROLE;
    PERFORM level_test.assert_true((SELECT count(*) = 3 FROM public.level_milestones WHERE user_id = a),
        'jump to Level 3 recognizes Levels 2 and 3 once');
    PERFORM level_test.assert_true((SELECT min(level) = 1 AND max(level) = 3 FROM public.level_milestones WHERE user_id = a),
        'milestone set is 1..3');
    PERFORM level_test.assert_true((SELECT count(*) = 2 FROM public.level_milestones
        WHERE user_id = a AND cause_kind = 'exp_credit' AND cause_ledger_entry_id = e1
            AND evaluated_exp = 400 AND actor_user_id = a AND origin = 'internal'),
        'credit milestone evidence');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.current_level = 3 AND st.current_exp = 400
        AND st.current_level_required_exp = 400 AND st.next_level = 4
        AND st.next_level_required_exp = 900, 'Level 3 status');
    RESET ROLE;

    -- Configure at a reached Level unlocks immediately and records the V1 receipt.
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    cD1 := gen_random_uuid();
    SET LOCAL ROLE authenticated;
    res := public.configure_level_reward(cD1,
        level_test.configure_request(3, 'Coffee treat', 'treat', 12.5, 'VND', 'Espresso'), 'web_ui');
    d1 := res.reward_id; u1 := res.unlock_id;
    PERFORM level_test.assert_true(res.event_type = 'configured' AND res.definition_revision = 1
        AND res.unlock_id IS NOT NULL AND res.before_snapshot IS NULL AND res.after_snapshot IS NOT NULL,
        'configure receipt shape');
    PERFORM level_test.assert_true(res.request = jsonb_build_object('operation', 'configureLevelReward', 'fields',
        jsonb_build_object('required_level', 3, 'title', 'Coffee treat', 'description', 'Espresso',
            'category', 'treat', 'estimated_cost', 12.5, 'currency_label', 'VND')),
        'canonical configure request');
    PERFORM level_test.assert_true(res.after_snapshot = jsonb_build_object('reward_definition_id', d1, 'user_id', a,
        'required_level', 3, 'title', 'Coffee treat', 'description', 'Espresso', 'category', 'treat',
        'estimated_cost', 12.5, 'currency_label', 'VND', 'revision', 1, 'archived_at', NULL),
        'configured after snapshot');
    PERFORM level_test.assert_true((SELECT count(*) = 1 FROM public.level_reward_events WHERE user_id = a
        AND reward_id = d1 AND event_type = 'configured' AND definition_revision = 1 AND payload_version = 1
        AND unlock_id IS NULL AND actor_user_id = a AND origin = 'web_ui'), 'configured event row');
    PERFORM level_test.assert_true((SELECT required_level = 3 AND definition_revision = 1 AND title = 'Coffee treat'
        AND description = 'Espresso' AND category = 'treat' AND estimated_cost = 12.5 AND currency_label = 'VND'
        AND milestone_id = (SELECT id FROM public.level_milestones WHERE user_id = a AND level = 3)
        AND definition_event_id = (SELECT id FROM public.level_reward_events WHERE reward_id = d1 AND event_type = 'configured')
        FROM public.level_reward_unlocks WHERE id = u1), 'unlock snapshot evidence');
    retry := public.configure_level_reward(cD1,
        level_test.configure_request(3, 'Coffee treat', 'treat', 12.5, 'VND', 'Espresso'), 'telegram');
    PERFORM level_test.assert_true(retry.event_id = res.event_id AND retry.unlock_id = u1,
        'configure replay returns original receipt');
    PERFORM level_test.reject(format('SELECT public.configure_level_reward(%L, level_test.configure_request(3,''Different title''), ''web_ui'')', cD1),
        ARRAY['23505'], 'conflicting configure retry');
    cD2 := gen_random_uuid();
    res := public.configure_level_reward(cD2,
        level_test.configure_request(3, 'Coffee treat', 'treat', 12.5, 'VND', 'Espresso'), 'web_ui');
    d2 := res.reward_id; u2 := res.unlock_id;
    PERFORM level_test.assert_true(d2 <> d1 AND u2 IS NOT NULL AND u2 <> u1,
        'identical fields with a distinct command allocate a distinct definition and unlock');


    -- Closed V1 request validation: unknown keys, wrong types, ranges, cost pair.
    FOREACH bad IN ARRAY ARRAY[
        level_test.configure_request(101, 'Out of range'),
        level_test.configure_request(0, 'Below baseline'),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3.5, 'title', 'Fractional', 'description', NULL, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', '3', 'title', 'String level', 'description', NULL, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', '   ', 'description', NULL, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', NULL, 'description', NULL, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Numeric title', 'description', 7, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Missing key', 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Extra key', 'description', NULL, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL, 'notes', 'x')),
        jsonb_build_object('operation', 'xLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Wrong operation', 'description', NULL, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', '[]'::jsonb),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Cost only', 'description', NULL, 'category', 'treat',
            'estimated_cost', 5, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Negative cost', 'description', NULL, 'category', 'treat',
            'estimated_cost', -1, 'currency_label', 'VND')),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Blank label', 'description', NULL, 'category', 'treat',
            'estimated_cost', 1, 'currency_label', '   ')),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'String cost', 'description', NULL, 'category', 'treat',
            'estimated_cost', '12', 'currency_label', 'VND')),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Bad category', 'description', NULL, 'category', 'fun',
            'estimated_cost', NULL, 'currency_label', NULL)),
        jsonb_build_object('operation', 'configureLevelReward', 'fields', jsonb_build_object(
            'required_level', 3, 'title', 'Extra request key', 'description', NULL, 'category', 'treat',
            'estimated_cost', NULL, 'currency_label', NULL), 'actor_user_id', gen_random_uuid())
    ] LOOP
        PERFORM level_test.reject(format('SELECT public.configure_level_reward(gen_random_uuid(), %L, ''web_ui'')', bad),
            ARRAY['22023', '23514', '23505'], 'invalid configure request rejected');
    END LOOP;


    -- Canonical normalization: integral 3.0 accepts, blank description becomes JSON null.
    cG := gen_random_uuid();
    res := public.configure_level_reward(cG, jsonb_build_object('operation', 'configureLevelReward', 'fields',
        jsonb_build_object('required_level', 3.0, 'title', '  Spaced  ', 'description', '   ',
            'category', 'custom', 'estimated_cost', NULL, 'currency_label', NULL)), 'mobile');
    s1 := res.reward_id;
    PERFORM level_test.assert_true(res.request #>> '{fields,required_level}' = '3'
        AND res.request #>> '{fields,title}' = '  Spaced  '
        AND res.request #> '{fields,description}' = 'null'::jsonb
        AND (SELECT description IS NULL FROM public.level_reward_definitions WHERE id = s1),
        'integral Level and blank description normalize canonically');

    -- Locked definition: revision-checked edits are audited, then archive blocks unlocking.
    cD3 := gen_random_uuid();
    res := public.configure_level_reward(cD3,
        level_test.configure_request(10, 'Trip', 'experience', 500000, 'VND'), 'web_ui');
    d3 := res.reward_id;
    PERFORM level_test.assert_true(res.unlock_id IS NULL AND res.definition_revision = 1
        AND NOT EXISTS (SELECT 1 FROM public.level_reward_unlocks WHERE reward_id = d3),
        'locked definition has no unlock');
    cU := gen_random_uuid();
    res := public.update_level_reward(cU, level_test.update_request(d3, 1,
        jsonb_build_object('title', 'Weekend trip', 'estimated_cost', 600000)), 'web_ui');
    PERFORM level_test.assert_true(res.event_type = 'updated' AND res.definition_revision = 2
        AND res.before_snapshot #>> '{revision}' = '1'
        AND res.before_snapshot #>> '{title}' = 'Trip'
        AND res.after_snapshot #>> '{title}' = 'Weekend trip'
        AND res.after_snapshot #>> '{estimated_cost}' = '600000'
        AND res.after_snapshot #>> '{currency_label}' = 'VND', 'locked definition update audit');
    PERFORM level_test.reject(format('SELECT public.update_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.update_request(d3, 1, jsonb_build_object('title', 'Stale'))),
        ARRAY['23514'], 'stale expected revision rejected');
    PERFORM level_test.reject(format('SELECT public.update_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.update_request(d3, 2, jsonb_build_object('required_level', 101))),
        ARRAY['23514'], 'update outside the assigned policy rejected');
    PERFORM level_test.reject(format('SELECT public.update_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.update_request(d3, 2, jsonb_build_object('unknown_field', 1))),
        ARRAY['22023'], 'unknown change key rejected');
    PERFORM level_test.reject(format('SELECT public.update_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.update_request(d3, 0, jsonb_build_object('title', 'Zero revision'))),
        ARRAY['22023'], 'nonpositive expected revision rejected');
    cR := gen_random_uuid();
    res := public.cancel_level_reward(cR, level_test.archive_request(d3, 2), 'web_ui');
    PERFORM level_test.assert_true(res.event_type = 'archived' AND res.definition_revision = 3
        AND res.before_snapshot #>> '{revision}' = '2' AND res.after_snapshot #>> '{revision}' = '3'
        AND res.after_snapshot #> '{archived_at}' <> 'null'::jsonb
        AND res.after_snapshot #>> '{title}' = 'Weekend trip', 'archive receipt');
    PERFORM level_test.assert_true((SELECT archived_at IS NOT NULL AND revision = 3
        FROM public.level_reward_definitions WHERE id = d3), 'archived definition state');
    PERFORM level_test.reject(format('SELECT public.cancel_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.archive_request(d3, 3)), ARRAY['23514'], 'repeat archive rejected');
    PERFORM level_test.reject(format('SELECT public.update_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.update_request(d3, 3, jsonb_build_object('title', 'After archive'))),
        ARRAY['23514'], 'archived definition edit rejected');
    PERFORM level_test.reject(format('SELECT public.cancel_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.archive_request(gen_random_uuid(), 1)), ARRAY['23514'], 'foreign archive target rejected');
    cD4 := gen_random_uuid();
    res := public.configure_level_reward(cD4, level_test.configure_request(10, 'Concert', 'experience'), 'web_ui');
    d4 := res.reward_id;
    PERFORM level_test.assert_true(res.unlock_id IS NULL, 'active definition at an unreached Level stays locked');


    -- LR-AC-06: reaching Level 10 recognizes missing Levels and unlocks active definitions.
    e2 := level_test.credit(a, 3200);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE quest_command_owner;
    PERFORM progression_internal.recognize_after_exp(e2, 'internal');
    RESET ROLE;
    PERFORM level_test.assert_true((SELECT count(*) = 7 AND max(level) = 7 FROM public.level_milestones WHERE user_id = a),
        'jump to Level 7 records Levels 4..7');
    PERFORM level_test.assert_true(NOT EXISTS (SELECT 1 FROM public.level_reward_unlocks WHERE reward_id = d4),
        'Level 10 definition still locked at Level 7');

    -- LR-AC-04: a reversal lowers current Level but never removes history or entitlements.
    r2 := level_test.reversal(e2, -3200);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE quest_command_owner;
    PERFORM progression_internal.recognize_after_exp(r2, 'internal');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.current_exp = 400 AND st.current_level = 3 AND st.highest_level = 7,
        'reversal lowers current Level and preserves highest Level');
    RESET ROLE;

    e3 := level_test.credit(a, 7700);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE quest_command_owner;
    PERFORM progression_internal.recognize_after_exp(e3, 'internal');
    RESET ROLE;
    PERFORM level_test.assert_true((SELECT count(*) = 10 AND min(level) = 1 AND max(level) = 10
        FROM public.level_milestones WHERE user_id = a), 'regained Levels create no duplicate milestones');
    PERFORM level_test.assert_true(NOT EXISTS (SELECT 1 FROM public.level_reward_unlocks WHERE reward_id = d3),
        'archived definition never unlocks');
    PERFORM level_test.assert_true((SELECT required_level = 10 AND definition_revision = 1
        AND title = 'Concert' AND category = 'experience' AND estimated_cost IS NULL AND currency_label IS NULL
        FROM public.level_reward_unlocks WHERE reward_id = d4), 'reached-Level unlock snapshot');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.current_exp = 8100 AND st.current_level = 10 AND st.highest_level = 10
        AND st.current_level_required_exp = 8100 AND st.next_level = 11 AND st.next_level_required_exp = 10000,
        'threshold equality derives current Level and exposes the next threshold');
    SELECT count(*) INTO after_exp FROM public.level_reward_unlocks WHERE user_id = a;
    PERFORM level_test.assert_true(after_exp = 4, 'unlocks for d1, d2, spaced and concert definitions');
    RESET ROLE;

    r3 := level_test.reversal(e3, -7700);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE quest_command_owner;
    PERFORM progression_internal.recognize_after_exp(r3, 'internal');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.current_exp = 400 AND st.current_level = 3 AND st.highest_level = 10
        AND st.next_level = 4, 'second reversal keeps highest Level and derived Level');
    PERFORM level_test.assert_true((SELECT count(*) = 10 FROM public.level_milestones WHERE user_id = a)
        AND (SELECT count(*) = 4 FROM public.level_reward_unlocks WHERE user_id = a),
        'milestones and unlocks survive reversals');
    RESET ROLE;


    -- LR-AC-07: unlocked content is frozen; archive keeps the entitlement (LR-AC-08).
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.assert_true((SELECT count(*) = 5 FROM public.list_level_rewards()), 'listing covers every definition');
    PERFORM level_test.assert_true((SELECT count(*) = 4 FROM public.list_level_rewards() WHERE lifecycle = 'UNLOCKED')
        AND (SELECT count(*) = 1 FROM public.list_level_rewards() WHERE lifecycle = 'LOCKED')
        AND (SELECT count(*) = 1 FROM public.list_level_rewards() WHERE archived_at IS NOT NULL),
        'lifecycle derivation and archived listing');
    PERFORM level_test.reject(format('SELECT public.update_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.update_request(d1, 1, jsonb_build_object('title', 'Frozen attempt'))),
        ARRAY['23514'], 'unlocked definition edit rejected');
    st := public.get_progression_status();
    before_exp := st.current_exp;
    cR := gen_random_uuid();
    res := public.cancel_level_reward(cR, level_test.archive_request(d1, 1), 'web_ui');
    PERFORM level_test.assert_true(res.event_type = 'archived' AND res.definition_revision = 2
        AND res.unlock_id = u1, 'archived unlocked definition keeps its unlock');
    PERFORM level_test.assert_true((SELECT archived_at IS NOT NULL FROM public.level_reward_definitions WHERE id = d1),
        'unlocked definition archived after unlock');
    cB := gen_random_uuid();
    res := public.redeem_level_reward(cB, jsonb_build_object('operation', 'redeemLevelReward',
        'reward_unlock_id', u1), 'web_ui');
    PERFORM level_test.assert_true(res.event_type = 'redeemed' AND res.unlock_id = u1
        AND res.reward_id = d1 AND res.definition_revision IS NULL
        AND res.before_snapshot IS NULL AND res.after_snapshot IS NULL
        AND res.request = jsonb_build_object('operation', 'redeemLevelReward', 'reward_unlock_id', u1)
        AND res.recorded_at IS NOT NULL, 'redemption receipt shape');
    PERFORM level_test.assert_true((SELECT count(*) = 1 FROM public.level_reward_events
        WHERE user_id = a AND event_type = 'redeemed' AND unlock_id = u1), 'one redeemed event per unlock');
    PERFORM level_test.assert_true((SELECT lifecycle = 'REDEEMED' AND redemption_event_id = res.event_id
        AND redeemed_at IS NOT NULL FROM public.list_level_rewards() WHERE reward_id = d1),
        'listing shows redeemed state');
    retry := public.redeem_level_reward(cB, jsonb_build_object('operation', 'redeemLevelReward',
        'reward_unlock_id', u1), 'telegram');
    PERFORM level_test.assert_true(retry.event_id = res.event_id, 'redemption replay returns original receipt');
    retry := public.redeem_level_reward(gen_random_uuid(), jsonb_build_object('operation', 'redeemLevelReward',
        'reward_unlock_id', u1), 'automation');
    PERFORM level_test.assert_true(retry.event_id = res.event_id AND retry.request = res.request
        AND (SELECT origin = 'web_ui' FROM public.level_reward_events WHERE id = res.event_id),
        'different command on a redeemed unlock returns the original receipt');
    PERFORM level_test.assert_true((SELECT count(*) = 1 FROM public.level_reward_events
        WHERE user_id = a AND event_type = 'redeemed'), 'no alias redemption receipt');
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.current_exp = before_exp, 'redemption changes no EXP');
    PERFORM level_test.reject('SELECT public.redeem_level_reward(gen_random_uuid(), jsonb_build_object(''operation'',''redeemLevelReward'',''reward_unlock_id'', gen_random_uuid()), ''web_ui'')',
        ARRAY['P0002'], 'unknown unlock rejected');
    PERFORM level_test.reject('SELECT public.redeem_level_reward(gen_random_uuid(), jsonb_build_object(''operation'',''redeemLevelReward'',''reward_unlock_id'', ''not-a-uuid''), ''web_ui'')',
        ARRAY['22P02'], 'malformed unlock UUID rejected');
    PERFORM level_test.reject(format('SELECT public.redeem_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        jsonb_build_object('operation', 'redeemLevelReward', 'reward_unlock_id', u1, 'note', 'extra')),
        ARRAY['22023'], 'closed redemption request enforced');
    PERFORM level_test.reject(format('SELECT public.redeem_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        jsonb_build_object('operation', 'cancelLevelReward', 'reward_unlock_id', u2)),
        ARRAY['22023'], 'redemption operation mismatch rejected');
    cU := gen_random_uuid();
    res := public.redeem_level_reward(cU, jsonb_build_object('operation', 'redeemLevelReward',
        'reward_unlock_id', u2), 'web_ui');
    PERFORM level_test.assert_true(res.event_type = 'redeemed' AND res.unlock_id = u2
        AND (SELECT count(*) = 2 FROM public.level_reward_events WHERE user_id = a AND event_type = 'redeemed'),
        'second unlock redeems independently');
    PERFORM level_test.assert_true((SELECT count(*) = 10 FROM public.get_reward_history()), 'owner history lists every receipt');
    RESET ROLE;



    -- Two-owner isolation: command targets bind the caller's own rows only (LR-AC-13).
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    cE := gen_random_uuid();
    SET LOCAL ROLE authenticated;
    rec := public.assign_level_policy(b, p1, cE, 'internal');
    PERFORM level_test.assert_true(rec.user_id = b AND rec.assignment_sequence = 1
        AND rec.evaluated_exp = 0, 'second owner assigned independently');
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    cB := gen_random_uuid();
    res := public.configure_level_reward(cB,
        level_test.configure_request(1, 'Owner B reward', 'treat'), 'web_ui');
    dB := res.reward_id; uB := res.unlock_id;
    PERFORM level_test.assert_true(uB IS NOT NULL AND res.definition_revision = 1, 'owner B baseline unlock');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    PERFORM level_test.assert_true((SELECT count(*) = 5 FROM public.list_level_rewards()), 'owner A listing excludes owner B');
    PERFORM level_test.assert_true((SELECT count(*) = 10 FROM public.get_reward_history()), 'owner A history excludes owner B');
    PERFORM level_test.reject(format('SELECT public.update_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.update_request(dB, 1, jsonb_build_object('title', 'Stolen'))),
        ARRAY['23514'], 'foreign definition update rejected');
    PERFORM level_test.reject(format('SELECT public.cancel_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.archive_request(dB, 1)), ARRAY['23514'], 'foreign definition archive rejected');
    PERFORM level_test.reject(format('SELECT public.redeem_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        jsonb_build_object('operation', 'redeemLevelReward', 'reward_unlock_id', uB)),
        ARRAY['P0002'], 'foreign redemption rejected');
    PERFORM level_test.reject(format('SELECT public.assign_level_policy(%L,%L,%L,%L)', a, p1, gen_random_uuid(), 'internal'),
        ARRAY['42501'], 'owner cannot assign itself');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.assert_true((SELECT count(*) = 1 FROM public.list_level_rewards())
        AND (SELECT count(*) = 1 FROM public.get_reward_history()), 'owner B sees only its own rewards');
    PERFORM level_test.reject(format('SELECT public.redeem_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        jsonb_build_object('operation', 'redeemLevelReward', 'reward_unlock_id', u1)),
        ARRAY['P0002'], 'owner B cannot redeem a foreign unlock');
    RESET ROLE;

    -- LR-AC-18 and cap: pre-policy EXP is recognized on assignment; the top Level caps.
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    cE := gen_random_uuid();
    SET LOCAL ROLE authenticated;
    rec := public.assign_level_policy(c, p1, cE, 'internal');
    PERFORM level_test.assert_true(rec.user_id = c AND rec.evaluated_exp = 980100
        AND rec.assignment_sequence = 1, 'pre-policy EXP recorded as historical evidence');
    RESET ROLE;
    PERFORM level_test.assert_true((SELECT count(*) = 100 AND min(level) = 1 AND max(level) = 100
        AND bool_and(cause_kind = 'policy_assignment' AND cause_ledger_entry_id IS NULL
            AND evaluated_exp = 980100 AND actor_user_id = op)
        FROM public.level_milestones WHERE user_id = c), 'assignment recognizes current-state Levels 1..100');
    PERFORM set_config('request.jwt.claim.sub', c::text, true);
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.current_level = 100 AND st.highest_level = 100
        AND st.current_level_required_exp = 980100 AND st.next_level IS NULL
        AND st.next_level_required_exp IS NULL, 'top published Level caps without extrapolation');
    RESET ROLE;

    -- LR-AC-12: reassignment derives the new Level and preserves prior history.
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    cE := gen_random_uuid();
    SET LOCAL ROLE authenticated;
    rec := public.assign_level_policy(a, p2, cE, 'internal');
    PERFORM level_test.assert_true(rec.assignment_sequence = 2 AND rec.policy_id = p2
        AND rec.evaluated_exp = 400, 'reassignment receipt sequence and evaluated EXP');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    st := public.get_progression_status();
    PERFORM level_test.assert_true(st.policy_id = p2 AND st.policy_version = 99
        AND st.current_level = 5 AND st.highest_level = 10
        AND st.next_level IS NULL, 'reassignment recalculates current Level without losing highest Level');
    PERFORM level_test.assert_true((SELECT count(*) = 10 FROM public.level_milestones WHERE user_id = a),
        'reassignment creates no duplicate milestones');
    PERFORM level_test.reject(format('SELECT public.configure_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.configure_request(6, 'Outside assigned policy')),
        ARRAY['23514'], 'definition outside the assigned policy rejected');
    RESET ROLE;


    -- Policy publication validation and published immutability (LR-AC-12 boundary).
    INSERT INTO public.level_policies (policy_key, version, name, status)
        VALUES ('level_test_gap', 98, 'Level reward gap policy', 'draft') RETURNING id INTO p3;
    INSERT INTO public.level_thresholds (policy_id, level, required_exp) VALUES (p3, 1, 0), (p3, 3, 400);
    PERFORM level_test.reject(format('SELECT progression_internal.publish_level_policy(%L)', p3),
        ARRAY['23514'], 'policy with a Level gap cannot publish');
    DELETE FROM public.level_thresholds WHERE policy_id = p3;
    INSERT INTO public.level_thresholds (policy_id, level, required_exp) VALUES (p3, 1, 0), (p3, 2, 100), (p3, 3, 50);
    PERFORM level_test.reject(format('SELECT progression_internal.publish_level_policy(%L)', p3),
        ARRAY['23514'], 'non-monotonic thresholds cannot publish');
    DELETE FROM public.level_thresholds WHERE policy_id = p3;
    INSERT INTO public.level_thresholds (policy_id, level, required_exp) VALUES (p3, 1, 10), (p3, 2, 100);
    PERFORM level_test.reject(format('SELECT progression_internal.publish_level_policy(%L)', p3),
        ARRAY['23514'], 'non-zero baseline cannot publish');
    PERFORM level_test.reject(format('INSERT INTO public.level_thresholds (policy_id, level, required_exp) VALUES (%L, 3, 100)', p3),
        ARRAY['23505'], 'duplicate threshold EXP rejected');
    PERFORM level_test.reject('UPDATE public.level_policies SET version = 5 WHERE policy_key = ''level_test_gap''',
        ARRAY['55000'], 'draft policy identity immutable');
    DELETE FROM public.level_thresholds WHERE policy_id = p3;
    INSERT INTO public.level_thresholds (policy_id, level, required_exp) VALUES (p3, 1, 0), (p3, 2, 100);
    PERFORM progression_internal.publish_level_policy(p3);
    PERFORM level_test.assert_true((SELECT status = 'published' AND published_at IS NOT NULL
        FROM public.level_policies WHERE id = p3), 'valid draft publishes with server timestamp');
    PERFORM level_test.reject('UPDATE public.level_policies SET name = ''edited'' WHERE policy_key = ''level_test_gap''',
        ARRAY['55000'], 'published policy immutable');
    PERFORM level_test.reject('DELETE FROM public.level_policies WHERE policy_key = ''level_test_gap''',
        ARRAY['55000'], 'published policy delete rejected');
    PERFORM level_test.reject(format('UPDATE public.level_thresholds SET required_exp = 1 WHERE policy_id = %L AND level = 2', p3),
        ARRAY['55000'], 'published threshold update rejected');
    PERFORM level_test.reject(format('DELETE FROM public.level_thresholds WHERE policy_id = %L', p3),
        ARRAY['55000'], 'published threshold delete rejected');
    PERFORM level_test.reject(format('INSERT INTO public.level_thresholds (policy_id, level, required_exp) VALUES (%L, 3, 300)', p3),
        ARRAY['55000'], 'published threshold insert rejected');
    PERFORM level_test.reject('SELECT progression_internal.publish_level_policy(gen_random_uuid())',
        ARRAY['P0002'], 'unknown policy publication rejected');


    -- History guards hold even for the migration administrator (LR-AC-16).
    PERFORM level_test.reject('UPDATE public.level_milestones SET evaluated_exp = 0', ARRAY['55000'], 'milestone update guard');
    PERFORM level_test.reject('DELETE FROM public.level_milestones', ARRAY['55000'], 'milestone delete guard');
    PERFORM level_test.reject('TRUNCATE public.level_milestones', ARRAY['55000','0A000'], 'milestone truncate guard');
    PERFORM level_test.reject('TRUNCATE public.progression_policy_assignments', ARRAY['55000','0A000'], 'assignment truncate guard');
    PERFORM level_test.reject('TRUNCATE public.level_reward_events', ARRAY['55000','0A000'], 'event truncate guard');
    PERFORM level_test.reject('TRUNCATE public.level_reward_unlocks', ARRAY['55000','0A000'], 'unlock truncate guard');
    PERFORM level_test.reject('TRUNCATE public.level_reward_definitions', ARRAY['55000','0A000'], 'definition truncate guard');
    PERFORM level_test.reject('UPDATE public.level_reward_events SET origin = ''web_ui''', ARRAY['55000'], 'event update guard');
    PERFORM level_test.reject('DELETE FROM public.level_reward_events', ARRAY['55000'], 'event delete guard');
    PERFORM level_test.reject('UPDATE public.level_reward_unlocks SET title = ''edited''', ARRAY['55000'], 'unlock update guard');
    PERFORM level_test.reject('DELETE FROM public.level_reward_unlocks', ARRAY['55000'], 'unlock delete guard');
    PERFORM level_test.reject(format('DELETE FROM public.level_reward_definitions WHERE id = %L', d4),
        ARRAY['55000'], 'definition delete guard');
    PERFORM level_test.reject(format('UPDATE public.level_reward_definitions SET revision = revision + 1 WHERE id = %L', d3),
        ARRAY['55000'], 'archived definition immutable');
    PERFORM level_test.reject(format('UPDATE public.level_reward_definitions SET title = ''frozen'' WHERE id = %L', d4),
        ARRAY['23514'], 'unlocked content frozen even for the administrator');

    -- Executor boundary: no EXP writes, no history mutation, no grant management.
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE progression_command_owner;
    PERFORM level_test.reject('UPDATE public.level_reward_events SET origin = ''web_ui''', ARRAY['42501'], 'command role event update denied');
    PERFORM level_test.reject('UPDATE public.level_milestones SET evaluated_exp = 0', ARRAY['42501'], 'command role milestone update denied');
    PERFORM level_test.reject('DELETE FROM public.level_reward_unlocks', ARRAY['42501'], 'command role unlock delete denied');
    PERFORM level_test.reject('INSERT INTO public.exp_ledger (user_id, source_type, source_id, reason, amount) VALUES (system_internal.request_user_id(), ''quest_completion'', gen_random_uuid(), ''completion_reward'', 1)', ARRAY['42501'], 'command role EXP insert denied');
    PERFORM level_test.reject('UPDATE public.exp_ledger SET amount = 0', ARRAY['42501'], 'command role EXP update denied');
    PERFORM level_test.reject('INSERT INTO public.level_policies (policy_key, version, name, status) VALUES (''x'', 1, ''x'', ''draft'')', ARRAY['42501'], 'command role policy insert denied');
    PERFORM level_test.reject('UPDATE public.level_reward_definitions SET title = ''direct'' WHERE archived_at IS NOT NULL', ARRAY['55000'], 'command role cannot rewrite archived content');
    PERFORM level_test.reject('SELECT * FROM system_internal.operator_grants', ARRAY['42501'], 'command role grant read denied');
    PERFORM level_test.reject('SELECT progression_internal.publish_level_policy(gen_random_uuid())', ARRAY['42501'], 'command role cannot publish policies');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE level_policy_assignment_owner;
    PERFORM level_test.reject('INSERT INTO public.exp_ledger (user_id, source_type, source_id, reason, amount) VALUES (system_internal.request_user_id(), ''quest_completion'', gen_random_uuid(), ''completion_reward'', 1)', ARRAY['42501'], 'assignment executor EXP insert denied');
    PERFORM level_test.reject('UPDATE public.level_milestones SET evaluated_exp = 0', ARRAY['42501'], 'assignment executor milestone update denied');
    PERFORM level_test.reject('INSERT INTO public.level_reward_definitions (user_id, required_level, title, category, revision) VALUES (system_internal.request_user_id(), 1, ''x'', ''treat'', 1)', ARRAY['42501'], 'assignment executor definition insert denied');
    PERFORM level_test.reject('UPDATE system_internal.operator_grants SET revoked_at = now()', ARRAY['42501'], 'assignment executor grant update denied');
    PERFORM level_test.reject('SELECT public.redeem_level_reward(gen_random_uuid(), jsonb_build_object(''operation'',''redeemLevelReward'',''reward_unlock_id'', gen_random_uuid()), ''web_ui'')', ARRAY['42501'], 'assignment executor cannot redeem');
    PERFORM level_test.assert_true((SELECT count(*) = 0 FROM system_internal.operator_grants), 'grant read is actor-scoped');
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    PERFORM level_test.assert_true((SELECT count(*) = 1 FROM system_internal.operator_grants WHERE revoked_at IS NULL),
        'capability holder sees only its own active grant');
    RESET ROLE;

    -- Authenticated callers keep read access but never direct domain writes (LR-AC-13).
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.assert_true((SELECT count(*) = 5 FROM public.level_reward_definitions),
        'owner keeps direct read of own definitions');
    PERFORM level_test.reject('INSERT INTO public.level_reward_definitions (user_id, required_level, title, category, revision) VALUES (system_internal.request_user_id(), 1, ''x'', ''treat'', 1)', ARRAY['42501'], 'browser definition insert denied');
    PERFORM level_test.reject('UPDATE public.level_reward_definitions SET title = ''x''', ARRAY['42501'], 'browser definition update denied');
    PERFORM level_test.reject('DELETE FROM public.level_reward_definitions', ARRAY['42501'], 'browser definition delete denied');
    PERFORM level_test.reject('INSERT INTO public.level_reward_events (user_id, command_id, event_type, reward_id, payload_version, request, actor_user_id, origin) VALUES (system_internal.request_user_id(), gen_random_uuid(), ''configured'', gen_random_uuid(), 1, ''{}''::jsonb, system_internal.request_user_id(), ''web_ui'')', ARRAY['42501'], 'browser event insert denied');
    PERFORM level_test.reject('INSERT INTO public.level_milestones (user_id, level, policy_assignment_id, policy_id, evaluated_exp, cause_kind, actor_user_id, origin) VALUES (system_internal.request_user_id(), 99, gen_random_uuid(), gen_random_uuid(), 0, ''policy_assignment'', system_internal.request_user_id(), ''web_ui'')', ARRAY['42501'], 'browser milestone insert denied');
    PERFORM level_test.reject('INSERT INTO public.level_reward_unlocks (user_id, reward_id, milestone_id, definition_event_id, required_level, definition_revision, title, category) VALUES (system_internal.request_user_id(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 1, ''x'', ''treat'')', ARRAY['42501'], 'browser unlock insert denied');
    PERFORM level_test.reject('INSERT INTO public.progression_policy_assignments (user_id, policy_id, assignment_sequence, command_id, evaluated_exp, actor_user_id, origin) VALUES (system_internal.request_user_id(), gen_random_uuid(), 1, gen_random_uuid(), 0, system_internal.request_user_id(), ''web_ui'')', ARRAY['42501'], 'browser assignment insert denied');
    PERFORM level_test.reject('INSERT INTO public.level_policies (policy_key, version, name, status) VALUES (''x'', 1, ''x'', ''draft'')', ARRAY['42501'], 'browser policy insert denied');
    PERFORM level_test.reject(format('INSERT INTO public.level_thresholds (policy_id, level, required_exp) VALUES (%L, 500, 0)', p1), ARRAY['42501'], 'browser threshold insert denied');
    PERFORM level_test.reject('INSERT INTO system_internal.operator_grants (user_id, capability) VALUES (system_internal.request_user_id(), ''level_policy_assign'')', ARRAY['42501'], 'browser cannot grant capabilities');
    PERFORM level_test.reject('UPDATE system_internal.operator_grants SET revoked_at = now()', ARRAY['42501'], 'browser cannot revoke capabilities');
    PERFORM level_test.reject('SELECT progression_internal.owner_exp(gen_random_uuid())', ARRAY['42501'], 'browser cannot call private helpers');
    PERFORM level_test.reject('SELECT system_internal.has_capability(''level_policy_assign'')', ARRAY['42501'], 'browser cannot call the capability helper');
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM level_test.reject('SELECT public.get_progression_status()', ARRAY['42501'], 'missing identity status denied');
    PERFORM level_test.assert_true((SELECT count(*) = 0 FROM public.level_reward_definitions),
        'missing identity sees no rows');
    PERFORM level_test.reject('SELECT public.list_level_rewards()', ARRAY['42501'], 'missing identity listing denied');
    PERFORM level_test.reject('SELECT * FROM public.get_reward_history()', ARRAY['42501'], 'missing identity history denied');
    PERFORM level_test.reject(format('SELECT public.configure_level_reward(gen_random_uuid(), %L, ''web_ui'')',
        level_test.configure_request(1, 'No identity')), ARRAY['42501'], 'missing identity configure denied');
    RESET ROLE;

    -- Capability helper semantics from current database state, never a cached claim.
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    PERFORM level_test.assert_true(system_internal.has_capability('level_policy_assign'), 'active grant authorizes');
    PERFORM level_test.assert_true(NOT system_internal.has_capability('unknown_capability'), 'unknown capability denies');
    PERFORM level_test.assert_true(NOT system_internal.has_capability(NULL), 'null capability denies');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    PERFORM level_test.assert_true(NOT system_internal.has_capability('level_policy_assign'), 'ungranted actor denies');
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM level_test.assert_true(NOT system_internal.has_capability('level_policy_assign'), 'missing identity denies');
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    UPDATE system_internal.operator_grants SET revoked_at = now() WHERE revoked_at IS NULL;
    PERFORM level_test.assert_true(NOT system_internal.has_capability('level_policy_assign'), 'revoked grant denies immediately');

    -- Owner serialization uses the shared transaction-scoped advisory lock.
    PERFORM progression_internal.lock_owner(a);
    PERFORM progression_internal.lock_owner(a);
    PERFORM level_test.assert_true(EXISTS (SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND granted
            AND classid::bigint = ((hashtextextended('system.v1.progression.owner:' || a::text, 0) >> 32) & 4294967295)
            AND objid::bigint = (hashtextextended('system.v1.progression.owner:' || a::text, 0) & 4294967295)),
        'owner lock key held for the target owner');

    -- LR-AC-10: an injected failure rolls back the complete command effect.
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        cI := gen_random_uuid();
        PERFORM public.configure_level_reward(cI, level_test.configure_request(1, 'Rolled back'), 'web_ui');
        RAISE EXCEPTION 'Injected configure failure' USING ERRCODE = 'Z0001';
    EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
    END;
    PERFORM level_test.assert_true(NOT EXISTS (SELECT 1 FROM public.level_reward_events WHERE command_id = cI)
        AND (SELECT count(*) = 5 FROM public.level_reward_definitions WHERE user_id = a),
        'failed configure rolls back definition and receipt');
    SELECT id INTO u3 FROM public.level_reward_unlocks WHERE reward_id = d4;
    BEGIN
        cI := gen_random_uuid();
        PERFORM public.redeem_level_reward(cI, jsonb_build_object('operation', 'redeemLevelReward',
            'reward_unlock_id', u3), 'web_ui');
        RAISE EXCEPTION 'Injected redemption failure' USING ERRCODE = 'Z0001';
    EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
    END;
    PERFORM level_test.assert_true(NOT EXISTS (SELECT 1 FROM public.level_reward_events WHERE command_id = cI)
        AND (SELECT count(*) = 2 FROM public.level_reward_events WHERE user_id = a AND event_type = 'redeemed'),
        'failed redemption rolls back its receipt');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    INSERT INTO system_internal.operator_grants (user_id, capability) VALUES (op, 'level_policy_assign');
    SET LOCAL ROLE authenticated;
    BEGIN
        cI := gen_random_uuid();
        PERFORM public.assign_level_policy(b, p2, cI, 'internal');
        RAISE EXCEPTION 'Injected assignment failure' USING ERRCODE = 'Z0001';
    EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
    END;
    RESET ROLE;
    PERFORM level_test.assert_true(NOT EXISTS (SELECT 1 FROM public.progression_policy_assignments WHERE command_id = cI)
        AND (SELECT count(*) = 1 FROM public.progression_policy_assignments WHERE user_id = b)
        AND (SELECT count(*) = 1 FROM public.level_milestones WHERE user_id = b),
        'failed assignment rolls back receipt and recognition');
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    SET LOCAL ROLE authenticated;
    rec := public.assign_level_policy(b, p2, gen_random_uuid(), 'internal');
    PERFORM level_test.assert_true(rec.assignment_sequence = 2 AND rec.evaluated_exp = 0,
        'later legitimate reassignment succeeds');
    RESET ROLE;

    -- Null lock target rejects closed.
    PERFORM level_test.reject('SELECT progression_internal.lock_owner(NULL)', ARRAY['22023'], 'null lock target rejected');

    RAISE NOTICE 'Level/Reward behavior tests passed';
END;
$tests$;
ROLLBACK;