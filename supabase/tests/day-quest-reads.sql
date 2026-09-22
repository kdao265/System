\set ON_ERROR_STOP on
-- Day Quest occurrence read layer behavior tests.
-- Authority: ui-read-query-v1-draft.md section 3.3 (Product Owner decisions 1-3),
-- quest-database-schema.md, quest-command-api-v1.md, quest-event-payload-v1.md,
-- auth-profile-database-schema.md, player-exp-database-schema.md and
-- level-reward-database-schema.md.
-- Disposable LOCAL database only: every fixture, role membership, trigger
-- disable/enable and grant rolls back at the end (sibling-suite pattern).
-- Runner:
--   Get-Content -Raw supabase/tests/day-quest-reads.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1

SET timezone TO 'UTC';

BEGIN;
GRANT quest_command_owner TO CURRENT_USER;
GRANT level_policy_assignment_owner TO CURRENT_USER;
CREATE SCHEMA day_test;
REVOKE ALL ON SCHEMA day_test FROM PUBLIC, anon, authenticated, service_role,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT USAGE ON SCHEMA day_test TO anon, authenticated, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;

CREATE FUNCTION day_test.assert_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
    IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
END;
$fn$;

CREATE FUNCTION day_test.reject(statement text, states text[], label text) RETURNS void
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
-- The rejection slate executes caller-supplied SQL, so it stays SECURITY INVOKER:
-- it can never run a slate statement above the calling role's privileges.

-- SECURITY DEFINER fixture builder owned by the migration executor so tests can
-- arrange storage directly regardless of the role under assertion.
CREATE FUNCTION day_test.occurrence(
    p_user uuid,
    p_status text DEFAULT 'draft',
    p_reward integer DEFAULT 50,
    p_slot date DEFAULT NULL,
    p_sched timestamptz DEFAULT NULL,
    p_deadline timestamptz DEFAULT NULL,
    p_cycle integer DEFAULT 1,
    p_recurring boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE qid uuid; oid uuid; rid uuid;
BEGIN
    INSERT INTO public.quests (user_id, title, recurrence_mode)
        VALUES (p_user, 'day test quest',
            CASE WHEN p_recurring THEN 'daily' ELSE 'one_off' END)
        RETURNING id INTO qid;
    IF p_recurring THEN
        INSERT INTO public.quest_recurrence_rules (quest_id, user_id, recurrence_type, anchor_date)
            VALUES (qid, p_user, 'daily', p_slot) RETURNING id INTO rid;
    END IF;
    INSERT INTO public.quest_occurrences (quest_id, user_id, status, execution_cycle,
            reward_exp_snapshot, source_slot_date, source_timezone, scheduled_at, deadline_at,
            recurrence_rule_id, recurrence_revision, recorded_completed_at)
        VALUES (qid, p_user, p_status, p_cycle, p_reward,
            p_slot, CASE WHEN p_recurring THEN 'UTC' END,
            p_sched, p_deadline,
            rid, CASE WHEN p_recurring THEN 1 END,
            CASE WHEN p_status = 'completed' THEN COALESCE(p_sched, pg_catalog.now()) END)
        RETURNING id INTO oid;
    RETURN oid;
END;
$fn$;

-- Published-policy assignment follows the quest-commands.sql fixture shape and
-- runs inline as the migration executor in the behavior block below: a dedicated
-- operator user holding the level_policy_assign capability executes
-- public.assign_level_policy through its frozen command boundary, so mandatory
-- Level recognition and the Level 1 milestone come from the real assignment path.
-- (A SECURITY DEFINER helper must not switch roles: PostgreSQL forbids SET ROLE
-- inside definer functions, so the fixture stays in the invoker DO block.)

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA day_test
    TO anon, authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
REVOKE ALL ON FUNCTION day_test.occurrence(uuid, text, integer, date, timestamptz, timestamptz, integer, boolean)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION day_test.occurrence(uuid, text, integer, date, timestamptz, timestamptz, integer, boolean)
    TO quest_command_owner;
-- The definer fixture builder stays executor-only; assertion helpers and the
-- SECURITY INVOKER rejection slate are callable by the roles under test.

-- Fixture precondition: the seeded published policy exists (same as quest-commands).
DO $precond$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.level_policies
        WHERE policy_key = 'level_policy_v1' AND status = 'published'
    ) THEN
        RAISE EXCEPTION 'fixture-missing=level_policy_v1 published policy' USING ERRCODE = '55000';
    END IF;
