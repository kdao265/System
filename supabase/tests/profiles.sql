\set ON_ERROR_STOP on
-- Run only against the local disposable database, after migrations.
BEGIN;
-- Local postgres is not a superuser; this test-only membership rolls back.
GRANT quest_command_owner TO CURRENT_USER;

DO $test$
DECLARE
    user_a uuid := gen_random_uuid();
    user_b uuid := gen_random_uuid();
    failed_user uuid := gen_random_uuid();
    affected integer;
    invalid_zone text;
    immutable_column text;
BEGIN
    INSERT INTO auth.users (id) VALUES (user_a), (user_b);
    IF (SELECT count(*) FROM public.profiles WHERE user_id IN (user_a, user_b)
        AND display_name IS NULL AND timezone IS NULL
        AND created_at = now() AND updated_at = now()) <> 2 THEN
        RAISE EXCEPTION 'Automatic provisioning/defaults failed';
    END IF;

    BEGIN
        INSERT INTO public.profiles (user_id) VALUES (user_a);
        RAISE EXCEPTION 'Duplicate profile accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.profiles (user_id) VALUES (failed_user);
        RAISE EXCEPTION 'Orphan profile accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    -- Force the provisioning path to fail and verify the Auth insert rolls back.
    REVOKE INSERT (user_id) ON public.profiles FROM profile_provisioner;
    BEGIN
        INSERT INTO auth.users (id) VALUES (failed_user);
        RAISE EXCEPTION 'Provisioning failure was swallowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    GRANT INSERT (user_id) ON public.profiles TO profile_provisioner;
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = failed_user) THEN
        RAISE EXCEPTION 'Failed provisioning left an Auth user';
    END IF;

    PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
    SET LOCAL ROLE authenticated;
    IF (SELECT count(*) FROM public.profiles) <> 1 THEN
        RAISE EXCEPTION 'Owner SELECT isolation failed';
    END IF;
    UPDATE public.profiles SET display_name = E' \t Test User \n', timezone = 'Asia/Ho_Chi_Minh'
        WHERE user_id = user_a;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = user_a
        AND display_name = 'Test User' AND timezone = 'Asia/Ho_Chi_Minh'
        AND updated_at = now()) THEN
        RAISE EXCEPTION 'Owner UPDATE/normalization/timestamp failed';
    END IF;
    UPDATE public.profiles SET display_name = 'Not allowed' WHERE user_id = user_b;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Cross-owner UPDATE succeeded'; END IF;

    FOREACH invalid_zone IN ARRAY ARRAY['', ' ', '+07:00', 'Not/A_Zone',
        'localtime', 'posix/UTC', 'right/UTC', ' UTC', 'UTC '] LOOP
        BEGIN
            UPDATE public.profiles SET timezone = invalid_zone WHERE user_id = user_a;
            RAISE EXCEPTION 'Invalid timezone accepted';
        EXCEPTION WHEN check_violation THEN NULL;
        END;
    END LOOP;
    UPDATE public.profiles SET timezone = 'UTC' WHERE user_id = user_a;
    UPDATE public.profiles SET timezone = 'US/Eastern' WHERE user_id = user_a;
    UPDATE public.profiles SET timezone = NULL, display_name = E' \t\n' WHERE user_id = user_a;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = user_a
        AND timezone IS NULL AND display_name IS NULL) THEN
        RAISE EXCEPTION 'Optional field clearing failed';
    END IF;

    FOREACH immutable_column IN ARRAY ARRAY['user_id', 'created_at', 'updated_at'] LOOP
        BEGIN
            EXECUTE format('UPDATE public.profiles SET %I = %I WHERE user_id = $1',
                immutable_column, immutable_column) USING user_a;
            RAISE EXCEPTION 'Protected column UPDATE allowed';
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
    END LOOP;
    BEGIN
        INSERT INTO public.profiles (user_id) VALUES (user_a);
        RAISE EXCEPTION 'Client INSERT allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.profiles (user_id) VALUES (user_a)
            ON CONFLICT (user_id) DO UPDATE SET display_name = 'Not allowed';
        RAISE EXCEPTION 'Client upsert allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.profiles WHERE user_id = user_a;
        RAISE EXCEPTION 'Client DELETE allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    UPDATE public.profiles SET updated_at = '2000-01-01' WHERE user_id = user_a;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = user_a
        AND updated_at = now() AND created_at = now()) THEN
        RAISE EXCEPTION 'Database did not override supplied update metadata';
    END IF;

    SET LOCAL ROLE quest_command_owner;
    IF (SELECT count(user_id) FROM public.profiles) <> 1 THEN
        RAISE EXCEPTION 'Quest timezone reader isolation failed';
    END IF;
    PERFORM timezone FROM public.profiles WHERE user_id = user_a;
    BEGIN
        PERFORM display_name FROM public.profiles;
        RAISE EXCEPTION 'Quest reader has excessive column privileges';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL ROLE authenticated;
    IF EXISTS (SELECT 1 FROM public.profiles) THEN
        RAISE EXCEPTION 'Missing identity can read profiles';
    END IF;
    RESET ROLE;
    SET LOCAL ROLE anon;
    BEGIN
        PERFORM 1 FROM public.profiles;
        RAISE EXCEPTION 'Anonymous SELECT allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    DELETE FROM auth.users WHERE id = user_b;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = user_b) THEN
        RAISE EXCEPTION 'Profile cascade failed';
    END IF;
    INSERT INTO public.quests (user_id, title, archived_at)
        VALUES (user_a, 'Synthetic retention test', now());
    BEGIN
        DELETE FROM auth.users WHERE id = user_a;
        RAISE EXCEPTION 'Quest retention restriction bypassed';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = user_a)
        OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = user_a) THEN
        RAISE EXCEPTION 'Failed Auth deletion removed identity/profile';
    END IF;
    RAISE NOTICE 'PASS: provisioning, rollback, RLS, column grants, timezone, timestamps and deletion';
END;
$test$;

ROLLBACK;
