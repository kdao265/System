-- Recurring Quest Archive/Delete V1: approved retain-exact-state-and-freeze contract.
-- Apply after owner activation and active projections. Historical migrations stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION system_internal.retire_recurring_quest_v1(
    p_command_id uuid, p_quest_id uuid, p_operation text, p_origin text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    q public.quests;
    prior public.quest_events;
    event_count bigint;
    v_event uuid;
    v_now timestamptz;
    v_archived timestamptz;
    v_deleted timestamptz;
    v_changed boolean;
    v_kind text;
    v_payload jsonb;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL OR p_command_id IS NULL OR p_quest_id IS NULL OR p_origin IS NULL THEN
        RAISE EXCEPTION 'Authentication and required retirement inputs are mandatory' USING ERRCODE = '42501';
    END IF;
    IF p_operation IS NULL OR p_operation NOT IN ('archive', 'restore', 'delete') THEN
        RAISE EXCEPTION 'Invalid recurring retirement operation' USING ERRCODE = '22023';
    END IF;
    PERFORM progression_internal.require_origin(p_origin);
    PERFORM progression_internal.lock_owner(actor);
    PERFORM system_internal.reject_completion_alias(p_command_id);
    SELECT * INTO q FROM public.quests WHERE id = p_quest_id AND user_id = actor FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quest subject not found' USING ERRCODE = 'P0002';
    END IF;
    IF q.recurrence_mode NOT IN ('daily', 'weekly', 'monthly') OR NOT EXISTS (
        SELECT 1 FROM public.quest_recurrence_rules r WHERE r.quest_id = q.id AND r.user_id = actor
    ) THEN
        RAISE EXCEPTION 'Recurring retirement requires a recurring Quest and rule' USING ERRCODE = '23514';
    END IF;
    v_kind := CASE WHEN p_operation = 'delete' THEN 'deleted' ELSE 'archived' END;
    SELECT count(*) INTO event_count FROM public.quest_events e
        WHERE e.user_id = actor AND e.command_id = p_command_id;
    IF event_count > 0 THEN
        SELECT * INTO prior FROM public.quest_events e
            WHERE e.user_id = actor AND e.command_id = p_command_id
                AND e.quest_id = q.id AND e.occurrence_id IS NULL AND e.event_type = v_kind;
        IF event_count <> 1 OR NOT FOUND OR prior.actor_kind IS DISTINCT FROM 'user'
            OR prior.actor_user_id IS DISTINCT FROM actor OR prior.execution_cycle IS NOT NULL
            OR prior.payload_version IS DISTINCT FROM 1
            OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(prior.payload) AS keys(k)) IS DISTINCT FROM
                ARRAY['archived_at','changed','command_kind','deleted_at','operation','origin']::text[]
            OR prior.payload ->> 'command_kind' IS DISTINCT FROM 'recurring_retirement_v1'
            OR prior.payload ->> 'operation' IS DISTINCT FROM p_operation
            OR prior.payload ->> 'origin' IS DISTINCT FROM p_origin
            OR jsonb_typeof(prior.payload -> 'changed') IS DISTINCT FROM 'boolean'
            OR jsonb_typeof(prior.payload -> 'archived_at') IS DISTINCT FROM
                (CASE WHEN p_operation = 'restore' THEN 'null' ELSE 'string' END)
            OR jsonb_typeof(prior.payload -> 'deleted_at') IS DISTINCT FROM
                (CASE WHEN p_operation = 'delete' THEN 'string' ELSE 'null' END) THEN
            RAISE EXCEPTION 'Conflicting recurring retirement command reuse' USING ERRCODE = '23505';
        END IF;
        -- Return historical state: lost archive/restore responses survive later deletion.
        RETURN jsonb_build_object('version',1,'command_id',p_command_id,'quest_id',q.id,
            'operation',p_operation,'archived_at',prior.payload -> 'archived_at',
            'deleted_at',prior.payload -> 'deleted_at','event_id',prior.id,
            'changed',prior.payload -> 'changed','replay',true);
    END IF;
    IF q.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Recurring Quest is permanently deleted' USING ERRCODE = '23514';
    END IF;
    IF p_operation = 'delete' AND q.archived_at IS NULL THEN
        RAISE EXCEPTION 'Archive recurring Quest before permanent deletion' USING ERRCODE = '23514';
    END IF;
    v_now := clock_timestamp();
    v_archived := CASE WHEN p_operation = 'restore' THEN NULL ELSE coalesce(q.archived_at,v_now) END;
    v_deleted := CASE WHEN p_operation = 'delete' THEN v_now ELSE NULL END;
    v_changed := ROW(q.archived_at,q.deleted_at) IS DISTINCT FROM ROW(v_archived,v_deleted);
    v_event := gen_random_uuid();
    v_payload := jsonb_build_object('command_kind','recurring_retirement_v1','origin',p_origin,
        'operation',p_operation,'archived_at',v_archived,'deleted_at',v_deleted,'changed',v_changed);
    -- Record fresh no-op commands too, making accepted identities durable.
    -- The final event precedes the tombstone, in this same atomic transaction.
    INSERT INTO public.quest_events(id,quest_id,user_id,event_type,actor_kind,actor_user_id,
        occurred_at,command_id,payload_version,payload)
        VALUES(v_event,q.id,actor,v_kind,'user',actor,v_now,p_command_id,1,v_payload);
    IF v_changed THEN
        UPDATE public.quests SET archived_at = v_archived, deleted_at = v_deleted, updated_at = v_now
            WHERE id = q.id AND user_id = actor;
    END IF;
    RETURN jsonb_build_object('version',1,'command_id',p_command_id,'quest_id',q.id,
        'operation',p_operation,'archived_at',v_archived,'deleted_at',v_deleted,
        'event_id',v_event,'changed',v_changed,'replay',false);
