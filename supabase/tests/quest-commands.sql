\set ON_ERROR_STOP on
-- Quest atomic command behavior tests.
-- Authority: quest-command-api-v1.md, quest-event-payload-v1.md,
-- quest-domain-model.md, quest-database-schema.md, player-exp-database-schema.md,
-- level-reward-domain-model.md, level-reward-database-schema.md,
-- operator-authorization-v1.md.
-- Local, deterministic, transactional: every standalone behavior check is a
-- transaction that rolls back on failure and leaves the shared fixtures intact.
-- Tables referenced here exist in earlier migrations; this file never creates
-- persistent state that survives a reset.

BEGIN;
-- Idempotent harness of shared test helpers.
CREATE SCHEMA IF NOT EXISTS level_test;
REVOKE ALL ON SCHEMA level_test FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT USAGE ON SCHEMA level_test TO anon, authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;

CREATE OR REPLACE FUNCTION level_test.credit_amount(bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$ SELECT $1::bigint; $function$;
REVOKE ALL ON FUNCTION level_test.credit_amount(bigint) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.credit_amount(bigint) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.reversal_amount(bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$ SELECT -$1::bigint; $function$;
REVOKE ALL ON FUNCTION level_test.reversal_amount(bigint) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.reversal_amount(bigint) TO quest_command_owner;

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

-- EXP amounts are bigint; a bigint-compatible assertion keeps the EXP helpers
-- free of lossy integer casts.
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

CREATE OR REPLACE FUNCTION level_test.check_text_contains(haystack text, needle text, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF haystack IS NULL OR needle IS NULL OR haystack !~ needle THEN
        RAISE EXCEPTION 'assert-fail=% payload does not match pattern=%', msg, needle USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_text_contains(text, text, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_text_contains(text, text, text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION level_test.check_json_has_path(j jsonb, path text[], expected jsonb, msg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actual jsonb;
BEGIN
    actual := j #> path;
    IF expected IS DISTINCT FROM actual THEN
        RAISE EXCEPTION 'assert-fail=% path=% expected=% got=%', msg, path, expected, actual USING ERRCODE = '55000';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_json_has_path(j jsonb, path text[], expected jsonb, msg text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_json_has_path(j jsonb, path text[], expected jsonb, msg text) TO quest_command_owner;

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
GRANT EXECUTE ON FUNCTION level_test.reject(text, text[], text) TO quest_command_owner, authenticated;
-- The slate helper executes caller-supplied SQL, so it stays SECURITY INVOKER:
-- it can never run a slate statement with privileges above the calling role.
-- Only authenticated and quest_command_owner ever drive rejection slates; no
-- slate runs under anon, so anon receives no grant.

-- Suite metadata only: recorded for the runner log, never persisted.
CREATE OR REPLACE FUNCTION level_test.begin_suite(name text, tags text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM set_config('level_test.suite', name, true);
    PERFORM set_config('level_test.tags', array_to_string(tags, ','), true);
    RAISE NOTICE 'suite=% tags=%', name, array_to_string(tags, ',');
END;
$function$;
REVOKE ALL ON FUNCTION level_test.begin_suite(text, text[]) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.begin_suite(text, text[]) TO quest_command_owner;

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

-- V1 milestone facts: one first-reach row per (owner, Level) attributed to the
-- EXP credit that crossed the assigned policy threshold. Parameters and the
-- table alias are qualified to avoid PL/pgSQL name ambiguity.
CREATE OR REPLACE FUNCTION level_test.check_milestone(
    p_user_id uuid, p_level integer, p_cause_entry uuid, p_evaluated_exp numeric, p_origin text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE milestone public.level_milestones%ROWTYPE;
BEGIN
    SELECT * INTO milestone FROM public.level_milestones AS lm
        WHERE lm.user_id = p_user_id
            AND lm.level = p_level
            AND lm.cause_ledger_entry_id = p_cause_entry;
    IF milestone IS NULL THEN
        RAISE EXCEPTION 'assert-fail=% expected milestone level=%', 'milestone', p_level USING ERRCODE = '55000';
    END IF;
    PERFORM level_test.check_int(milestone.level, p_level, 'milestone: level');
    PERFORM level_test.check_uuid(milestone.cause_ledger_entry_id, p_cause_entry, 'milestone: cause credit');
    PERFORM level_test.check_boolean(milestone.cause_kind = 'exp_credit', true, 'milestone: cause kind');
    PERFORM level_test.check_uuid(milestone.user_id, p_user_id, 'milestone: owner');
    PERFORM level_test.check_uuid(milestone.actor_user_id, p_user_id, 'milestone: actor');
    PERFORM level_test.check_equal(milestone.evaluated_exp::text, p_evaluated_exp::text, 'milestone: evaluated exp');
    PERFORM level_test.check_equal(milestone.origin, p_origin, 'milestone: origin');
END;
$function$;
REVOKE ALL ON FUNCTION level_test.check_milestone(uuid, integer, uuid, numeric, text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.check_milestone(uuid, integer, uuid, numeric, text) TO quest_command_owner;

-- Shared fixture precondition: one published Level policy must already exist.
DO $fixtures$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.level_policies WHERE policy_key = 'level_policy_v1' AND status = 'published') THEN
        RAISE EXCEPTION 'fixture-missing=level_policy_v1 published policy' USING ERRCODE = '55000';
    END IF;
END;
$fixtures$;

-- Deterministic test actor used by every behavior check in this file.
CREATE OR REPLACE FUNCTION level_test.actor_test_owner() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
    SELECT '00000000-0000-0000-0000-000000000001'::uuid;
$function$;
REVOKE ALL ON FUNCTION level_test.actor_test_owner() FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.actor_test_owner() TO quest_command_owner;

-- Deterministic fixture builder for completion/reopen checks.
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

-- Deterministic "alternate command id" for same-cycle replay specs.
CREATE OR REPLACE FUNCTION level_test.alt_command_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $body$
    SELECT '00000000-0000-0000-0000-0000000000FF'::uuid;
$body$;
REVOKE ALL ON FUNCTION level_test.alt_command_id() FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.alt_command_id() TO quest_command_owner;

-- Deterministic event id preallocation test values.
CREATE OR REPLACE FUNCTION level_test.fake_event_id(seed text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $body$
    SELECT md5('test-event:' || seed)::uuid;
$body$;
REVOKE ALL ON FUNCTION level_test.fake_event_id(text) FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION level_test.fake_event_id(text) TO quest_command_owner;

-- Deterministic test owner fixture: the Auth row provisions the private
-- profile through the existing Auth trigger (same pattern as the EXP and
-- Level/Reward suites), and the seeded published policy is assigned through
-- the legitimate Level command boundary: a dedicated operator user holding
-- the level_policy_assign capability executes public.assign_level_policy, so
-- mandatory Level recognition and the Level 1 milestone are produced by the
-- real assignment path. The Quest commands authenticate through
-- system_internal.request_user_id() and read no operator capability, so no
-- grant is created for the owner itself.
DO $body$
DECLARE
    actor uuid; op uuid; policy_id uuid;
    policy_rec public.progression_policy_assignments;
BEGIN
    actor := level_test.actor_test_owner();
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
        RAISE EXCEPTION 'fixture-missing=level_policy_v1 published policy' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.progression_policy_assignments WHERE user_id = actor) THEN
        IF NOT EXISTS (
            SELECT 1 FROM system_internal.operator_grants
            WHERE user_id = op AND capability = 'level_policy_assign' AND revoked_at IS NULL
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

-- Mark this harness as bootstrapped.
DO $body$
BEGIN
    PERFORM set_config('level_test.harness', 'quest-commands', true);
END;
$body$;

BEGIN;
SELECT level_test.begin_suite('quest completion and reopen behavior', ARRAY['1']);

-- Regression: no completion/reopen behavior may run until Quest + EXP ledger
-- integration are present, because both commands depend on quest_events and the
-- public receipt types.
DO $body$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'quest_completion_receipt'
            AND n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'skip=quest_command_types_not_present';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'quest_reopen_receipt'
            AND n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'skip=quest_command_types_not_present';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'complete_quest_occurrence'
            AND n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'skip=quest_complete_not_present';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'reopen_quest_occurrence'
            AND n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'skip=quest_reopen_not_present';
    END IF;
END;
$body$;

-- Behavior checks. A failing assertion aborts the file via ON_ERROR_STOP, and
-- the final ROLLBACK discards every fixture, so reruns stay deterministic.
DO $behaviors$
DECLARE
    a uuid := level_test.actor_test_owner();
    b uuid := '00000000-0000-0000-0000-000000000002'::uuid;
    o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; oX uuid;
    c1 uuid := gen_random_uuid();
    cR1 uuid := gen_random_uuid();
    c3 uuid;
    cR2 uuid := level_test.alt_command_id();
    r1 public.quest_completion_receipt;
    r2 public.quest_completion_receipt;
    r3 public.quest_completion_receipt;
    r5 public.quest_completion_receipt;
    r6 public.quest_completion_receipt;
    u1 public.quest_reopen_receipt;
    u2 public.quest_reopen_receipt;
    u3 public.quest_reopen_receipt;
    u4 public.quest_reopen_receipt;
    ev public.quest_events;
    occ public.quest_occurrences;
    exp numeric;
    st public.progression_status;
    def public.level_reward_command_result;
    mrow public.level_milestones;
    urow public.level_reward_unlocks;
    uL public.level_reward_unlocks;
    oZ uuid;
    oB uuid;
BEGIN
    -- Owner B exists only to prove owner isolation; B receives no policy assignment.
    INSERT INTO auth.users (id) VALUES (b) ON CONFLICT (id) DO NOTHING;

    o1 := level_test.build_test_occurrence(a, 50);
    o2 := level_test.build_test_occurrence(a, 110);
    o3 := level_test.build_test_occurrence(a, 20);
    o4 := level_test.build_test_occurrence(a, 5, 'cancelled');
    o5 := level_test.build_test_occurrence(a, 5);
    oX := level_test.build_test_occurrence(b, 10);
    oZ := level_test.build_test_occurrence(a, 0);
    oB := level_test.build_test_occurrence(b, 5);

    PERFORM level_test.set_actor(a);

    -- 1) First completion: completed event V1, exact snapshot credit, mandatory
    --    Level recognition and the completed projection in one transaction.
    SET LOCAL ROLE authenticated;
    r1 := public.complete_quest_occurrence(c1, o1, 1, '2026-09-21T08:00:00Z'::timestamptz, 'web_ui');
    RESET ROLE;

    PERFORM level_test.check_boolean(r1.replay = false, true, 'completion: fresh command is not a replay');
    PERFORM level_test.check_uuid(r1.command_id, c1, 'completion: command id');
    PERFORM level_test.check_uuid(r1.occurrence_id, o1, 'completion: occurrence id');
    PERFORM level_test.check_int(r1.execution_cycle, 1, 'completion: cycle');
    PERFORM level_test.check_bigint(r1.exp_amount, 50, 'completion: exact snapshot amount');
    PERFORM level_test.check_boolean(r1.reported_completed_at = '2026-09-21T08:00:00Z'::timestamptz, true, 'completion: reported time echoed');
    PERFORM level_test.check_not_null(r1.recorded_completed_at, 'completion: recorded time');

    SELECT * INTO ev FROM public.quest_events WHERE id = r1.completed_event_id;
    PERFORM level_test.check_uuid(ev.user_id, a, 'completion: event owner');
    PERFORM level_test.check_uuid(ev.command_id, c1, 'completion: event command id');
    PERFORM level_test.check_equal(ev.event_type, 'completed', 'completion: event type');
    PERFORM level_test.check_int(ev.payload_version, 1, 'completion: payload version');
    PERFORM level_test.check_int(ev.execution_cycle, 1, 'completion: event cycle');
    PERFORM level_test.check_boolean(ev.related_event_id IS NULL, true, 'completion: root event has no related event');
    PERFORM level_test.check_equal(ev.actor_kind, 'user', 'completion: actor kind');
    PERFORM level_test.check_uuid(ev.actor_user_id, a, 'completion: actor user');
    PERFORM level_test.check_boolean(ev.occurred_at = r1.recorded_completed_at, true, 'completion: recorded equals event time');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','source_type'], '"quest_completion"'::jsonb, 'completion: envelope source type');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','reason'], '"completion_reward"'::jsonb, 'completion: envelope reason');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','source_id'], to_jsonb(ev.id), 'completion: envelope source id');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','ledger_entry_id'], to_jsonb(r1.exp_entry_id), 'completion: preallocated receipt');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','amount'], '50'::jsonb, 'completion: envelope amount');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['reward_exp_snapshot'], '50'::jsonb, 'completion: reward snapshot preserved');

    PERFORM level_test.check_exp_entry(r1.exp_entry_id, a, 'quest_completion', r1.completed_event_id, 50, 'completion_reward');
    -- Level 1 was recognized at EXP 0 by the policy assignment; a +50 credit
    -- crosses no persisted threshold, so recognition adds no milestone here.
    PERFORM level_test.check_boolean((SELECT count(*) FROM public.level_milestones WHERE user_id = a) = 1, true, 'completion: no milestone below the next threshold');

    SELECT * INTO occ FROM public.quest_occurrences WHERE id = o1;
    PERFORM level_test.check_uuid(r1.quest_id, occ.quest_id, 'completion: quest echoed');
    PERFORM level_test.check_equal(occ.status, 'completed', 'completion: status projected');
    PERFORM level_test.check_boolean(occ.recorded_completed_at = r1.recorded_completed_at, true, 'completion: projection recorded');
    PERFORM level_test.check_boolean(occ.reported_completed_at = r1.reported_completed_at, true, 'completion: projection reported');
    PERFORM level_test.check_int(occ.execution_cycle, 1, 'completion: cycle unchanged');

    SET LOCAL ROLE authenticated;
    exp := public.get_current_exp();
    RESET ROLE;
    PERFORM level_test.check_equal(exp::text, '50', 'completion: owner EXP total');

    -- 2) Replay with the accepted command id returns the same receipt with
    --    replay = true and mints no additional event or ledger row.
    SET LOCAL ROLE authenticated;
    r2 := public.complete_quest_occurrence(c1, o1, 1, '2026-09-21T08:00:00Z'::timestamptz, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(r2.replay, true, 'replay: marked as replay');
    PERFORM level_test.check_uuid(r2.completed_event_id, r1.completed_event_id, 'replay: same completed event');
    PERFORM level_test.check_uuid(r2.exp_entry_id, r1.exp_entry_id, 'replay: same ledger entry');
    PERFORM level_test.check_bigint(r2.exp_amount, 50, 'replay: same amount');
    PERFORM level_test.check_boolean(r2.recorded_completed_at = r1.recorded_completed_at, true, 'replay: recorded time preserved');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND command_id = c1)::integer, 1, 'replay: single command event');

    -- 2b) A retry that arrives under a DIFFERENT command id, for the same
    --     already completed occurrence and the same execution cycle, resolves
    --     to the already accepted completion: replay receipt, same event and
    --     credit identities, and no additional quest event or EXP credit.
    SET LOCAL ROLE authenticated;
    r5 := public.complete_quest_occurrence(cR2, o1, 1, '2026-09-21T08:30:00Z'::timestamptz, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_uuid(r5.command_id, cR2, 'retry: caller command id echoed');
    PERFORM level_test.check_boolean(r5.replay, true, 'retry: alternate id resolves to replay');
    PERFORM level_test.check_uuid(r5.completed_event_id, r1.completed_event_id, 'retry: same completed event');
    PERFORM level_test.check_uuid(r5.exp_entry_id, r1.exp_entry_id, 'retry: same ledger entry');
    PERFORM level_test.check_bigint(r5.exp_amount, 50, 'retry: same amount');
    PERFORM level_test.check_boolean(r5.recorded_completed_at = r1.recorded_completed_at, true, 'retry: recorded time preserved');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1)::integer, 1, 'retry: no extra quest event');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND command_id = cR2)::integer, 0, 'retry: alternate id mints no event');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = a AND source_type = 'quest_completion' AND source_id = r1.completed_event_id)::integer, 1, 'retry: no extra EXP credit');

    -- 3) Rejection slates: an accepted command id cannot address another
    --    occurrence, and fresh commands need the live cycle, a completable
    --    status and a known occurrence.
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, now(), ''web_ui'')', c1, o2),
        ARRAY['23505'], 'completion: command id reuse on other occurrence');
    PERFORM level_test.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 2, now(), ''web_ui'')', gen_random_uuid(), o5),
        ARRAY['23514'], 'completion: stale cycle');
    PERFORM level_test.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, now(), ''web_ui'')', gen_random_uuid(), o4),
        ARRAY['23514'], 'completion: cancelled occurrence');
    PERFORM level_test.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, now(), ''web_ui'')', gen_random_uuid(), gen_random_uuid()),
        ARRAY['23514'], 'completion: unknown occurrence');
    RESET ROLE;

    -- 4) Threshold crossing: the +110 credit lifts EXP to 160 past the Level 2
    --    threshold (100) and recognition mints exactly the missing milestone.
    c3 := gen_random_uuid();
    SET LOCAL ROLE authenticated;
    r3 := public.complete_quest_occurrence(c3, o2, 1, '2026-09-21T09:00:00Z'::timestamptz, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(r3.replay, false, 'threshold: fresh command');
    PERFORM level_test.check_bigint(r3.exp_amount, 110, 'threshold: exact snapshot amount');
    SELECT * INTO mrow FROM public.level_milestones WHERE user_id = a AND level = 2;
    PERFORM level_test.check_uuid(mrow.user_id, a, 'threshold: Level 2 milestone owner');
    PERFORM level_test.check_uuid(mrow.cause_ledger_entry_id, r3.exp_entry_id, 'threshold: milestone cause credit');
    PERFORM level_test.check_bigint(mrow.evaluated_exp::bigint, 160, 'threshold: evaluated EXP');
    PERFORM level_test.check_int((SELECT count(*) FROM public.level_milestones WHERE user_id = a)::integer, 2, 'threshold: exactly two milestones');
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    RESET ROLE;
    PERFORM level_test.check_boolean(st.available, true, 'threshold: progression available');
    PERFORM level_test.check_equal(st.current_exp::text, '160', 'threshold: current EXP');
    PERFORM level_test.check_int(st.current_level, 2, 'threshold: current level');
    PERFORM level_test.check_int(st.highest_level, 2, 'threshold: highest level');

    -- 5) Owner isolation: an owner without a policy assignment cannot complete
    --    because mandatory recognition fails, and no owner can address another
    --    owner's occurrence.
    PERFORM level_test.set_actor(b);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, now(), ''web_ui'')', gen_random_uuid(), oX),
        ARRAY['P0001'], 'isolation: unassigned owner completion');
    RESET ROLE;
    PERFORM level_test.set_actor(a);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, now(), ''web_ui'')', gen_random_uuid(), oX),
        ARRAY['23514'], 'isolation: foreign occurrence');
    RESET ROLE;
    PERFORM level_test.check_boolean((SELECT count(*) FROM public.quest_events WHERE user_id = b)::integer = 0, true, 'isolation: owner B stayed clean');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = b)::integer, 0, 'isolation: owner B ledger clean');
    SELECT * INTO occ FROM public.quest_occurrences WHERE id = oX;
    PERFORM level_test.check_equal(occ.status, 'active', 'isolation: B occurrence untouched');
    PERFORM level_test.check_int(occ.execution_cycle, 1, 'isolation: B cycle untouched');
    PERFORM level_test.check_boolean(occ.recorded_completed_at IS NULL, true, 'isolation: B has no recorded completion');

    -- 6) A zero-reward completion still mints its event and zero ledger receipt
    --    without moving the EXP total.
    SET LOCAL ROLE authenticated;
    r6 := public.complete_quest_occurrence(gen_random_uuid(), oZ, 1, '2026-09-21T10:00:00Z'::timestamptz, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_bigint(r6.exp_amount, 0, 'zero: amount');
    PERFORM level_test.check_exp_entry(r6.exp_entry_id, a, 'quest_completion', r6.completed_event_id, 0, 'completion_reward');
    SET LOCAL ROLE authenticated;
    exp := public.get_current_exp();
    RESET ROLE;
    PERFORM level_test.check_equal(exp::text, '160', 'zero: EXP total unchanged');

    -- 7) Reopen undoes the accepted completion: a correction event V1 records
    --    the exact reversal envelope, a reopened event references it, the
    --    occurrence returns to its scheduled status with the cycle advanced,
    --    and the EXP credit is reversed with history preserved.
    SET LOCAL ROLE authenticated;
    u1 := public.reopen_quest_occurrence(cR1, o1, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(u1.replay = false, true, 'reopen: fresh command');
    PERFORM level_test.check_uuid(u1.command_id, cR1, 'reopen: command id');
    PERFORM level_test.check_uuid(u1.occurrence_id, o1, 'reopen: occurrence id');
    PERFORM level_test.check_int(u1.undone_cycle, 1, 'reopen: undone cycle');
    PERFORM level_test.check_bigint(u1.reversed_amount, -50, 'reopen: exact reversal amount');
    PERFORM level_test.check_uuid(u1.original_credit_entry_id, r1.exp_entry_id, 'reopen: original credit linked');
    PERFORM level_test.check_not_null(u1.correction_event_id, 'reopen: correction event');
    PERFORM level_test.check_not_null(u1.reopened_event_id, 'reopen: reopened event');

    SELECT * INTO ev FROM public.quest_events WHERE id = u1.correction_event_id;
    PERFORM level_test.check_equal(ev.event_type, 'completion_corrected', 'reopen: correction event type');
    PERFORM level_test.check_uuid(ev.related_event_id, r1.completed_event_id, 'reopen: correction references completion');
    PERFORM level_test.check_int(ev.execution_cycle, 1, 'reopen: correction keeps the undone cycle');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['correction','undo'], 'true'::jsonb, 'reopen: undo flag');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['correction','original_completion_event_id'], to_jsonb(r1.completed_event_id), 'reopen: undo target event');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','source_type'], '"quest_completion_reversal"'::jsonb, 'reopen: reversal source type');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','reason'], '"completion_reward_reversal"'::jsonb, 'reopen: reversal reason');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','source_id'], to_jsonb(ev.id), 'reopen: reversal source id');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','amount'], '-50'::jsonb, 'reopen: reversal amount');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','original_credit_entry_id'], to_jsonb(r1.exp_entry_id), 'reopen: original credit in envelope');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','reversal_entry_id'], to_jsonb(u1.reversal_entry_id), 'reopen: preallocated reversal receipt');

    SELECT * INTO ev FROM public.quest_events WHERE id = u1.reopened_event_id;
    PERFORM level_test.check_equal(ev.event_type, 'reopened', 'reopen: reopened event type');
    PERFORM level_test.check_uuid(ev.related_event_id, u1.correction_event_id, 'reopen: reopened references correction');
    PERFORM level_test.check_int(ev.execution_cycle, 2, 'reopen: reopened carries the new cycle');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['prior_status'], '"completed"'::jsonb, 'reopen: prior status');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['new_status'], '"scheduled"'::jsonb, 'reopen: new status');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['prior_execution_cycle'], '1'::jsonb, 'reopen: prior cycle');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['new_execution_cycle'], '2'::jsonb, 'reopen: new cycle');

    PERFORM level_test.check_reversal_entry(u1.reversal_entry_id, a, 'quest_completion_reversal', u1.correction_event_id, r1.exp_entry_id, -50, 'completion_reward_reversal');
    SELECT * INTO occ FROM public.quest_occurrences WHERE id = o1;
    PERFORM level_test.check_equal(occ.status, 'scheduled', 'reopen: status restored');
    PERFORM level_test.check_int(occ.execution_cycle, 2, 'reopen: cycle advanced');
    PERFORM level_test.check_boolean(occ.recorded_completed_at IS NULL, true, 'reopen: recorded time cleared');
    PERFORM level_test.check_boolean(occ.reported_completed_at IS NULL, true, 'reopen: reported time cleared');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1)::integer, 3, 'reopen: full history preserved');
    PERFORM level_test.check_int((SELECT count(*) FROM public.level_milestones WHERE user_id = a)::integer, 2, 'reopen: milestones never revoked');
    SET LOCAL ROLE authenticated;
    exp := public.get_current_exp();
    RESET ROLE;
    PERFORM level_test.check_equal(exp::text, '110', 'reopen: EXP total reversed');

    -- 8) Reopen rejection slate and replay: a fresh command needs an accepted
    --    completion, a completion command id cannot drive reopen, and the
    --    accepted reopen command id replays as one immutable event pair.
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence(%L, %L, ''web_ui'')', gen_random_uuid(), o3),
        ARRAY['23514'], 'reopen: occurrence never completed');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence(%L, %L, ''web_ui'')', gen_random_uuid(), gen_random_uuid()),
        ARRAY['23514'], 'reopen: unknown occurrence');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence(%L, %L, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['23514'], 'reopen: occurrence no longer completed');
    PERFORM level_test.reject(format('SELECT public.reopen_quest_occurrence(%L, %L, ''web_ui'')', c1, o1),
        ARRAY['23505'], 'reopen: completion command id rejected');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    u2 := public.reopen_quest_occurrence(cR1, o1, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(u2.replay, true, 'reopen replay: marked as replay');
    PERFORM level_test.check_int(u2.undone_cycle, 1, 'reopen replay: undone cycle preserved');
    PERFORM level_test.check_uuid(u2.correction_event_id, u1.correction_event_id, 'reopen replay: same correction');
    PERFORM level_test.check_uuid(u2.reopened_event_id, u1.reopened_event_id, 'reopen replay: same reopened event');
    PERFORM level_test.check_uuid(u2.reversal_entry_id, u1.reversal_entry_id, 'reopen replay: same reversal entry');
    PERFORM level_test.check_bigint(u2.reversed_amount, -50, 'reopen replay: same amount');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND command_id = cR1)::integer, 2, 'reopen replay: single command pair');

    -- 8b) Recompletion on the reopened occurrence: the reopen advanced the
    --     execution cycle to 2, so a fresh command with expected cycle 2
    --     succeeds, mints a NEW completed event and NEW EXP credit without
    --     reusing the cycle-1 identities, and completes the occurrence on
    --     cycle 2.
    SET LOCAL ROLE authenticated;
    r2 := public.complete_quest_occurrence(gen_random_uuid(), o1, 2, '2026-09-21T11:00:00Z'::timestamptz, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(r2.replay, false, 'recompletion: fresh command');
    PERFORM level_test.check_int(r2.execution_cycle, 2, 'recompletion: cycle 2 receipt');
    PERFORM level_test.check_bigint(r2.exp_amount, 50, 'recompletion: unchanged snapshot amount');
    PERFORM level_test.check_boolean(r2.completed_event_id IS DISTINCT FROM r1.completed_event_id, true, 'recompletion: new completed event');
    PERFORM level_test.check_boolean(r2.exp_entry_id IS DISTINCT FROM r1.exp_entry_id, true, 'recompletion: new EXP credit');
    SELECT * INTO ev FROM public.quest_events WHERE id = r2.completed_event_id;
    PERFORM level_test.check_int(ev.execution_cycle, 2, 'recompletion: event carries cycle 2');
    PERFORM level_test.check_uuid(ev.occurrence_id, o1, 'recompletion: same occurrence');
    PERFORM level_test.check_int((SELECT count(*) FROM public.quest_events WHERE user_id = a AND occurrence_id = o1)::integer, 4, 'recompletion: completed+correction+reopened+completed');
    PERFORM level_test.check_int((SELECT count(*) FROM public.exp_ledger WHERE user_id = a AND source_type = 'quest_completion' AND source_id = r1.completed_event_id)::integer, 1, 'recompletion: cycle-1 credit untouched');
    SELECT * INTO occ FROM public.quest_occurrences WHERE id = o1;
    PERFORM level_test.check_equal(occ.status, 'completed', 'recompletion: projection completed');
    PERFORM level_test.check_int(occ.execution_cycle, 2, 'recompletion: projection on cycle 2');
    SET LOCAL ROLE authenticated;
    exp := public.get_current_exp();
    RESET ROLE;
    PERFORM level_test.check_equal(exp::text, '160', 'recompletion: EXP back to 160');

    -- 9) Security: without a request identity the commands refuse to act at all.
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT set_config(''request.jwt.claim.sub'', '''', true); SELECT public.complete_quest_occurrence(%L, %L, 1, now(), ''web_ui'')', gen_random_uuid(), o5),
        ARRAY['42501'], 'security: completion without request identity');
    PERFORM level_test.reject(format('SELECT set_config(''request.jwt.claim.sub'', '''', true); SELECT public.reopen_quest_occurrence(%L, %L, ''web_ui'')', gen_random_uuid(), o1),
        ARRAY['42501'], 'security: reopen without request identity');
    RESET ROLE;
    PERFORM level_test.set_actor(a);

    -- 10) Level/Reward boundary: the completed quest EXP drives reward unlocks.
    --     A reward at the reached level mints its unlock against the Level 2
    --     milestone, a reward above the reached level stays locked, and requests
    --     outside the assigned policy or from an unassigned owner are rejected
    --     with no partial writes (atomic rollback).
    SET LOCAL ROLE authenticated;
    def := public.configure_level_reward(gen_random_uuid(),
        '{"operation":"configureLevelReward","fields":{"required_level":2,"title":"Movie night","description":null,"category":"experience","estimated_cost":null,"currency_label":null}}'::jsonb,
        'web_ui');
    RESET ROLE;
    PERFORM level_test.check_equal(def.event_type, 'configured', 'reward: event type');
    PERFORM level_test.check_bigint(def.definition_revision, 1, 'reward: first revision');
    PERFORM level_test.check_boolean(def.before_snapshot IS NULL, true, 'reward: no before snapshot on create');
    PERFORM level_test.check_not_null(def.reward_id, 'reward: definition id');
    PERFORM level_test.check_not_null(def.unlock_id, 'reward: unlock minted at reached level');
    PERFORM level_test.check_json_has_path(def.request, ARRAY['operation'], '"configureLevelReward"'::jsonb, 'reward: canonical operation');
    PERFORM level_test.check_json_has_path(def.request, ARRAY['fields','required_level'], '2'::jsonb, 'reward: canonical level');
    PERFORM level_test.check_json_has_path(def.after_snapshot, ARRAY['title'], '"Movie night"'::jsonb, 'reward: after snapshot title');
    PERFORM level_test.check_json_has_path(def.after_snapshot, ARRAY['required_level'], '2'::jsonb, 'reward: after snapshot level');
    PERFORM level_test.check_json_has_path(def.after_snapshot, ARRAY['archived_at'], 'null'::jsonb, 'reward: after snapshot not archived');

    SELECT * INTO urow FROM public.level_reward_unlocks WHERE reward_id = def.reward_id;
    PERFORM level_test.check_uuid(urow.user_id, a, 'reward: unlock owner');
    PERFORM level_test.check_int(urow.required_level, 2, 'reward: unlock level');
    PERFORM level_test.check_bigint(urow.definition_revision, 1, 'reward: unlock revision');
    PERFORM level_test.check_uuid(urow.milestone_id, mrow.id, 'reward: unlock milestone');
    PERFORM level_test.check_uuid(urow.definition_event_id, def.event_id, 'reward: unlock definition event');
    PERFORM level_test.check_equal(urow.title, 'Movie night', 'reward: frozen unlock title');

    SET LOCAL ROLE authenticated;
    def := public.configure_level_reward(gen_random_uuid(),
        '{"operation":"configureLevelReward","fields":{"required_level":3,"title":"Concert","description":null,"category":"experience","estimated_cost":null,"currency_label":null}}'::jsonb,
        'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(def.unlock_id IS NULL, true, 'reward: above reached level stays locked');

    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.configure_level_reward(%L, %L, ''web_ui'')', gen_random_uuid(),
        '{"operation":"configureLevelReward","fields":{"required_level":101,"title":"Too far","description":null,"category":"experience","estimated_cost":null,"currency_label":null}}'),
        ARRAY['23514'], 'reward: level outside assigned policy');
    RESET ROLE;
    PERFORM level_test.set_actor(b);
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject(format('SELECT public.configure_level_reward(%L, %L, ''web_ui'')', gen_random_uuid(),
        '{"operation":"configureLevelReward","fields":{"required_level":1,"title":"No policy","description":null,"category":"experience","estimated_cost":null,"currency_label":null}}'),
        ARRAY['P0001'], 'reward: unassigned owner rejected');
    RESET ROLE;
    PERFORM level_test.set_actor(a);
    PERFORM level_test.check_int((SELECT count(*) FROM public.level_reward_definitions WHERE user_id = b)::integer, 0, 'reward: owner B atomic rollback');

    -- 11) Level decrease on reversal: reopening the recompletion (-50) and the
    --     Level-2 threshold crossing completion (-110) takes EXP from 160 to 0,
    --     below the Level 2 threshold (100). Current Level drops from 2 to 1 on
    --     read while highest Level, milestones and the minted unlock persist.
    SET LOCAL ROLE authenticated;
    u3 := public.reopen_quest_occurrence(gen_random_uuid(), o1, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(u3.replay, false, 'level drop: recompletion reopen');
    PERFORM level_test.check_uuid(u3.original_credit_entry_id, r2.exp_entry_id, 'level drop: reversal targets the cycle-2 credit');
    PERFORM level_test.check_bigint(u3.reversed_amount, -50, 'level drop: recompletion reversal amount');
    SET LOCAL ROLE authenticated;
    u4 := public.reopen_quest_occurrence(gen_random_uuid(), o2, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_uuid(u4.original_credit_entry_id, r3.exp_entry_id, 'level drop: threshold completion reversal target');
    PERFORM level_test.check_bigint(u4.reversed_amount, -110, 'level drop: threshold completion reversal amount');
    SET LOCAL ROLE authenticated;
    st := public.get_progression_status();
    RESET ROLE;
    PERFORM level_test.check_equal(st.current_exp::text, '0', 'level drop: EXP total back to zero');
    PERFORM level_test.check_int(st.current_level, 1, 'level drop: current Level decreased to 1');
    PERFORM level_test.check_int(st.highest_level, 2, 'level drop: highest Level preserved');
    PERFORM level_test.check_int((SELECT count(*) FROM public.level_milestones WHERE user_id = a)::integer, 2, 'level drop: both milestones preserved');
    SELECT * INTO mrow FROM public.level_milestones WHERE user_id = a AND level = 2;
    PERFORM level_test.check_bigint(mrow.evaluated_exp::bigint, 160, 'level drop: Level 2 milestone history unchanged');
    SELECT * INTO uL FROM public.level_reward_unlocks WHERE id = urow.id;
    PERFORM level_test.check_uuid(uL.id, urow.id, 'unlock: same unlock row preserved');
    PERFORM level_test.check_uuid(uL.milestone_id, mrow.id, 'unlock: milestone link preserved');
    PERFORM level_test.check_int(uL.required_level, 2, 'unlock: level preserved');
    PERFORM level_test.check_bigint(uL.definition_revision, 1, 'unlock: revision preserved');
    PERFORM level_test.check_equal(uL.title, 'Movie night', 'unlock: title preserved');
    PERFORM level_test.check_uuid(uL.definition_event_id, urow.definition_event_id, 'unlock: definition event preserved');
    PERFORM level_test.check_boolean(uL.unlocked_at = urow.unlocked_at, true, 'unlock: unlocked_at preserved');
    PERFORM level_test.check_int((SELECT count(*) FROM public.level_reward_unlocks WHERE user_id = a)::integer, 1, 'unlock: exactly one unlock preserved');

    -- 12) Zero-EXP reopen: the zero-reward completion's ledger receipt is
    --     reversed with an exact zero reversal receipt; original and reversal
    --     history stay linked and the occurrence returns to scheduled on
    --     cycle 2 with the EXP total unchanged.
    SET LOCAL ROLE authenticated;
    u1 := public.reopen_quest_occurrence(gen_random_uuid(), oZ, 'web_ui');
    RESET ROLE;
    PERFORM level_test.check_boolean(u1.replay = false, true, 'zero reopen: fresh command');
    PERFORM level_test.check_uuid(u1.occurrence_id, oZ, 'zero reopen: occurrence');
    PERFORM level_test.check_bigint(u1.reversed_amount, 0, 'zero reopen: exact zero reversal');
    PERFORM level_test.check_uuid(u1.original_credit_entry_id, r6.exp_entry_id, 'zero reopen: original zero credit linked');
    PERFORM level_test.check_reversal_entry(u1.reversal_entry_id, a, 'quest_completion_reversal', u1.correction_event_id, r6.exp_entry_id, 0, 'completion_reward_reversal');
    PERFORM level_test.check_exp_entry(r6.exp_entry_id, a, 'quest_completion', r6.completed_event_id, 0, 'completion_reward');
    SELECT * INTO ev FROM public.quest_events WHERE id = u1.correction_event_id;
    PERFORM level_test.check_uuid(ev.related_event_id, r6.completed_event_id, 'zero reopen: correction references completion');
    PERFORM level_test.check_json_has_path(ev.payload, ARRAY['exp','amount'], '0'::jsonb, 'zero reopen: envelope zero amount');
    SELECT * INTO ev FROM public.quest_events WHERE id = u1.reopened_event_id;
    PERFORM level_test.check_int(ev.execution_cycle, 2, 'zero reopen: reopened carries cycle 2');
    SELECT * INTO occ FROM public.quest_occurrences WHERE id = oZ;
    PERFORM level_test.check_equal(occ.status, 'scheduled', 'zero reopen: status restored');
    PERFORM level_test.check_int(occ.execution_cycle, 2, 'zero reopen: cycle advanced');
    SET LOCAL ROLE authenticated;
    exp := public.get_current_exp();
    RESET ROLE;
    PERFORM level_test.check_equal(exp::text, '0', 'zero reopen: EXP total unchanged');

    -- 13) Authenticated direct-mutation denial: the browser role is read-only
    --     across the Quest/EXP/progression history boundary; every direct
    --     write path is denied with 42501. The slate helper is SECURITY
    --     INVOKER, so each statement executes with plain authenticated
    --     privileges and no elevated fallback.
    SET LOCAL ROLE authenticated;
    PERFORM level_test.reject('INSERT INTO public.quest_events (id, quest_id, user_id, occurrence_id, event_type, actor_kind, actor_user_id, occurred_at, command_id, execution_cycle, payload_version, payload) VALUES (gen_random_uuid(), gen_random_uuid(), ''00000000-0000-0000-0000-000000000001''::uuid, gen_random_uuid(), ''completed'', ''user'', ''00000000-0000-0000-0000-000000000001''::uuid, now(), gen_random_uuid(), 1, 1, ''{}''::jsonb)',
        ARRAY['42501'], 'security: authenticated cannot insert quest_events');
    PERFORM level_test.reject('DELETE FROM public.quest_events',
        ARRAY['42501'], 'security: authenticated cannot delete quest_events');
    PERFORM level_test.reject('TRUNCATE public.quest_events',
        ARRAY['42501'], 'security: authenticated cannot truncate quest_events');
    PERFORM level_test.reject(format('UPDATE public.quest_occurrences SET status = ''completed'' WHERE id = %L', o5),
        ARRAY['42501'], 'security: authenticated cannot update quest_occurrences');
    PERFORM level_test.reject(format('INSERT INTO public.exp_ledger (id, user_id, source_type, source_id, reason, amount) VALUES (gen_random_uuid(), %L, ''quest_completion'', gen_random_uuid(), ''completion_reward'', 1)', a),
        ARRAY['42501'], 'security: authenticated cannot insert exp_ledger');
    PERFORM level_test.reject(format('INSERT INTO public.level_milestones (user_id, level, policy_assignment_id, policy_id, evaluated_exp, cause_kind, cause_ledger_entry_id, actor_user_id, origin) VALUES (%L, 1, gen_random_uuid(), gen_random_uuid(), 0, ''policy_assignment'', NULL, %L, ''web_ui'')', a, a),
        ARRAY['42501'], 'security: authenticated cannot mint level_milestones');
    PERFORM level_test.reject(format('INSERT INTO public.level_reward_unlocks (user_id, reward_id, milestone_id, definition_event_id, required_level, definition_revision, title, description, category) VALUES (%L, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 2, 1, ''Forged'', NULL, ''treat'')', a),
        ARRAY['42501'], 'security: authenticated cannot forge level_reward_unlocks');
    RESET ROLE;

    RAISE NOTICE 'Quest command behavior tests passed';
END;
$behaviors$;
ROLLBACK;
