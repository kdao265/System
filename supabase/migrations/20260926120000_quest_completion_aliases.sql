-- ADR-013: durable alternate completion identities. No backfill or history rewrite.
-- Apply only after draining old command calls. See completion-alias-v1.md.
BEGIN;

CREATE TABLE system_internal.quest_completion_aliases (
    user_id uuid NOT NULL,
    command_id uuid NOT NULL,
    quest_id uuid NOT NULL,
    completed_event_id uuid NOT NULL,
    registered_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, command_id),
    CONSTRAINT fk_completion_alias_event FOREIGN KEY (completed_event_id, quest_id, user_id)
        REFERENCES public.quest_events (id, quest_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE system_internal.quest_completion_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON system_internal.quest_completion_aliases FROM PUBLIC, anon, authenticated,
    service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT SELECT, INSERT ON system_internal.quest_completion_aliases TO quest_command_owner;
CREATE POLICY completion_alias_select ON system_internal.quest_completion_aliases
    FOR SELECT TO quest_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY completion_alias_insert ON system_internal.quest_completion_aliases
    FOR INSERT TO quest_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));

-- Internal helpers execute with the existing RLS-bound command role, never elevated.
CREATE FUNCTION system_internal.completion_receipt(p_event uuid, p_command uuid)
RETURNS public.quest_completion_receipt
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid := system_internal.request_user_id();
    e public.quest_events;
    credit public.exp_ledger;
    reported timestamptz;
BEGIN
    SELECT * INTO e FROM public.quest_events WHERE id = p_event AND user_id = actor;
    IF NOT FOUND OR e.event_type <> 'completed' OR e.payload_version <> 1
        OR e.occurrence_id IS NULL OR e.execution_cycle IS NULL OR e.execution_cycle < 1
        OR e.related_event_id IS NOT NULL OR p_command IS NULL THEN
        RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO credit FROM public.exp_ledger
    WHERE user_id = actor AND source_type = 'quest_completion' AND source_id = e.id
        AND reason = 'completion_reward';
    IF NOT FOUND OR credit.reverses_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
    END IF;
    PERFORM exp_internal.validate_credit_envelope(e, credit.id, credit.amount);
    IF exp_internal.integer_value(e.payload -> 'reward_exp_snapshot') IS DISTINCT FROM credit.amount::numeric
        OR jsonb_typeof(e.payload -> 'recorded_completed_at') IS DISTINCT FROM 'string'
        OR NOT (e.payload ? 'reported_completed_at')
        OR jsonb_typeof(e.payload -> 'reported_completed_at') NOT IN ('string', 'null')
        OR (e.payload ->> 'recorded_completed_at')::timestamptz IS DISTINCT FROM e.occurred_at
        OR (SELECT count(*) FROM public.quest_events x WHERE x.user_id = actor AND x.command_id = e.command_id) <> 1
        OR EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases a
            WHERE a.user_id = actor AND a.command_id = e.command_id) THEN
        RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
    END IF;
    reported := (e.payload ->> 'reported_completed_at')::timestamptz;
    RETURN (p_command, e.occurrence_id, e.quest_id, e.execution_cycle, e.id, credit.id,
        credit.amount, reported, e.occurred_at, true);
EXCEPTION WHEN data_exception OR check_violation THEN
    -- No cast inputs or stored payload values escape in diagnostics.
    RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
END;
$function$;

CREATE FUNCTION system_internal.completion_binding(p_command uuid, p_occurrence uuid, p_cycle integer)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid := system_internal.request_user_id();
    binding system_internal.quest_completion_aliases;
    e public.quest_events;
    event_count bigint;
BEGIN
    SELECT * INTO binding FROM system_internal.quest_completion_aliases a
        WHERE a.user_id = actor AND a.command_id = p_command;
    SELECT count(*) INTO event_count FROM public.quest_events x
        WHERE x.user_id = actor AND x.command_id = p_command;
    IF binding.command_id IS NOT NULL THEN
        IF event_count <> 0 THEN
            RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO e FROM public.quest_events x
            WHERE x.user_id = actor AND x.id = binding.completed_event_id AND x.quest_id = binding.quest_id;
        IF NOT FOUND OR e.event_type <> 'completed' THEN
            RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
        END IF;
    ELSIF event_count > 0 THEN
        SELECT * INTO e FROM public.quest_events x
            WHERE x.user_id = actor AND x.command_id = p_command AND x.event_type = 'completed';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
        END IF;
        IF event_count <> 1 THEN
            RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
        END IF;
    ELSE
        RETURN NULL;
    END IF;
    IF e.occurrence_id IS DISTINCT FROM p_occurrence OR e.execution_cycle IS DISTINCT FROM p_cycle THEN
        RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
    END IF;
    RETURN e.id;
