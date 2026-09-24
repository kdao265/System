\set ON_ERROR_STOP on
-- Quest Reopen V2 behavior tests.
-- Authority: ADR quest-reopen-guard-v2, quest-command-api-v1.md and its V2
-- appendix, quest-event-payload-v1.md, quest-database-schema.md,
-- player-exp-database-schema.md, level-reward-domain-model.md.
-- Local, deterministic, transactional: every behavior check runs inside one
-- transaction that rolls back on failure and leaves no persistent state.
-- Self-contained harness (same pattern as quest-commands.sql): this file never
-- assumes state created by another suite and never creates persistent state.
-- This suite requires the V2 migration to be applied to the target database.

BEGIN;
CREATE SCHEMA IF NOT EXISTS level_test;
REVOKE ALL ON SCHEMA level_test FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT USAGE ON SCHEMA level_test TO anon, authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;

CREATE OR REPLACE FUNCTION level_test.set_actor(job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM set_config('request.jwt.claim.sub', job::text, true);
END;
$function$;
REVOKE ALL ON FUNCTION level_test.set_actor(job uuid) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.set_actor(job uuid) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_equal(a text, b text, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF a IS DISTINCT FROM b THEN
        RAISE EXCEPTION 'assert-fail=% expected=% got=%', msg, a, b USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_equal(text, text, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_equal(text, text, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_int(a integer, b integer, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF a IS DISTINCT FROM b THEN
        RAISE EXCEPTION 'assert-fail=% expected=% got=%', msg, a, b USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_int(integer, integer, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_int(integer, integer, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_bigint(a bigint, b bigint, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF a IS DISTINCT FROM b THEN
        RAISE EXCEPTION 'assert-fail=% expected=% got=%', msg, b, a USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_bigint(bigint, bigint, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_bigint(bigint, bigint, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_uuid(a uuid, b uuid, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF a IS DISTINCT FROM b THEN
        RAISE EXCEPTION 'assert-fail=% expected=% got=%', msg, a, b USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_uuid(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_uuid(uuid, uuid, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_boolean(a boolean, b boolean, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF a IS DISTINCT FROM b THEN
        RAISE EXCEPTION 'assert-fail=% expected=% got=%', msg, a, b USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_boolean(boolean, boolean, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_boolean(boolean, boolean, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_not_null(v anyelement, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF v IS NULL THEN
        RAISE EXCEPTION 'assert-fail=% expected nonnull', msg USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_not_null(anyelement, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_not_null(anyelement, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.reject(statement text, states text[], msg text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = ANY(states) THEN RETURN; END IF;
        RAISE EXCEPTION 'assert-fail=% unexpected error=%: %', msg, SQLSTATE, SQLERRM USING ERRCODE = '55000';
    END;
    RAISE EXCEPTION 'assert-fail=% expected rejection', msg USING ERRCODE = '55000';
END;
$function$;
REVOKE ALL ON FUNCTION level_test.reject(text, text[], text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.reject(text, text[], text) TO quest_command_owner, authenticated, anon;

CREATE OR REPLACE FUNCTION level_test.check_exp_entry(entry_id uuid, user_id uuid, source_type text, source_id uuid, expected_amount bigint, expected_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE row public.exp_ledger%ROWTYPE;
BEGIN
    SELECT * INTO row FROM public.exp_ledger WHERE id = entry_id;
    IF row IS NULL THEN
        RAISE EXCEPTION 'assert-fail=% expected EXP entry %', 'exp_entry', entry_id USING ERRCODE = '55000';
    END IF;
    PERFORM level_test.check_uuid(row.user_id, user_id, 'exp_entry: owner');
    PERFORM level_test.check_equal(row.source_type, source_type, 'exp_entry: source_type');
    PERFORM level_test.check_uuid(row.source_id, source_id, 'exp_entry: source_id');
    PERFORM level_test.check_bigint(row.amount, expected_amount, 'exp_entry: amount');
    PERFORM level_test.check_equal(row.reason, expected_reason, 'exp_entry: reason');
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_exp_entry(uuid, uuid, text, uuid, bigint, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_exp_entry(uuid, uuid, text, uuid, bigint, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_reversal_entry(entry_id uuid, user_id uuid, source_type text, source_id uuid, original_credit_entry_id uuid, expected_amount bigint, expected_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE row public.exp_ledger%ROWTYPE;
BEGIN
    SELECT * INTO row FROM public.exp_ledger WHERE id = entry_id;
    IF row IS NULL THEN
        RAISE EXCEPTION 'assert-fail=% expected reversal EXP entry %', 'reversal_entry', entry_id USING ERRCODE = '55000';
    END IF;
    PERFORM level_test.check_uuid(row.user_id, user_id, 'reversal_entry: owner');
    PERFORM level_test.check_equal(row.source_type, source_type, 'reversal_entry: source_type');
    PERFORM level_test.check_uuid(row.source_id, source_id, 'reversal_entry: source_id');
    PERFORM level_test.check_bigint(row.amount, expected_amount, 'reversal_entry: amount');
    PERFORM level_test.check_equal(row.reason, expected_reason, 'reversal_entry: reason');
    PERFORM level_test.check_uuid(row.reverses_entry_id, original_credit_entry_id, 'reversal_entry: reverses_entry_id/original_credit');
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_reversal_entry(uuid, uuid, text, uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_reversal_entry(uuid, uuid, text, uuid, uuid, bigint, text) TO quest_command_owner;

-- Deterministic fixture builder for reopen V2 checks (V1 pattern).
CREATE OR REPLACE FUNCTION level_test.build_test_occurrence(p_user_id uuid, p_reward_exp integer, p_status text DEFAULT 'active', p_execution_cycle integer DEFAULT 1, p_at timestamptz DEFAULT now()) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $body$
DECLARE qid uuid;
    oid uuid;
BEGIN
    INSERT INTO public.quests (id, user_id, title, importance, default_reward_exp)
        VALUES (gen_random_uuid(), p_user_id, 'test quest', 'side', p_reward_exp)
        RETURNING id INTO qid;
    INSERT INTO public.quest_occurrences (id, quest_id, user_id, status, execution_cycle, reward_exp_snapshot, scheduled_at, deadline_at)
        VALUES (gen_random_uuid(), qid, p_user_id, p_status, p_execution_cycle, p_reward_exp, p_at, p_at + interval '1 day')
        RETURNING id INTO oid;
    RETURN oid;
END;
$body$;
REVOKE ALL ON FUNCTION level_test.build_test_occurrence(uuid, integer, text, integer, timestamptz) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.build_test_occurrence(uuid, integer, text, integer, timestamptz) TO quest_command_owner;

-- Deterministic V2 test owner fixture. The Auth row provisions the private
-- profile through the existing Auth trigger; the seeded published policy is
-- assigned through the legitimate Level command boundary (same pattern as
-- quest-commands.sql), so mandatory Level recognition succeeds on completion.
DO $body$
DECLARE
    actor uuid; op uuid; policy_id uuid;
    policy_rec public.progression_policy_assignments;
BEGIN
    actor := '00000000-0000-0000-0000-000000000001'::uuid;
    op := '00000000-0000-0000-0000-0000000000EE'::uuid;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = actor) THEN
        INSERT INTO auth.users (id) VALUES (actor);
    END IF;
    INSERT INTO auth.users (id) VALUES (op) ON CONFLICT (id) DO NOTHING;
    SELECT p.id INTO policy_id
        FROM public.level_policies p
        WHERE p.policy_key = 'level_policy_v1' AND p.status = 'published'
        LIMIT 1;
    IF policy_id IS NULL THEN
        RAISE EXCEPTION 'fixture-missing=level_policy_v1 published policy';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.progression_policy_assignments AS assignment
        WHERE assignment.user_id = actor
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM system_internal.operator_grants AS grant_row
            WHERE grant_row.user_id = op
                AND grant_row.capability = 'level_policy_assign'
                AND grant_row.revoked_at IS NULL
        ) THEN
            INSERT INTO system_internal.operator_grants (user_id, capability)
                VALUES (op, 'level_policy_assign');
        END IF;
        PERFORM set_config('request.jwt.claim.sub', op::text, true);
        SET LOCAL ROLE authenticated;
        policy_rec := public.assign_level_policy(actor, policy_id, gen_random_uuid(), 'internal');
        RESET ROLE;
    END IF;
END;
$body$;

BEGIN;
DO $body$ BEGIN
    PERFORM set_config('level_test.harness', 'quest-reopen-v2', true);
END;
$body$;

-- Behavior checks. A failing assertion aborts the file via ON_ERROR_STOP, and
-- the final ROLLBACK discards every fixture, so reruns stay deterministic.
DO $behaviors$
DECLARE
    a uuid := '00000000-0000-0000-0000-000000000001'::uuid;
    b uuid := '00000000-0000-0000-0000-000000000002'::uuid;
    o1 uuid; o2 uuid; o3 uuid; o4 uuid; oX uuid; oZ uuid; oOverflow uuid;
    c1 uuid := gen_random_uuid();
    cR1 uuid := gen_random_uuid();
    c2 uuid := gen_random_uuid();
    cR2 uuid := gen_random_uuid();
    cR2b uuid := gen_random_uuid();
    r1 public.quest_completion_receipt;
    r2 public.quest_completion_receipt;
    r3 public.quest_completion_receipt;
    rZ public.quest_completion_receipt;
    rOverflow public.quest_completion_receipt;
    u1 public.quest_reopen_receipt;
    u2 public.quest_reopen_receipt;
    u3 public.quest_reopen_receipt;
    u4 public.quest_reopen_receipt;
    uZ public.quest_reopen_receipt;
    ev public.quest_events;
    occ public.quest_occurrences;
    exp numeric;
BEGIN
    INSERT INTO auth.users (id) VALUES (b) ON CONFLICT (id) DO NOTHING;
    o1 := level_test.build_test_occurrence(a, 50);
    o2 := level_test.build_test_occurrence(a, 30);
    o3 := level_test.build_test_occurrence(a, 20);
    oX := level_test.build_test_occurrence(b, 10);
    oZ := level_test.build_test_occurrence(a, 0);
    oOverflow := level_test.build_test_occurrence(a, 10, 'active', 2147483647);
    PERFORM level_test.set_actor(a);

    -- 1) Fresh reopen: exactly one correction, reversal and reopened event.
    SET LOCAL ROLE authenticated;
    r1 := public.complete_quest_occurrence(c1, o1, 1, '2026-09-21T08:00:00Z'::timestamptz, 'web_ui');
    u1 := public.reopen_quest_occurrence_v2(cR1, o1, 1, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(u1.replay = false, true, 'v2 fresh: not replay');
    PERFORM level_test.check_uuid(u1.command_id, cR1, 'v2 fresh: command id');
    PERFORM level_test.check_uuid(u1.occurrence_id, o1, 'v2 fresh: occurrence');
    PERFORM level_test.check_int(u1.undone_cycle, 1, 'v2 fresh: undone cycle');
    PERFORM level_test.check_bigint(u1.reversed_amount, -50, 'v2 fresh: signed amount');
    PERFORM level_test.check_uuid(u1.original_credit_entry_id, r1.exp_entry_id, 'v2 fresh: original credit');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND command_id = cR1)::integer, 2, 'v2 fresh: exactly two events');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1 AND event_type = 'completion_corrected')::integer, 1, 'v2 fresh: one correction');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1 AND event_type = 'reopened')::integer, 1, 'v2 fresh: one reopened');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = a AND source_type = 'quest_completion_reversal')::integer, 1, 'v2 fresh: one reversal');

    -- 2) Cycle advances once and projection restores.
    SELECT * INTO occ FROM public.quest_occurrences WHERE id = o1;
    PERFORM level_test.check_equal(occ.status, 'scheduled', 'v2 projection: status restored');
    PERFORM level_test.check_int(occ.execution_cycle, 2, 'v2 projection: cycle advanced once');
    PERFORM level_test.check_boolean(occ.recorded_completed_at IS NULL, true, 'v2 projection: recorded time cleared');
    PERFORM level_test.check_boolean(occ.reported_completed_at IS NULL, true, 'v2 projection: reported time cleared');
    PERFORM level_test.check_boolean(occ.failure_reason IS NULL, true, 'v2 projection: failure reason cleared');
    SELECT * INTO ev FROM public.quest_events WHERE id = u1.reopened_event_id;
    PERFORM level_test.check_int(ev.execution_cycle, 2, 'v2 projection: reopened event cycle 2');
    PERFORM level_test.check_uuid(ev.related_event_id, u1.correction_event_id, 'v2 projection: reopened references correction');
    SELECT * INTO ev FROM public.quest_events WHERE id = u1.correction_event_id;
    PERFORM level_test.check_int(ev.execution_cycle, 1, 'v2 projection: correction keeps undone cycle');
    PERFORM level_test.check_uuid(ev.related_event_id, r1.completed_event_id, 'v2 projection: correction references completion');
    PERFORM level_test.check_reversal_entry(u1.reversal_entry_id, a, 'quest_completion_reversal', u1.correction_event_id, r1.exp_entry_id, -50, 'completion_reward_reversal');
    PERFORM level_test.check_exp_entry(r1.exp_entry_id, a, 'quest_completion', r1.completed_event_id, 50, 'completion_reward');
    SET LOCAL ROLE authenticated;
    exp := public.get_current_exp();
    RESET ROLE;
    PERFORM level_test.check_equal(exp::text, '0', 'v2 projection: EXP total reversed');

    -- 3) Exact command replay: no extra effects, replay=true.
    SET LOCAL ROLE authenticated;
    u2 := public.reopen_quest_occurrence_v2(cR1, o1, 1, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(u2.replay, true, 'v2 replay: marked replay');
    PERFORM level_test.check_uuid(u2.correction_event_id, u1.correction_event_id, 'v2 replay: same correction');
    PERFORM level_test.check_uuid(u2.reopened_event_id, u1.reopened_event_id, 'v2 replay: same reopened');
    PERFORM level_test.check_uuid(u2.reversal_entry_id, u1.reversal_entry_id, 'v2 replay: same reversal');
    PERFORM level_test.check_bigint(u2.reversed_amount, -50, 'v2 replay: same amount');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND command_id = cR1)::integer, 2, 'v2 replay: no extra events');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = a AND source_type = 'quest_completion_reversal')::integer, 1, 'v2 replay: no extra reversal');

    -- 4) Historical replay after later recompletion: the recorded command
    --    replays its original receipt even though the occurrence now sits on a
    --    later cycle (ADR decision 3), while a DIFFERENT expected cycle on the
    --    same recorded command rejects with 23505.
    SET LOCAL ROLE authenticated;
    r2 := public.complete_quest_occurrence(c2, o1, 2, '2026-09-21T09:00:00Z'::timestamptz, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(r2.replay = false, true, 'v2 history: recompletion accepted');
    SET LOCAL ROLE authenticated;
    u3 := public.reopen_quest_occurrence_v2(cR1, o1, 1, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(u3.replay, true, 'v2 history: replay across cycles');
    PERFORM level_test.check_int(u3.undone_cycle, 1, 'v2 history: original undone cycle');
    PERFORM level_test.check_uuid(u3.correction_event_id, u1.correction_event_id, 'v2 history: same correction');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND command_id = cR1)::integer, 2, 'v2 history: still two events');
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 2, ''web_ui'')', cR1, o1),
        ARRAY['23505'], 'v2 history: recorded command with different cycle');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 2, ''web_ui'')', cR1, o2),
        ARRAY['23505'], 'v2 history: recorded command on other occurrence');
    RESET ROLE;

    -- 5) Other conflicting command reuse: a completion command id cannot drive
    --    reopen V2, and vice versa.
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 1, ''web_ui'')', c2, o1),
        ARRAY['23505'], 'v2 conflict: completion command id rejected');
    RESET ROLE;

    -- 6) Fresh stale-cycle command: 23514 before any mutation.
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 1, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['23514'], 'v2 stale: cycle 1 is no longer current');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 3, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['23514'], 'v2 stale: future cycle');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, NULL, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['42501'], 'v2 input: null cycle rejected');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, -1, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['23514'], 'v2 input: negative cycle rejected');
    RESET ROLE;
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1)::integer, 4, 'v2 stale: no events added');

    -- 7) The core regression: complete cycle 1, reopen, complete cycle 2, then
    --    a stale reopen for cycle 1. Cycle 2's completion and its credit must
    --    remain intact: a stale request can never undo a newer completion.
    SELECT * INTO occ FROM public.quest_occurrences WHERE id = o1;
    PERFORM level_test.check_equal(occ.status, 'completed', 'core: cycle 2 completed before stale attempt');
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 1, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['23514'], 'core: stale cycle-1 reopen rejected');
    RESET ROLE;
    PERFORM level_test.check_equal((SELECT status FROM public.quest_occurrences WHERE id = o1),
        'completed', 'core: cycle 2 remains completed');
    PERFORM level_test.check_int((SELECT execution_cycle FROM public.quest_occurrences WHERE id = o1),
        2, 'core: cycle 2 remains current');
    PERFORM level_test.check_equal((SELECT event_type FROM public.quest_events WHERE id = r2.completed_event_id),
        'completed', 'core: cycle-2 completion event remains intact');
    PERFORM level_test.check_int((SELECT execution_cycle FROM public.quest_events WHERE id = r2.completed_event_id),
        2, 'core: cycle-2 completion event cycle remains intact');
    PERFORM level_test.check_exp_entry(r2.exp_entry_id, a, 'quest_completion', r2.completed_event_id, 50, 'completion_reward');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE reverses_entry_id = r2.exp_entry_id)::integer,
        0, 'core: cycle-2 credit has no reversal row');
    PERFORM level_test.check_boolean((SELECT reverses_entry_id IS NULL FROM public.exp_ledger WHERE id = r2.exp_entry_id),
        true, 'core: cycle-2 credit remains unreversed');
    SET LOCAL ROLE authenticated;
    exp := public.get_current_exp();
    RESET ROLE;
    PERFORM level_test.check_equal(exp::text, '50', 'core: current EXP remains cycle-2 total');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1 AND event_type = 'completion_corrected')::integer,
        1, 'core: stale request adds no correction');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1 AND event_type = 'reopened')::integer,
        1, 'core: stale request adds no reopened event');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = a AND source_type = 'quest_completion_reversal')::integer,
        1, 'core: stale request adds no reversal');

    -- 8) Ownership and authentication boundaries reject without mutation.
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 1, ''web_ui'')', gen_random_uuid(), oX),
        ARRAY['23514'], 'boundary: cross-account occurrence rejected');
    RESET ROLE;
    PERFORM level_test.set_actor(b);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 2, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['23514'], 'boundary: owner cannot target another account');
    RESET ROLE;
    PERFORM level_test.set_actor(a);
    SET LOCAL ROLE anon;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 2, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['42501'], 'boundary: unauthenticated caller rejected');
    RESET ROLE;

    -- 9) A zero-EXP completion still produces an exact zero reversal.
    SET LOCAL ROLE authenticated;
    rZ := public.complete_quest_occurrence(gen_random_uuid(), oZ, 1, NULL, 'web_ui');
    uZ := public.reopen_quest_occurrence_v2(gen_random_uuid(), oZ, 1, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_bigint(uZ.reversed_amount, 0, 'zero exp: signed reversal is zero');
    PERFORM level_test.check_reversal_entry(uZ.reversal_entry_id, a, 'quest_completion_reversal', uZ.correction_event_id, rZ.exp_entry_id, 0, 'completion_reward_reversal');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = a AND source_type = 'quest_completion_reversal' AND source_id = uZ.correction_event_id)::integer,
        1, 'zero exp: exactly one reversal');

    -- 10) Two different fresh commands cannot both undo one completed cycle.
    SET LOCAL ROLE authenticated;
    r3 := public.complete_quest_occurrence(cR2, o3, 1, NULL, 'web_ui');
    u4 := public.reopen_quest_occurrence_v2(cR2b, o3, 1, 'web_ui');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 1, ''web_ui'')', gen_random_uuid(), o3),
        ARRAY['23514'], 'single-cycle: second fresh command rejected');
    RESET ROLE;
    PERFORM level_test.check_boolean(u4.replay, false, 'single-cycle: first command accepted fresh');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o3 AND event_type = 'completion_corrected')::integer,
        1, 'single-cycle: one correction');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = a AND source_type = 'quest_completion_reversal' AND source_id = u4.correction_event_id)::integer,
        1, 'single-cycle: one reversal');

    -- 11) A late cycle-increment failure rolls back the correction and EXP
    --    reversal instead of leaving partial undo history behind.
    SET LOCAL ROLE authenticated;
    rOverflow := public.complete_quest_occurrence(gen_random_uuid(), oOverflow, 2147483647, NULL, 'web_ui');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 2147483647, ''web_ui'')', gen_random_uuid(), oOverflow),
        ARRAY['22003'], 'rollback: cycle increment overflow rejected');
    RESET ROLE;
    PERFORM level_test.check_equal((SELECT status FROM public.quest_occurrences WHERE id = oOverflow),
        'completed', 'rollback: occurrence remains completed');
    PERFORM level_test.check_int((SELECT execution_cycle FROM public.quest_occurrences WHERE id = oOverflow),
        2147483647, 'rollback: occurrence cycle remains at maximum');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE occurrence_id = oOverflow AND event_type = 'completion_corrected')::integer,
        0, 'rollback: correction event was rolled back');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE source_type = 'quest_completion_reversal' AND reverses_entry_id = rOverflow.exp_entry_id)::integer,
        0, 'rollback: reversal ledger row was rolled back');
    PERFORM level_test.check_exp_entry(rOverflow.exp_entry_id, a, 'quest_completion', rOverflow.completed_event_id, 10, 'completion_reward');
END;
$behaviors$;

ROLLBACK;
