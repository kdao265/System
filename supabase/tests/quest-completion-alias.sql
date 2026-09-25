\set ON_ERROR_STOP on
-- Disposable database only. All fixtures and grants roll back.
BEGIN;
CREATE FUNCTION pg_temp.reject(statement text, state text, message text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = state AND (message IS NULL OR SQLERRM = message) THEN RETURN; END IF;
        RAISE EXCEPTION 'Unexpected error: % %', SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected rejection: %', statement;
END;
$$;
INSERT INTO auth.users (id) VALUES
    ('00000000-0000-4000-8000-00000000b001'),
    ('00000000-0000-4000-8000-00000000b002');
INSERT INTO system_internal.operator_grants (user_id, capability)
VALUES ('00000000-0000-4000-8000-00000000b002', 'level_policy_assign');
GRANT quest_command_owner TO CURRENT_USER;
DO $test$
DECLARE
    actor uuid := '00000000-0000-4000-8000-00000000b001';
    other_actor uuid := '00000000-0000-4000-8000-00000000b002';
    policy uuid;
    a public.quest_completion_receipt;
    b public.quest_completion_receipt;
    replay public.quest_completion_receipt;
    fresh public.quest_completion_receipt;
    undo public.quest_reopen_receipt;
    created public.quest_creation_receipt;
    other public.quest_creation_receipt;
    resolved public.quest_completion_resolution_v1;
    b_command uuid := gen_random_uuid();
    legacy_command uuid := gen_random_uuid();
    bad_quest uuid := gen_random_uuid();
    bad_occurrence uuid := gen_random_uuid();
    before_effects jsonb;
    after_effects jsonb;
    request jsonb := '{"title":"Alias behavior","default_reward_exp":1000,"scheduled_at":"2026-09-26T08:00:00Z"}';
BEGIN
    SELECT id INTO STRICT policy FROM public.level_policies
        WHERE policy_key = 'level_policy_v1' AND status = 'published';
    PERFORM set_config('request.jwt.claim.sub', other_actor::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.assign_level_policy(actor, policy, gen_random_uuid(), 'internal');
    PERFORM public.assign_level_policy(other_actor, policy, gen_random_uuid(), 'internal');
    PERFORM set_config('request.jwt.claim.sub', actor::text, true);
    created := public.create_one_off_quest(gen_random_uuid(), request, 'web_ui');
    other := public.create_one_off_quest(gen_random_uuid(), request, 'web_ui');
    resolved := public.get_quest_completion_resolution_v1(b_command, created.occurrence_id, 1);
    IF resolved.version <> 1 OR resolved.outcome <> 'unrecorded_current'
        OR resolved.receipt IS DISTINCT FROM NULL OR resolved.canonical_receipt IS DISTINCT FROM NULL THEN
        RAISE EXCEPTION 'Unrecorded unfinished request misclassified';
    END IF;
    a := public.complete_quest_occurrence(gen_random_uuid(), created.occurrence_id, 1, '2026-09-20T10:00:00Z', 'web_ui');
    RESET ROLE;
    SELECT jsonb_build_object(
        'events', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.quest_events x WHERE user_id = actor),
        'ledger', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.exp_ledger x WHERE user_id = actor),
        'occurrences', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.quest_occurrences x WHERE user_id = actor),
        'milestones', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.level_milestones x WHERE user_id = actor),
        'unlocks', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.level_reward_unlocks x WHERE user_id = actor)
    ) INTO before_effects;
    SET LOCAL ROLE authenticated;
    resolved := public.get_quest_completion_resolution_v1(b_command, created.occurrence_id, 1);
    IF resolved.outcome <> 'unrecorded_current' OR resolved.receipt IS DISTINCT FROM NULL
        OR to_jsonb(resolved.canonical_receipt) IS DISTINCT FROM (to_jsonb(a) || '{"replay":true}'::jsonb) THEN
        RAISE EXCEPTION 'Unrecorded completed request fabricated a receipt';
    END IF;
    -- B receives an alternate receipt; simulate response loss by retrying later.
    b := public.complete_quest_occurrence(b_command, created.occurrence_id, 1, NULL, 'mobile');
    IF to_jsonb(b) IS DISTINCT FROM (to_jsonb(a) || jsonb_build_object('command_id', b_command, 'replay', true)) THEN
        RAISE EXCEPTION 'Alias did not preserve all canonical facts';
    END IF;
    replay := public.complete_quest_occurrence(b_command, created.occurrence_id, 1, now(), 'automation');
    IF replay IS DISTINCT FROM b THEN RAISE EXCEPTION 'Alias retry changed receipt'; END IF;
    resolved := public.get_quest_completion_resolution_v1(b_command, created.occurrence_id, 1);
    IF resolved.outcome <> 'recorded' OR resolved.receipt IS DISTINCT FROM b
        OR resolved.canonical_receipt IS DISTINCT FROM NULL OR resolved.correction_event_id IS NOT NULL THEN
        RAISE EXCEPTION 'Recorded resolution envelope mismatch';
    END IF;
    RESET ROLE;
    SELECT jsonb_build_object(
        'events', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.quest_events x WHERE user_id = actor),
        'ledger', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.exp_ledger x WHERE user_id = actor),
        'occurrences', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.quest_occurrences x WHERE user_id = actor),
        'milestones', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.level_milestones x WHERE user_id = actor),
        'unlocks', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.level_reward_unlocks x WHERE user_id = actor)
    ) INTO after_effects;
    IF before_effects IS DISTINCT FROM after_effects THEN RAISE EXCEPTION 'Alias or resolution produced domain effects'; END IF;
    IF (SELECT count(*) FROM system_internal.quest_completion_aliases WHERE user_id = actor) <> 1
        OR NOT EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases
            WHERE user_id = actor AND command_id = b_command AND completed_event_id = a.completed_event_id) THEN
        RAISE EXCEPTION 'Alias was not durably registered exactly once';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.reject(format('SELECT public.create_one_off_quest(%L, %L, %L)', b_command, request, 'web_ui'), '23505', 'Conflicting quest command reuse');
    PERFORM pg_temp.reject(format('SELECT public.reopen_quest_occurrence_v2(%L, %L, 1, %L)', b_command, created.occurrence_id, 'web_ui'), '23505', 'Conflicting quest command reuse');
    PERFORM pg_temp.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, NULL, %L)', b_command, other.occurrence_id, 'web_ui'), '23505', 'Conflicting quest command reuse');
    PERFORM pg_temp.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 2, NULL, %L)', b_command, created.occurrence_id, 'web_ui'), '23505', 'Conflicting quest command reuse');
    PERFORM pg_temp.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, NULL, %L)', created.command_id, created.occurrence_id, 'web_ui'), '23505', 'Conflicting quest command reuse');
    resolved := public.get_quest_completion_resolution_v1(b_command, other.occurrence_id, 1);
    IF resolved.outcome <> 'conflict' OR resolved.receipt IS DISTINCT FROM NULL OR resolved.canonical_receipt IS DISTINCT FROM NULL THEN
        RAISE EXCEPTION 'Conflict leaked an unrelated receipt';
    END IF;
    undo := public.reopen_quest_occurrence_v2(gen_random_uuid(), created.occurrence_id, 1, 'web_ui');
    replay := public.complete_quest_occurrence(b_command, created.occurrence_id, 1, NULL, 'web_ui');
    IF replay IS DISTINCT FROM b THEN RAISE EXCEPTION 'Lost response retry failed after reopen'; END IF;
    PERFORM pg_temp.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, NULL, %L)', undo.command_id, created.occurrence_id, 'web_ui'), '23505', 'Conflicting quest command reuse');
    PERFORM pg_temp.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, NULL, %L)', legacy_command, created.occurrence_id, 'web_ui'), '23514', 'Stale quest completion cycle');
    resolved := public.get_quest_completion_resolution_v1(legacy_command, created.occurrence_id, 1);
    IF resolved.outcome <> 'unrecorded_superseded' OR resolved.receipt IS DISTINCT FROM NULL
        OR (resolved.canonical_receipt).command_id <> a.command_id
        OR resolved.reversal_entry_id <> undo.reversal_entry_id
        OR resolved.correction_event_id <> undo.correction_event_id OR resolved.reopened_event_id <> undo.reopened_event_id THEN
        RAISE EXCEPTION 'Unrecorded superseded reconciliation mismatch';
    END IF;
    fresh := public.complete_quest_occurrence(gen_random_uuid(), created.occurrence_id, 2, NULL, 'web_ui');
    replay := public.complete_quest_occurrence(b_command, created.occurrence_id, 1, NULL, 'web_ui');
    IF replay IS DISTINCT FROM b OR fresh.completed_event_id = b.completed_event_id THEN RAISE EXCEPTION 'Historical alias drifted after recompletion'; END IF;
    resolved := public.get_quest_completion_resolution_v1(b_command, created.occurrence_id, 1);
    IF resolved.outcome <> 'recorded' OR resolved.receipt IS DISTINCT FROM b OR resolved.current_execution_cycle <> 2 OR resolved.current_status <> 'completed' THEN
        RAISE EXCEPTION 'Recorded history was confused with current state';
    END IF;
    PERFORM pg_temp.reject(format('SELECT public.get_quest_completion_resolution_v1(%L, %L, 3)', legacy_command, created.occurrence_id), '23514', 'Expected execution cycle is ahead of current occurrence');
    PERFORM pg_temp.reject(format('SELECT public.get_quest_completion_resolution_v1(%L, %L, 0)', legacy_command, created.occurrence_id), '23514', 'Expected execution cycle is out of range');
    PERFORM pg_temp.reject(format('SELECT public.get_quest_completion_resolution_v1(NULL, %L, 1)', created.occurrence_id), '42501', 'Authentication and required command inputs are mandatory');
    -- Private storage/helpers cannot be used directly, even for one's own alias.
    PERFORM pg_temp.reject('SELECT * FROM system_internal.quest_completion_aliases', '42501');
    PERFORM pg_temp.reject(format('SELECT system_internal.completion_receipt(%L, %L)', a.completed_event_id, b_command), '42501');
    PERFORM set_config('request.jwt.claim.sub', other_actor::text, true);
    PERFORM pg_temp.reject(format('SELECT public.get_quest_completion_resolution_v1(%L, %L, 1)', b_command, created.occurrence_id), '23514', 'Unknown quest occurrence');
    PERFORM pg_temp.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, NULL, %L)', b_command, created.occurrence_id, 'web_ui'), '23514', 'Unknown quest occurrence');
    -- Command namespace is per-owner, not global.
    other := public.create_one_off_quest(b_command, request, 'web_ui');
    RESET ROLE;
    SET LOCAL ROLE quest_command_owner;
    IF EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases) THEN RAISE EXCEPTION 'Alias RLS leaked another owner'; END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', actor::text, true);
    PERFORM pg_temp.reject(format('UPDATE system_internal.quest_completion_aliases SET quest_id = quest_id WHERE command_id = %L', b_command), '55000', 'Completion aliases are immutable');
    PERFORM pg_temp.reject(format('DELETE FROM system_internal.quest_completion_aliases WHERE command_id = %L', b_command), '55000', 'Completion aliases are immutable');
    PERFORM pg_temp.reject('TRUNCATE system_internal.quest_completion_aliases', '55000', 'Completion aliases are immutable');
    -- Abort after registration: neither alias nor effects may survive the subtransaction.
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM public.complete_quest_occurrence(legacy_command, created.occurrence_id, 2, NULL, 'web_ui');
        RAISE EXCEPTION 'test rollback' USING ERRCODE = 'P0002';
    EXCEPTION WHEN no_data_found THEN NULL;
    END;
    IF EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases WHERE command_id = legacy_command) THEN RAISE EXCEPTION 'Aborted alias persisted'; END IF;
    IF (SELECT count(*) FROM public.quest_events WHERE occurrence_id = created.occurrence_id AND event_type = 'completed') <> 2
        OR (SELECT count(*) FROM public.exp_ledger WHERE user_id = actor AND source_type = 'quest_completion') <> 2
        OR (SELECT sum(amount) FROM public.exp_ledger WHERE user_id = actor) <> 1000 THEN
        RAISE EXCEPTION 'Canonical event/credit/EXP totals are incorrect';
    END IF;
    -- Malformed retained projection cannot become an alias or reconciliation.
    INSERT INTO public.quests(id, user_id, title, importance, default_reward_exp)
    VALUES (bad_quest, actor, 'Inconsistent history', 'side', 0);
    INSERT INTO public.quest_occurrences(id, quest_id, user_id, status, execution_cycle, reward_exp_snapshot, recorded_completed_at)
    VALUES (bad_occurrence, bad_quest, actor, 'completed', 1, 0, now());
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.reject(format('SELECT public.complete_quest_occurrence(%L, %L, 1, NULL, %L)', legacy_command, bad_occurrence, 'web_ui'), '23514', 'Completion history is inconsistent');
    PERFORM pg_temp.reject(format('SELECT public.get_quest_completion_resolution_v1(%L, %L, 1)', legacy_command, bad_occurrence), '23514', 'Completion history is inconsistent');
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM pg_temp.reject(format('SELECT public.get_quest_completion_resolution_v1(%L, %L, 1)', b_command, created.occurrence_id), '42501', 'Authentication and required command inputs are mandatory');
    RESET ROLE;
    SET LOCAL ROLE anon;
    PERFORM pg_temp.reject(format('SELECT public.get_quest_completion_resolution_v1(%L, %L, 1)', b_command, created.occurrence_id), '42501');
    RESET ROLE;
    RAISE NOTICE 'PASS: durable alias, historical replay, exact errors, isolation, immutability, atomic rollback and fail-closed history';
END;
$test$;
ROLLBACK;
