\set ON_ERROR_STOP on
-- Transactional behavior/security suite for the Calendar / Schedule slice
-- (20260929120000_create_schedule_events.sql).
-- Authority: docs/01-requirements/calendar-schedule.md CS-01..CS-12 and
-- CS-AC-01..CS-AC-07, docs/02-architecture/decisions.md ADR-019.
-- Run only against a disposable local database; this file never commits.
BEGIN;
GRANT schedule_command_owner, quest_command_owner TO CURRENT_USER;
CREATE SCHEMA calendar_test;
CREATE FUNCTION calendar_test.assert_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END;
$fn$;
CREATE FUNCTION calendar_test.reject(statement text, states text[], label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN IF SQLSTATE = ANY(states) THEN RETURN; END IF;
        RAISE EXCEPTION 'Unexpected %: % %', label, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected rejection: %', label;
END;
$fn$;
-- Counters are read both as the migration executor and under a switched client role, so
-- they live in the shared test schema rather than inside a single definer body.
CREATE FUNCTION calendar_test.occurrence_count() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
    SELECT count(*)::int FROM public.quest_occurrences;
$fn$;
CREATE FUNCTION calendar_test.event_count() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
    SELECT count(*)::int FROM public.quest_events;
$fn$;
CREATE FUNCTION calendar_test.ledger_count() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
    SELECT count(*)::int FROM public.exp_ledger;
$fn$;
GRANT USAGE ON SCHEMA calendar_test TO authenticated, anon, schedule_command_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA calendar_test
    TO authenticated, anon, schedule_command_owner;

DO $behavior$
DECLARE
    a uuid := '00000000-0000-0000-0000-00000000e001';
    b uuid := '00000000-0000-0000-0000-00000000e002';
    day_1 date := date '2031-03-05';
    day_2 date := date '2031-03-06';
    first_id uuid := '10000000-0000-4000-8000-00000000e001';
    span_id uuid := '10000000-0000-4000-8000-00000000e002';
    all_day_id uuid := '10000000-0000-4000-8000-00000000e003';
    shift_id uuid := '10000000-0000-4000-8000-00000000e004';
    other_id uuid := '10000000-0000-4000-8000-00000000e005';
    dst_id uuid := '10000000-0000-4000-8000-00000000e006';
    rec_command uuid := '20000000-0000-4000-8000-00000000e001';
    quest_mine uuid;
    quest_deadline uuid;
    quest_theirs uuid;
    occurrence_mine uuid;
    occurrence_deadline uuid;
    occurrence_theirs uuid;
    r public.schedule_event_receipt;
    r2 public.schedule_event_receipt;
    first_entry public.calendar_entry;
    second_entry public.calendar_entry;
    today date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
    v_occurrences integer;
    v_events integer;
    v_ledger integer;
    v_rows integer;
BEGIN
    INSERT INTO auth.users (id) VALUES (a), (b) ON CONFLICT (id) DO NOTHING;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id IN (a, b);
    -- ADR-015: every Calendar routine carries system_private.require_owner() in its own
    -- body, so the singleton must exist for this rolled-back transaction. No production
    -- grant, policy or configuration is touched by this suite.
    INSERT INTO system_private.owner_configuration (singleton, user_id) VALUES (true, a);

    -- Occurrence fixtures: one timed occurrence, one deadline-only occurrence and one
    -- foreign owned occurrence, all on the two days under test. These are read-side
    -- fixtures only; the Quest write path is unchanged and unexercised here.
    INSERT INTO public.quests (user_id, title, recurrence_mode)
        VALUES (a, 'Calendar fixture Quest', 'one_off') RETURNING id INTO quest_mine;
    INSERT INTO public.quests (user_id, title, recurrence_mode)
        VALUES (a, 'Calendar deadline Quest', 'one_off') RETURNING id INTO quest_deadline;
    INSERT INTO public.quests (user_id, title, recurrence_mode)
        VALUES (b, 'Foreign fixture Quest', 'one_off') RETURNING id INTO quest_theirs;
    INSERT INTO public.quest_occurrences (quest_id, user_id, status, scheduled_at)
        VALUES (quest_mine, a, 'scheduled', '2031-03-05T09:00:00Z') RETURNING id INTO occurrence_mine;
    INSERT INTO public.quest_occurrences (quest_id, user_id, status, deadline_at)
        VALUES (quest_deadline, a, 'scheduled', '2031-03-06T18:00:00Z') RETURNING id INTO occurrence_deadline;
    INSERT INTO public.quest_occurrences (quest_id, user_id, status, scheduled_at)
        VALUES (quest_theirs, b, 'scheduled', '2031-03-05T09:30:00Z') RETURNING id INTO occurrence_theirs;

    -- 1) CS-01, CS-08 and CS-AC-03: one create command submitted three times with one
    --    identity stores exactly one row and answers identically every time.
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    r := public.create_schedule_event(first_id, 'Morning class',
        '2031-03-05T07:30:00Z', '2031-03-05T08:30:00Z', false, 'class', 'Note');
    PERFORM calendar_test.assert_true(r.replay = false AND r.event_id = first_id AND r.user_id = a
        AND r.title = 'Morning class' AND r.category = 'class' AND r.notes = 'Note'
        AND r.all_day = false AND r.created_at = r.updated_at,
        'first create receipt');
    r2 := public.create_schedule_event(first_id, 'Morning class',
        '2031-03-05T07:30:00Z', '2031-03-05T08:30:00Z', false, 'class', 'Note');
    PERFORM calendar_test.assert_true(r2.replay = true
        AND ROW (r2.event_id, r2.user_id, r2.title, r2.start_at, r2.end_at, r2.all_day,
                 r2.category, r2.notes, r2.created_at, r2.updated_at)
        IS NOT DISTINCT FROM ROW (r.event_id, r.user_id, r.title, r.start_at, r.end_at, r.all_day,
               r.category, r.notes, r.created_at, r.updated_at),
        'second identical create replays the identical receipt');
    r2 := public.create_schedule_event(first_id, 'Morning class',
        '2031-03-05T07:30:00Z', '2031-03-05T08:30:00Z', false, 'class', 'Note');
    PERFORM calendar_test.assert_true(r2.replay = true, 'third identical create still replays');
    RESET ROLE;
    SELECT count(*) INTO v_rows FROM public.schedule_events WHERE removed_at IS NULL;
    PERFORM calendar_test.assert_true(v_rows = 1, 'CS-AC-03: three submissions stored one row');
    SET LOCAL ROLE authenticated;

    -- 2) CS-04, CS-05 and CS-AC-01: one day mixing both sources returns exactly the two
    --    entries in real instant order, and the read itself stores nothing new.
    v_occurrences := calendar_test.occurrence_count();
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_1, day_1) AS e;
    SELECT e.* INTO first_entry FROM public.get_calendar_events(day_1, day_1) AS e LIMIT 1;
    SELECT e.* INTO second_entry
        FROM public.get_calendar_events(day_1, day_1) AS e OFFSET 1 LIMIT 1;
    PERFORM calendar_test.assert_true(v_rows = 2
        AND first_entry.source = 'schedule_event' AND first_entry.entry_id = first_id
        AND first_entry.start_at = '2031-03-05T07:30:00Z'
        AND first_entry.end_at = '2031-03-05T08:30:00Z'
        AND first_entry.status IS NULL AND first_entry.quest_id IS NULL
        AND first_entry.reward_exp_snapshot IS NULL
        AND second_entry.source = 'quest_occurrence'
        AND second_entry.entry_id = occurrence_mine
        AND second_entry.quest_id = quest_mine AND second_entry.title = 'Calendar fixture Quest'
        AND second_entry.status = 'scheduled' AND second_entry.all_day = false
        AND second_entry.category IS NULL AND second_entry.notes IS NULL,
        'CS-AC-01: exactly two ordered entries, one per source, with no invented columns');
    PERFORM calendar_test.assert_true(calendar_test.occurrence_count() = v_occurrences,
        'CS-07: the Calendar read changed no occurrence');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_1, day_1) AS e
        WHERE e.entry_id = occurrence_theirs;
    PERFORM calendar_test.assert_true(v_rows = 0, 'CS-03: a foreign occurrence never appears');

    -- 3) CS-06: a deadline-only occurrence with a null scheduled_at is not invented into
    --    the grid on the day its deadline falls.
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_2, day_2) AS e
        WHERE e.entry_id = occurrence_deadline;
    PERFORM calendar_test.assert_true(v_rows = 0, 'CS-06: null-scheduled occurrence stayed out of the range');

    -- 4) CS-09 and CS-AC-05: one event across midnight shows on both days it touches.
    r := public.create_schedule_event(span_id, 'Late shift',
        '2031-03-05T23:30:00Z', '2031-03-06T00:30:00Z', false, NULL, NULL);
    PERFORM calendar_test.assert_true(r.replay = false AND r.category IS NULL, 'late shift created');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_1, day_1) AS e
        WHERE e.entry_id = span_id;
    PERFORM calendar_test.assert_true(v_rows = 1, 'midnight-spanning event shows on its start day');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_2, day_2) AS e
        WHERE e.entry_id = span_id;
    PERFORM calendar_test.assert_true(v_rows = 1, 'midnight-spanning event shows on the following day');

    -- 5) BR-03 and OQ-1: an all-day block is normalized to Profile-local whole days with
    --    an exclusive end, so it never bleeds into the next day.
    r := public.create_schedule_event(all_day_id, 'Public holiday',
        '2031-03-05T10:00:00Z', '2031-03-05T14:00:00Z', true, NULL, NULL);
    PERFORM calendar_test.assert_true(r.all_day = true
        AND r.start_at = '2031-03-05T00:00:00Z' AND r.end_at = '2031-03-06T00:00:00Z',
        'BR-03: all-day block snapped to Profile-local midnight boundaries');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_1, day_1) AS e
        WHERE e.entry_id = all_day_id AND e.all_day;
    PERFORM calendar_test.assert_true(v_rows = 1, 'all-day block shows on its own day');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_2, day_2) AS e
        WHERE e.entry_id = all_day_id;
    PERFORM calendar_test.assert_true(v_rows = 0,
        'exclusive all-day end does not leak into the next day');

    -- 6) CS-02 and CS-AC-04: edit and remove touch nothing outside schedule_events.
    v_occurrences := calendar_test.occurrence_count();
    v_events := calendar_test.event_count();
    v_ledger := calendar_test.ledger_count();
    r2 := public.update_schedule_event(first_id, 'Morning class (moved)',
        '2031-03-05T08:00:00Z', NULL, false, NULL, 'Cleared');
    PERFORM calendar_test.assert_true(r2.replay = false AND r2.title = 'Morning class (moved)'
        AND r2.end_at IS NULL AND r2.category IS NULL AND r2.notes = 'Cleared'
        AND r2.created_at = r.created_at,
        'CS-08: a real edit replaces state and clears omitted fields');
    r := public.update_schedule_event(first_id, 'Morning class (moved)',
        '2031-03-05T08:00:00Z', NULL, false, NULL, 'Cleared');
    PERFORM calendar_test.assert_true(r.replay = true
        AND ROW (r.event_id, r.title, r.start_at, r.end_at, r.all_day, r.category,
                 r.notes, r.created_at, r.updated_at)
        IS NOT DISTINCT FROM ROW (r2.event_id, r2.title, r2.start_at, r2.end_at, r2.all_day, r2.category,
               r2.notes, r2.created_at, r2.updated_at),
        'CS-08: identical state writes nothing and answers identically');
    PERFORM calendar_test.assert_true(NOT EXISTS (
        SELECT 1 FROM public.get_calendar_events(day_2, day_2) WHERE entry_id = first_id),
        'an event without an end belongs only to its start day');
    PERFORM calendar_test.assert_true(calendar_test.occurrence_count() = v_occurrences
        AND calendar_test.event_count() = v_events
        AND calendar_test.ledger_count() = v_ledger,
        'CS-AC-04: occurrences, Quest events and the EXP ledger are untouched');
    PERFORM calendar_test.reject(
        'SELECT public.update_schedule_event(''' || other_id || ''', ''Ghost'', '
            || '''2031-03-05T08:00:00Z''::timestamptz, NULL, false, NULL, NULL)',
        ARRAY['PZ002'], 'edit of an unknown Schedule Event');
    PERFORM calendar_test.reject(
        'SELECT public.create_schedule_event(gen_random_uuid(), ''   '', '
            || '''2031-03-05T08:00:00Z''::timestamptz, NULL, false, NULL, NULL)',
        ARRAY['22023'], 'blank title');
    PERFORM calendar_test.reject(
        'SELECT public.create_schedule_event(gen_random_uuid(), ''Backwards'', '
            || '''2031-03-05T09:00:00Z''::timestamptz, ''2031-03-05T08:00:00Z''::timestamptz, '
            || 'false, NULL, NULL)',
        ARRAY['22023'], 'BR-03 end before start');
    PERFORM calendar_test.reject(
        'SELECT public.create_schedule_event(gen_random_uuid(), ''Bad category'', '
            || '''2031-03-05T09:00:00Z''::timestamptz, NULL, false, ''  '', NULL)',
        ARRAY['22023'], 'BR-05 blank category');
    PERFORM calendar_test.reject(format(
        'SELECT public.get_calendar_events(%L::date, %L::date)', day_2, day_1),
        ARRAY['22023'], 'reversed range');
    PERFORM calendar_test.reject(format(
        'SELECT public.get_calendar_events(%L::date, %L::date)', day_1, day_1 + 100),
        ARRAY['22023'], 'range beyond 92 days');
    PERFORM calendar_test.reject('SELECT public.get_calendar_events(NULL, NULL)',
        ARRAY['22023'], 'missing range');


    -- 7) CS-03 and CS-AC-02: another valid owner token and an anonymous request reach
    --    nothing, and a direct table read stays empty under RLS.
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_rows FROM public.schedule_events WHERE removed_at IS NULL;
    PERFORM calendar_test.assert_true(v_rows = 0, 'CS-03: a non-owner sees no Schedule Event rows');
    PERFORM calendar_test.reject(format(
        'SELECT public.get_calendar_events(%L::date, %L::date)', day_1, day_1),
        ARRAY['42501'], 'CS-AC-02: non-owner Calendar read');
    PERFORM calendar_test.reject(
        'SELECT public.create_schedule_event(''' || other_id || ''', ''Intrusion'', '
            || '''2031-03-05T10:00:00Z''::timestamptz, NULL, false, NULL, NULL)',
        ARRAY['42501'], 'CS-AC-02: non-owner create');
    PERFORM calendar_test.reject(
        'SELECT public.update_schedule_event(''' || first_id || ''', ''Intrusion'', '
            || '''2031-03-05T10:00:00Z''::timestamptz, NULL, false, NULL, NULL)',
        ARRAY['42501'], 'CS-AC-02: non-owner edit');
    PERFORM calendar_test.reject(
        'SELECT public.delete_schedule_event(''' || first_id || ''')',
        ARRAY['42501'], 'CS-AC-02: non-owner remove');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL ROLE anon;
    PERFORM calendar_test.reject('SELECT count(*) FROM public.schedule_events',
        ARRAY['42501'], 'anonymous direct table read');
    PERFORM calendar_test.reject(format(
        'SELECT public.get_calendar_events(%L::date, %L::date)', day_1, day_1),
        ARRAY['42501'], 'CS-AC-02: anonymous Calendar read');
    PERFORM calendar_test.reject(
        'SELECT public.create_schedule_event(gen_random_uuid(), ''Anonymous'', '
            || '''2031-03-05T10:00:00Z''::timestamptz, NULL, false, NULL, NULL)',
        ARRAY['42501'], 'CS-AC-02: anonymous create');
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_rows FROM public.schedule_events WHERE removed_at IS NULL;
    PERFORM calendar_test.assert_true(v_rows = 3,
        'CS-AC-02: every rejected attempt left the owner state exactly as it was');

    -- 8) CS-10: removing an Event is idempotent and reports whether a row went away.
    PERFORM calendar_test.assert_true(NOT public.delete_schedule_event(other_id), 'unknown removal');
    PERFORM calendar_test.assert_true(public.delete_schedule_event(span_id), 'first removal');
    PERFORM calendar_test.assert_true(NOT public.delete_schedule_event(span_id), 'repeated removal');
    PERFORM calendar_test.reject(
        'SELECT public.create_schedule_event(''' || span_id || ''', ''Late retry'', '
            || '''2031-03-05T10:00:00Z''::timestamptz, NULL, false, NULL, NULL)',
        ARRAY['23505'], 'a late create retry cannot resurrect a removed identity');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_1, day_2) AS e
        WHERE e.entry_id = span_id;
    PERFORM calendar_test.assert_true(v_rows = 0, 'a removed Event leaves the Calendar read');
    PERFORM calendar_test.assert_true(calendar_test.occurrence_count() = v_occurrences
        AND calendar_test.event_count() = v_events
        AND calendar_test.ledger_count() = v_ledger,
        'CS-AC-04: removal touched no occurrence, Quest event or ledger row');

    -- 9) CS-AC-06 and BR-04: changing the Profile timezone re-anchors day grouping only.
    r := public.create_schedule_event(shift_id, 'Evening call',
        '2031-03-05T20:00:00Z', '2031-03-05T21:00:00Z', false, NULL, NULL);
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_1, day_1) AS e
        WHERE e.entry_id = shift_id;
    PERFORM calendar_test.assert_true(v_rows = 1, 'UTC: the call belongs to its own day');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_2, day_2) AS e
        WHERE e.entry_id = shift_id;
    PERFORM calendar_test.assert_true(v_rows = 0, 'UTC: the call is not on the following day');
    RESET ROLE;
    UPDATE public.profiles SET timezone = 'Asia/Tokyo' WHERE user_id = a;
    SET LOCAL ROLE authenticated;
    SELECT e.* INTO first_entry FROM public.get_calendar_events(day_1, day_1) AS e
        WHERE e.entry_id = all_day_id;
    PERFORM calendar_test.assert_true(first_entry.start_date = day_1
        AND first_entry.end_date = day_2 AND first_entry.start_at IS NULL AND first_entry.end_at IS NULL,
        'all-day dates survive timezone changes without acquiring times');
    PERFORM calendar_test.assert_true(NOT EXISTS (
        SELECT 1 FROM public.get_calendar_events(day_2, day_2) WHERE entry_id = all_day_id),
        'all-day dates do not bleed into another day after a timezone edit');
    SELECT count(*) INTO v_rows FROM public.get_calendar_events(day_1, day_1) AS e
        WHERE e.entry_id = shift_id;
    PERFORM calendar_test.assert_true(v_rows = 0, 'BR-04: the same instant left the earlier day');
    SELECT e.* INTO first_entry FROM public.get_calendar_events(day_2, day_2) AS e
        WHERE e.entry_id = shift_id;
    PERFORM calendar_test.assert_true(first_entry.entry_id = shift_id
        AND first_entry.start_at = '2031-03-05T20:00:00Z'
        AND first_entry.end_at = '2031-03-05T21:00:00Z',
        'CS-AC-06: stored instants are untouched, only the day grouping moved');
    RESET ROLE;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id = a;
    SET LOCAL ROLE authenticated;

    -- A single all-day date without an end is bounded, including a 23-hour DST day.
    RESET ROLE;
    UPDATE public.profiles SET timezone = 'America/New_York' WHERE user_id = a;
    SET LOCAL ROLE authenticated;
    r := public.create_schedule_event(dst_id, 'DST day',
        '2026-03-08T16:00:00Z', NULL, true, NULL, NULL);
    PERFORM calendar_test.assert_true(r.start_date = '2026-03-08' AND r.end_date = '2026-03-09'
        AND r.end_at - r.start_at = interval '23 hours', 'date-only DST day uses two local midnights');
    PERFORM calendar_test.assert_true(NOT EXISTS (
        SELECT 1 FROM public.get_calendar_events('2026-03-09', '2026-03-09') WHERE entry_id = dst_id),
        'missing all-day end does not make an unbounded event');
    PERFORM public.delete_schedule_event(dst_id);
    RESET ROLE;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id = a;
    SET LOCAL ROLE authenticated;

    -- 10) CS-07 and CS-AC-07: a Calendar read over a window that contains a recurring
    --     anchor generates nothing. Slot generation stays with materialize_quest_day.
    PERFORM public.create_recurring_quest(rec_command,
        jsonb_build_object('title', 'Calendar window Quest', 'recurrence_mode', 'daily',
            'start_date', (today + 1)::text, 'default_reward_exp', 20), 'web_ui');
    v_occurrences := calendar_test.occurrence_count();
    PERFORM public.get_calendar_events(today, today + 7);
    PERFORM calendar_test.assert_true(calendar_test.occurrence_count() = v_occurrences,
        'CS-AC-07: reading a Calendar window materialized no occurrence');
    PERFORM calendar_test.assert_true(NOT EXISTS (
        SELECT 1 FROM public.quest_occurrences AS o
        JOIN public.quests AS q ON q.id = o.quest_id AND q.user_id = a
        WHERE q.title = 'Calendar window Quest'),
        'CS-07: no occurrence row was generated for the recurring Quest');
    -- Only the existing Quest engine may generate this fixture. Calendar then projects
    -- its identity and slot without inventing a scheduled instant or another lifecycle.
    PERFORM public.materialize_quest_day(today + 1);
    v_occurrences := calendar_test.occurrence_count();
    SELECT e.* INTO first_entry FROM public.get_calendar_events(today + 1, today + 1) AS e
        WHERE e.title = 'Calendar window Quest';
    PERFORM calendar_test.assert_true(first_entry.source = 'quest_occurrence'
        AND first_entry.source_slot_date = today + 1 AND first_entry.start_at IS NULL,
        'existing untimed recurring occurrence appears under its own slot date');
    PERFORM calendar_test.assert_true(calendar_test.occurrence_count() = v_occurrences,
        'projecting recurring work is still read-only');

    -- 11) BR-04 and CS-12: a Profile without a timezone is refused, never guessed. A
    --     timed write needs no timezone and therefore still succeeds.
    RESET ROLE;
    UPDATE public.profiles SET timezone = NULL WHERE user_id = a;
    SET LOCAL ROLE authenticated;
    PERFORM calendar_test.reject(format(
        'SELECT public.get_calendar_events(%L::date, %L::date)', day_1, day_1),
        ARRAY['PZ001'], 'Calendar read without a Profile timezone');
    PERFORM calendar_test.reject(
        'SELECT public.create_schedule_event(gen_random_uuid(), ''All day'', '
            || '''2031-03-05T10:00:00Z''::timestamptz, ''2031-03-05T14:00:00Z''::timestamptz, '
            || 'true, NULL, NULL)',
        ARRAY['PZ001'], 'all-day write without a Profile timezone');
    r := public.create_schedule_event(gen_random_uuid(), 'Timed write',
        '2031-03-05T10:00:00Z', NULL, false, NULL, NULL);
    PERFORM calendar_test.assert_true(r.replay = false AND r.all_day = false,
        'a timed write needs no timezone and still succeeds');
    RESET ROLE;
    SELECT count(*) INTO v_rows FROM public.schedule_events WHERE removed_at IS NULL;
    PERFORM calendar_test.assert_true(v_rows = 4,
        'the whole suite left exactly the four accepted writes stored');
    RAISE NOTICE 'Calendar and Schedule behavior tests passed';
END;
$behavior$;

REVOKE schedule_command_owner, quest_command_owner FROM CURRENT_USER;
ROLLBACK;