END;
$function$;

CREATE FUNCTION system_internal.reject_completion_alias(p_command uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases a
        WHERE a.user_id = system_internal.request_user_id() AND a.command_id = p_command) THEN
        RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
    END IF;
END;
$function$;

CREATE FUNCTION system_internal.guard_completion_alias() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid := system_internal.request_user_id();
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Completion aliases are immutable' USING ERRCODE = '55000';
    END IF;
    IF actor IS NULL OR NEW.user_id IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'Unauthorized completion alias owner' USING ERRCODE = '42501';
    END IF;
    -- Outer public commands already hold owner -> Quest -> occurrence locks.
    PERFORM progression_internal.lock_owner(actor);
    IF EXISTS (SELECT 1 FROM public.quest_events e WHERE e.user_id = actor AND e.command_id = NEW.command_id) THEN
        RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
    END IF;
    PERFORM system_internal.completion_receipt(NEW.completed_event_id, NEW.command_id);
    NEW.registered_at := now();
    RETURN NEW;
END;
$function$;
CREATE TRIGGER completion_alias_guard BEFORE INSERT OR UPDATE OR DELETE
    ON system_internal.quest_completion_aliases FOR EACH ROW EXECUTE FUNCTION system_internal.guard_completion_alias();
CREATE TRIGGER completion_alias_truncate_guard BEFORE TRUNCATE
    ON system_internal.quest_completion_aliases FOR EACH STATEMENT EXECUTE FUNCTION system_internal.guard_completion_alias();

REVOKE ALL ON FUNCTION system_internal.completion_receipt(uuid, uuid),
    system_internal.completion_binding(uuid, uuid, integer), system_internal.reject_completion_alias(uuid),
    system_internal.guard_completion_alias()
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
        progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION system_internal.completion_receipt(uuid, uuid),
    system_internal.completion_binding(uuid, uuid, integer), system_internal.reject_completion_alias(uuid),
    system_internal.guard_completion_alias() TO quest_command_owner;

