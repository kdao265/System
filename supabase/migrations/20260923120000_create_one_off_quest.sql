-- SYSTEM V1 one-off Quest creation command.
-- Additive only: creates one public command and its receipt type.
BEGIN;

CREATE TYPE public.quest_creation_receipt AS (
    command_id uuid,
    quest_id uuid,
    occurrence_id uuid,
    definition_created_event_id uuid,
    occurrence_scheduled_event_id uuid,
    scheduled_at timestamptz,
    deadline_at timestamptz,
    reward_exp_snapshot integer,
    execution_cycle integer,
    replay boolean
);

CREATE FUNCTION public.create_one_off_quest(
    command_id uuid,
    request jsonb,
    origin text
) RETURNS public.quest_creation_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    definition jsonb;
    occurrence jsonb;
    prior_created public.quest_events;
    prior_scheduled public.quest_events;
    prior_occurrence public.quest_occurrences;
    created_count integer;
    created_event_id uuid;
    scheduled_event_id uuid;
    quest_id uuid;
    occurrence_id uuid;
    v_now timestamptz;
    v_scheduled_at timestamptz;
    v_deadline_at timestamptz;
    v_reward integer;
    v_execution_cycle integer := 1;
    v_title text;
    v_description text;
    v_importance text := 'side';
    v_priority text;
    v_difficulty smallint;
    v_duration integer;
    v_energy smallint;
    v_focus smallint;
    v_tags text[] := ARRAY[]::text[];
    v_notes text;
    key_name text;
    number_value numeric;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL OR request IS NULL
        OR jsonb_typeof(request) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Authentication and required creation inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);

    -- The request surface is deliberately closed. In particular, unsupported
    -- Goal, Project and Penalty inputs fail instead of disappearing.
    IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(request) AS supplied(key)
        WHERE supplied.key NOT IN ('title', 'description', 'importance',
            'priority', 'default_difficulty', 'default_estimated_duration_minutes',
            'default_energy_cost', 'default_focus_demand', 'default_reward_exp',
            'tags', 'notes', 'scheduled_at', 'deadline_at', 'recurrence_mode')
    ) THEN
        RAISE EXCEPTION 'Unsupported one-off Quest input (Goal, Project, Penalty and unknown inputs are unavailable)'
            USING ERRCODE = '22023';
    END IF;
    IF request ? 'recurrence_mode'
        AND request -> 'recurrence_mode' IS DISTINCT FROM '"one_off"'::jsonb
        AND request -> 'recurrence_mode' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'Only one-off Quest creation is supported' USING ERRCODE = '22023';
    END IF;

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

    IF request ? 'scheduled_at' AND jsonb_typeof(request -> 'scheduled_at') NOT IN ('string', 'null')
        OR request ? 'deadline_at' AND jsonb_typeof(request -> 'deadline_at') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'schedule values must be timestamps or null' USING ERRCODE = '22023';
    END IF;
    -- Require an explicit absolute ISO-8601 timestamp before PostgreSQL parses
    -- it. This excludes date-only, timezone-less, relative and infinity input.
    IF request ->> 'scheduled_at' IS NOT NULL
        AND (request ->> 'scheduled_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
        OR request ->> 'deadline_at' IS NOT NULL
        AND (request ->> 'deadline_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RAISE EXCEPTION 'schedule timestamps must be explicit ISO 8601 values with Z or a numeric UTC offset'
            USING ERRCODE = '22023';
    END IF;
    BEGIN
        v_scheduled_at := (request ->> 'scheduled_at')::timestamptz;
        v_deadline_at := (request ->> 'deadline_at')::timestamptz;
    EXCEPTION WHEN data_exception THEN
        RAISE EXCEPTION 'Invalid schedule timestamp' USING ERRCODE = '22023';
    END;
    IF v_scheduled_at IS NULL AND v_deadline_at IS NULL THEN
        RAISE EXCEPTION 'scheduled_at or deadline_at is required' USING ERRCODE = '22023';
    END IF;
    IF v_deadline_at IS NOT NULL AND v_scheduled_at IS NOT NULL
        AND v_deadline_at < v_scheduled_at THEN
        RAISE EXCEPTION 'deadline_at must not precede scheduled_at' USING ERRCODE = '22023';
    END IF;

    definition := jsonb_build_object(
        'title', v_title, 'description', v_description, 'importance', v_importance,
        'priority', v_priority, 'default_difficulty', v_difficulty,
        'default_estimated_duration_minutes', v_duration, 'default_energy_cost', v_energy,
        'default_focus_demand', v_focus, 'default_reward_exp', v_reward,
        'direct_goal_id', NULL, 'project_id', NULL, 'recurrence_mode', 'one_off',
        'default_penalty_snapshot', NULL, 'tags', to_jsonb(v_tags), 'notes', v_notes);
    occurrence := jsonb_build_object(
        'status', 'scheduled',
        'scheduled_at', to_char(v_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'deadline_at', to_char(v_deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'reward_exp_snapshot', v_reward, 'difficulty_snapshot', v_difficulty,
        'estimated_duration_minutes_snapshot', v_duration, 'energy_cost_snapshot', v_energy,
        'focus_demand_snapshot', v_focus, 'direct_goal_id_snapshot', NULL,
        'project_id_snapshot', NULL, 'penalty_snapshot', NULL,
        'recurrence_rule_id', NULL, 'recurrence_revision', NULL, 'source_slot_date', NULL,
        'source_timezone', NULL, 'execution_cycle', v_execution_cycle);

    -- This lock is intentionally before event lookup and before any ID generation.
    PERFORM progression_internal.lock_owner(actor);
    SELECT count(*) INTO created_count FROM public.quest_events e
        WHERE e.user_id = actor AND e.command_id = create_one_off_quest.command_id;
    IF created_count > 0 THEN
        SELECT * INTO prior_created FROM public.quest_events e
            WHERE e.user_id = actor AND e.command_id = create_one_off_quest.command_id
                AND e.event_type = 'created' AND e.occurrence_id IS NULL;
        SELECT * INTO prior_scheduled FROM public.quest_events e
            WHERE e.user_id = actor AND e.command_id = create_one_off_quest.command_id
                AND e.event_type = 'scheduled' AND e.occurrence_id IS NOT NULL;
        IF created_count <> 2 OR NOT FOUND
            OR prior_created.id IS NULL OR prior_scheduled.id IS NULL THEN
            RAISE EXCEPTION 'Conflicting or partial one-off Quest command reuse'
                USING ERRCODE = '23505';
        END IF;
        IF jsonb_typeof(prior_created.payload -> 'origin') IS DISTINCT FROM 'string'
            OR jsonb_typeof(prior_scheduled.payload -> 'origin') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Conflicting or partial one-off Quest command reuse'
                USING ERRCODE = '23505';
        END IF;
        PERFORM progression_internal.require_origin(prior_created.payload ->> 'origin');
        PERFORM progression_internal.require_origin(prior_scheduled.payload ->> 'origin');
        SELECT * INTO prior_occurrence FROM public.quest_occurrences o
            WHERE o.id = prior_scheduled.occurrence_id
                AND o.quest_id = prior_scheduled.quest_id
                AND o.user_id = actor;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Conflicting or partial one-off Quest command reuse'
                USING ERRCODE = '23505';
        END IF;
        IF prior_created.user_id IS DISTINCT FROM actor
            OR prior_scheduled.user_id IS DISTINCT FROM actor
            OR prior_created.actor_kind IS DISTINCT FROM 'user'
            OR prior_scheduled.actor_kind IS DISTINCT FROM 'user'
            OR prior_created.actor_user_id IS DISTINCT FROM actor
            OR prior_scheduled.actor_user_id IS DISTINCT FROM actor
            OR prior_created.occurrence_id IS NOT NULL
            OR prior_created.execution_cycle IS NOT NULL
            OR prior_scheduled.occurrence_id IS NULL
            OR prior_scheduled.execution_cycle IS DISTINCT FROM 1
            OR prior_created.payload IS NULL
            OR jsonb_typeof(prior_created.payload) IS DISTINCT FROM 'object'
            OR (prior_created.payload - 'origin' - 'after') <> '{}'::jsonb
            OR jsonb_typeof(prior_created.payload -> 'after') IS DISTINCT FROM 'object'
            OR ((prior_created.payload -> 'after') - 'definition') <> '{}'::jsonb
            OR jsonb_typeof(prior_created.payload -> 'after' -> 'definition') IS DISTINCT FROM 'object'
            OR prior_scheduled.payload IS NULL
            OR jsonb_typeof(prior_scheduled.payload) IS DISTINCT FROM 'object'
            OR (prior_scheduled.payload - 'origin' - 'after') <> '{}'::jsonb
            OR jsonb_typeof(prior_scheduled.payload -> 'after') IS DISTINCT FROM 'object'
            OR ((prior_scheduled.payload -> 'after') - 'occurrence') <> '{}'::jsonb
            OR jsonb_typeof(prior_scheduled.payload -> 'after' -> 'occurrence') IS DISTINCT FROM 'object'
            OR prior_created.payload -> 'origin' IS DISTINCT FROM prior_scheduled.payload -> 'origin'
            OR prior_created.payload_version IS DISTINCT FROM 1
            OR prior_scheduled.payload_version IS DISTINCT FROM 1
            OR prior_created.payload -> 'after' -> 'definition' IS DISTINCT FROM definition
            OR prior_scheduled.payload -> 'after' -> 'occurrence' IS DISTINCT FROM occurrence
            OR prior_created.quest_id IS DISTINCT FROM prior_scheduled.quest_id
            OR prior_scheduled.occurrence_id IS DISTINCT FROM prior_occurrence.id
            OR prior_occurrence.quest_id IS DISTINCT FROM prior_scheduled.quest_id
            OR prior_occurrence.user_id IS DISTINCT FROM actor THEN
            RAISE EXCEPTION 'Conflicting or partial one-off Quest command reuse'
                USING ERRCODE = '23505';
        END IF;
        RETURN (create_one_off_quest.command_id, prior_created.quest_id,
            prior_scheduled.occurrence_id, prior_created.id, prior_scheduled.id,
            (prior_scheduled.payload #>> '{after,occurrence,scheduled_at}')::timestamptz,
            (prior_scheduled.payload #>> '{after,occurrence,deadline_at}')::timestamptz,
            (prior_scheduled.payload #>> '{after,occurrence,reward_exp_snapshot}')::integer,
            1, true);
    END IF;

    v_now := now();
    quest_id := gen_random_uuid();
    occurrence_id := gen_random_uuid();
    created_event_id := gen_random_uuid();
    scheduled_event_id := gen_random_uuid();
    INSERT INTO public.quests (id, user_id, title, description, importance, priority,
        default_difficulty, default_estimated_duration_minutes, default_energy_cost,
        default_focus_demand, default_reward_exp, direct_goal_id, project_id,
        recurrence_mode, default_penalty_snapshot, tags, notes, materialized_occurrence_count)
        VALUES (quest_id, actor, v_title, v_description, v_importance, v_priority,
            v_difficulty, v_duration, v_energy, v_focus, v_reward, NULL, NULL,
            'one_off', NULL, v_tags, v_notes, 1);
    INSERT INTO public.quest_occurrences (id, quest_id, user_id, status, scheduled_at,
        deadline_at, reward_exp_snapshot, difficulty_snapshot,
        estimated_duration_minutes_snapshot, energy_cost_snapshot, focus_demand_snapshot,
        recurrence_rule_id, recurrence_revision, source_slot_date, source_timezone,
        direct_goal_id_snapshot, project_id_snapshot, penalty_snapshot, execution_cycle)
        VALUES (occurrence_id, quest_id, actor, 'scheduled', v_scheduled_at, v_deadline_at,
            v_reward, v_difficulty, v_duration, v_energy, v_focus, NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, 1);
    INSERT INTO public.quest_events (id, quest_id, user_id, event_type, actor_kind,
        actor_user_id, occurred_at, command_id, payload_version, payload)
        VALUES (created_event_id, quest_id, actor, 'created', 'user', actor, v_now,
            create_one_off_quest.command_id, 1,
            jsonb_build_object('origin', origin, 'after', jsonb_build_object('definition', definition)));
    INSERT INTO public.quest_events (id, quest_id, user_id, occurrence_id, event_type,
        actor_kind, actor_user_id, occurred_at, command_id, execution_cycle,
        payload_version, payload)
        VALUES (scheduled_event_id, quest_id, actor, occurrence_id, 'scheduled', 'user', actor,
            v_now, create_one_off_quest.command_id, 1, 1,
            jsonb_build_object('origin', origin, 'after', jsonb_build_object('occurrence', occurrence)));
    RETURN (create_one_off_quest.command_id, quest_id, occurrence_id, created_event_id,
        scheduled_event_id, v_scheduled_at, v_deadline_at, v_reward, 1, false);
END;
$function$;

GRANT quest_command_owner TO CURRENT_USER;
GRANT quest_command_owner TO CURRENT_USER;

-- Temporarily allow ownership transfer within this transaction.
GRANT CREATE ON SCHEMA public TO quest_command_owner;

ALTER FUNCTION public.create_one_off_quest(uuid, jsonb, text)
    OWNER TO quest_command_owner;

-- Restore the role's original schema privileges.
REVOKE CREATE ON SCHEMA public FROM quest_command_owner;
REVOKE ALL ON FUNCTION public.create_one_off_quest(uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.create_one_off_quest(uuid, jsonb, text) TO authenticated;
COMMENT ON FUNCTION public.create_one_off_quest(uuid, jsonb, text) IS
    'Atomically creates one scheduled one-off Quest, its occurrence and exactly two V1 events; owner identity comes only from request_user_id and retries compare immutable event payloads.';
REVOKE quest_command_owner FROM CURRENT_USER;

COMMIT;