END;
$function$;

CREATE FUNCTION public.set_recurring_quest_archived_v1(
    p_command_id uuid, p_quest_id uuid, p_archived boolean, p_origin text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    IF p_archived IS NULL THEN RAISE EXCEPTION 'Archive state required' USING ERRCODE = '22023'; END IF;
    RETURN system_internal.retire_recurring_quest_v1(p_command_id,p_quest_id,
        CASE WHEN p_archived THEN 'archive' ELSE 'restore' END,p_origin);
END;
$function$;

CREATE FUNCTION public.delete_recurring_quest_v1(p_command_id uuid, p_quest_id uuid, p_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    RETURN system_internal.retire_recurring_quest_v1(p_command_id,p_quest_id,'delete',p_origin);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_archived_recurring_quests_v1()
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
    last_slot_date date,
    archived_at timestamptz
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
                AND o.recurrence_rule_id IS NOT NULL),
        q.archived_at
        FROM public.quests AS q
        JOIN public.quest_recurrence_rules AS r
            ON r.quest_id = q.id AND r.user_id = q.user_id
        WHERE q.user_id = actor
            AND q.archived_at IS NOT NULL AND q.deleted_at IS NULL
            AND q.recurrence_mode IN ('daily', 'weekly', 'monthly')
        ORDER BY q.archived_at DESC, q.id;
END;
$function$;

-- Existing temporary migration grants must precede replacement, not just ownership transfer.
-- All borrowed privileges are revoked below before COMMIT; RLS and final ACLs stay intact.
GRANT quest_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO quest_command_owner;
SET LOCAL ROLE quest_command_owner;
GRANT EXECUTE ON FUNCTION public.set_quest_recurrence_pause(uuid,uuid,boolean,text),
    public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text),
    public.reopen_quest_occurrence_v2(uuid,uuid,integer,text) TO quest_command_owner;

CREATE OR REPLACE FUNCTION public.set_quest_recurrence_pause(
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

    -- Accepted historical receipts above remain valid after retirement.
    PERFORM system_internal.reject_completion_alias(command_id);
    IF EXISTS (SELECT 1 FROM public.quest_events e
        WHERE e.user_id = actor AND e.command_id = set_quest_recurrence_pause.command_id) THEN
        RAISE EXCEPTION 'Conflicting recurring Quest recurrence command reuse' USING ERRCODE = '23505';
    END IF;
    IF definition.deleted_at IS NOT NULL OR definition.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Retired recurring Quest cannot change pause state' USING ERRCODE = '23514';
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
    PERFORM system_private.require_owner();
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
    -- Resolve accepted identities first. A NEW alias is not an accepted retry.
    -- Preserve one-off behavior; recurring retirement freezes every existing slot.
    IF EXISTS (SELECT 1 FROM public.quests q WHERE q.id = quest AND q.user_id = actor
        AND q.recurrence_mode <> 'one_off'
        AND (q.archived_at IS NOT NULL OR q.deleted_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Retired recurring Quest occurrence is not actionable' USING ERRCODE = '23514';
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
    PERFORM system_private.require_owner();
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

    -- Resolve accepted identities first. A NEW alias is not an accepted retry.
    -- Preserve one-off behavior; recurring retirement freezes every existing slot.
    IF EXISTS (SELECT 1 FROM public.quests q WHERE q.id = quest AND q.user_id = actor
        AND q.recurrence_mode <> 'one_off'
        AND (q.archived_at IS NOT NULL OR q.deleted_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Retired recurring Quest occurrence is not actionable' USING ERRCODE = '23514';
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


-- No table, policy or ledger changes. Existing replaced function owners/ACLs stay intact.
REVOKE EXECUTE ON FUNCTION public.set_quest_recurrence_pause(uuid,uuid,boolean,text),
    public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text),
    public.reopen_quest_occurrence_v2(uuid,uuid,integer,text) FROM quest_command_owner;
RESET ROLE;
ALTER FUNCTION public.set_recurring_quest_archived_v1(uuid,uuid,boolean,text) OWNER TO quest_command_owner;
ALTER FUNCTION public.delete_recurring_quest_v1(uuid,uuid,text) OWNER TO quest_command_owner;
REVOKE CREATE ON SCHEMA public FROM quest_command_owner;
REVOKE ALL ON FUNCTION system_internal.retire_recurring_quest_v1(uuid,uuid,text,text)
    FROM PUBLIC,anon,authenticated,service_role,quest_command_owner,progression_command_owner,
        level_policy_assignment_owner,goal_command_owner,schedule_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.retire_recurring_quest_v1(uuid,uuid,text,text) TO quest_command_owner;
REVOKE ALL ON FUNCTION public.set_recurring_quest_archived_v1(uuid,uuid,boolean,text),
    public.delete_recurring_quest_v1(uuid,uuid,text),public.list_archived_recurring_quests_v1()
    FROM PUBLIC,anon,authenticated,service_role,quest_command_owner,progression_command_owner,
        level_policy_assignment_owner,goal_command_owner,schedule_command_owner;
GRANT EXECUTE ON FUNCTION public.set_recurring_quest_archived_v1(uuid,uuid,boolean,text),
    public.delete_recurring_quest_v1(uuid,uuid,text),public.list_archived_recurring_quests_v1() TO authenticated;
REVOKE quest_command_owner FROM CURRENT_USER;
NOTIFY pgrst, 'reload schema';
COMMIT;
