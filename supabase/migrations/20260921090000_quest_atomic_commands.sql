-- Quest atomic command integration. Authority: quest-command-api-v1.md,
-- quest-event-payload-v1.md, quest-database-schema.md and operator-authorization-v1.md.
-- Reuses system_internal.request_user_id, exp_internal.append_quest_event and the
-- progression_internal lock/recognition helpers; no new EXP or progression semantics.
BEGIN;

CREATE TYPE public.quest_completion_receipt AS (
    command_id            uuid,
    occurrence_id         uuid,
    quest_id              uuid,
    execution_cycle       integer,
    completed_event_id    uuid,
    exp_entry_id          uuid,
    exp_amount            bigint,
    reported_completed_at timestamptz,
    recorded_completed_at timestamptz,
    replay                boolean
);

CREATE TYPE public.quest_reopen_receipt AS (
    command_id               uuid,
    occurrence_id            uuid,
    quest_id                 uuid,
    undone_cycle             integer,
    correction_event_id      uuid,
    reopened_event_id        uuid,
    reversal_entry_id        uuid,
    reversed_amount          bigint,
    original_credit_entry_id uuid,
    replay                   boolean
);

CREATE FUNCTION public.complete_quest_occurrence(
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
    prior public.quest_events;
    prior_entry uuid;
    v_event_id uuid;
    v_entry_id uuid;
    receipt uuid;
    v_payload jsonb;
    replayed boolean := false;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL OR occurrence_id IS NULL
        OR expected_execution_cycle IS NULL THEN
        RAISE EXCEPTION 'Authentication and required command inputs are mandatory'
            USING ERRCODE = '42501';
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

    -- Resolve accepted effects before minting any new identity (payload V1 section 6).
    SELECT * INTO prior FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.command_id = complete_quest_occurrence.command_id
            AND e.occurrence_id = complete_quest_occurrence.occurrence_id
            AND e.event_type = 'completed';
    IF FOUND THEN
        IF prior.execution_cycle IS DISTINCT FROM expected_execution_cycle THEN
            RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
        END IF;
        prior_entry := exp_internal.uuid_value(prior.payload #> '{exp,ledger_entry_id}');
        IF NOT EXISTS (
            SELECT 1 FROM public.exp_ledger c
            WHERE c.id = prior_entry AND c.user_id = actor
                AND c.source_type = 'quest_completion' AND c.source_id = prior.id
                AND c.reason = 'completion_reward'
        ) THEN
            RAISE EXCEPTION 'Accepted credit receipt is missing' USING ERRCODE = '23514';
        END IF;
        replayed := true;
    ELSIF EXISTS (
        SELECT 1 FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.command_id = complete_quest_occurrence.command_id
    ) THEN
        RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
    ELSIF occurrence_row.status = 'completed'
        AND occurrence_row.execution_cycle = expected_execution_cycle THEN
        SELECT * INTO prior FROM public.quest_events e
            WHERE e.user_id = actor
                AND e.occurrence_id = complete_quest_occurrence.occurrence_id
                AND e.event_type = 'completed'
                AND e.execution_cycle = expected_execution_cycle;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Accepted completion is missing' USING ERRCODE = '23514';
        END IF;
        prior_entry := exp_internal.uuid_value(prior.payload #> '{exp,ledger_entry_id}');
        IF NOT EXISTS (
            SELECT 1 FROM public.exp_ledger c
            WHERE c.id = prior_entry AND c.user_id = actor
                AND c.source_type = 'quest_completion' AND c.source_id = prior.id
                AND c.reason = 'completion_reward'
        ) THEN
            RAISE EXCEPTION 'Accepted credit receipt is missing' USING ERRCODE = '23514';
        END IF;
        replayed := true;
    ELSE
        IF occurrence_row.status NOT IN ('draft', 'scheduled', 'active')
            OR occurrence_row.reward_exp_snapshot IS NULL THEN
            RAISE EXCEPTION 'Occurrence is not completable' USING ERRCODE = '23514';
        END IF;
        IF occurrence_row.execution_cycle IS DISTINCT FROM expected_execution_cycle THEN
            RAISE EXCEPTION 'Stale quest completion cycle' USING ERRCODE = '23514';
        END IF;
    END IF;

    IF replayed THEN
        RETURN (complete_quest_occurrence.command_id,
            complete_quest_occurrence.occurrence_id, quest,
            prior.execution_cycle, prior.id, prior_entry,
            exp_internal.integer_value(prior.payload #> '{exp,amount}')::bigint,
            (prior.payload #>> '{reported_completed_at}')::timestamptz,
            prior.occurred_at, true);
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

CREATE FUNCTION public.reopen_quest_occurrence(
    command_id uuid,
    occurrence_id uuid,
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
    IF actor IS NULL OR command_id IS NULL OR occurrence_id IS NULL THEN
        RAISE EXCEPTION 'Authentication and required command inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    PERFORM progression_internal.lock_owner(actor);
    SELECT o.quest_id INTO quest FROM public.quest_occurrences o
        WHERE o.id = reopen_quest_occurrence.occurrence_id AND o.user_id = actor;
    IF quest IS NULL THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.quests q
        WHERE q.id = quest AND q.user_id = actor FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest definition' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO occurrence_row FROM public.quest_occurrences o
        WHERE o.id = reopen_quest_occurrence.occurrence_id AND o.user_id = actor
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown quest occurrence' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO prior FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.command_id = reopen_quest_occurrence.command_id
            AND e.occurrence_id = reopen_quest_occurrence.occurrence_id
            AND e.event_type = 'completion_corrected';
    IF FOUND THEN
        SELECT * INTO prior_reopened FROM public.quest_events e
            WHERE e.user_id = actor
                AND e.command_id = reopen_quest_occurrence.command_id
                AND e.occurrence_id = reopen_quest_occurrence.occurrence_id
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
        RETURN (reopen_quest_occurrence.command_id,
            reopen_quest_occurrence.occurrence_id, quest,
            prior.execution_cycle, prior.id, prior_reopened.id, prior_reversal,
            exp_internal.integer_value(prior.payload #> '{exp,amount}')::bigint,
            exp_internal.uuid_value(prior.payload #> '{exp,original_credit_entry_id}'),
            true);
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.command_id = reopen_quest_occurrence.command_id
    ) THEN
        RAISE EXCEPTION 'Conflicting quest command reuse' USING ERRCODE = '23505';
    END IF;
    IF occurrence_row.status IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'Occurrence has no accepted completion to undo'
            USING ERRCODE = '23514';
    END IF;
    SELECT * INTO completed_event FROM public.quest_events e
        WHERE e.user_id = actor
            AND e.occurrence_id = reopen_quest_occurrence.occurrence_id
            AND e.event_type = 'completed'
            AND e.execution_cycle = occurrence_row.execution_cycle;
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
        v_correction_id, quest, actor, reopen_quest_occurrence.occurrence_id,
        'completion_corrected', 'user', actor, v_now,
        reopen_quest_occurrence.command_id, occurrence_row.execution_cycle,
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
        v_reopened_id, quest, actor, reopen_quest_occurrence.occurrence_id,
        'reopened', 'user', actor, v_now,
        reopen_quest_occurrence.command_id, occurrence_row.execution_cycle + 1,
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
        WHERE o.id = reopen_quest_occurrence.occurrence_id AND o.user_id = actor;
    RETURN (reopen_quest_occurrence.command_id,
        reopen_quest_occurrence.occurrence_id, quest, occurrence_row.execution_cycle,
        v_correction_id, v_reopened_id, v_reversal_id, -original_credit.amount,
        original_credit.id, false);
END;
$function$;

-- Command routines are owned by the frozen quest executor role; the temporary
-- migration membership is revoked so no capability is retained by the migration role.
GRANT quest_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO quest_command_owner;
ALTER FUNCTION public.complete_quest_occurrence(uuid, uuid, integer, timestamptz, text)
    OWNER TO quest_command_owner;
ALTER FUNCTION public.reopen_quest_occurrence(uuid, uuid, text)
    OWNER TO quest_command_owner;
REVOKE CREATE ON SCHEMA public FROM quest_command_owner;

REVOKE ALL ON FUNCTION public.complete_quest_occurrence(uuid, uuid, integer, timestamptz, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.complete_quest_occurrence(uuid, uuid, integer, timestamptz, text)
    TO authenticated;
REVOKE ALL ON FUNCTION public.reopen_quest_occurrence(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.reopen_quest_occurrence(uuid, uuid, text)
    TO authenticated;

COMMENT ON TYPE public.quest_completion_receipt IS
    'Immutable accepted completion facts: event, credit, amounts, times and cycle; replay marks resolved retries.';
COMMENT ON TYPE public.quest_reopen_receipt IS
    'Immutable accepted undo facts: correction, reopened event, reversal identity, signed amount and original credit.';
COMMENT ON FUNCTION public.complete_quest_occurrence(uuid, uuid, integer, timestamptz, text) IS
    'Atomic quest completion: completed event V1, EXP credit, mandatory Level recognition and projection in one transaction; idempotent on accepted receipts.';
COMMENT ON FUNCTION public.reopen_quest_occurrence(uuid, uuid, text) IS
    'Atomic completion undo: correction V1 envelope, exact EXP reversal, reopened event and incremented cycle in one transaction; history is preserved.';

REVOKE quest_command_owner FROM CURRENT_USER;

COMMIT;
