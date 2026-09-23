\set ON_ERROR_STOP on
-- JWT compatibility behavior + consumer regression. Synthetic fixtures only.
-- PROPOSED local validation, AFTER separately authorized migration application:
-- Get-Content -Raw supabase/tests/request-identity-compat.sql | docker exec -i supabase_db_System psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
-- Use a fresh psql connection with both JWT settings initially absent. Everything
-- below, including fixture rows and test-only executor membership, rolls back.
BEGIN;

DO $missing$
BEGIN
    IF current_setting('request.jwt.claims', true) IS NOT NULL
        OR current_setting('request.jwt.claim.sub', true) IS NOT NULL THEN
        RAISE EXCEPTION 'Test requires a fresh connection without JWT settings';
    END IF;
    SET LOCAL ROLE authenticated;
    IF system_internal.request_user_id() IS NOT NULL THEN
        RAISE EXCEPTION 'Absent settings must return null';
    END IF;
    BEGIN
        PERFORM public.get_progression_status();
        RAISE EXCEPTION 'Absent settings allowed progression access';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- Modern JSON claims work while legacy sub is genuinely absent.
    PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub', 'abcdefab-1111-4111-8111-111111111111'
        )::text,
        true
    );

    IF current_setting('request.jwt.claim.sub', true) IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy setting should still be absent';
    END IF;

    IF system_internal.request_user_id()
        IS DISTINCT FROM 'abcdefab-1111-4111-8111-111111111111'::uuid THEN
        RAISE EXCEPTION 'Modern-only identity failed';
    END IF;

    PERFORM public.get_progression_status();

    -- Clear modern claims before testing legacy-only identity.
    PERFORM set_config('request.jwt.claims', '', true);
    -- Legacy works while the modern setting is genuinely absent.
    PERFORM set_config('request.jwt.claim.sub', 'abcdefab-1111-4111-8111-111111111111', true);
    IF system_internal.request_user_id() IS DISTINCT FROM 'abcdefab-1111-4111-8111-111111111111'::uuid THEN
        RAISE EXCEPTION 'Legacy identity with absent modern setting failed';
    END IF;
    RESET ROLE;
END;
$missing$;

DO $matrix$
DECLARE
    a uuid := 'abcdefab-1111-4111-8111-111111111111';
    b uuid := 'bcdefabc-2222-4222-8222-222222222222';
    c record;
    actual uuid;
    observed_state text;
    observed_message text;
    expected_rpc_state text;
    st public.progression_status;