-- Replacement signatures/return types and effective ACLs remain unchanged.
GRANT quest_command_owner TO CURRENT_USER;
CREATE OR REPLACE FUNCTION public.complete_quest_occurrence(
    command_id uuid,
    occurrence_id uuid,
    expected_execution_cycle integer,
    reported_completed_at timestamptz,
    origin text
) RETURNS public.quest_completion_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    quest uuid;
    v_recorded timestamptz;
    v_now timestamptz;
    occurrence_row public.quest_occurrences;
    v_event_id uuid;
    v_entry_id uuid;
    receipt uuid;
    v_payload jsonb;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL OR occurrence_id IS NULL
        OR expected_execution_cycle IS NULL THEN
        RAISE EXCEPTION 'Authentication and required command inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;
    IF expected_execution_cycle < 1 THEN
        RAISE EXCEPTION 'Expected execution cycle is out of range' USING ERRCODE = '23514';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    -- Frozen lock order: owner-wide progression lock, then Quest, then occurrence.
    PERFORM progression_internal.lock_owner(actor);
    SELECT o.quest_id INTO quest FROM public.quest_occurrences o
        WHERE o.id = complete_quest_occurrence.occurrence_id AND o.user_id = actor;
    IF quest IS NULL THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.quests q
        WHERE q.id = quest AND q.user_id = actor FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest definition' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO occurrence_row FROM public.quest_occurrences o
        WHERE o.id = complete_quest_occurrence.occurrence_id AND o.user_id = actor
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;

    -- Accepted original/alias identities are resolved before live-cycle checks.
    v_event_id := system_internal.completion_binding(command_id, occurrence_id, expected_execution_cycle);
    IF v_event_id IS NOT NULL THEN
        RETURN system_internal.completion_receipt(v_event_id, command_id);
    END IF;
    IF occurrence_row.execution_cycle IS DISTINCT FROM expected_execution_cycle THEN
        RAISE EXCEPTION 'Stale quest completion cycle' USING ERRCODE = '23514';
    END IF;
    IF occurrence_row.status = 'completed' THEN
        SELECT e.id INTO v_event_id FROM public.quest_events e
        WHERE e.user_id = actor AND e.occurrence_id = complete_quest_occurrence.occurrence_id
            AND e.execution_cycle = expected_execution_cycle AND e.event_type = 'completed';
        -- Validate the canonical receipt before registering the alternate identity.
        PERFORM system_internal.completion_receipt(v_event_id, command_id);
        IF EXISTS (SELECT 1 FROM public.exp_ledger reversal
            JOIN public.exp_ledger credit ON credit.id = reversal.reverses_entry_id
            WHERE credit.user_id = actor AND credit.source_id = v_event_id
                AND credit.source_type = 'quest_completion') THEN
            RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
        END IF;
        INSERT INTO system_internal.quest_completion_aliases
            (user_id, command_id, quest_id, completed_event_id)
        VALUES (actor, complete_quest_occurrence.command_id, quest, v_event_id);
        RETURN system_internal.completion_receipt(v_event_id, command_id);
    END IF;
    IF occurrence_row.status NOT IN ('draft', 'scheduled', 'active')
        OR occurrence_row.reward_exp_snapshot IS NULL THEN
        RAISE EXCEPTION 'Occurrence is not completable' USING ERRCODE = '23514';
    END IF;

    v_now := now();
    v_event_id := gen_random_uuid();
    v_entry_id := gen_random_uuid();
    v_payload := jsonb_build_object(
        'reported_completed_at', complete_quest_occurrence.reported_completed_at,
        'recorded_completed_at', v_now,
        'reward_exp_snapshot', occurrence_row.reward_exp_snapshot,
        'difficulty_snapshot', occurrence_row.difficulty_snapshot,
        'estimated_duration_minutes_snapshot', occurrence_row.estimated_duration_minutes_snapshot,
        'energy_cost_snapshot', occurrence_row.energy_cost_snapshot,
        'focus_demand_snapshot', occurrence_row.focus_demand_snapshot,
        'direct_goal_id_snapshot', occurrence_row.direct_goal_id_snapshot,
        'project_id_snapshot', occurrence_row.project_id_snapshot,
        'exp', jsonb_build_object(
            'source_type', 'quest_completion',
            'source_id', v_event_id,
            'reason', 'completion_reward',
            'amount', occurrence_row.reward_exp_snapshot::bigint,
            'ledger_entry_id', v_entry_id));
    INSERT INTO public.quest_events (
        id, quest_id, user_id, occurrence_id, event_type, actor_kind, actor_user_id,
        occurred_at, command_id, execution_cycle, related_event_id, payload_version, payload
    ) VALUES (
        v_event_id, quest, actor, complete_quest_occurrence.occurrence_id, 'completed',
        'user', actor, v_now, complete_quest_occurrence.command_id,
        expected_execution_cycle, NULL, 1, v_payload);
    receipt := exp_internal.append_quest_event(v_event_id);
    IF receipt IS DISTINCT FROM v_entry_id THEN
        RAISE EXCEPTION 'EXP receipt integrity failure' USING ERRCODE = '23514';
    END IF;
    PERFORM progression_internal.recognize_after_exp(v_entry_id, origin);
    v_recorded := v_now;
    UPDATE public.quest_occurrences o
        SET status = 'completed',
            recorded_completed_at = v_recorded,
            reported_completed_at = complete_quest_occurrence.reported_completed_at,
            updated_at = v_now
        WHERE o.id = complete_quest_occurrence.occurrence_id AND o.user_id = actor;
    RETURN (complete_quest_occurrence.command_id,
        complete_quest_occurrence.occurrence_id, quest, expected_execution_cycle,
        v_event_id, v_entry_id, occurrence_row.reward_exp_snapshot::bigint,
        complete_quest_occurrence.reported_completed_at, v_recorded, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_one_off_quest(
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
    PERFORM system_internal.reject_completion_alias(command_id);
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

CREATE OR REPLACE FUNCTION public.reopen_quest_occurrence_v2(
    command_id uuid,
    occurrence_id uuid,
    expected_execution_cycle integer,
    origin text
) RETURNS public.quest_reopen_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    quest uuid;
    v_now timestamptz;
    occurrence_row public.quest_occurrences;
    prior public.quest_events;
    prior_reopened public.quest_events;
    completed_event public.quest_events;
    original_credit public.exp_ledger;
    v_correction_id uuid;
    v_reopened_id uuid;
    v_reversal_id uuid;
    prior_reversal uuid;
    receipt uuid;
    v_target text;
    v_payload jsonb;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL OR occurrence_id IS NULL
        OR expected_execution_cycle IS NULL OR origin IS NULL THEN
        RAISE EXCEPTION 'Authentication and required command inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;
    IF expected_execution_cycle < 1
        OR expected_execution_cycle > 2147483647 THEN
        RAISE EXCEPTION 'Expected execution cycle is out of range'
            USING ERRCODE = '23514';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    -- Frozen lock order: owner-wide progression lock, then Quest, then occurrence.
    PERFORM progression_internal.lock_owner(actor);
    PERFORM system_internal.reject_completion_alias(command_id);
    SELECT o.quest_id INTO quest FROM public.quest_occurrences o
        WHERE o.id = reopen_quest_occurrence_v2.occurrence_id AND o.user_id = actor;
    IF quest IS NULL THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.quests q
        WHERE q.id = quest AND q.user_id = actor FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest definition' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO occurrence_row FROM public.quest_occurrences o
        WHERE o.id = reopen_quest_occurrence_v2.occurrence_id AND o.user_id = actor
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;
    -- Resolve accepted effects before minting any new identity (payload V1
    -- section 6). A recorded command replays its original receipt regardless of
    -- the occurrence's CURRENT cycle, but only when the supplied expected cycle
    -- equals the cycle originally recorded by that command (ADR).
    SELECT * INTO prior FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.command_id = reopen_quest_occurrence_v2.command_id
            AND e.occurrence_id = reopen_quest_occurrence_v2.occurrence_id
            AND e.event_type = 'completion_corrected';
    IF FOUND THEN
        IF prior.execution_cycle IS DISTINCT FROM expected_execution_cycle THEN
            RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
        END IF;
        SELECT * INTO prior_reopened FROM public.quest_events e
            WHERE e.user_id = actor
                AND e.command_id = reopen_quest_occurrence_v2.command_id
                AND e.occurrence_id = reopen_quest_occurrence_v2.occurrence_id
                AND e.event_type = 'reopened';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Accepted reopen event is missing' USING ERRCODE = '23514';
        END IF;
        prior_reversal := exp_internal.uuid_value(prior.payload #> '{exp,reversal_entry_id}');
        IF NOT EXISTS (
            SELECT 1 FROM public.exp_ledger c
            WHERE c.id = prior_reversal AND c.user_id = actor
                AND c.source_type = 'quest_completion_reversal'
                AND c.source_id = prior.id
                AND c.reason = 'completion_reward_reversal'
                AND c.reverses_entry_id
                    = exp_internal.uuid_value(prior.payload #> '{exp,original_credit_entry_id}')
        ) THEN
            RAISE EXCEPTION 'Accepted reversal receipt is missing' USING ERRCODE = '23514';
        END IF;
        RETURN (reopen_quest_occurrence_v2.command_id,
            reopen_quest_occurrence_v2.occurrence_id, quest,
            prior.execution_cycle, prior.id, prior_reopened.id, prior_reversal,
            exp_internal.integer_value(prior.payload #> '{exp,amount}')::bigint,
            exp_internal.uuid_value(prior.payload #> '{exp,original_credit_entry_id}'),
            true);
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.command_id = reopen_quest_occurrence_v2.command_id
    ) THEN
        RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
    END IF;

    -- Fresh command: the cycle guard runs after replay resolution and command
    -- reuse rejection, while holding the owner lock and both FOR UPDATE locks,
    -- and before any event or EXP-ledger mutation.
    IF occurrence_row.execution_cycle IS DISTINCT FROM expected_execution_cycle THEN
        RAISE EXCEPTION 'Stale quest reopen cycle' USING ERRCODE = '23514';
    END IF;
    IF occurrence_row.status IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'Occurrence has no accepted completion to undo'
            USING ERRCODE = '23514';
    END IF;
    SELECT * INTO completed_event FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.occurrence_id = reopen_quest_occurrence_v2.occurrence_id
            AND e.event_type = 'completed'
            AND e.execution_cycle = expected_execution_cycle;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Accepted completion is missing' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO original_credit FROM public.exp_ledger c
        WHERE c.user_id = actor AND c.source_type = 'quest_completion'
            AND c.source_id = completed_event.id AND c.reason = 'completion_reward';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original credit receipt is missing' USING ERRCODE = '23514';
    END IF;
    IF original_credit.reverses_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'Completion credit is already reversed' USING ERRCODE = '23514';
    END IF;

    v_now := now();
    v_correction_id := gen_random_uuid();
    v_reopened_id := gen_random_uuid();
    v_reversal_id := gen_random_uuid();
    v_target := CASE
        WHEN occurrence_row.scheduled_at IS NOT NULL
            OR occurrence_row.deadline_at IS NOT NULL THEN 'scheduled'
        ELSE 'draft'
    END;
    v_payload := jsonb_build_object(
        'correction', jsonb_build_object(
            'undo', true,
            'original_completion_event_id', completed_event.id),
        'exp', jsonb_build_object(
            'source_type', 'quest_completion_reversal',
            'source_id', v_correction_id,
            'reason', 'completion_reward_reversal',
            'amount', -original_credit.amount,
            'original_credit_entry_id', original_credit.id,
            'reversal_entry_id', v_reversal_id));
    INSERT INTO public.quest_events (
        id, quest_id, user_id, occurrence_id, event_type, actor_kind, actor_user_id,
        occurred_at, command_id, execution_cycle, related_event_id, payload_version, payload
    ) VALUES (
        v_correction_id, quest, actor, reopen_quest_occurrence_v2.occurrence_id,
        'completion_corrected', 'user', actor, v_now,
        reopen_quest_occurrence_v2.command_id, occurrence_row.execution_cycle,
        completed_event.id, 1, v_payload);
    receipt := exp_internal.append_quest_event(v_correction_id);
    IF receipt IS DISTINCT FROM v_reversal_id THEN
        RAISE EXCEPTION 'EXP receipt integrity failure' USING ERRCODE = '23514';
    END IF;
    -- Required post-reversal progression step: the existing helper validates the
    -- reversal receipt and performs no recognition for reversal sources by design;
    -- milestones and unlocks are never revoked and current Level derives on read.
    PERFORM progression_internal.recognize_after_exp(v_reversal_id, origin);
    INSERT INTO public.quest_events (
        id, quest_id, user_id, occurrence_id, event_type, actor_kind, actor_user_id,
        occurred_at, command_id, execution_cycle, related_event_id, payload_version, payload
    ) VALUES (
        v_reopened_id, quest, actor, reopen_quest_occurrence_v2.occurrence_id,
        'reopened', 'user', actor, v_now,
        reopen_quest_occurrence_v2.command_id, occurrence_row.execution_cycle + 1,
        v_correction_id, 1,
        jsonb_build_object(
            'prior_status', occurrence_row.status,
            'new_status', v_target,
            'prior_execution_cycle', occurrence_row.execution_cycle,
            'new_execution_cycle', occurrence_row.execution_cycle + 1));
    UPDATE public.quest_occurrences o
        SET status = v_target,
            execution_cycle = occurrence_row.execution_cycle + 1,
            recorded_completed_at = NULL,
            reported_completed_at = NULL,
            failure_reason = NULL,
            updated_at = v_now
        WHERE o.id = reopen_quest_occurrence_v2.occurrence_id AND o.user_id = actor;
    RETURN (reopen_quest_occurrence_v2.command_id,
        reopen_quest_occurrence_v2.occurrence_id, quest, occurrence_row.execution_cycle,
        v_correction_id, v_reopened_id, v_reversal_id, -original_credit.amount,
        original_credit.id, false);
END;
$function$;

CREATE TYPE public.quest_completion_resolution_v1 AS (
    version integer,
    outcome text,
    command_id uuid,
    occurrence_id uuid,
    expected_execution_cycle integer,
    current_execution_cycle integer,
    current_status text,
    receipt public.quest_completion_receipt,
    canonical_receipt public.quest_completion_receipt,
    correction_event_id uuid,
    reopened_event_id uuid,
    reversal_entry_id uuid
);

CREATE FUNCTION public.get_quest_completion_resolution_v1(
    command_id uuid, occurrence_id uuid, expected_execution_cycle integer
) RETURNS public.quest_completion_resolution_v1
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid := system_internal.request_user_id();
    quest uuid;
    o public.quest_occurrences;
    event_id uuid;
    canonical public.quest_events;
    correction public.quest_events;
    reopened public.quest_events;
    reversal public.exp_ledger;
    result public.quest_completion_resolution_v1;
BEGIN
    IF actor IS NULL OR command_id IS NULL OR occurrence_id IS NULL OR expected_execution_cycle IS NULL THEN
        RAISE EXCEPTION 'Authentication and required command inputs are mandatory' USING ERRCODE = '42501';
    END IF;
    IF expected_execution_cycle < 1 THEN
        RAISE EXCEPTION 'Expected execution cycle is out of range' USING ERRCODE = '23514';
    END IF;
    PERFORM progression_internal.lock_owner(actor);
    SELECT x.quest_id INTO quest FROM public.quest_occurrences x
        WHERE x.id = occurrence_id AND x.user_id = actor;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.quests q WHERE q.id = quest AND q.user_id = actor FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest definition' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO o FROM public.quest_occurrences x
        WHERE x.id = occurrence_id AND x.user_id = actor FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;
    result.version := 1;
    result.command_id := command_id;
    result.occurrence_id := occurrence_id;
    result.expected_execution_cycle := expected_execution_cycle;
    result.current_execution_cycle := o.execution_cycle;
    result.current_status := o.status;
    BEGIN
        event_id := system_internal.completion_binding(command_id, occurrence_id, expected_execution_cycle);
    EXCEPTION WHEN unique_violation THEN
        IF SQLERRM <> 'Conflicting quest command reuse' THEN RAISE; END IF;
        result.outcome := 'conflict';
        RETURN result;
    END;
    IF event_id IS NOT NULL THEN
        result.receipt := system_internal.completion_receipt(event_id, command_id);
        result.outcome := 'recorded';
        RETURN result;
    END IF;
    IF expected_execution_cycle > o.execution_cycle THEN
        RAISE EXCEPTION 'Expected execution cycle is ahead of current occurrence' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO canonical FROM public.quest_events e
        WHERE e.user_id = actor AND e.occurrence_id = get_quest_completion_resolution_v1.occurrence_id
            AND e.execution_cycle = expected_execution_cycle AND e.event_type = 'completed';
    IF expected_execution_cycle = o.execution_cycle THEN
        IF o.status = 'completed' THEN
            result.canonical_receipt := system_internal.completion_receipt(canonical.id, canonical.command_id);
            IF EXISTS (SELECT 1 FROM public.exp_ledger l WHERE l.user_id = actor
                AND l.reverses_entry_id = (result.canonical_receipt).exp_entry_id) THEN
                RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
            END IF;
        ELSIF canonical.id IS NOT NULL THEN
            RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
        END IF;
        result.outcome := 'unrecorded_current';
        RETURN result;
    END IF;
    -- Legacy absence is not success. Validate the old cycle's retained undo chain.
    result.canonical_receipt := system_internal.completion_receipt(canonical.id, canonical.command_id);
    SELECT * INTO reversal FROM public.exp_ledger l
        WHERE l.user_id = actor AND l.reverses_entry_id = (result.canonical_receipt).exp_entry_id;
    SELECT * INTO correction FROM public.quest_events e
        WHERE e.user_id = actor AND e.id = reversal.source_id;
    SELECT * INTO reopened FROM public.quest_events e
        WHERE e.user_id = actor AND e.occurrence_id = get_quest_completion_resolution_v1.occurrence_id
            AND e.event_type = 'reopened' AND e.execution_cycle = expected_execution_cycle + 1
            AND e.related_event_id = correction.id;
    IF reversal.id IS NULL OR correction.id IS NULL OR reopened.id IS NULL
        OR reversal.source_type <> 'quest_completion_reversal' OR reversal.reason <> 'completion_reward_reversal'
        OR reversal.amount::numeric IS DISTINCT FROM -(result.canonical_receipt).exp_amount::numeric
        OR correction.event_type <> 'completion_corrected' OR correction.payload_version <> 1
        OR correction.quest_id <> quest OR correction.occurrence_id IS DISTINCT FROM occurrence_id
        OR correction.execution_cycle IS DISTINCT FROM expected_execution_cycle
        OR correction.related_event_id IS DISTINCT FROM canonical.id
        OR correction.payload #> '{correction,undo}' IS DISTINCT FROM 'true'::jsonb
        OR exp_internal.uuid_value(correction.payload #> '{correction,original_completion_event_id}') IS DISTINCT FROM canonical.id
        OR correction.payload #> '{exp,source_type}' IS DISTINCT FROM '"quest_completion_reversal"'::jsonb
        OR correction.payload #> '{exp,reason}' IS DISTINCT FROM '"completion_reward_reversal"'::jsonb
        OR exp_internal.uuid_value(correction.payload #> '{exp,source_id}') IS DISTINCT FROM correction.id
        OR exp_internal.uuid_value(correction.payload #> '{exp,reversal_entry_id}') IS DISTINCT FROM reversal.id
        OR exp_internal.uuid_value(correction.payload #> '{exp,original_credit_entry_id}') IS DISTINCT FROM reversal.reverses_entry_id
        OR exp_internal.integer_value(correction.payload #> '{exp,amount}') IS DISTINCT FROM reversal.amount::numeric
        OR reopened.quest_id <> quest OR reopened.command_id <> correction.command_id OR reopened.payload_version <> 1
        OR reopened.payload ->> 'prior_status' IS DISTINCT FROM 'completed'
        OR (reopened.payload ->> 'new_status') IS NULL OR (reopened.payload ->> 'new_status') NOT IN ('draft', 'scheduled')
        OR exp_internal.integer_value(reopened.payload -> 'prior_execution_cycle') IS DISTINCT FROM expected_execution_cycle::numeric
        OR exp_internal.integer_value(reopened.payload -> 'new_execution_cycle') IS DISTINCT FROM expected_execution_cycle::numeric + 1
        OR (SELECT count(*) FROM public.quest_events e WHERE e.user_id = actor
            AND e.occurrence_id = get_quest_completion_resolution_v1.occurrence_id
            AND e.event_type = 'reopened' AND e.execution_cycle = expected_execution_cycle + 1) <> 1
        OR EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases a
            WHERE a.user_id = actor AND a.command_id = correction.command_id)
        OR (SELECT count(*) FROM public.quest_events e WHERE e.user_id = actor AND e.command_id = correction.command_id) <> 2 THEN
        RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
    END IF;
    result.outcome := 'unrecorded_superseded';
    result.correction_event_id := correction.id;
    result.reopened_event_id := reopened.id;
    result.reversal_entry_id := reversal.id;
    RETURN result;
EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'Completion history is inconsistent' USING ERRCODE = '23514';
END;
$function$;

GRANT CREATE ON SCHEMA public TO quest_command_owner;
ALTER FUNCTION public.get_quest_completion_resolution_v1(uuid, uuid, integer) OWNER TO quest_command_owner;
REVOKE CREATE ON SCHEMA public FROM quest_command_owner;
REVOKE ALL ON FUNCTION public.get_quest_completion_resolution_v1(uuid, uuid, integer)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
        progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.get_quest_completion_resolution_v1(uuid, uuid, integer) TO authenticated;

COMMENT ON TABLE system_internal.quest_completion_aliases IS
    'Private immutable alternate completion identities. No Quest/EXP effects; no inferred legacy backfill.';
COMMENT ON FUNCTION public.get_quest_completion_resolution_v1(uuid, uuid, integer) IS
    'Owner-authenticated locked observation only: recorded, unrecorded_current, unrecorded_superseded or conflict. Unrecorded never asserts earlier success; no history writes.';
REVOKE quest_command_owner FROM CURRENT_USER;
COMMIT;
