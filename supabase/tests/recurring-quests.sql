\set ON_ERROR_STOP on
-- Transactional behavior/security suite for recurring Quest definitions and the lazy
-- idempotent materialization of their occurrences
-- (20260928181000_create_recurring_quests.sql).
-- Authority: docs/01-requirements/quest-engine.md RR-01..RR-07 and AC-32/AC-33/AC-39/AC-40,
-- docs/02-architecture/quest-database-schema.md section 18.
-- Run only against a disposable local database; this file never commits.
BEGIN;
GRANT quest_command_owner TO CURRENT_USER;
CREATE SCHEMA recurring_test;
CREATE FUNCTION recurring_test.assert_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END;
$fn$;
CREATE FUNCTION recurring_test.reject(statement text, states text[], label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN IF SQLSTATE = ANY(states) THEN RETURN; END IF;
        RAISE EXCEPTION 'Unexpected %: % %', label, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected rejection: %', label;
END;
$fn$;
-- Occurrence counters are read both as the migration executor and as the owner, so they
-- stay in the shared test schema instead of a definer-only fixture builder.
CREATE FUNCTION recurring_test.slots(p_quest uuid, p_day date DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
    SELECT count(*)::int FROM public.quest_occurrences
    WHERE quest_id = p_quest AND (p_day IS NULL OR source_slot_date = p_day);
$fn$;
GRANT USAGE ON SCHEMA recurring_test TO authenticated, anon, quest_command_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA recurring_test TO authenticated, anon, quest_command_owner;

-- Fixture precondition: the seeded published policy, exactly as quest-commands.sql and
-- day-quest-reads.sql require before any completion or EXP assertion.
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

DO $behavior$
DECLARE
    a  uuid := '00000000-0000-0000-0000-00000000d001';
    b  uuid := '00000000-0000-0000-0000-00000000d002';
    op uuid := '00000000-0000-0000-0000-00000000d003';
    policy_id uuid;
    today date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
    next_year integer := (EXTRACT(YEAR FROM (pg_catalog.now() AT TIME ZONE 'UTC'))::integer + 1);
    jan31 date; feb_last date; mar31 date; apr_last date;
    on_rule date; off_rule date;
    idx integer;
    daily_cmd uuid := '20000000-0000-4000-8000-00000000d001';
    replay_cmd uuid := '20000000-0000-4000-8000-00000000d002';
    pause_cmd uuid := '20000000-0000-4000-8000-00000000d003';
    resume_cmd uuid := '20000000-0000-4000-8000-00000000d004';
    monthly_cmd uuid := '20000000-0000-4000-8000-00000000d005';
    weekly_cmd uuid := '20000000-0000-4000-8000-00000000d006';
    limited_cmd uuid := '20000000-0000-4000-8000-00000000d007';
    tamper_cmd uuid := '20000000-0000-4000-8000-00000000d008';
    complete_cmd uuid := '20000000-0000-4000-8000-00000000d009';
    assign_cmd uuid := '20000000-0000-4000-8000-00000000d00a';
    r public.quest_recurring_receipt;
    r2 public.quest_recurring_receipt;
    paused public.quest_recurrence_state_receipt;
    resumed public.quest_recurrence_state_receipt;
    ack public.quest_recurrence_state_receipt;
    done public.quest_completion_receipt;
    done_again public.quest_completion_receipt;
    daily_quest uuid;
    monthly_quest uuid;
    weekly_quest uuid;
    limited_quest uuid;
    generated_occurrence uuid;
    events_before integer;
    rows_before integer;
    v_counter_before bigint;
    v_counter_after bigint;
    v_slots_before integer;
    v_slots_after integer;
    v_count integer;
    v_jsonb jsonb;
BEGIN
    INSERT INTO auth.users (id) VALUES (a), (b), (op) ON CONFLICT (id) DO NOTHING;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id IN (a, b, op);
    -- ADR-015: these four routines carry system_private.require_owner() in their own
    -- bodies because the deferred activation migration only guards the frozen
    -- pre-existing RPC list. Provision the singleton owner for this rolled-back
    -- transaction alone; no production grant or policy is touched.
    INSERT INTO system_private.owner_configuration (singleton, user_id) VALUES (true, a);

    -- 1) Creation writes a definition, one rule and exactly two events, never a slot.
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    r := public.create_recurring_quest(daily_cmd,
        jsonb_build_object('title', 'Daily stretch', 'recurrence_mode', 'daily',
            'start_date', (today - 3)::text, 'default_reward_exp', 25), 'web_ui');
    PERFORM recurring_test.assert_true(r.replay = false
        AND r.recurrence_mode = 'daily' AND r.recurrence_type = 'daily'
        AND r.anchor_date = today - 3 AND r.default_reward_exp = 25
        AND r.weekdays IS NULL AND r.month_day IS NULL AND r.occurrence_limit IS NULL,
        'daily creation receipt normalization');
    daily_quest := r.quest_id;
    PERFORM recurring_test.assert_true(recurring_test.slots(daily_quest) = 0,
        'creation never materializes a slot');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a AND command_id = daily_cmd) = 2, 'creation writes exactly two events');
    PERFORM recurring_test.assert_true(
        (SELECT count(*) FROM public.quest_events
            WHERE user_id = a AND command_id = daily_cmd AND event_type = 'created'
                AND occurrence_id IS NULL AND execution_cycle IS NULL
                AND actor_kind = 'user' AND actor_user_id = a AND payload_version = 1) = 1
        AND (SELECT count(*) FROM public.quest_events
            WHERE user_id = a AND command_id = daily_cmd AND event_type = 'recurrence_changed'
                AND occurrence_id IS NULL AND execution_cycle IS NULL
                AND actor_kind = 'user' AND actor_user_id = a AND payload_version = 1) = 1,
        'exact created and recurrence_changed event pair');
    SELECT payload INTO v_jsonb FROM public.quest_events
        WHERE user_id = a AND command_id = daily_cmd AND event_type = 'created';
    PERFORM recurring_test.assert_true(v_jsonb ->> 'origin' = 'web_ui'
        AND v_jsonb -> 'after' -> 'definition' ->> 'default_reward_exp' = '25'
        AND (v_jsonb - 'origin' - 'after') = '{}'::jsonb, 'definition payload V1 shape');
    SELECT payload INTO v_jsonb FROM public.quest_events
        WHERE user_id = a AND command_id = daily_cmd AND event_type = 'recurrence_changed';
    PERFORM recurring_test.assert_true(v_jsonb -> 'before' = 'null'::jsonb
        AND (v_jsonb - 'origin' - 'before' - 'after') = '{}'::jsonb
        AND v_jsonb -> 'after' -> 'rule' ->> 'anchor_date' = (today - 3)::text,
        'recurrence_changed payload records the new rule as the after state');

    -- 2) Retrying the identical command identity returns the recorded receipt; the
    --    recorded origin stays untouched when a retry uses another valid origin.
    SELECT count(*) INTO events_before FROM public.quest_events WHERE user_id = a;
    r2 := public.create_recurring_quest(daily_cmd,
        jsonb_build_object('title', 'Daily stretch', 'recurrence_mode', 'daily',
            'start_date', (today - 3)::text, 'default_reward_exp', 25), 'automation');
    PERFORM recurring_test.assert_true(r2.replay
        AND r2.quest_id = r.quest_id AND r2.recurrence_rule_id = r.recurrence_rule_id
        AND r2.definition_created_event_id = r.definition_created_event_id
        AND r2.recurrence_changed_event_id = r.recurrence_changed_event_id,
        'creation replay returns the recorded receipt');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a) = events_before, 'creation replay writes nothing');
    PERFORM recurring_test.assert_true((SELECT payload ->> 'origin'
        FROM public.quest_events WHERE id = r.definition_created_event_id) = 'web_ui',
        'a retry may change origin without rewriting the recorded payload');
    UPDATE public.profiles SET timezone = 'Africa/Abidjan' WHERE user_id = a;
    r2 := public.create_recurring_quest(daily_cmd,
        jsonb_build_object('title', 'Daily stretch', 'recurrence_mode', 'daily',
            'start_date', (today - 3)::text, 'default_reward_exp', 25), 'web_ui');
    PERFORM recurring_test.assert_true(r2.replay AND r2.quest_id = daily_quest
        AND (SELECT payload #>> '{after,rule,source_timezone}' FROM public.quest_events
            WHERE id = r.recurrence_changed_event_id) = 'UTC'
        AND (SELECT count(*) FROM public.quest_events WHERE user_id = a) = events_before,
        'creation recovery survives Profile timezone change without rewriting provenance');
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id = a;
    RESET ROLE;

    -- 3) Lazy idempotent materialization (RR-01, RR-05, section 18.2 and 18.4).
    SET LOCAL ROLE authenticated;
    PERFORM recurring_test.assert_true(public.materialize_quest_day(today) = 1,
        'reading the day materializes the daily slot once');
    PERFORM recurring_test.assert_true(public.materialize_quest_day(today) = 0
        AND recurring_test.slots(daily_quest) = 1,
        'a repeated read of the same day creates nothing');
    PERFORM recurring_test.assert_true((SELECT o.status = 'draft'
            AND o.scheduled_at IS NULL AND o.deadline_at IS NULL
            AND o.source_slot_date = today AND o.source_timezone = 'UTC'
            AND o.execution_cycle = 1 AND o.reward_exp_snapshot = 25
            AND o.recurrence_revision = 1
            AND o.recurrence_rule_id = r.recurrence_rule_id
         FROM public.quest_occurrences AS o
         WHERE o.quest_id = daily_quest AND o.source_slot_date = today),
        'a generated slot is an unscheduled draft carrying calendar provenance only');
    PERFORM recurring_test.assert_true((SELECT q.materialized_occurrence_count
        FROM public.quests AS q WHERE q.id = daily_quest) = 1,
        'the cumulative counter moves by exactly one per new instance');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a) = events_before, 'slot generation writes no Quest Event');
    PERFORM recurring_test.assert_true(public.materialize_quest_day(today - 1) = 0
        AND recurring_test.slots(daily_quest, today - 1) = 0,
        'an anchored past day is skipped, never backfilled (RR-05, AC-33)');
    -- A volatile generator and a STABLE reader never share one expression: the reader
    -- would be pinned to the statement snapshot taken before the insert.
    PERFORM public.materialize_quest_day(today + 1);
    PERFORM recurring_test.assert_true(recurring_test.slots(daily_quest, today + 1) = 1,
        'a requested later day materializes');
    RESET ROLE;
    -- The frozen partial unique index is the last replay-safety backstop.
    PERFORM recurring_test.reject(format(
        'INSERT INTO public.quest_occurrences (quest_id, user_id, status, recurrence_rule_id,'
        || ' recurrence_revision, source_slot_date, source_timezone, reward_exp_snapshot,'
        || ' execution_cycle) SELECT %L::uuid, %L::uuid, ''draft'', id, revision, %L::date,'
        || ' ''UTC'', 25, 1 FROM public.quest_recurrence_rules WHERE quest_id = %L::uuid',
        daily_quest, a, today::text, daily_quest), ARRAY['23505'],
        'uq_recurring_slot rejects a second occurrence for the same calendar day');

    -- 4) RR-07 pause and resume are non-destructive state changes.
    SET LOCAL ROLE authenticated;
    paused := public.set_quest_recurrence_pause(pause_cmd, daily_quest, true, 'web_ui');
    PERFORM recurring_test.assert_true(paused.replay = false AND paused.paused
        AND paused.quest_id = daily_quest AND paused.stopped_at IS NOT NULL
        AND paused.state_event_id IS NOT NULL, 'pause records one state change');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a AND command_id = pause_cmd AND event_type = 'recurrence_stopped'
            AND occurrence_id IS NULL AND execution_cycle IS NULL) = 1,
        'pause writes exactly one recurrence_stopped definition event');
    SELECT payload INTO v_jsonb FROM public.quest_events
        WHERE user_id = a AND command_id = pause_cmd;
    PERFORM recurring_test.assert_true(
        v_jsonb #> '{after,rule,stopped}' = 'true'::jsonb
        AND v_jsonb #> '{before,rule,stopped}' = 'false'::jsonb
        AND jsonb_typeof(v_jsonb #> '{after,rule,stopped_at}') = 'string'
        AND v_jsonb #> '{before,rule,stopped_at}' = 'null'::jsonb
        AND ((v_jsonb -> 'before' -> 'rule') - 'stopped' - 'stopped_at') = '{}'::jsonb
        AND ((v_jsonb -> 'after' -> 'rule') - 'stopped' - 'stopped_at') = '{}'::jsonb,
        'pause payload records the old and new rule state only');
    PERFORM recurring_test.assert_true(public.materialize_quest_day(today + 2) = 0
        AND recurring_test.slots(daily_quest, today + 2) = 0,
        'a paused series generates no future slot');
    ack := public.set_quest_recurrence_pause(replay_cmd, daily_quest, true, 'web_ui');
    PERFORM recurring_test.assert_true(NOT ack.replay AND ack.state_event_id IS NULL
        AND ack.stopped_at = paused.stopped_at,
        'a fresh command in the state already held is a no-op acknowledgement');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a AND command_id = replay_cmd) = 0,
        'a no-op acknowledgement invents no history');
    ack := public.set_quest_recurrence_pause(pause_cmd, daily_quest, true, 'automation');
    PERFORM recurring_test.assert_true(ack.replay AND ack.state_event_id = paused.state_event_id
        AND ack.stopped_at = paused.stopped_at,
        'replaying the accepted pause returns its recorded receipt');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a AND command_id = pause_cmd) = 1,
        'a pause replay writes no second event');
    PERFORM recurring_test.assert_true(recurring_test.slots(daily_quest) = 2
        AND (SELECT q.archived_at FROM public.quests q WHERE q.id = daily_quest) IS NULL
        AND (SELECT x.revision FROM public.quest_recurrence_rules x
             WHERE x.quest_id = daily_quest) = 1,
        'pausing keeps the definition and its existing occurrences intact');
    r2 := public.create_recurring_quest(daily_cmd,
        jsonb_build_object('title', 'Daily stretch', 'recurrence_mode', 'daily',
            'start_date', (today - 3)::text, 'default_reward_exp', 25), 'web_ui');
    PERFORM recurring_test.assert_true(r2.replay AND r2.quest_id = daily_quest
        AND (SELECT x.stopped_at FROM public.quest_recurrence_rules x
            WHERE x.quest_id = daily_quest) = paused.stopped_at
        AND (SELECT count(*) FROM public.quest_events
            WHERE user_id = a AND command_id = daily_cmd) = 2,
        'creation recovery survives pause without resuming or duplicating history');
    resumed := public.set_quest_recurrence_pause(resume_cmd, daily_quest, false, 'web_ui');
    PERFORM recurring_test.assert_true(NOT resumed.replay AND NOT resumed.paused
        AND resumed.stopped_at IS NULL AND resumed.state_event_id IS NOT NULL,
        'resume restores generation from the same rule');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a AND command_id = resume_cmd AND event_type = 'recurrence_changed'
            AND occurrence_id IS NULL AND execution_cycle IS NULL) = 1,
        'resume writes exactly one recurrence_changed definition event');
    SELECT payload INTO v_jsonb FROM public.quest_events
        WHERE user_id = a AND command_id = resume_cmd;
    PERFORM recurring_test.assert_true(
        v_jsonb #> '{after,rule,stopped}' = 'false'::jsonb
        AND v_jsonb #> '{before,rule,stopped}' = 'true'::jsonb
        AND jsonb_typeof(v_jsonb #> '{before,rule,stopped_at}') = 'string'
        AND v_jsonb #> '{after,rule,stopped_at}' = 'null'::jsonb,
        'resume payload records the reversal of the pause boundary');
    PERFORM public.materialize_quest_day(today + 2);
    PERFORM recurring_test.assert_true(recurring_test.slots(daily_quest, today + 2) = 1,
        'a resumed series generates again');
    ack := public.set_quest_recurrence_pause(pause_cmd, daily_quest, true, 'telegram');
    PERFORM recurring_test.assert_true(ack.replay AND ack.state_event_id = paused.state_event_id,
        'an accepted pause still replays after a later resume');
    ack := public.set_quest_recurrence_pause(replay_cmd, daily_quest, false, 'web_ui');
    PERFORM recurring_test.assert_true(NOT ack.replay AND ack.state_event_id IS NULL,
        'resume in the state already held is a no-op acknowledgement');
    RESET ROLE;

    -- 5) RR-07 and AC-32: a monthly day-31 series clamps to the month's last valid day
    --    and returns to day 31 in the next long month, without duplicating a slot.
    SET LOCAL ROLE authenticated;
    jan31 := make_date(next_year, 1, 31);
    feb_last := make_date(next_year, 3, 1) - 1;
    mar31 := make_date(next_year, 3, 31);
    apr_last := make_date(next_year, 4, 30);
    r := public.create_recurring_quest(monthly_cmd,
        jsonb_build_object('title', 'Monthly review', 'recurrence_mode', 'monthly',
            'month_day', 31, 'start_date', jan31::text), 'web_ui');
    monthly_quest := r.quest_id;
    PERFORM recurring_test.assert_true(r.recurrence_type = 'monthly' AND r.month_day = 31
        AND r.weekdays IS NULL, 'monthly creation normalizes the discriminator');
    PERFORM public.materialize_quest_day(feb_last);
    PERFORM recurring_test.assert_true(recurring_test.slots(monthly_quest, feb_last) = 1,
        'February clamps to that month''s last valid day');
    PERFORM public.materialize_quest_day(mar31);
    PERFORM recurring_test.assert_true(recurring_test.slots(monthly_quest, mar31) = 1,
        'March still uses day 31');
    PERFORM public.materialize_quest_day(apr_last);
    PERFORM recurring_test.assert_true(recurring_test.slots(monthly_quest, apr_last) = 1,
        'April clamps to day 30');
    PERFORM public.materialize_quest_day(feb_last);
    PERFORM recurring_test.assert_true(recurring_test.slots(monthly_quest) = 3
        AND (SELECT q.materialized_occurrence_count FROM public.quests q
             WHERE q.id = monthly_quest) = 3,
        'a clamped slot is keyed to its real date and never duplicated');
    RESET ROLE;

    -- 6) A weekly series matches exactly the stored ISO weekdays.
    SET LOCAL ROLE authenticated;
    r := public.create_recurring_quest(weekly_cmd,
        jsonb_build_object('title', 'Mon Wed Fri', 'recurrence_mode', 'weekly',
            'weekdays', jsonb_build_array(3, 1, 1, 5), 'start_date', (today - 3)::text), 'web_ui');
    weekly_quest := r.quest_id;
    PERFORM recurring_test.assert_true(r.recurrence_type = 'selected_weekdays'
        AND r.weekdays = ARRAY[1, 3, 5]::smallint[] AND r.month_day IS NULL,
        'weekly creation sorts and deduplicates the ISO weekday set');
    on_rule := NULL;
    off_rule := NULL;
    FOR idx IN 0..13 LOOP
        IF on_rule IS NULL AND EXTRACT(ISODOW FROM (today + idx))::integer IN (1, 3, 5) THEN
            on_rule := today + idx;
        END IF;
        IF off_rule IS NULL AND EXTRACT(ISODOW FROM (today + idx))::integer IN (2, 4, 6) THEN
            off_rule := today + idx;
        END IF;
    END LOOP;
    PERFORM public.materialize_quest_day(on_rule);
    PERFORM recurring_test.assert_true(recurring_test.slots(weekly_quest, on_rule) = 1,
        'a selected weekday materializes');
    PERFORM public.materialize_quest_day(off_rule);
    PERFORM recurring_test.assert_true(recurring_test.slots(weekly_quest, off_rule) = 0,
        'an unselected weekday materializes nothing');
    RESET ROLE;

    -- 7) RR-02 and AC-40: occurrence_limit counts materialized instances, not elapsed days.
    SET LOCAL ROLE authenticated;
    r := public.create_recurring_quest(limited_cmd,
        jsonb_build_object('title', 'Two only', 'recurrence_mode', 'daily',
            'start_date', (today - 3)::text, 'occurrence_limit', 2), 'web_ui');
    limited_quest := r.quest_id;
    PERFORM recurring_test.assert_true(r.occurrence_limit = 2, 'limited creation stores the limit');
    FOR idx IN 0..2 LOOP
        PERFORM public.materialize_quest_day(today + idx);
    END LOOP;
    PERFORM recurring_test.assert_true(recurring_test.slots(limited_quest) = 2
        AND (SELECT q.materialized_occurrence_count FROM public.quests q
             WHERE q.id = limited_quest) = 2,
        'generation stops at occurrence_limit and skipped days consume no capacity');
    PERFORM public.materialize_quest_day(today + 3);
    PERFORM recurring_test.assert_true(recurring_test.slots(limited_quest, today + 3) = 0
        AND recurring_test.slots(daily_quest, today + 3) = 1,
        'past the limit only the unlimited series still generates');
    RESET ROLE;

    -- 8) The management projection exposes each definition with its live pause state.
    SET LOCAL ROLE authenticated;
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.list_recurring_quests()) = 4,
        'list_recurring_quests projects every recurring definition');
    PERFORM recurring_test.assert_true((SELECT NOT l.paused
            AND l.recurrence_mode = 'daily' AND l.recurrence_type = 'daily'
            AND l.anchor_date = today - 3 AND l.end_date IS NULL
            AND l.occurrence_limit IS NULL AND l.default_reward_exp = 25
            AND l.materialized_occurrence_count = recurring_test.slots(daily_quest)
            AND l.last_slot_date = (SELECT max(o.source_slot_date)
                FROM public.quest_occurrences AS o WHERE o.quest_id = daily_quest)
         FROM public.list_recurring_quests() AS l WHERE l.quest_id = daily_quest),
        'the projection reports the live state and materialization history');
    -- The generated slot enters the ordinary day read, which stays byte-identical.
    PERFORM recurring_test.assert_true((SELECT d.status = 'draft'
            AND d.source_slot_date = today AND d.completable = false
         FROM public.list_day_quest_occurrences(today) AS d
         WHERE d.quest_id = daily_quest AND d.source_slot_date = today),
        'the frozen day read lists the generated draft');
    -- Assignment fixture: a dedicated operator holds the frozen level_policy_assign
    -- capability and assigns the seeded published policy through its own command.
    SELECT p.id INTO policy_id FROM public.level_policies AS p
        WHERE p.policy_key = 'level_policy_v1' AND p.status = 'published' LIMIT 1;
    RESET ROLE;
    INSERT INTO system_internal.operator_grants (user_id, capability)
        VALUES (op, 'level_policy_assign');
    PERFORM set_config('request.jwt.claim.sub', op::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.assign_level_policy(a, policy_id, assign_cmd, 'internal');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    PERFORM recurring_test.assert_true((SELECT d.completable
         FROM public.list_day_quest_occurrences(today) AS d
         WHERE d.quest_id = daily_quest AND d.source_slot_date = today),
        'an assigned policy makes the generated draft completable');

    -- 9) Recurrence feeds the same occurrence -> completion -> EXP pipeline as a
    --    one-off Quest: the generated slot completes normally and is credited once.
    SELECT o.id INTO generated_occurrence FROM public.quest_occurrences AS o
        WHERE o.quest_id = daily_quest AND o.source_slot_date = today;
    done := public.complete_quest_occurrence(complete_cmd, generated_occurrence, 1,
        pg_catalog.now(), 'web_ui');
    PERFORM recurring_test.assert_true(NOT done.replay AND done.execution_cycle = 1
        AND done.exp_amount = 25 AND done.exp_entry_id IS NOT NULL
        AND done.completed_event_id IS NOT NULL,
        'completing a generated slot credits its frozen reward snapshot');
    PERFORM recurring_test.assert_true((SELECT e.source_type = 'quest_completion'
            AND e.source_id = done.completed_event_id AND e.reason = 'completion_reward'
            AND e.amount = 25 AND e.user_id = a
         FROM public.exp_ledger AS e WHERE e.id = done.exp_entry_id),
        'the ledger attributes the credit to the Completion Event (AC-41)');
    done_again := public.complete_quest_occurrence(complete_cmd, generated_occurrence, 1,
        pg_catalog.now(), 'web_ui');
    PERFORM recurring_test.assert_true(done_again.replay
        AND done_again.completed_event_id = done.completed_event_id
        AND done_again.exp_entry_id = done.exp_entry_id
        AND (SELECT count(*) FROM public.exp_ledger
             WHERE source_id = done.completed_event_id) = 1,
        'a completion replay grants no extra credit');
    SELECT q.materialized_occurrence_count,
            (SELECT count(*) FROM public.quest_occurrences AS o WHERE o.quest_id = daily_quest)
        INTO v_counter_before, v_slots_before
        FROM public.quests AS q WHERE q.id = daily_quest;
    PERFORM public.materialize_quest_day(today);
    SELECT q.materialized_occurrence_count,
            (SELECT count(*) FROM public.quest_occurrences AS o WHERE o.quest_id = daily_quest)
        INTO v_counter_after, v_slots_after
        FROM public.quests AS q WHERE q.id = daily_quest;
    PERFORM recurring_test.assert_true(v_counter_after = v_counter_before
        AND v_slots_after = v_slots_before AND v_slots_after > 0,
        're-reading the day after completion recreates no slot and moves no counter');
    PERFORM recurring_test.assert_true((SELECT d.status = 'completed'
            AND d.already_completed_cycle = 1 AND d.completable = false
         FROM public.list_day_quest_occurrences(today) AS d
         WHERE d.quest_id = daily_quest AND d.source_slot_date = today),
        'the day read reports the completed cycle and no longer offers completion');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_occurrences AS o
        WHERE o.quest_id = monthly_quest AND o.status = 'completed') = 0,
        'completing one occurrence never completes or rewards another (RR-04)');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_occurrences AS o
        WHERE o.quest_id = daily_quest AND o.source_slot_date IN (today + 1, today + 2, today + 3)
            AND o.status <> 'draft') = 0,
        'other generated occurrences keep their own state (RR-04)');
    RESET ROLE;

    -- 10) The request surface is closed: Goal, Project, Penalty, one-off instants and
    --     unknown inputs fail loudly, and cadence parameters are discriminator-bound.
    SET LOCAL ROLE authenticated;
    DECLARE
        bad_request text;
    BEGIN
        FOREACH bad_request IN ARRAY ARRAY[
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","goal_id":"g"}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","project_id":"p"}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","default_penalty_snapshot":{}}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","scheduled_at":"2030-01-01T09:00:00Z"}',
            '{"title":"X","recurrence_mode":"monthly","start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"weekly","start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"weekly","weekdays":[0],"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"weekly","weekdays":[8],"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"weekly","weekdays":[1.5],"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"weekly","weekdays":[],"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"monthly","month_day":32,"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"monthly","month_day":31.5,"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"daily","month_day":5,"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"daily","weekdays":[1],"start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"hourly","start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","default_reward_exp":-1}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","occurrence_limit":0}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","occurrence_limit":1.5}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","end_date":"' || (today - 1) || '"}',
            '{"title":"X","recurrence_mode":"daily"}',
            '{"title":"X","recurrence_mode":"daily","start_date":"2030-13-45"}',
            '{"title":"   ","recurrence_mode":"daily","start_date":"' || today || '"}',
            '{"recurrence_mode":"daily","start_date":"' || today || '"}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","default_difficulty":6}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","default_estimated_duration_minutes":-5}',
            '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '","tags":"not-a-list"}'
        ] LOOP
            PERFORM recurring_test.reject(format(
                'SELECT public.create_recurring_quest(%L::uuid, %L::jsonb, %L)',
                gen_random_uuid()::text, bad_request, 'web_ui'), ARRAY['22023'],
                'unsupported or inconsistent recurring input: ' || bad_request);
        END LOOP;
    END;
    PERFORM recurring_test.reject(format('SELECT public.create_recurring_quest(%L::uuid, %L::jsonb, %L)',
        gen_random_uuid()::text,
        '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '"}', 'not-an-origin'),
        ARRAY['22023'], 'an unknown origin is rejected');

    -- 11) Identity boundaries: no request identity, an authenticated non-owner and the
    --     anonymous browser role are refused before any data is touched (ADR-015).
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM recurring_test.reject(format('SELECT public.create_recurring_quest(%L::uuid, %L::jsonb, %L)',
        gen_random_uuid()::text,
        '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '"}', 'web_ui'),
        ARRAY['42501'], 'a missing request identity is refused');
    PERFORM recurring_test.reject(format('SELECT public.materialize_quest_day(%L::date)', today::text),
        ARRAY['42501'], 'materialization without a request identity is refused');
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    PERFORM recurring_test.reject(format('SELECT public.create_recurring_quest(%L::uuid, %L::jsonb, %L)',
        gen_random_uuid()::text,
        '{"title":"X","recurrence_mode":"daily","start_date":"' || today || '"}', 'web_ui'),
        ARRAY['42501'], 'an authenticated non-owner is refused');
    PERFORM recurring_test.reject('SELECT count(*) FROM public.list_recurring_quests()',
        ARRAY['42501'], 'the management projection is refused for a non-owner');
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    RESET ROLE;
    SET LOCAL ROLE anon;
    PERFORM recurring_test.reject('SELECT count(*) FROM public.list_recurring_quests()',
        ARRAY['42501'], 'the anonymous browser role has no EXECUTE');
    PERFORM recurring_test.reject(format('SELECT public.materialize_quest_day(%L::date)', today::text),
        ARRAY['42501'], 'anonymous materialization is denied');
    RESET ROLE;

    -- 12) Replay identity is bound to the immutable recorded request and payload.
    SET LOCAL ROLE authenticated;
    r := public.create_recurring_quest(tamper_cmd,
        jsonb_build_object('title', 'Tamper me', 'recurrence_mode', 'daily',
            'start_date', (today - 3)::text), 'web_ui');
    rows_before := (SELECT count(*) FROM public.quests WHERE user_id = a);
    PERFORM recurring_test.reject(format('SELECT public.create_recurring_quest(%L::uuid, %L::jsonb, %L)',
        tamper_cmd::text,
        '{"title":"Tampered","recurrence_mode":"daily","start_date":"' || (today - 3)::text || '"}',
        'web_ui'), ARRAY['23505'], 'a replay with a different request is refused');
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quests WHERE user_id = a) = rows_before
        AND (SELECT count(*) FROM public.quest_events
             WHERE user_id = a AND command_id = tamper_cmd) = 2,
        'a refused replay creates no definition and no event');
    PERFORM recurring_test.reject(format('SELECT public.set_quest_recurrence_pause(%L::uuid, %L::uuid, %L, %L)',
        gen_random_uuid()::text, gen_random_uuid()::text, 'true', 'web_ui'),
        ARRAY['23514'], 'pausing an unknown definition is refused');
    PERFORM recurring_test.reject(format('SELECT public.set_quest_recurrence_pause(%L::uuid, %L::uuid, %L, %L)',
        monthly_cmd::text, monthly_quest::text, 'false', 'web_ui'),
        ARRAY['23505'], 'a creation command id cannot be reused by a state change');
    RESET ROLE;
    -- The historical creation timezone remains mandatory, valid provenance.
    SELECT payload INTO v_jsonb FROM public.quest_events WHERE id = r.recurrence_changed_event_id;
    UPDATE public.quest_events SET payload = jsonb_set(payload, '{after,rule,source_timezone}', 'null'::jsonb)
        WHERE id = r.recurrence_changed_event_id;
    SET LOCAL ROLE authenticated;
    PERFORM recurring_test.reject(format('SELECT public.create_recurring_quest(%L::uuid, %L::jsonb, %L)',
        tamper_cmd::text,
        '{"title":"Tamper me","recurrence_mode":"daily","start_date":"' || (today - 3)::text || '"}',
        'web_ui'), ARRAY['23505'], 'missing historical creation timezone rejects replay');
    RESET ROLE;
    UPDATE public.quest_events SET payload = v_jsonb WHERE id = r.recurrence_changed_event_id;
    -- Rewriting a recorded pause payload invalidates its replay.
    UPDATE public.quest_events
        SET payload = jsonb_set(payload, '{after,rule,injected}', 'true'::jsonb)
        WHERE id = paused.state_event_id;
    SET LOCAL ROLE authenticated;
    PERFORM recurring_test.reject(format('SELECT public.set_quest_recurrence_pause(%L::uuid, %L::uuid, %L, %L)',
        pause_cmd::text, daily_quest::text, 'true', 'web_ui'),
        ARRAY['23505'], 'a rewritten pause payload invalidates its replay');
    RESET ROLE;

    -- 13) RR-03 and AC-39: a missing Profile timezone is rejected, never guessed. The
    --     Profile row trigger already refuses an unstoreable zone, so the routines'
    --     second pg_timezone_names guard is defence in depth and is not fixture'd here.
    UPDATE public.profiles SET timezone = NULL WHERE user_id = a;
    SET LOCAL ROLE authenticated;
    PERFORM recurring_test.reject(format('SELECT public.create_recurring_quest(%L::uuid, %L::jsonb, %L)',
        gen_random_uuid()::text,
        '{"title":"TZ","recurrence_mode":"daily","start_date":"' || today || '"}', 'web_ui'),
        ARRAY['PZ001'], 'recurrence creation requires a Profile timezone');
    PERFORM recurring_test.reject(format('SELECT public.materialize_quest_day(%L::date)', today::text),
        ARRAY['PZ001'], 'slot generation requires a Profile timezone');
    PERFORM recurring_test.reject(format('SELECT count(*) FROM public.list_day_quest_occurrences(%L::date)',
        today::text), ARRAY['PZ001'], 'the frozen day read requires a Profile timezone');
    RESET ROLE;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id = a;
    SET LOCAL ROLE authenticated;
    PERFORM public.materialize_quest_day(today + 4);
    PERFORM recurring_test.assert_true(recurring_test.slots(daily_quest, today + 4) = 1,
        'generation resumes once the Profile timezone is set again');
    RESET ROLE;
    PERFORM recurring_test.assert_true((SELECT count(*) FROM public.quest_events
        WHERE user_id = a AND event_type IN ('created', 'recurrence_changed', 'recurrence_stopped'))
        = 12,
        'the whole suite wrote only the expected definition history');
    RAISE NOTICE 'Recurring Quest behavior tests passed';
END;
$behavior$;

REVOKE quest_command_owner FROM CURRENT_USER;
ROLLBACK;
