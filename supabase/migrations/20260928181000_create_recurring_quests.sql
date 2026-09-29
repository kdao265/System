-- SYSTEM V1 recurring Quest definitions: Daily, Weekly (selected weekdays) and Monthly.
-- Authority: docs/02-architecture/decisions.md ADR-018,
-- docs/01-requirements/quest-engine.md section 11 RR-01..RR-07 plus AC-32/AC-33/AC-39,
-- and docs/02-architecture/quest-database-schema.md sections 6, 12 and 18.
--
-- Additive only. Two composite receipt types and four routines are created. No table,
-- column, constraint, index, policy, role or grant on a pre-existing object is created
-- or altered, and no previously applied migration is modified. The recurrence storage
-- contract already exists in migration one (quest_recurrence_rules, quests.recurrence_mode,
-- quests.materialized_occurrence_count, the occurrence origin columns and the partial
-- unique index uq_recurring_slot), so a recurring definition feeds the SAME occurrence,
-- completion and EXP pipeline as a one-off Quest instead of a second engine.
--
-- public.list_day_quest_occurrences(date) is deliberately left byte-identical: the
-- promoted ADR-015 activation migration pins its exact source hash, and the historical
-- day-quest-reads checkpoint suites assert its SECURITY INVOKER / STABLE catalog shape.
-- Recurrence therefore enters the read path through the new sibling
-- public.materialize_quest_day(date), which the day-listing feature boundary calls first.
--
-- Every routine below is ADR-015 fail-closed: system_private.require_owner() runs before
-- any other work and identity comes only from system_internal.request_user_id(). No
-- routine accepts a caller-supplied owner. No background job, scheduler, cron, worker,
-- queue or precreation horizon exists here: RR-03 and section 18 do not mandate one and
-- requirement AC-33 forbids a manufactured catch-up backlog. materialize_quest_day enforces
-- that directly: only the profile-local today or a later requested day may generate, and a
-- past day that was never materialized is skipped rather than backfilled (section 18.2).
--
-- Deliberate deviation recorded for review: materializing one slot writes no Quest Event.
-- The frozen ck_event_type vocabulary has no slot-generation kind, so inventing a synthetic
-- command_id/audit row would widen the accepted domain-event contract. Provenance lives in
-- the occurrence origin columns (recurrence_rule_id, recurrence_revision, source_slot_date,
-- source_timezone), the cumulative quests.materialized_occurrence_count and
-- quest_occurrences.created_at. Definition changes DO write events: 'created' plus
-- 'recurrence_changed' on creation and 'recurrence_changed' on pause/resume, matching
-- RR-06's old/new configuration and effective-boundary rule.

BEGIN;

CREATE TYPE public.quest_recurring_receipt AS (
    command_id uuid,
    quest_id uuid,
    recurrence_rule_id uuid,
    definition_created_event_id uuid,
    recurrence_changed_event_id uuid,
    recurrence_mode text,
    recurrence_type text,
    anchor_date date,
    end_date date,
    weekdays smallint[],
    month_day smallint,
    occurrence_limit integer,
    default_reward_exp integer,
    replay boolean
);

CREATE TYPE public.quest_recurrence_state_receipt AS (
    command_id uuid,
    quest_id uuid,
    recurrence_rule_id uuid,
    recurrence_mode text,
    paused boolean,
    stopped_at timestamptz,
    state_event_id uuid,
    replay boolean
);

