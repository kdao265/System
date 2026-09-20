\set ON_ERROR_STOP on
-- Disposable LOCAL database only. Every fixture, role membership and grant rolls back.
BEGIN;
GRANT quest_command_owner TO CURRENT_USER;
CREATE SCHEMA exp_test;
GRANT USAGE ON SCHEMA exp_test TO authenticated, anon, quest_command_owner;

CREATE FUNCTION exp_test.assert_true(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
END;
$$;
CREATE FUNCTION exp_test.reject(statement text, states text[], label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = ANY(states) THEN RETURN; END IF;
        RAISE EXCEPTION 'Unexpected error for %: % %', label, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected rejection: %', label;
END;
$$;
CREATE FUNCTION exp_test.completion(reward integer, overrides jsonb DEFAULT '{}', version smallint DEFAULT 1, omit text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE q uuid := gen_random_uuid(); o uuid := gen_random_uuid(); e uuid := gen_random_uuid();
BEGIN
    INSERT INTO public.quests (id, user_id, title) VALUES (q, system_internal.request_user_id(), 'EXP test');
    INSERT INTO public.quest_occurrences (id, quest_id, user_id, reward_exp_snapshot)
        VALUES (o, q, system_internal.request_user_id(), reward);
    INSERT INTO public.quest_events (id, quest_id, user_id, occurrence_id, event_type,
        actor_kind, actor_user_id, command_id, execution_cycle, payload_version, payload)
        VALUES (e, q, system_internal.request_user_id(), o, 'completed', 'user', system_internal.request_user_id(), gen_random_uuid(), 1, version,
            jsonb_build_object('exp', (jsonb_build_object('source_type', 'quest_completion',
                'source_id', e, 'reason', 'completion_reward', 'amount', reward,
                'ledger_entry_id', gen_random_uuid()) || overrides) - omit, 'unrelated', 'ignored'));
    RETURN e;
END;
$$;
CREATE FUNCTION exp_test.correction(credit uuid, overrides jsonb DEFAULT '{}', corrections jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c public.exp_ledger; e public.quest_events; x uuid := gen_random_uuid();
BEGIN
    SELECT * INTO STRICT c FROM public.exp_ledger WHERE id = credit;
    SELECT * INTO STRICT e FROM public.quest_events WHERE id = c.source_id;
    UPDATE public.quest_occurrences SET status = 'completed', recorded_completed_at = now()
        WHERE id = e.occurrence_id;
    INSERT INTO public.quest_events (id, quest_id, user_id, occurrence_id, event_type,
        actor_kind, actor_user_id, command_id, execution_cycle, related_event_id, payload)
        VALUES (x, e.quest_id, system_internal.request_user_id(), e.occurrence_id, 'completion_corrected', 'user',
            system_internal.request_user_id(), gen_random_uuid(), e.execution_cycle, e.id,
            jsonb_build_object('correction', jsonb_build_object('undo', true,
                'original_completion_event_id', e.id) || corrections,
                'exp', jsonb_build_object('source_type', 'quest_completion_reversal', 'source_id', x,
                    'reason', 'completion_reward_reversal', 'amount', -c.amount,
                    'original_credit_entry_id', c.id, 'reversal_entry_id', gen_random_uuid()) || overrides));
    RETURN x;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA exp_test TO authenticated, anon, quest_command_owner;

DO $tests$
DECLARE
    a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); e uuid; c uuid; x uuid; r uuid;
    zero_c uuid; max_c uuid; other_c uuid; bad uuid; key text; val jsonb; item jsonb;
    row_data public.exp_ledger; o uuid; q uuid; e2 uuid; c2 uuid;
BEGIN
    INSERT INTO auth.users (id) VALUES (a), (b);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM exp_test.assert_true(public.get_current_exp() = 0, 'empty owner total');
    PERFORM exp_test.reject('SELECT exp_internal.append_quest_event(gen_random_uuid())', ARRAY['42501'], 'private helper');
    PERFORM exp_test.reject('INSERT INTO public.exp_ledger (user_id) VALUES (system_internal.request_user_id())', ARRAY['42501'], 'browser insert');
    SET LOCAL ROLE quest_command_owner;
    e := exp_test.completion(50);
    c := exp_internal.append_quest_event(e);
    PERFORM exp_test.assert_true((SELECT l.amount = 50 AND l.id = (v.payload #>> '{exp,ledger_entry_id}')::uuid
        FROM public.exp_ledger l JOIN public.quest_events v ON v.id = l.source_id WHERE l.id = c), 'credit receipt');
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)', e), ARRAY['23505'], 'duplicate credit');
    SELECT occurrence_id, quest_id INTO o, q FROM public.quest_events WHERE id = e;
    PERFORM exp_test.reject(format('INSERT INTO public.quest_events (quest_id,user_id,occurrence_id,event_type,actor_kind,actor_user_id,command_id,execution_cycle) VALUES (%L,%L,%L,''completed'',''user'',%L,gen_random_uuid(),1)',q,a,o,a), ARRAY['23505'], 'Quest completion cycle unique');

    -- Wrong insert receipt/amount/kind cannot evade the trigger.
    PERFORM exp_test.reject(format('INSERT INTO public.exp_ledger (id,user_id,source_type,source_id,reason,amount) VALUES (gen_random_uuid(),%L,''quest_completion'',%L,''completion_reward'',50)',a,e), ARRAY['23514'], 'wrong receipt');
    PERFORM exp_test.reject(format('INSERT INTO public.exp_ledger (id,user_id,source_type,source_id,reason,amount) VALUES (%L,%L,''quest_completion'',%L,''completion_reward'',51)',c,a,e), ARRAY['23514'], 'wrong amount');
    PERFORM exp_test.reject(format('INSERT INTO public.exp_ledger (user_id,source_type,source_id,reason,amount) VALUES (%L,''unknown'',%L,''unknown'',0)',a,e), ARRAY['23514'], 'unknown kind');

    -- Every canonical credit key is required; null values fail as well as malformed types.
    FOREACH key IN ARRAY ARRAY['source_type','source_id','reason','amount','ledger_entry_id'] LOOP
        bad := exp_test.completion(50, jsonb_build_object(key, NULL));
        PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514','22023'], 'null credit ' || key);
        bad := exp_test.completion(50, '{}', 1::smallint, key);
        PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514','22023'], 'missing credit ' || key);
    END LOOP;
    FOR val IN SELECT value FROM jsonb_array_elements('["50",50.5,true,null,-1,2147483648]'::jsonb) LOOP
        bad := exp_test.completion(50, jsonb_build_object('amount',val));
        PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514','22023'], 'invalid numeric credit');
    END LOOP;
    bad := exp_test.completion(50, jsonb_build_object('source_id','not-a-uuid'));
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['22P02'], 'malformed UUID');
    bad := exp_test.completion(50, jsonb_build_object('source_id',gen_random_uuid()));
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'wrong source UUID');
    bad := exp_test.completion(NULL);
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['22023'], 'unresolved snapshot');
    bad := exp_test.completion(50, '{}'::jsonb, 2::smallint);
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'unsupported version');
    bad := exp_test.completion(50);
    UPDATE public.quest_occurrences SET status = 'cancelled' WHERE id = (SELECT occurrence_id FROM public.quest_events WHERE id=bad);
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'terminal credit');
    bad := exp_test.completion(50);
    UPDATE public.quest_occurrences SET execution_cycle = 2 WHERE id = (SELECT occurrence_id FROM public.quest_events WHERE id=bad);
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'stale cycle');

    x := exp_test.correction(c);
    -- Reversal uses immutable history even if the current reward has changed.
    UPDATE public.quest_occurrences SET reward_exp_snapshot = 80 WHERE id = o;
    r := exp_internal.append_quest_event(x);
    PERFORM exp_test.assert_true((SELECT amount = -50 AND reverses_entry_id = c FROM public.exp_ledger WHERE id=r), 'exact compensation');
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',x), ARRAY['23505'], 'same correction retry');
    bad := exp_test.correction(c);
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23505'], 'different correction duplicate reversal');
    bad := exp_test.correction(c, jsonb_build_object('original_credit_entry_id',r));
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'reversal of reversal');
    bad := exp_test.correction(c, jsonb_build_object('amount',-49));
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'partial reversal');
    bad := exp_test.correction(c, jsonb_build_object('reversal_entry_id',c));
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'self reversal');
    FOREACH key IN ARRAY ARRAY['source_type','source_id','reason','amount','original_credit_entry_id','reversal_entry_id'] LOOP
        bad := exp_test.correction(c, jsonb_build_object(key,NULL));
        PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514','22023'], 'null undo '||key);
    END LOOP;
    FOR val IN SELECT value FROM jsonb_array_elements('[false,"true",null]'::jsonb) LOOP
        bad := exp_test.correction(c, '{}', jsonb_build_object('undo',val));
        PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'metadata/nonboolean undo');
    END LOOP;
    bad := exp_test.correction(c, '{}', jsonb_build_object('original_completion_event_id',gen_random_uuid()));
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad), ARRAY['23514'], 'related event mismatch');

    zero_c := exp_internal.append_quest_event(exp_test.completion(0));
    PERFORM exp_internal.append_quest_event(exp_test.correction(zero_c));
    max_c := exp_internal.append_quest_event(exp_test.completion(2147483647));
    PERFORM exp_internal.append_quest_event(exp_test.correction(max_c));
    PERFORM exp_internal.append_quest_event(exp_test.completion(50,'{"amount":50.0}'));

    -- Later legitimate cycle: new event/source/receipt; old history remains.
    UPDATE public.quest_occurrences SET status='draft', recorded_completed_at=NULL, execution_cycle=2 WHERE id=o;
    e2 := gen_random_uuid(); c2 := gen_random_uuid();
    INSERT INTO public.quest_events (id,quest_id,user_id,occurrence_id,event_type,actor_kind,actor_user_id,command_id,execution_cycle,payload)
        VALUES(e2,q,a,o,'completed','user',a,gen_random_uuid(),2,jsonb_build_object('exp',jsonb_build_object(
            'source_type','quest_completion','source_id',e2,'reason','completion_reward','amount',80,'ledger_entry_id',c2)));
    PERFORM exp_internal.append_quest_event(e2);
    PERFORM exp_test.assert_true((SELECT count(*)=2 FROM public.exp_ledger WHERE id IN(c,c2)), 'new cycle independent credit');
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',e),ARRAY['23514'],'late old cycle cannot resurrect');

    -- A downstream failure must roll back the source and credit together.
    BEGIN
        bad := exp_test.completion(9);
        PERFORM exp_internal.append_quest_event(bad);
        RAISE EXCEPTION 'Injected later command failure' USING ERRCODE='Z0001';
    EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
    END;
    PERFORM exp_test.assert_true(NOT EXISTS(SELECT 1 FROM public.quest_events WHERE id=bad)
        AND NOT EXISTS(SELECT 1 FROM public.exp_ledger WHERE source_id=bad),'atomic rollback');

    PERFORM set_config('request.jwt.claim.sub',b::text,true);
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',e2),ARRAY['23514'],'foreign completion source');
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',x),ARRAY['23514'],'foreign correction source');
    other_c := exp_internal.append_quest_event(exp_test.completion(7));
    bad := exp_test.correction(other_c,jsonb_build_object('original_credit_entry_id',c2));
    PERFORM exp_test.reject(format('SELECT exp_internal.append_quest_event(%L)',bad),ARRAY['23514'],'foreign reversal target');
    SET LOCAL ROLE authenticated;
    PERFORM exp_test.assert_true(public.get_current_exp()=7 AND (SELECT count(*)=1 FROM public.exp_ledger), 'owner B isolation');
    PERFORM set_config('request.jwt.claim.sub',a::text,true);
    PERFORM exp_test.assert_true(public.get_current_exp()=130 AND NOT EXISTS(SELECT 1 FROM public.exp_ledger WHERE user_id=b), 'owner A exact total/isolation');
    FOREACH key IN ARRAY ARRAY['UPDATE public.exp_ledger SET amount=0','DELETE FROM public.exp_ledger','TRUNCATE public.exp_ledger'] LOOP
        PERFORM exp_test.reject(key,ARRAY['42501'],'browser immutable');
    END LOOP;
    SET LOCAL ROLE quest_command_owner;
    FOREACH key IN ARRAY ARRAY['UPDATE public.exp_ledger SET amount=0','DELETE FROM public.exp_ledger','TRUNCATE public.exp_ledger'] LOOP
        PERFORM exp_test.reject(key,ARRAY['42501'],'command role immutable');
    END LOOP;
    SET LOCAL ROLE anon;
    PERFORM exp_test.reject('SELECT * FROM public.exp_ledger',ARRAY['42501'],'anon read');
    PERFORM exp_test.reject('SELECT public.get_current_exp()',ARRAY['42501'],'anon total');
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM exp_test.reject('SELECT public.get_current_exp()',ARRAY['42501'],'missing identity');
    RESET ROLE;
    -- Verify the ledger's Auth FK itself, independently of Quest's earlier FK.
    -- Disable only insert validation for a synthetic source-less admin fixture;
    -- transaction rollback restores both the trigger and fixture state.
    e2 := gen_random_uuid();
    INSERT INTO auth.users (id) VALUES (e2);
    ALTER TABLE public.exp_ledger DISABLE TRIGGER exp_ledger_validate_insert;
    INSERT INTO public.exp_ledger(user_id,source_type,source_id,reason,amount)
        VALUES(e2,'quest_completion',gen_random_uuid(),'completion_reward',0);
    ALTER TABLE public.exp_ledger ENABLE TRIGGER exp_ledger_validate_insert;
    PERFORM exp_test.reject(format('DELETE FROM auth.users WHERE id=%L',e2),ARRAY['23503'],'ledger Auth FK independent of Quest');
    -- Numeric aggregate precision beyond JavaScript's safe-integer range.
    -- Admin-only fixture is deliberately outside valid Quest amount bounds.
    ALTER TABLE public.exp_ledger DISABLE TRIGGER exp_ledger_validate_insert;
    INSERT INTO public.exp_ledger(user_id,source_type,source_id,reason,amount)
        VALUES(e2,'quest_completion',gen_random_uuid(),'completion_reward',9007199254740993),
              (e2,'quest_completion',gen_random_uuid(),'completion_reward',2);
    ALTER TABLE public.exp_ledger ENABLE TRIGGER exp_ledger_validate_insert;
    PERFORM set_config('request.jwt.claim.sub',e2::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM exp_test.assert_true(public.get_current_exp()=9007199254740995::numeric,'exact numeric aggregate');
    RESET ROLE;
    -- Administrator can exercise guards independently of runtime grants/RLS.
    PERFORM exp_test.reject('UPDATE public.exp_ledger SET amount=amount',ARRAY['55000'],'update guard');
    PERFORM exp_test.reject('DELETE FROM public.exp_ledger',ARRAY['55000'],'delete guard');
    PERFORM exp_test.reject('TRUNCATE public.exp_ledger',ARRAY['55000','0A000'],'truncate guard');
    PERFORM exp_test.reject(format('DELETE FROM auth.users WHERE id=%L',a),ARRAY['23503'],'Auth retained history restrict');
    RAISE NOTICE 'Player/EXP behavior tests passed';
END;
$tests$;
ROLLBACK;
