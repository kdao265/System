\set ON_ERROR_STOP on
BEGIN;
GRANT quest_command_owner TO CURRENT_USER;

SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl FROM pg_namespace WHERE nspname='system_internal';
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner, p.provolatile, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p WHERE p.oid='system_internal.request_user_id()'::regprocedure;
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='quest_command_owner';
SELECT has_schema_privilege('quest_command_owner','auth','USAGE') AS command_auth_usage;
SELECT tablename, policyname, roles, qual, with_check FROM pg_policies
WHERE 'quest_command_owner'=ANY(roles) ORDER BY tablename, policyname;

DO $test$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); role_name text; affected integer;
BEGIN
    IF system_internal.request_user_id() IS NOT NULL THEN RAISE EXCEPTION 'Missing claim not null'; END IF;
    IF has_schema_privilege('quest_command_owner','auth','USAGE') THEN RAISE EXCEPTION 'Managed auth access leaked'; END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='quest_command_owner' AND (rolcanlogin OR rolsuper OR rolbypassrls))
        OR pg_has_role('quest_command_owner','authenticated','MEMBER')
        OR pg_has_role('quest_command_owner','service_role','MEMBER') THEN RAISE EXCEPTION 'Unsafe command role'; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','service_role','authenticator'] LOOP
        IF has_schema_privilege(role_name,'system_internal','USAGE')
            OR has_function_privilege(role_name,'system_internal.request_user_id()','EXECUTE') THEN
            RAISE EXCEPTION 'Identity helper access too broad';
        END IF;
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY['authenticated','quest_command_owner'] LOOP
        IF NOT has_schema_privilege(role_name,'system_internal','USAGE')
            OR has_schema_privilege(role_name,'system_internal','CREATE')
            OR NOT has_function_privilege(role_name,'system_internal.request_user_id()','EXECUTE') THEN
            RAISE EXCEPTION 'Identity helper grants incorrect';
        END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='system_internal.request_user_id()'::regprocedure
        AND (prosecdef OR provolatile<>'s' OR pronargs<>0 OR prorettype<>'uuid'::regtype
            OR NOT ('search_path=pg_catalog'=ANY(proconfig)) OR pg_get_userbyid(proowner)<>'postgres')) THEN
        RAISE EXCEPTION 'Identity helper attributes incorrect';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_policies WHERE 'quest_command_owner'=ANY(roles)
        AND (COALESCE(qual,'') LIKE '%auth.uid%' OR COALESCE(with_check,'') LIKE '%auth.uid%')) THEN
        RAISE EXCEPTION 'Command policy still depends on auth.uid';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('exp_internal','system_internal')
            AND CASE WHEN p.prokind='f' THEN pg_get_functiondef(p.oid) ELSE '' END LIKE '%auth.uid%') THEN
        RAISE EXCEPTION 'Command routine still depends on auth.uid';
    END IF;
    INSERT INTO auth.users(id) VALUES(a),(b);
    INSERT INTO public.quests(id,user_id,title) VALUES(q,b,'Foreign owner');
    PERFORM set_config('request.jwt.claim.sub',a::text,true);
    SET LOCAL ROLE quest_command_owner;
    IF system_internal.request_user_id()<>a THEN RAISE EXCEPTION 'JWT identity mismatch'; END IF;
    INSERT INTO public.quests(user_id,title) VALUES(a,'Own Quest');
    IF (SELECT count(*) FROM public.quests)<>1 THEN RAISE EXCEPTION 'Quest SELECT isolation failed'; END IF;
    UPDATE public.quests SET title='Unauthorized' WHERE id=q;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'Foreign Quest UPDATE succeeded'; END IF;
    BEGIN
        INSERT INTO public.quests(user_id,title) VALUES(b,'Unauthorized');
        RAISE EXCEPTION 'Foreign Quest INSERT succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    IF (SELECT count(user_id) FROM public.profiles)<>1 THEN RAISE EXCEPTION 'Profile reader isolation failed'; END IF;
    PERFORM set_config('request.jwt.claim.sub','',true);
    IF system_internal.request_user_id() IS NOT NULL OR EXISTS(SELECT 1 FROM public.quests) THEN
        RAISE EXCEPTION 'Blank identity did not fail closed';
    END IF;
    BEGIN
        INSERT INTO public.quests(user_id,title) VALUES(a,'Missing identity');
        RAISE EXCEPTION 'Missing identity could write';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM set_config('request.jwt.claim.sub','invalid-uuid',true);
    BEGIN
        PERFORM system_internal.request_user_id();
        RAISE EXCEPTION 'Invalid UUID accepted';
    EXCEPTION WHEN invalid_text_representation THEN NULL; END;
    BEGIN
        PERFORM 1 FROM public.quests;
        RAISE EXCEPTION 'Invalid identity could read';
    EXCEPTION WHEN invalid_text_representation THEN NULL; END;
    PERFORM set_config('request.jwt.claim.sub',a::text,true);
    SET LOCAL ROLE authenticated;
    IF system_internal.request_user_id()<>auth.uid() OR (SELECT count(*) FROM public.quests)<>1 THEN
        RAISE EXCEPTION 'Authenticated identity behavior changed';
    END IF;
    RESET ROLE;
    RAISE NOTICE 'Request identity behavior/catalog tests passed';
END;
$test$;
ROLLBACK;
