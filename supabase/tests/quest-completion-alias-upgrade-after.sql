\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
    saved jsonb;
    a public.quest_completion_receipt;
    result public.quest_completion_resolution_v1;
BEGIN
    SELECT data INTO STRICT saved FROM completion_alias_upgrade_test.snapshot;
    IF EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases WHERE user_id = '00000000-0000-4000-8000-00000000a001') THEN
        RAISE EXCEPTION 'Migration fabricated a legacy alias';
    END IF;
    IF saved -> 'events' IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.quest_events e WHERE user_id = '00000000-0000-4000-8000-00000000a001')
        OR saved -> 'ledger' IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.exp_ledger l WHERE user_id = '00000000-0000-4000-8000-00000000a001') THEN
        RAISE EXCEPTION 'Upgrade modified accepted history';
    END IF;
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a001', true);
    SET LOCAL ROLE authenticated;
    a := public.complete_quest_occurrence((saved #>> '{a,command_id}')::uuid,
        (saved #>> '{a,occurrence_id}')::uuid, 1, NULL, 'web_ui');
    IF to_jsonb(a) IS DISTINCT FROM (saved -> 'a' || '{"replay":true}'::jsonb) THEN
        RAISE EXCEPTION 'Historical canonical replay changed';
    END IF;
    result := public.get_quest_completion_resolution_v1((saved #>> '{b,command_id}')::uuid,
        (saved #>> '{b,occurrence_id}')::uuid, 1);
    IF result.outcome <> 'unrecorded_superseded' OR result.receipt IS DISTINCT FROM NULL
        OR to_jsonb(result.canonical_receipt) IS DISTINCT FROM to_jsonb(a)
        OR result.reversal_entry_id IS DISTINCT FROM (saved #>> '{undo,reversal_entry_id}')::uuid THEN
        RAISE EXCEPTION 'Legacy unrecorded request was not explicitly reconciled';
    END IF;
    BEGIN
        PERFORM public.complete_quest_occurrence((saved #>> '{b,command_id}')::uuid,
            (saved #>> '{b,occurrence_id}')::uuid, 1, NULL, 'web_ui');
        RAISE EXCEPTION 'Legacy completion unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '23514' THEN
        IF SQLERRM <> 'Stale quest completion cycle' THEN RAISE; END IF;
    END;
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM system_internal.quest_completion_aliases WHERE user_id = '00000000-0000-4000-8000-00000000a001') THEN
        RAISE EXCEPTION 'Resolution fabricated an alias';
    END IF;
    RAISE NOTICE 'PASS: migration-nine history preserved; legacy absence is not success';
END;
$test$;
ROLLBACK;