BEGIN
    SET LOCAL ROLE authenticated;
    -- None of these untrusted locations may become an identity fallback.
    PERFORM set_config('app.user_id', b::text, true);
    PERFORM set_config('request.jwt.claim.user_id', b::text, true);
    PERFORM set_config('request.headers', jsonb_build_object('x-user-id', b)::text, true);
    FOR c IN SELECT * FROM (VALUES
        ('both empty', '', '', NULL::uuid, NULL::text),
        ('legacy only', '', a::text, a, NULL),
        ('modern only', jsonb_build_object('sub', a)::text, '', a, NULL),
        ('matching', jsonb_build_object('sub', a)::text, a::text, a, NULL),
        ('equivalent UUID spelling', jsonb_build_object('sub', upper(a::text))::text, replace(a::text, '-', ''), a, NULL),
        ('empty object', '{}', '', NULL, NULL),
        ('missing subject', '{"role":"authenticated"}', '', NULL, NULL),
        ('null subject', '{"sub":null}', '', NULL, NULL),
        ('empty subject', '{"sub":""}', '', NULL, NULL),
        ('missing subject plus legacy', '{}', a::text, a, NULL),
        ('null subject plus legacy', '{"sub":null}', a::text, a, NULL),
        ('empty subject plus legacy', '{"sub":""}', a::text, a, NULL),
        ('metadata is not identity', jsonb_build_object('user_id', b, 'user_metadata', jsonb_build_object('sub', b))::text, '', NULL, NULL),
        ('metadata cannot override subject', jsonb_build_object('sub', a, 'user_metadata', jsonb_build_object('sub', b))::text, '', a, NULL),
        ('conflict', jsonb_build_object('sub', a)::text, b::text, NULL, '42501'),
        ('reverse conflict', jsonb_build_object('sub', b)::text, a::text, NULL, '42501'),
        ('malformed JSON', '{', '', NULL, '22P02'),
        ('malformed JSON plus legacy', '{', a::text, NULL, '22P02'),
        ('JSON null envelope', 'null', '', NULL, '22P02'),
        ('JSON null plus legacy', 'null', a::text, NULL, '22P02'),
        ('JSON array envelope', '[]', a::text, NULL, '22P02'),
        ('JSON string envelope', '"subject"', a::text, NULL, '22P02'),
        ('JSON number envelope', '42', a::text, NULL, '22P02'),
        ('JSON boolean envelope', 'true', a::text, NULL, '22P02'),
        ('number subject', '{"sub":42}', a::text, NULL, '22P02'),
        ('boolean subject', '{"sub":true}', a::text, NULL, '22P02'),
        ('object subject', '{"sub":{}}', a::text, NULL, '22P02'),
        ('array subject', '{"sub":[]}', a::text, NULL, '22P02'),
        ('malformed modern UUID', '{"sub":"invalid-uuid"}', '', NULL, '22P02'),
        ('malformed modern plus legacy', '{"sub":"invalid-uuid"}', a::text, NULL, '22P02'),
        ('malformed legacy UUID', '', 'invalid-uuid', NULL, '22P02'),
        ('malformed legacy plus modern', jsonb_build_object('sub', a)::text, 'invalid-uuid', NULL, '22P02'),
        ('both malformed UUIDs', '{"sub":"invalid-uuid"}', 'invalid-uuid', NULL, '22P02'),
        ('whitespace claims', ' ', a::text, NULL, '22P02'),
        ('whitespace modern subject', '{"sub":" "}', a::text, NULL, '22P02'),
        ('whitespace legacy subject', jsonb_build_object('sub', a)::text, ' ', NULL, '22P02'),
        ('invalid Unicode subject', '{"sub":"\u0000"}', a::text, NULL, '22P02'),
        ('out of range JSON number', '{"sub":1e1000000}', a::text, NULL, '22P02')
    ) AS cases(label, modern, legacy, expected_id, expected_state) LOOP
        PERFORM set_config('request.jwt.claims', c.modern, true);
        PERFORM set_config('request.jwt.claim.sub', c.legacy, true);
        actual := NULL;
        observed_state := NULL;
        observed_message := NULL;
        BEGIN
            actual := system_internal.request_user_id();
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE, observed_message = MESSAGE_TEXT;
        END;
        IF observed_state IS DISTINCT FROM c.expected_state
            OR actual IS DISTINCT FROM c.expected_id THEN
            RAISE EXCEPTION 'Identity case failed: % (SQLSTATE %)', c.label, observed_state;
        END IF;
        IF c.expected_state = '22P02' AND observed_message IS DISTINCT FROM 'Invalid request identity claims' THEN
            RAISE EXCEPTION 'Malformed identity error is not sanitized: %', c.label;
        END IF;
        IF c.expected_state = '42501' AND observed_message IS DISTINCT FROM 'Conflicting request identities' THEN
            RAISE EXCEPTION 'Conflict error is not sanitized: %', c.label;
        END IF;
        -- Exercise the actual reported failing RPC for every identity case.
        expected_rpc_state := coalesce(c.expected_state,
            CASE WHEN c.expected_id IS NULL THEN '42501' END);
        observed_state := NULL;
        BEGIN
            st := public.get_progression_status();
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE;
        END;
        IF observed_state IS DISTINCT FROM expected_rpc_state THEN
            RAISE EXCEPTION 'Progression case failed: % (SQLSTATE %)', c.label, observed_state;
        END IF;
    END LOOP;
    RESET ROLE;
    RAISE NOTICE 'JWT identity and progression claim matrix passed';
END;
$matrix$;

GRANT quest_command_owner TO CURRENT_USER;
DO $isolation$
DECLARE
    a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); op uuid := gen_random_uuid();
    qa uuid := gen_random_uuid(); qb uuid := gen_random_uuid();
    policy_id uuid;
    format_name text;
    actor uuid;
    affected integer;
    st public.progression_status;