-- Creates one recurring Quest definition and its single current recurrence rule.
-- It never materializes an occurrence: slot generation belongs to
-- public.materialize_quest_day(date), so reading a day is the only trigger.
CREATE FUNCTION public.create_recurring_quest(
    command_id uuid,
    request jsonb,
    origin text
) RETURNS public.quest_recurring_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    profile_timezone text;
    definition jsonb;
    rule jsonb;
    prior_created public.quest_events;
    prior_changed public.quest_events;
    prior_rule public.quest_recurrence_rules;
    event_count integer;
    quest_id uuid;
    rule_id uuid;
    created_event_id uuid;
    changed_event_id uuid;
    v_now timestamptz;
    v_title text;
    v_description text;
    v_importance text := 'side';
    v_priority text;
    v_difficulty smallint;
    v_duration integer;
    v_energy smallint;
    v_focus smallint;
    v_reward integer;
    v_tags text[] := ARRAY[]::text[];
    v_notes text;
    v_mode text;
    v_type text;
    v_anchor date;
    v_end_date date;
    v_weekdays smallint[];
    v_month_day smallint;
    v_limit integer;
    key_name text;
    number_value numeric;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL OR request IS NULL
        OR jsonb_typeof(request) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Authentication and required creation inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);

    -- The request surface is deliberately closed. In particular Goal, Project, Penalty,
    -- absolute one-off instants and unknown inputs fail loudly instead of disappearing.
    IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(request) AS supplied(key)
        WHERE supplied.key NOT IN ('title', 'description', 'importance',
            'priority', 'default_difficulty', 'default_estimated_duration_minutes',
            'default_energy_cost', 'default_focus_demand', 'default_reward_exp',
            'tags', 'notes', 'recurrence_mode', 'start_date', 'end_date',
            'weekdays', 'month_day', 'occurrence_limit')
    ) THEN
        RAISE EXCEPTION 'Unsupported recurring Quest input (Goal, Project, Penalty, one-off instants and unknown inputs are unavailable)'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(request -> 'recurrence_mode') IS DISTINCT FROM 'string'
        OR (request ->> 'recurrence_mode') NOT IN ('daily', 'weekly', 'monthly') THEN
        RAISE EXCEPTION 'recurrence_mode must be daily, weekly or monthly' USING ERRCODE = '22023';
    END IF;
    v_mode := request ->> 'recurrence_mode';
    -- The Quest-level cadence and the rule-level discriminator are separate stored
    -- dimensions: weekly cadence is the already-constrained 'selected_weekdays' rule.
    v_type := CASE v_mode WHEN 'daily' THEN 'daily'
        WHEN 'weekly' THEN 'selected_weekdays' ELSE 'monthly' END;

    IF jsonb_typeof(request -> 'title') IS DISTINCT FROM 'string'
        OR btrim(request ->> 'title') = '' THEN
        RAISE EXCEPTION 'title is required and must be nonblank' USING ERRCODE = '22023';
    END IF;
    v_title := request ->> 'title';
    IF char_length(v_title) > 120 THEN
        RAISE EXCEPTION 'title is too long' USING ERRCODE = '22023';
    END IF;

    IF request ? 'description' AND jsonb_typeof(request -> 'description') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'description must be text or null' USING ERRCODE = '22023';
    END IF;
    v_description := request ->> 'description';
    IF char_length(v_description) > 4000 THEN
        RAISE EXCEPTION 'description is too long' USING ERRCODE = '22023';
    END IF;

    FOREACH key_name IN ARRAY ARRAY['importance', 'priority'] LOOP
        IF request ? key_name AND jsonb_typeof(request -> key_name) NOT IN ('string', 'null') THEN
            RAISE EXCEPTION '% must be text or null', key_name USING ERRCODE = '22023';
        END IF;
    END LOOP;
    IF request ? 'importance' AND request ->> 'importance' IS NOT NULL THEN
        v_importance := request ->> 'importance';
    END IF;
    v_priority := request ->> 'priority';
    IF v_importance NOT IN ('main', 'side')
        OR (v_priority IS NOT NULL AND v_priority NOT IN ('low', 'medium', 'high', 'critical')) THEN
        RAISE EXCEPTION 'Invalid importance or priority' USING ERRCODE = '22023';
    END IF;

    FOREACH key_name IN ARRAY ARRAY['default_difficulty', 'default_estimated_duration_minutes',
        'default_energy_cost', 'default_focus_demand', 'default_reward_exp'] LOOP
        IF request ? key_name AND jsonb_typeof(request -> key_name) NOT IN ('number', 'null') THEN
            RAISE EXCEPTION '% must be an integer or null', key_name USING ERRCODE = '22023';
        END IF;
        IF request ? key_name AND jsonb_typeof(request -> key_name) = 'number' THEN
            number_value := (request ->> key_name)::numeric;
            IF number_value <> trunc(number_value) THEN
                RAISE EXCEPTION '% must be an integer', key_name USING ERRCODE = '22023';
            END IF;
            IF (key_name IN ('default_difficulty', 'default_energy_cost', 'default_focus_demand')
                    AND number_value NOT BETWEEN -32768 AND 32767)
                OR (key_name IN ('default_estimated_duration_minutes', 'default_reward_exp')
                    AND number_value NOT BETWEEN -2147483648 AND 2147483647) THEN
                RAISE EXCEPTION '% is outside its PostgreSQL integer range', key_name
                    USING ERRCODE = '22003';
            END IF;
        END IF;
    END LOOP;
    v_difficulty := (request ->> 'default_difficulty')::smallint;
    v_duration := (request ->> 'default_estimated_duration_minutes')::integer;
    v_energy := (request ->> 'default_energy_cost')::smallint;
    v_focus := (request ->> 'default_focus_demand')::smallint;
    v_reward := COALESCE((request ->> 'default_reward_exp')::integer, 0);
    IF v_difficulty IS NOT NULL AND v_difficulty NOT BETWEEN 1 AND 5
        OR v_duration IS NOT NULL AND v_duration <= 0
        OR v_energy IS NOT NULL AND v_energy NOT BETWEEN 1 AND 5
        OR v_focus IS NOT NULL AND v_focus NOT BETWEEN 1 AND 5
        OR v_reward < 0 THEN
        RAISE EXCEPTION 'Invalid Quest numeric value' USING ERRCODE = '22023';
    END IF;

    IF request ? 'tags' AND jsonb_typeof(request -> 'tags') NOT IN ('array', 'null') THEN
        RAISE EXCEPTION 'tags must be an array or null' USING ERRCODE = '22023';
    END IF;
    IF request ? 'tags' AND jsonb_typeof(request -> 'tags') = 'array' THEN
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(request -> 'tags') AS item
            WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string') THEN
            RAISE EXCEPTION 'tags must contain only text values' USING ERRCODE = '22023';
        END IF;
        SELECT COALESCE(array_agg(item.value #>> '{}' ORDER BY item.ordinality), ARRAY[]::text[])
            INTO v_tags
            FROM jsonb_array_elements(request -> 'tags') WITH ORDINALITY AS item(value, ordinality);
    END IF;
    IF request ? 'notes' AND jsonb_typeof(request -> 'notes') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'notes must be text or null' USING ERRCODE = '22023';
    END IF;
    v_notes := request ->> 'notes';
    IF char_length(v_notes) > 4000 THEN
        RAISE EXCEPTION 'notes is too long' USING ERRCODE = '22023';
    END IF;

    -- RR-03/AC-39: the authoritative zone is the Profile-owned validated IANA value.
    -- Recurrence creation is rejected, never guessed. Identical resolution to
    -- public.list_day_quest_occurrences so both day routines fail the same way.
    SELECT p.timezone INTO profile_timezone
        FROM public.profiles AS p
        WHERE p.user_id = actor;
    IF profile_timezone IS NULL THEN
        RAISE EXCEPTION 'Profile timezone is not set; complete Profile timezone setup before creating a recurring Quest'
            USING ERRCODE = 'PZ001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
        WHERE zone.name = profile_timezone
            AND zone.name NOT LIKE 'posix/%'
            AND zone.name NOT LIKE 'right/%'
            AND zone.name <> 'localtime'
    ) THEN
        RAISE EXCEPTION 'Profile timezone is not a supported IANA zone; update Profile timezone settings'
            USING ERRCODE = 'PZ001';
    END IF;

    -- RR-02/RR-03: the schedule is profile-local calendar data, never an absolute
    -- instant. start_date is the inclusive anchor; end_date is inclusive when supplied.
    IF jsonb_typeof(request -> 'start_date') IS DISTINCT FROM 'string'
        OR (request ->> 'start_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'start_date is required and must be a YYYY-MM-DD calendar date' USING ERRCODE = '22023';
    END IF;
    BEGIN
        v_anchor := (request ->> 'start_date')::date;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'start_date is not a valid calendar date' USING ERRCODE = '22023';
    END;
    IF request ? 'end_date' AND jsonb_typeof(request -> 'end_date') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'end_date must be a YYYY-MM-DD calendar date or null' USING ERRCODE = '22023';
    END IF;
    IF request ? 'end_date' AND jsonb_typeof(request -> 'end_date') = 'string' THEN
        IF (request ->> 'end_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'end_date must be a YYYY-MM-DD calendar date or null' USING ERRCODE = '22023';
        END IF;
        BEGIN
            v_end_date := (request ->> 'end_date')::date;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'end_date is not a valid calendar date' USING ERRCODE = '22023';
        END;
        IF v_end_date < v_anchor THEN
            RAISE EXCEPTION 'end_date must not precede start_date' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Cadence parameters are strictly discriminator-bound, mirroring ck_rule_weekdays
    -- and ck_rule_month_day so a mismatched parameter can never be silently dropped.
    IF v_mode = 'weekly' THEN
        IF jsonb_typeof(request -> 'weekdays') IS DISTINCT FROM 'array'
            OR jsonb_array_length(request -> 'weekdays') NOT BETWEEN 1 AND 7 THEN
            RAISE EXCEPTION 'weekdays is required for a weekly Quest and must hold 1 to 7 ISO weekdays' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(request -> 'weekdays') AS item
            WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'number') THEN
            RAISE EXCEPTION 'weekdays must contain only whole numbers' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(request -> 'weekdays') AS item
            WHERE (item.value #>> '{}')::numeric <> trunc((item.value #>> '{}')::numeric)) THEN
            RAISE EXCEPTION 'weekdays must contain only whole numbers' USING ERRCODE = '22023';
        END IF;
        SELECT array_agg(DISTINCT (item.value #>> '{}')::smallint
                ORDER BY (item.value #>> '{}')::smallint)
            INTO v_weekdays
            FROM jsonb_array_elements(request -> 'weekdays') AS item(value);
        IF v_weekdays IS NULL OR NOT public.quest_valid_weekdays(v_weekdays) THEN
            RAISE EXCEPTION 'weekdays must be one to seven distinct ISO weekdays from 1 (Monday) to 7 (Sunday)'
                USING ERRCODE = '22023';
        END IF;
    ELSIF request ? 'weekdays' AND jsonb_typeof(request -> 'weekdays') IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'weekdays is only valid for a weekly Quest' USING ERRCODE = '22023';
    END IF;

    IF v_mode = 'monthly' THEN
        IF jsonb_typeof(request -> 'month_day') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'month_day is required for a monthly Quest' USING ERRCODE = '22023';
        END IF;
        number_value := (request ->> 'month_day')::numeric;
        IF number_value <> trunc(number_value) OR number_value NOT BETWEEN 1 AND 31 THEN
            RAISE EXCEPTION 'month_day must be a whole number from 1 to 31' USING ERRCODE = '22023';
        END IF;
        v_month_day := number_value::smallint;
    ELSIF request ? 'month_day' AND jsonb_typeof(request -> 'month_day') IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'month_day is only valid for a monthly Quest' USING ERRCODE = '22023';
    END IF;

    IF request ? 'occurrence_limit' THEN
        IF jsonb_typeof(request -> 'occurrence_limit') NOT IN ('number', 'null') THEN
            RAISE EXCEPTION 'occurrence_limit must be a positive integer or null' USING ERRCODE = '22023';
        END IF;
        IF jsonb_typeof(request -> 'occurrence_limit') = 'number' THEN
            number_value := (request ->> 'occurrence_limit')::numeric;
            IF number_value <> trunc(number_value)
                OR number_value < 1 OR number_value > 2147483647 THEN
                RAISE EXCEPTION 'occurrence_limit must be a positive integer' USING ERRCODE = '22023';
            END IF;
            v_limit := number_value::integer;
        END IF;
    END IF;

    definition := jsonb_build_object(
        'title', v_title, 'description', v_description, 'importance', v_importance,
        'priority', v_priority, 'default_difficulty', v_difficulty,
        'default_estimated_duration_minutes', v_duration, 'default_energy_cost', v_energy,
        'default_focus_demand', v_focus, 'default_reward_exp', v_reward,
        'direct_goal_id', NULL, 'project_id', NULL, 'recurrence_mode', v_mode,
        'default_penalty_snapshot', NULL, 'tags', to_jsonb(v_tags), 'notes', v_notes);
    rule := jsonb_build_object(
        'recurrence_type', v_type, 'interval_count', NULL,
        'weekdays', to_jsonb(v_weekdays), 'month_day', v_month_day,
        'anchor_date', v_anchor::text, 'local_start_time', NULL,
        'end_date', v_end_date::text, 'occurrence_limit', v_limit, 'revision', 1,
        'source_timezone', profile_timezone);

    -- Frozen lock order: owner-wide progression lock, then the event lookup. This is the
    -- same owner advisory lock the completion and reopen commands take, so a creation
    -- retry can never interleave with slot materialization or a completion.
    PERFORM progression_internal.lock_owner(actor);
    SELECT count(*) INTO event_count FROM public.quest_events e
        WHERE e.user_id = actor AND e.command_id = create_recurring_quest.command_id;
    IF event_count > 0 THEN
        SELECT * INTO prior_created FROM public.quest_events e
            WHERE e.user_id = actor AND e.command_id = create_recurring_quest.command_id
                AND e.event_type = 'created' AND e.occurrence_id IS NULL;
        SELECT * INTO prior_changed FROM public.quest_events e
            WHERE e.user_id = actor AND e.command_id = create_recurring_quest.command_id
                AND e.event_type = 'recurrence_changed' AND e.occurrence_id IS NULL;
        IF event_count <> 2 OR NOT FOUND
            OR prior_created.id IS NULL OR prior_changed.id IS NULL THEN
            RAISE EXCEPTION 'Conflicting or partial recurring Quest command reuse'
                USING ERRCODE = '23505';
        END IF;
        SELECT * INTO prior_rule FROM public.quest_recurrence_rules r
            WHERE r.quest_id = prior_changed.quest_id AND r.user_id = actor;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Conflicting or partial recurring Quest command reuse'
                USING ERRCODE = '23505';
        END IF;
        IF prior_created.user_id IS DISTINCT FROM actor
            OR prior_changed.user_id IS DISTINCT FROM actor
            OR prior_created.actor_kind IS DISTINCT FROM 'user'
            OR prior_changed.actor_kind IS DISTINCT FROM 'user'
            OR prior_created.actor_user_id IS DISTINCT FROM actor
            OR prior_changed.actor_user_id IS DISTINCT FROM actor
            OR prior_created.execution_cycle IS NOT NULL
            OR prior_changed.execution_cycle IS NOT NULL
            OR prior_created.quest_id IS DISTINCT FROM prior_changed.quest_id
            OR prior_rule.revision IS DISTINCT FROM 1
            OR prior_rule.recurrence_type IS DISTINCT FROM v_type
            OR prior_rule.anchor_date IS DISTINCT FROM v_anchor
            OR prior_rule.end_date IS DISTINCT FROM v_end_date
            OR prior_rule.weekdays IS DISTINCT FROM v_weekdays
            OR prior_rule.month_day IS DISTINCT FROM v_month_day
            OR prior_rule.occurrence_limit IS DISTINCT FROM v_limit
            OR prior_created.payload_version IS DISTINCT FROM 1
            OR prior_changed.payload_version IS DISTINCT FROM 1
            OR jsonb_typeof(prior_created.payload) IS DISTINCT FROM 'object'
            OR (prior_created.payload - 'origin' - 'after') <> '{}'::jsonb
            OR jsonb_typeof(prior_created.payload -> 'origin') IS DISTINCT FROM 'string'
            OR jsonb_typeof(prior_created.payload -> 'after') IS DISTINCT FROM 'object'
            OR ((prior_created.payload -> 'after') - 'definition') <> '{}'::jsonb
            OR jsonb_typeof(prior_created.payload -> 'after' -> 'definition') IS DISTINCT FROM 'object'
            OR jsonb_typeof(prior_changed.payload) IS DISTINCT FROM 'object'
            OR (prior_changed.payload - 'origin' - 'before' - 'after') <> '{}'::jsonb
            OR jsonb_typeof(prior_changed.payload -> 'origin') IS DISTINCT FROM 'string'
            OR prior_changed.payload -> 'before' IS DISTINCT FROM 'null'::jsonb
            OR jsonb_typeof(prior_changed.payload -> 'after') IS DISTINCT FROM 'object'
            OR ((prior_changed.payload -> 'after') - 'rule') <> '{}'::jsonb
            OR jsonb_typeof(prior_changed.payload -> 'after' -> 'rule') IS DISTINCT FROM 'object'
            OR prior_created.payload -> 'origin' IS DISTINCT FROM prior_changed.payload -> 'origin'
            OR prior_created.payload -> 'after' -> 'definition' IS DISTINCT FROM definition
            -- Pause state and the current Profile timezone may legitimately change
            -- after creation commits but before a lost response is recovered. Validate
            -- the recorded timezone as provenance, not as part of the caller's request.
            OR jsonb_typeof(prior_changed.payload #> '{after,rule,source_timezone}')
                IS DISTINCT FROM 'string'
            OR NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
                WHERE zone.name = prior_changed.payload #>> '{after,rule,source_timezone}'
                    AND zone.name NOT LIKE 'posix/%'
                    AND zone.name NOT LIKE 'right/%'
                    AND zone.name <> 'localtime')
            OR ((prior_changed.payload -> 'after' -> 'rule') - 'source_timezone')
                IS DISTINCT FROM (rule - 'source_timezone') THEN
            RAISE EXCEPTION 'Conflicting or partial recurring Quest command reuse'
                USING ERRCODE = '23505';
        END IF;
        PERFORM progression_internal.require_origin(prior_created.payload ->> 'origin');
        PERFORM progression_internal.require_origin(prior_changed.payload ->> 'origin');
        RETURN (create_recurring_quest.command_id, prior_changed.quest_id, prior_rule.id,
            prior_created.id, prior_changed.id, v_mode, v_type, v_anchor, v_end_date,
            v_weekdays, v_month_day, v_limit, v_reward, true);
    END IF;

    v_now := now();
    quest_id := gen_random_uuid();
    rule_id := gen_random_uuid();
    created_event_id := gen_random_uuid();
    changed_event_id := gen_random_uuid();
    INSERT INTO public.quests (id, user_id, title, description, importance, priority,
        default_difficulty, default_estimated_duration_minutes, default_energy_cost,
        default_focus_demand, default_reward_exp, direct_goal_id, project_id,
        recurrence_mode, default_penalty_snapshot, tags, notes, materialized_occurrence_count)
        VALUES (quest_id, actor, v_title, v_description, v_importance, v_priority,
            v_difficulty, v_duration, v_energy, v_focus, v_reward, NULL, NULL,
            v_mode, NULL, v_tags, v_notes, 0);
    INSERT INTO public.quest_recurrence_rules (id, quest_id, user_id, recurrence_type,
        interval_count, weekdays, month_day, anchor_date, local_start_time, end_date,
        occurrence_limit, revision, stopped_at)
        VALUES (rule_id, quest_id, actor, v_type, NULL, v_weekdays, v_month_day,
            v_anchor, NULL, v_end_date, v_limit, 1, NULL);
    INSERT INTO public.quest_events (id, quest_id, user_id, event_type, actor_kind,
        actor_user_id, occurred_at, command_id, payload_version, payload)
        VALUES (created_event_id, quest_id, actor, 'created', 'user', actor, v_now,
            create_recurring_quest.command_id, 1,
            jsonb_build_object('origin', origin,
                'after', jsonb_build_object('definition', definition)));
    INSERT INTO public.quest_events (id, quest_id, user_id, event_type, actor_kind,
        actor_user_id, occurred_at, command_id, payload_version, payload)
        VALUES (changed_event_id, quest_id, actor, 'recurrence_changed', 'user', actor, v_now,
            create_recurring_quest.command_id, 1,
            jsonb_build_object('origin', origin, 'before', NULL,
                'after', jsonb_build_object('rule', rule)));
    RETURN (create_recurring_quest.command_id, quest_id, rule_id, created_event_id,
        changed_event_id, v_mode, v_type, v_anchor, v_end_date, v_weekdays, v_month_day,
        v_limit, v_reward, false);
END;
$function$;

-- Idempotently materialize the profile-local day's eligible recurring slots and return
-- how many new occurrences were created. This is the only generation trigger in V1:
-- there is no scheduler, cron, worker, queue or precreation horizon, and reading a day
-- never builds a historical catch-up backlog (RR-05, AC-33).
--
-- Determinism comes from three layers, in this order:
--   1. progression_internal.lock_owner() serializes every generation path for the owner,
--      including completion and reopen, so two concurrent readers cannot both decide a
--      slot is missing.
--   2. The Quest row is taken FOR UPDATE around the limit check and the counter increment,
--      exactly as section 18.2/18.4 requires, so the counter moves by exactly one per
--      genuinely new instance and never for a skipped conflict.
--   3. The pre-existing partial unique index uq_recurring_slot (quest_id, source_slot_date)
--      is the final backstop; the insert uses ON CONFLICT DO NOTHING and ROW_COUNT counts
--      only genuinely new rows.
CREATE FUNCTION public.materialize_quest_day(p_day date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    profile_timezone text;
    selected_day date;
    today_local date;
    created integer := 0;
    slot record;
    inserted integer;
    v_now timestamptz;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '42501';
    END IF;

    -- The authoritative timezone is the Profile-owned profile.timezone, revalidated on
    -- every generation pass; no default is ever guessed (frozen RR-03, AC-39).
    SELECT p.timezone INTO profile_timezone
        FROM public.profiles AS p
        WHERE p.user_id = actor;
    IF profile_timezone IS NULL THEN
        RAISE EXCEPTION 'Profile timezone is not set; complete Profile timezone setup before materializing Quest days'
            USING ERRCODE = 'PZ001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
        WHERE zone.name = profile_timezone
            AND zone.name NOT LIKE 'posix/%'
            AND zone.name NOT LIKE 'right/%'
            AND zone.name <> 'localtime'
    ) THEN
        RAISE EXCEPTION 'Profile timezone is not a supported IANA zone; update Profile timezone settings'
            USING ERRCODE = 'PZ001';
    END IF;

    IF p_day IS NULL THEN
        selected_day := (pg_catalog.now() AT TIME ZONE profile_timezone)::date;
    ELSE
        selected_day := p_day;
    END IF;
    -- Section 18.2 is authoritative: only today or later may generate. A past day that
    -- was never materialized is skipped silently (returns 0 for it) instead of being
    -- backfilled, so returning after an absence cannot manufacture an obligation for
    -- every missed slot (RR-05, AC-33). Slots already materialized on their own day are
    -- untouched, so existing history stays visible. Explicitly requested past days
    -- remain safe to call from the day-listing path.
    today_local := (pg_catalog.now() AT TIME ZONE profile_timezone)::date;

    PERFORM progression_internal.lock_owner(actor);
    v_now := pg_catalog.now();

    -- Each eligible rule contributes at most one slot for this one day. A rule that is
    -- stopped (paused), archived, ended, not yet anchored, not reached yet (today_local
    -- gate) or already at its materialized limit yields nothing, and no unmaterialized
    -- past slot is ever revisited (RR-05, section 18.2).
    -- RR-07/AC-32: a monthly slot whose intended day-of-month is absent from the current
    -- month falls back to that month's last valid day, and the retained month_day still
    -- produces day 31 again in the next 31-day month. The slot key is the resulting
    -- calendar date, so the fallback can never duplicate a slot.
    FOR slot IN
        SELECT q.id AS quest_id, q.default_reward_exp, q.default_difficulty,
               q.default_estimated_duration_minutes, q.default_energy_cost,
               q.default_focus_demand, r.id AS rule_id, r.revision
            FROM public.quests AS q
            JOIN public.quest_recurrence_rules AS r
                ON r.quest_id = q.id AND r.user_id = q.user_id
            WHERE q.user_id = actor
                AND q.archived_at IS NULL
                AND r.stopped_at IS NULL
                AND r.recurrence_type IN ('daily', 'selected_weekdays', 'monthly')
                AND selected_day >= today_local
                AND selected_day >= r.anchor_date
                AND (r.end_date IS NULL OR selected_day <= r.end_date)
                AND (r.occurrence_limit IS NULL
                    OR q.materialized_occurrence_count < r.occurrence_limit)
                AND (
                    r.recurrence_type = 'daily'
                    OR (r.recurrence_type = 'selected_weekdays'
                        AND EXTRACT(ISODOW FROM selected_day)::smallint = ANY (r.weekdays))
                    OR (r.recurrence_type = 'monthly'
                        AND EXTRACT(DAY FROM selected_day)::smallint = LEAST(r.month_day,
                            (EXTRACT(DAY FROM (date_trunc('month', selected_day)
                                + interval '1 month - 1 day'))::smallint)))
                )
            ORDER BY q.id
            FOR UPDATE OF q
    LOOP
        -- A generated slot is an unscheduled draft: it carries a calendar day, not an
        -- invented instant. Section 18.4 forbids inventing a deadline, and the frozen
        -- ck_occurrence_schedule check requires an instant before status may be
        -- 'scheduled'. 'draft' is already completable for both the advisory day-read
        -- projection and the atomic completion command, so completion/EXP is unchanged.
        INSERT INTO public.quest_occurrences (quest_id, user_id, status, scheduled_at,
            deadline_at, reward_exp_snapshot, difficulty_snapshot,
            estimated_duration_minutes_snapshot, energy_cost_snapshot,
            focus_demand_snapshot, recurrence_rule_id, recurrence_revision,
            source_slot_date, source_timezone, direct_goal_id_snapshot,
            project_id_snapshot, penalty_snapshot, execution_cycle)
        VALUES (slot.quest_id, actor, 'draft', NULL, NULL,
            COALESCE(slot.default_reward_exp, 0), slot.default_difficulty,
            slot.default_estimated_duration_minutes, slot.default_energy_cost,
            slot.default_focus_demand, slot.rule_id, slot.revision,
            selected_day, profile_timezone, NULL, NULL, NULL, 1)
        ON CONFLICT (quest_id, source_slot_date)
            WHERE recurrence_rule_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS inserted = ROW_COUNT;
        IF inserted = 1 THEN
            UPDATE public.quests AS q
                SET materialized_occurrence_count = q.materialized_occurrence_count + 1,
                    updated_at = v_now
                WHERE q.id = slot.quest_id AND q.user_id = actor;
            created := created + 1;
        ELSIF inserted <> 0 THEN
            RAISE EXCEPTION 'Recurring slot generation produced an unexpected row count'
                USING ERRCODE = '23505';
        END IF;
    END LOOP;

    RETURN created;
END;
$function$;

-- Owner-scoped read projection of the recurring definitions and their pause state for
-- the routine management surface. STABLE and SECURITY INVOKER exactly like
-- public.list_day_quest_occurrences, so the caller's own RLS-bound privileges remain the
-- final barrier and no write path is reachable from a read.
CREATE FUNCTION public.list_recurring_quests()
RETURNS TABLE (
    quest_id uuid,
    title text,
    recurrence_mode text,
    recurrence_type text,
    paused boolean,
    anchor_date date,
    end_date date,
    weekdays smallint[],
    month_day smallint,
    occurrence_limit integer,
    default_reward_exp integer,
    materialized_occurrence_count bigint,
    last_slot_date date
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT q.id,
        q.title,
        q.recurrence_mode,
        r.recurrence_type,
        (r.stopped_at IS NOT NULL),
        r.anchor_date,
        r.end_date,
        r.weekdays,
        r.month_day,
        r.occurrence_limit,
        q.default_reward_exp,
        q.materialized_occurrence_count,
        (SELECT max(o.source_slot_date)
            FROM public.quest_occurrences AS o
            WHERE o.quest_id = q.id
                AND o.user_id = actor
                AND o.recurrence_rule_id IS NOT NULL)
        FROM public.quests AS q
        JOIN public.quest_recurrence_rules AS r
            ON r.quest_id = q.id AND r.user_id = q.user_id
        WHERE q.user_id = actor
            AND q.archived_at IS NULL
            AND q.recurrence_mode <> 'one_off'
        ORDER BY (r.stopped_at IS NOT NULL), r.anchor_date, q.title, q.id;
END;
$function$;

-- RR-07: pausing a series stops future generation only. The definition stays available,
-- nothing is archived, materialized occurrences keep their state and completed history is
-- untouched. Resuming restores generation from the same anchor and rule. This is a
-- non-destructive state change, so V1 needs no schedule-versioning machinery.
CREATE FUNCTION public.set_quest_recurrence_pause(
    command_id uuid,
    quest_id uuid,
    paused boolean,
    origin text
) RETURNS public.quest_recurrence_state_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    definition public.quests;
    rule public.quest_recurrence_rules;
    prior public.quest_events;
    prior_rule public.quest_recurrence_rules;
    v_wanted_event text;
    v_now timestamptz;
    v_stopped_at timestamptz;
    v_event uuid;
    v_stopped_text text;
    v_previous_text text;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL OR quest_id IS NULL OR paused IS NULL THEN
        RAISE EXCEPTION 'Authentication and required command inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    -- Stopping uses the dedicated recurrence_stopped kind; resuming is a rule change whose
    -- effective boundary is now, so the two actions never share a history identity.
    v_wanted_event := CASE WHEN paused THEN 'recurrence_stopped' ELSE 'recurrence_changed' END;

    PERFORM progression_internal.lock_owner(actor);
    SELECT * INTO definition FROM public.quests AS q
        WHERE q.id = set_quest_recurrence_pause.quest_id AND q.user_id = actor
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown Quest definition' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO rule FROM public.quest_recurrence_rules AS r
        WHERE r.quest_id = definition.id AND r.user_id = actor;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown recurring Quest definition' USING ERRCODE = '23514';
    END IF;
    IF definition.recurrence_mode = 'one_off' THEN
        RAISE EXCEPTION 'A one-off Quest has no recurrence to change' USING ERRCODE = '23514';
    END IF;

    -- An accepted command identity is replayable and returns its recorded receipt; it can
    -- never write a second history row (uq_definition_command_effect is the backstop).
    SELECT * INTO prior FROM public.quest_events AS e
        WHERE e.user_id = actor
            AND e.command_id = set_quest_recurrence_pause.command_id
            AND e.occurrence_id IS NULL
            AND e.event_type IN ('recurrence_changed', 'recurrence_stopped');
    IF FOUND THEN
        SELECT * INTO prior_rule FROM public.quest_recurrence_rules AS r
            WHERE r.quest_id = prior.quest_id AND r.user_id = actor;
        IF NOT FOUND OR prior.quest_id IS DISTINCT FROM definition.id
            OR prior.actor_kind IS DISTINCT FROM 'user'
            OR prior.actor_user_id IS DISTINCT FROM actor
            OR prior.execution_cycle IS NOT NULL
            OR prior.event_type IS DISTINCT FROM v_wanted_event
            OR prior.payload_version IS DISTINCT FROM 1
            OR jsonb_typeof(prior.payload) IS DISTINCT FROM 'object'
            OR (prior.payload - 'origin' - 'before' - 'after') <> '{}'::jsonb
            OR jsonb_typeof(prior.payload -> 'origin') IS DISTINCT FROM 'string'
            OR jsonb_typeof(prior.payload -> 'before') IS DISTINCT FROM 'object'
            OR jsonb_typeof(prior.payload -> 'after') IS DISTINCT FROM 'object'
            OR jsonb_typeof(prior.payload #> '{before,rule}') IS DISTINCT FROM 'object'
            OR jsonb_typeof(prior.payload #> '{after,rule}') IS DISTINCT FROM 'object'
            OR ((prior.payload -> 'before' -> 'rule') - 'stopped' - 'stopped_at')
                IS DISTINCT FROM '{}'::jsonb
            OR ((prior.payload -> 'after' -> 'rule') - 'stopped' - 'stopped_at')
                IS DISTINCT FROM '{}'::jsonb
            OR prior.payload #> '{before,rule,stopped}' IS DISTINCT FROM to_jsonb(NOT paused)
            OR prior.payload #> '{after,rule,stopped}' IS DISTINCT FROM to_jsonb(paused)
            -- A recorded boundary is an ISO instant when present and JSON null when the
            -- state was never held; a missing key or any other JSON type is tampering.
            OR coalesce(jsonb_typeof(prior.payload #> '{before,rule,stopped_at}'), 'absent')
                NOT IN ('string', 'null')
            OR coalesce(jsonb_typeof(prior.payload #> '{after,rule,stopped_at}'), 'absent')
                NOT IN ('string', 'null')
            OR (((prior.payload #>> '{before,rule,stopped_at}') IS NOT NULL)
                IS DISTINCT FROM (NOT paused))
            OR (((prior.payload #>> '{after,rule,stopped_at}') IS NOT NULL)
                IS DISTINCT FROM paused)
            -- The recorded boundary is deliberately not compared to the live rule row:
            -- a replay of an accepted pause must still succeed after a later resume, and
            -- the receipt always returns what that command originally recorded.
            THEN
            RAISE EXCEPTION 'Conflicting recurring Quest recurrence command reuse'
                USING ERRCODE = '23505';
        END IF;
        -- Attribution only: a retry may arrive under another valid origin, and the
        -- recorded payload is never rewritten (quest-creation-v1-contract.md).
        PERFORM progression_internal.require_origin(prior.payload ->> 'origin');
        RETURN (set_quest_recurrence_pause.command_id, prior.quest_id, prior_rule.id,
            definition.recurrence_mode, paused,
            (prior.payload #>> '{after,rule,stopped_at}')::timestamptz, prior.id, true);
    END IF;

    -- A fresh command that finds the definition already in the requested state writes
    -- nothing: no history row, no rule update. replay stays false because no command
    -- identity was recorded, and state_event_id is null so the caller can tell a no-op
    -- acknowledgement from a replay of an accepted command (RR-07).
    IF (rule.stopped_at IS NOT NULL) = paused THEN
        RETURN (set_quest_recurrence_pause.command_id, definition.id, rule.id,
            definition.recurrence_mode, paused, rule.stopped_at, NULL::uuid, false);
    END IF;

    v_now := now();
    v_stopped_at := CASE WHEN paused THEN v_now END;
    v_stopped_text := CASE WHEN paused THEN to_char(v_now AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END;
    v_previous_text := CASE WHEN rule.stopped_at IS NOT NULL THEN to_char(
        rule.stopped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END;
    v_event := gen_random_uuid();

    UPDATE public.quest_recurrence_rules AS r
        SET stopped_at = v_stopped_at, updated_at = v_now
        WHERE r.id = rule.id AND r.user_id = actor;
    UPDATE public.quests AS q
        SET updated_at = v_now
        WHERE q.id = definition.id AND q.user_id = actor;

    INSERT INTO public.quest_events (id, quest_id, user_id, event_type, actor_kind,
        actor_user_id, occurred_at, command_id, payload_version, payload)
        VALUES (v_event, definition.id, actor, v_wanted_event, 'user', actor, v_now,
            set_quest_recurrence_pause.command_id, 1,
            jsonb_build_object('origin', origin,
                'before', jsonb_build_object('rule', jsonb_build_object(
                    'stopped', NOT paused, 'stopped_at', v_previous_text)),
                'after', jsonb_build_object('rule', jsonb_build_object(
                    'stopped', paused, 'stopped_at', v_stopped_text))));

    RETURN (set_quest_recurrence_pause.command_id, definition.id, rule.id,
        definition.recurrence_mode, paused, v_stopped_at, v_event, false);
END;
$function$;

-- Command routines are owned by the RLS-bound command role, never by the migration role.
-- The temporary CREATE grant exists only so ownership transfer is permitted inside this
-- transaction, mirroring 20260923120000_create_one_off_quest.sql.
GRANT quest_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO quest_command_owner;

ALTER FUNCTION public.create_recurring_quest(uuid, jsonb, text)
    OWNER TO quest_command_owner;
ALTER FUNCTION public.materialize_quest_day(date)
    OWNER TO quest_command_owner;
ALTER FUNCTION public.set_quest_recurrence_pause(uuid, uuid, boolean, text)
    OWNER TO quest_command_owner;

REVOKE CREATE ON SCHEMA public FROM quest_command_owner;

-- The caller-facing surface is exactly these four routines for the authenticated owner.
-- Every sibling role, PUBLIC and the command roles themselves lose EXECUTE, matching the
-- frozen grant shape of create_one_off_quest and list_day_quest_occurrences.
REVOKE ALL ON FUNCTION public.create_recurring_quest(uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.create_recurring_quest(uuid, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.materialize_quest_day(date)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.materialize_quest_day(date) TO authenticated;

REVOKE ALL ON FUNCTION public.set_quest_recurrence_pause(uuid, uuid, boolean, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.set_quest_recurrence_pause(uuid, uuid, boolean, text)
    TO authenticated;

REVOKE ALL ON FUNCTION public.list_recurring_quests()
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.list_recurring_quests() TO authenticated;

COMMENT ON TYPE public.quest_recurring_receipt IS
    'Receipt for one recurring Quest definition command. replay=true means the identical command identity was already accepted and nothing new was written; no occurrence id exists because creation never materializes a slot.';
COMMENT ON TYPE public.quest_recurrence_state_receipt IS
    'Receipt for one recurrence pause/resume command. replay=true means this exact command identity was already accepted and the recorded receipt is returned again, never a second history row. replay=false with state_event_id null means a fresh command whose requested state already held, so nothing was written. replay=false with a non-null state_event_id is the original accepted command.';
COMMENT ON FUNCTION public.create_recurring_quest(uuid, jsonb, text) IS
    'Atomically creates one daily/weekly/monthly Quest definition, its single current recurrence rule and exactly two V1 events. Owner identity comes only from request_user_id and ADR-015 require_owner; retries compare immutable event payloads. Rejects with PZ001 when the Profile timezone is missing or invalid (RR-03/AC-39). Never materializes an occurrence.';
COMMENT ON FUNCTION public.materialize_quest_day(date) IS
    'The only recurrence generation trigger in V1: lazily materializes at most one occurrence per eligible rule for one profile-local day and returns how many were created. Eligible days are today and later only; a past day that was never materialized is skipped without backfilling or consuming occurrence_limit (RR-05, AC-33, section 18.2). Idempotent under the owner advisory lock, a Quest row FOR UPDATE and uq_recurring_slot, so repeated or concurrent day reads cannot duplicate a slot or double-count materialized_occurrence_count. Daily steps every day, weekly matches ISO weekdays 1-7, monthly uses month_day with the month''s last valid day as fallback (RR-07/AC-32). Skips archived quests, stopped (paused) rules, days before anchor_date, days after end_date and rules at occurrence_limit. No scheduler, cron, worker or precreation horizon exists.';
COMMENT ON FUNCTION public.list_recurring_quests() IS
    'Owner-scoped recurring Quest definition projection including the pause state. Identity: system_internal.request_user_id() only, ADR-015 require_owner first; STABLE and SECURITY INVOKER so caller RLS remains the final barrier. Excludes archived definitions and one-off Quests.';
COMMENT ON FUNCTION public.set_quest_recurrence_pause(uuid, uuid, boolean, text) IS
    'RR-07 non-destructive pause/resume of one recurring definition: writes quest_recurrence_rules.stopped_at and one recurrence_stopped or recurrence_changed event, never deletes or alters an existing occurrence, never archives the definition and never reverses EXP. Replaying a command identity returns the recorded receipt; an already-matching state is acknowledged without new history.';

NOTIFY pgrst, 'reload schema';
REVOKE quest_command_owner FROM CURRENT_USER;
COMMIT;





