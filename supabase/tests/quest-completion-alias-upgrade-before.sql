\set ON_ERROR_STOP on
-- DISPOSABLE ONLY: intentionally committed migration-nine fixtures, consumed by
-- upgrade-after. Never execute against a developer or shared database.
BEGIN;
CREATE SCHEMA completion_alias_upgrade_test;
CREATE TABLE completion_alias_upgrade_test.snapshot (data jsonb NOT NULL);
INSERT INTO auth.users (id) VALUES
    ('00000000-0000-4000-8000-00000000a001'),
    ('00000000-0000-4000-8000-00000000a002');
INSERT INTO system_internal.operator_grants (user_id, capability)
VALUES ('00000000-0000-4000-8000-00000000a002', 'level_policy_assign');
DO $test$
DECLARE
    policy uuid;
    created public.quest_creation_receipt;
    a public.quest_completion_receipt;
    b public.quest_completion_receipt;
    undo public.quest_reopen_receipt;
BEGIN
    SELECT id INTO STRICT policy FROM public.level_policies
        WHERE policy_key = 'level_policy_v1' AND status = 'published';
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.assign_level_policy('00000000-0000-4000-8000-00000000a001', policy, gen_random_uuid(), 'internal');
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a001', true);
    created := public.create_one_off_quest(gen_random_uuid(), '{"title":"Legacy replay","default_reward_exp":37,"scheduled_at":"2026-09-26T08:00:00Z"}', 'web_ui');
    a := public.complete_quest_occurrence(gen_random_uuid(), created.occurrence_id, 1, NULL, 'web_ui');
    b := public.complete_quest_occurrence(gen_random_uuid(), created.occurrence_id, 1, NULL, 'web_ui');
    IF b.command_id = a.command_id OR b.completed_event_id <> a.completed_event_id OR NOT b.replay THEN
        RAISE EXCEPTION 'Expected historical alternate-ID receipt';
    END IF;
    undo := public.reopen_quest_occurrence_v2(gen_random_uuid(), created.occurrence_id, 1, 'web_ui');
    RESET ROLE;
    INSERT INTO completion_alias_upgrade_test.snapshot SELECT jsonb_build_object(
        'a', to_jsonb(a), 'b', to_jsonb(b), 'undo', to_jsonb(undo),
        'events', (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.quest_events e WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
        'ledger', (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.exp_ledger l WHERE user_id = '00000000-0000-4000-8000-00000000a001'));
END;
$test$;
COMMIT;