END;
$precond$;

DO $behaviors$
DECLARE
    a  uuid := '00000000-0000-0000-0000-0000000000A1';
    b  uuid := '00000000-0000-0000-0000-0000000000B2';
    op uuid := '00000000-0000-0000-0000-0000000000EE';
    policy_id uuid;
    o uuid; o_today uuid; o_slot uuid; o_deadline uuid; o_sched uuid; o_dup uuid;
    o_in1 uuid; o_out1 uuid; o_in2 uuid; o_out2 uuid;
    f_in1 uuid; f_out1 uuid; f_in2 uuid; f_out2 uuid;
    c_in uuid; c_out uuid;
    oE uuid; oC uuid; oX uuid; o_nr uuid; o9 uuid;
    oY uuid; oX2 uuid; oZ uuid;
    v_st text; v_cyc integer; v_acc integer; v_pr boolean; v_comp boolean;
    arr uuid[];
BEGIN
    INSERT INTO auth.users (id) VALUES (a), (b), (op)
        ON CONFLICT (id) DO NOTHING;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id IN (a, b);

    -- 1) Identity boundary: no request identity is rejected with 42501 before
    --    any data access; the anonymous browser role has no EXECUTE at all.
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.reject('SELECT count(*) FROM public.list_day_quest_occurrences()',
        ARRAY['42501'], 'missing request identity rejected 42501');
    RESET ROLE;
    SET LOCAL ROLE anon;
    PERFORM day_test.reject('SELECT count(*) FROM public.list_day_quest_occurrences()',
        ARRAY['42501'], 'anonymous EXECUTE denied 42501');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);

    -- 2) Empty day, cross-owner isolation.
    SET LOCAL ROLE authenticated;
    PERFORM day_test.assert_true(
        (SELECT count(*) = 0 FROM public.list_day_quest_occurrences(DATE '2026-06-15')),
        'empty selected day before fixtures');
    RESET ROLE;
    o := day_test.occurrence(a, 'draft', 50, NULL, '2026-06-15T10:00:00Z'::timestamptz, NULL);
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.assert_true(
        (SELECT count(*) = 0 FROM public.list_day_quest_occurrences(DATE '2026-06-15')),
        'cross-owner isolation: owner B sees none of A');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.assert_true(
        (SELECT count(*) = 1 FROM public.list_day_quest_occurrences(DATE '2026-06-15')),
        'owner sees exactly the own row');
    RESET ROLE;

    -- 3) p_day NULL means today in the profile timezone (UTC here): the row
    --    scheduled at today's local midnight is returned by default and by an
    --    explicit current_date, regardless of any other fixture's fixed dates.
    o_today := day_test.occurrence(a, 'draft', 10, NULL,
        (current_date::timestamp AT TIME ZONE 'UTC'), NULL);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.assert_true(
        (SELECT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences() WHERE occurrence_id = o_today)),
        'default day = today in profile timezone');
    PERFORM day_test.assert_true(
        (SELECT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(current_date) WHERE occurrence_id = o_today)),
        'explicit selected day = current date');
    RESET ROLE;

    -- 4) Membership: slot date, deadline and scheduled predicates on one
    --    profile-local day (UTC profile, normal 24h day).
    o_slot     := day_test.occurrence(a, 'draft', 20, DATE '2026-03-10', NULL, NULL, 1, true);
    o_deadline := day_test.occurrence(a, 'draft', 20, NULL, NULL, '2026-03-10T23:00:00Z'::timestamptz);
    o_sched    := day_test.occurrence(a, 'active', 20, NULL, '2026-03-10T08:00:00Z'::timestamptz, NULL);
    o_dup      := day_test.occurrence(a, 'draft', 20, DATE '2026-03-10',
        '2026-03-10T01:00:00Z'::timestamptz, '2026-03-10T02:00:00Z'::timestamptz, 1, true);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.assert_true(
        (SELECT count(*) = 4 FROM public.list_day_quest_occurrences(DATE '2026-03-10')),
        'slot-date + scheduled + deadline membership all listed');
    PERFORM day_test.assert_true(
        (SELECT count(*) = 0 FROM public.list_day_quest_occurrences(DATE '2026-03-09')),
        'previous day excluded');
    PERFORM day_test.assert_true(
        (SELECT count(*) = 0 FROM public.list_day_quest_occurrences(DATE '2026-03-11')),
        'next day excluded');
    PERFORM day_test.assert_true(
        (SELECT count(*) = 1 FROM public.list_day_quest_occurrences(DATE '2026-03-10')
         WHERE occurrence_id = o_dup),
        'duplicate predicate match listed exactly once');
    RESET ROLE;

    -- 5) DST-safe local-day windows (profile America/New_York).
    --    All fixtures are built in migration-executor context before any
    --    role switch; the builder is not callable by the browser role.
    UPDATE public.profiles SET timezone = 'America/New_York' WHERE user_id = a;
    --    Spring-forward 2026-03-08 is a 23-hour day:
    --    [2026-03-08T05:00Z, 2026-03-09T04:00Z).
    o_in1  := day_test.occurrence(a, 'draft', 5, NULL, '2026-03-08T05:00:00Z'::timestamptz, NULL);
    o_out1 := day_test.occurrence(a, 'draft', 5, NULL, '2026-03-08T04:59:59Z'::timestamptz, NULL);
    o_in2  := day_test.occurrence(a, 'draft', 5, NULL, '2026-03-09T03:59:59Z'::timestamptz, NULL);
    o_out2 := day_test.occurrence(a, 'draft', 5, NULL, '2026-03-09T04:00:00Z'::timestamptz, NULL);
    --    Fall-back 2026-11-01 is a 25-hour day:
    --    [2026-11-01T04:00Z, 2026-11-02T05:00Z).
    f_in1  := day_test.occurrence(a, 'draft', 5, NULL, '2026-11-01T04:00:00Z'::timestamptz, NULL);
    f_out1 := day_test.occurrence(a, 'draft', 5, NULL, '2026-11-01T03:59:59Z'::timestamptz, NULL);
    f_in2  := day_test.occurrence(a, 'draft', 5, NULL, '2026-11-02T04:59:59Z'::timestamptz, NULL);
    f_out2 := day_test.occurrence(a, 'draft', 5, NULL, '2026-11-02T05:00:00Z'::timestamptz, NULL);
    --    Normal 24h EST control day: [2026-02-10T05:00Z, 2026-02-11T05:00Z).
    c_in  := day_test.occurrence(a, 'draft', 5, NULL, '2026-02-10T05:00:00Z'::timestamptz, NULL);
    c_out := day_test.occurrence(a, 'draft', 5, NULL, '2026-02-11T05:00:00Z'::timestamptz, NULL);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.assert_true(
        (SELECT count(*) = 2 FROM public.list_day_quest_occurrences(DATE '2026-03-08')),
        '23h DST day returns exactly its two boundary-inclusive rows');
    PERFORM day_test.assert_true(
        (SELECT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-03-08') WHERE occurrence_id = o_in1)
         AND EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-03-08') WHERE occurrence_id = o_in2)),
        'spring DST: local midnight inclusive, one second before day end inclusive');
    PERFORM day_test.assert_true(
        (SELECT NOT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-03-08') WHERE occurrence_id = o_out1)
         AND NOT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-03-08') WHERE occurrence_id = o_out2)),
        'spring DST: one second before midnight and next local midnight excluded');
    PERFORM day_test.assert_true(
        (SELECT count(*) = 2 FROM public.list_day_quest_occurrences(DATE '2026-11-01')),
        '25h DST day returns exactly its two boundary-inclusive rows');
    PERFORM day_test.assert_true(
        (SELECT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-11-01') WHERE occurrence_id = f_in1)
         AND EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-11-01') WHERE occurrence_id = f_in2)),
        'fall DST: both local midnights inclusive across the 25h window');
    PERFORM day_test.assert_true(
        (SELECT NOT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-11-01') WHERE occurrence_id = f_out1)
         AND NOT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-11-01') WHERE occurrence_id = f_out2)),
        'fall DST: outside-boundary instants excluded');
    PERFORM day_test.assert_true(
        (SELECT count(*) = 1 FROM public.list_day_quest_occurrences(DATE '2026-02-10')),
        '24h control day window is exact');
    PERFORM day_test.assert_true(
        (SELECT NOT EXISTS(SELECT 1 FROM public.list_day_quest_occurrences(DATE '2026-02-10') WHERE occurrence_id = c_out)),
        '24h control: next local midnight excluded');
    RESET ROLE;

    -- 6) Missing and invalid Profile timezone: frozen actionable SQLSTATE PZ001,
    --    never a silent fallback and never an empty-day result.
    UPDATE public.profiles SET timezone = NULL WHERE user_id = a;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.reject('SELECT count(*) FROM public.list_day_quest_occurrences()',
        ARRAY['PZ001'], 'missing profile timezone raises PZ001');
    PERFORM day_test.reject('SELECT count(*) FROM public.list_day_quest_occurrences(DATE ''2026-02-10'')',
        ARRAY['PZ001'], 'explicit date still requires a valid timezone');
    RESET ROLE;
    -- The Profile trigger validates stored zones, so the invalid-storage branch
    -- is exercised by temporarily disabling the write guard (test-local only).
    ALTER TABLE public.profiles DISABLE TRIGGER profiles_validate_row;
    UPDATE public.profiles SET timezone = 'Not/AZone' WHERE user_id = a;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM day_test.reject('SELECT count(*) FROM public.list_day_quest_occurrences()',
        ARRAY['PZ001'], 'invalid profile timezone raises PZ001');
    RESET ROLE;
    ALTER TABLE public.profiles ENABLE TRIGGER profiles_validate_row;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id = a;

    -- 7) Progression availability and advisory completable (row-level asserts).
    --    All fixtures are built in migration-executor context: the definer
    --    builder is never granted to the browser role.
    oE := day_test.occurrence(a, 'draft', 30, NULL, '2026-05-05T10:00:00Z'::timestamptz, NULL);
    oC := day_test.occurrence(a, 'completed', 40, NULL, '2026-05-05T11:00:00Z'::timestamptz, NULL);
    oX := day_test.occurrence(a, 'cancelled', 20, NULL, '2026-05-05T12:00:00Z'::timestamptz, NULL);
    o_nr := day_test.occurrence(a, 'draft', NULL, NULL, '2026-05-05T13:00:00Z'::timestamptz, NULL);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    SELECT progression_ready, completable, already_completed_cycle
        INTO v_pr, v_comp, v_acc
        FROM public.list_day_quest_occurrences(DATE '2026-05-05') WHERE occurrence_id = oE;
    PERFORM day_test.assert_true(v_pr = false AND v_comp = false AND v_acc IS NULL,
        'no assigned policy: progression_ready and completable false');
    RESET ROLE;
    -- Inline assignment fixture (invoker DO block): dedicated operator with the
    -- frozen level_policy_assign capability assigns the seeded published policy
    -- through public.assign_level_policy, producing the real Level 1 milestone.
    SELECT p.id INTO policy_id FROM public.level_policies p
        WHERE p.policy_key = 'level_policy_v1' AND p.status = 'published' LIMIT 1;
    INSERT INTO system_internal.operator_grants (user_id, capability)
        VALUES (op, 'level_policy_assign');
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.assign_level_policy(a, policy_id, gen_random_uuid(), 'internal');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    SELECT progression_ready, completable, already_completed_cycle
        INTO v_pr, v_comp, v_acc
        FROM public.list_day_quest_occurrences(DATE '2026-05-05') WHERE occurrence_id = oE;
    PERFORM day_test.assert_true(v_pr = true AND v_comp = true AND v_acc IS NULL,
        'published policy assigned: eligible draft is completable');
    SELECT completable INTO v_comp FROM public.list_day_quest_occurrences(DATE '2026-05-05') WHERE occurrence_id = oC;
    PERFORM day_test.assert_true(v_comp = false, 'completed status is not completable');
    SELECT completable INTO v_comp FROM public.list_day_quest_occurrences(DATE '2026-05-05') WHERE occurrence_id = oX;
    PERFORM day_test.assert_true(v_comp = false, 'cancelled status is not completable');
    SELECT completable INTO v_comp FROM public.list_day_quest_occurrences(DATE '2026-05-05') WHERE occurrence_id = o_nr;
    PERFORM day_test.assert_true(v_comp = false, 'null reward snapshot is not completable');
    RESET ROLE;

    -- 8) Complete -> reopen -> recomplete against the frozen commands: the
    --    projection must never show a stale completed cycle.
    o9 := day_test.occurrence(a, 'active', 50, NULL,
        '2026-06-15T09:00:00Z'::timestamptz, '2026-06-15T10:00:00Z'::timestamptz);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.complete_quest_occurrence(gen_random_uuid(), o9, 1, NULL, 'web_ui');
    SELECT status, execution_cycle, already_completed_cycle, completable
        INTO v_st, v_cyc, v_acc, v_comp
        FROM public.list_day_quest_occurrences(DATE '2026-06-15') WHERE occurrence_id = o9;
    PERFORM day_test.assert_true(v_st = 'completed' AND v_cyc = 1 AND v_acc = 1 AND v_comp = false,
        'after completion: current-cycle completed projection, still listed on its day');
    PERFORM public.reopen_quest_occurrence(gen_random_uuid(), o9, 'web_ui');
    SELECT status, execution_cycle, already_completed_cycle, completable
        INTO v_st, v_cyc, v_acc, v_comp
        FROM public.list_day_quest_occurrences(DATE '2026-06-15') WHERE occurrence_id = o9;
    PERFORM day_test.assert_true(v_st = 'scheduled' AND v_cyc = 2 AND v_acc IS NULL AND v_comp = true,
        'after reopen: advanced cycle shows no completed projection and is actionable again');
    PERFORM public.complete_quest_occurrence(gen_random_uuid(), o9, 2, NULL, 'web_ui');
    SELECT status, execution_cycle, already_completed_cycle, completable
        INTO v_st, v_cyc, v_acc, v_comp
        FROM public.list_day_quest_occurrences(DATE '2026-06-15') WHERE occurrence_id = o9;
    PERFORM day_test.assert_true(v_st = 'completed' AND v_cyc = 2 AND v_acc = 2 AND v_comp = false,
        'after recompletion: cycle-2 projection, no stale cycle-1 confusion');
    RESET ROLE;

    -- 9) Deterministic ordering: COALESCE(scheduled_at, deadline_at) NULLS LAST, id.
    oY  := day_test.occurrence(a, 'draft', 20, NULL, NULL, '2026-06-16T01:00:00Z'::timestamptz);
    oX2 := day_test.occurrence(a, 'draft', 20, NULL, '2026-06-16T02:00:00Z'::timestamptz, NULL);
    oZ  := day_test.occurrence(a, 'draft', 20, DATE '2026-06-16', NULL, NULL, 1, true);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    SELECT array_agg(occurrence_id) INTO arr
        FROM public.list_day_quest_occurrences(DATE '2026-06-16');
    PERFORM day_test.assert_true(arr = ARRAY[oY, oX2, oZ],
        'deterministic ordering with scheduled/deadline/untimed rows');
    SELECT quest_title INTO v_st FROM public.list_day_quest_occurrences(DATE '2026-06-15') WHERE occurrence_id = o9;
    PERFORM day_test.assert_true(v_st = 'day test quest', 'quest title projected');
    RESET ROLE;

    RAISE NOTICE 'Day quest read behavior tests passed';
END;
$behaviors$;

ROLLBACK;