BEGIN
    -- Trusted test setup only; no trigger/RLS disabling or service-role use.
    INSERT INTO auth.users(id) VALUES (a), (b), (op);
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id IN (a, b);
    INSERT INTO public.quests(id, user_id, title) VALUES (qa, a, 'Identity A'), (qb, b, 'Identity B');
    INSERT INTO system_internal.operator_grants(user_id, capability) VALUES (op, 'level_policy_assign');
    SELECT id INTO STRICT policy_id FROM public.level_policies WHERE policy_key = 'level_policy_v1';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', op)::text, true);
    SET LOCAL ROLE authenticated;
    -- The existing capability-checked command creates B's distinctive progression
    -- state. This also exercises the helper inside its existing definer boundary.
    PERFORM public.assign_level_policy(b, policy_id, gen_random_uuid(), 'web_ui');
    RESET ROLE;

    FOREACH format_name IN ARRAY ARRAY['modern', 'legacy', 'both'] LOOP
        FOREACH actor IN ARRAY ARRAY[a, b] LOOP
            PERFORM set_config('request.jwt.claim.sub', CASE WHEN format_name = 'modern' THEN '' ELSE actor::text END, true);
            PERFORM set_config('request.jwt.claims', CASE WHEN format_name = 'legacy' THEN '' ELSE jsonb_build_object('sub', actor)::text END, true);
            SET LOCAL ROLE authenticated;
            IF system_internal.request_user_id() IS DISTINCT FROM actor
                OR auth.uid() IS DISTINCT FROM actor
                OR (SELECT count(*) FROM public.quests WHERE id IN (qa, qb)) <> 1
                OR EXISTS (SELECT 1 FROM public.quests WHERE user_id <> actor)
                OR (SELECT count(*) FROM public.profiles WHERE user_id = actor) <> 1 THEN
                RAISE EXCEPTION 'Authenticated owner isolation failed: %', format_name;
            END IF;
            st := public.get_progression_status();
            IF st.available IS DISTINCT FROM (actor = b)
                OR st.current_exp IS DISTINCT FROM 0::numeric
                OR (actor = b AND st.policy_id IS DISTINCT FROM policy_id)
                OR (actor = a AND st.policy_id IS NOT NULL) THEN
                RAISE EXCEPTION 'Progression owner isolation failed: %', format_name;
            END IF;
            -- Existing day-read consumer must also pass identity/timezone checks.
            PERFORM public.list_day_quest_occurrences(DATE '2026-09-23');
            BEGIN
                PERFORM public.assign_level_policy(actor, policy_id, gen_random_uuid(), 'web_ui');
                RAISE EXCEPTION 'Identity alone conferred operator capability';
            EXCEPTION WHEN insufficient_privilege THEN NULL;
            END;
            RESET ROLE;
        END LOOP;

        PERFORM set_config('request.jwt.claim.sub', CASE WHEN format_name = 'modern' THEN '' ELSE a::text END, true);
        PERFORM set_config('request.jwt.claims', CASE WHEN format_name = 'legacy' THEN '' ELSE jsonb_build_object('sub', a)::text END, true);
        SET LOCAL ROLE quest_command_owner;
        IF (SELECT count(*) FROM public.quests WHERE id IN (qa, qb)) <> 1
            OR EXISTS (SELECT 1 FROM public.quests WHERE user_id <> a)
            OR (SELECT count(user_id) FROM public.profiles) <> 1
            OR EXISTS (SELECT user_id FROM public.profiles WHERE user_id <> a) THEN
            RAISE EXCEPTION 'Command-role owner isolation failed: %', format_name;
        END IF;
        INSERT INTO public.quests(user_id, title) VALUES (a, 'Own identity write');
        UPDATE public.quests SET title = 'Denied' WHERE id = qb;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Foreign update succeeded'; END IF;
        BEGIN
            INSERT INTO public.quests(user_id, title) VALUES (b, 'Denied');
            RAISE EXCEPTION 'Foreign insert succeeded';
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        RESET ROLE;
    END LOOP;

    -- Missing, malformed and conflicting identity cannot read/write via RLS.
    FOREACH format_name IN ARRAY ARRAY['missing', 'malformed', 'conflicting'] LOOP
        PERFORM set_config('request.jwt.claim.sub', CASE WHEN format_name = 'conflicting' THEN b::text ELSE '' END, true);
        PERFORM set_config('request.jwt.claims', CASE format_name WHEN 'missing' THEN '{}' WHEN 'malformed' THEN '{' ELSE jsonb_build_object('sub', a)::text END, true);
        SET LOCAL ROLE quest_command_owner;
        BEGIN
            IF EXISTS (SELECT 1 FROM public.quests) THEN
                RAISE EXCEPTION 'Invalid identity exposed rows: %', format_name;
            END IF;
            IF format_name <> 'missing' THEN RAISE EXCEPTION 'Invalid identity did not reject'; END IF;
        EXCEPTION WHEN invalid_text_representation THEN
            IF format_name <> 'malformed' THEN RAISE; END IF;
        WHEN insufficient_privilege THEN
            IF format_name <> 'conflicting' THEN RAISE; END IF;
        END;
        BEGIN
            INSERT INTO public.quests(user_id, title) VALUES (a, 'Denied identity write');
            RAISE EXCEPTION 'Invalid identity wrote a row';
        EXCEPTION WHEN invalid_text_representation THEN
            IF format_name <> 'malformed' THEN RAISE; END IF;
        WHEN insufficient_privilege THEN
            IF format_name = 'malformed' THEN RAISE; END IF;
        END;
        RESET ROLE;
    END LOOP;

    -- A syntactically valid subject cannot grant anonymous callers execution.
    FOREACH format_name IN ARRAY ARRAY['missing', 'modern', 'legacy'] LOOP
        PERFORM set_config('request.jwt.claim.sub', CASE WHEN format_name = 'legacy' THEN a::text ELSE '' END, true);
        PERFORM set_config('request.jwt.claims', CASE WHEN format_name = 'modern' THEN jsonb_build_object('sub', a)::text ELSE '' END, true);
        SET LOCAL ROLE anon;
        BEGIN
            PERFORM system_internal.request_user_id();
            RAISE EXCEPTION 'Anonymous helper execution succeeded';
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        BEGIN
            PERFORM public.get_progression_status();
            RAISE EXCEPTION 'Anonymous progression execution succeeded';
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        BEGIN
            PERFORM 1 FROM public.quests;
            RAISE EXCEPTION 'Anonymous Quest access succeeded';
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        RESET ROLE;
    END LOOP;
    RAISE NOTICE 'JWT compatibility owner/RPC/anonymous isolation passed';
END;
$isolation$;
ROLLBACK;
