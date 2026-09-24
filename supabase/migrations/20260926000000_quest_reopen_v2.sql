-- Quest Reopen V2: cycle-specific completion undo.
-- Authority: docs/02-architecture/decisions.md (ADR quest reopen guard V2),
-- quest-command-api-v1.md (historical V1 contract) and its V2 appendix.
-- Additive only: no previously applied migration is modified. The historical
-- three-argument reopen_quest_occurrence is retained verbatim; only its
-- authenticated EXECUTE privilege is revoked (approved frozen-API permission
-- change). The V2 command adds a mandatory expected_execution_cycle guard so
-- a stale reopen request can never undo a newer completion.
-- Reuses system_internal.request_user_id, exp_internal.append_quest_event and
-- progression_internal lock/recognition helpers; no new EXP or progression
-- semantics, no new ledger source types, no receipt-shape change.
BEGIN;

CREATE FUNCTION public.reopen_quest_occurrence_v2(
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

-- Ownership transfer follows the established historical pattern exactly:
-- temporary membership on the frozen quest executor role, CREATE on the
-- schema for the transfer, then immediate revocation of both.
GRANT quest_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO quest_command_owner;
ALTER FUNCTION public.reopen_quest_occurrence_v2(uuid, uuid, integer, text)
    OWNER TO quest_command_owner;
REVOKE CREATE ON SCHEMA public FROM quest_command_owner;

-- V2: EXECUTE only for authenticated among application roles.
REVOKE ALL ON FUNCTION public.reopen_quest_occurrence_v2(uuid, uuid, integer, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.reopen_quest_occurrence_v2(uuid, uuid, integer, text)
    TO authenticated;

-- V1 permission change: the three-argument reopen accepts no expected cycle
-- and can undo a newer completion from a stale request. The historical
-- implementation and owner are unchanged; only the browser-facing EXECUTE
-- privilege is revoked. Revoking from authenticated also closes the
-- role-inheritance path: authenticated holds no membership that would reach
-- EXECUTE indirectly, which the catalog tests verify with
-- has_function_privilege rather than textual grant inspection.
REVOKE EXECUTE ON FUNCTION public.reopen_quest_occurrence(uuid, uuid, text)
    FROM authenticated;

COMMENT ON FUNCTION public.reopen_quest_occurrence_v2(uuid, uuid, integer, text) IS
    'Cycle-specific atomic completion undo (V2): replay-verified, expected-cycle-guarded correction V1 envelope, exact EXP reversal, reopened event and incremented cycle in one transaction; history is preserved.';
COMMENT ON FUNCTION public.reopen_quest_occurrence(uuid, uuid, text) IS
    'Historical V1 completion undo without a stale-cycle guard; retained for accepted-command history only. Browser EXECUTE revoked; use reopen_quest_occurrence_v2.';

REVOKE quest_command_owner FROM CURRENT_USER;

COMMIT;

