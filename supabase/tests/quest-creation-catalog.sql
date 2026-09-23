\set ON_ERROR_STOP on
-- Catalog/security contract for public.create_one_off_quest.
BEGIN;

SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    p.prosecdef, p.proconfig, p.proacl, pg_get_userbyid(p.proowner)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'create_one_off_quest';

DO $catalog$
DECLARE
    fn oid := 'public.create_one_off_quest(uuid,jsonb,text)'::regprocedure;
    owner_name text;
    config_text text;
    is_security_definer boolean;
    role_name text;
BEGIN
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='create_one_off_quest') <> 1 THEN
        RAISE EXCEPTION 'creation function overload mismatch';
    END IF;
    IF pg_get_function_identity_arguments(fn) IS DISTINCT FROM 'command_id uuid, request jsonb, origin text' THEN
        RAISE EXCEPTION 'creation signature mismatch';
    END IF;
    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig::text
        INTO owner_name, is_security_definer, config_text
        FROM pg_proc p WHERE p.oid=fn;
    IF owner_name IS DISTINCT FROM 'quest_command_owner' THEN RAISE EXCEPTION 'owner mismatch'; END IF;
    IF is_security_definer IS DISTINCT FROM true
        OR config_text IS DISTINCT FROM '{search_path=pg_catalog}' THEN
        RAISE EXCEPTION 'definer/search_path mismatch';
    END IF;
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION 'authenticated missing EXECUTE'; END IF;
    FOREACH role_name IN ARRAY ARRAY['public','anon','service_role','quest_command_owner',
        'progression_command_owner','level_policy_assignment_owner'] LOOP
        IF has_function_privilege(role_name, fn, 'EXECUTE') THEN RAISE EXCEPTION 'unexpected EXECUTE: %', role_name; END IF;
    END LOOP;
    IF (SELECT p.proacl::text[] FROM pg_proc p WHERE p.oid=fn)
        IS DISTINCT FROM ARRAY['authenticated=X/quest_command_owner'] THEN
        RAISE EXCEPTION 'ACL mismatch';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['quests','quest_occurrences','quest_events'] LOOP
        IF NOT has_table_privilege('authenticated', 'public.'||role_name, 'SELECT') THEN RAISE EXCEPTION 'missing SELECT: %', role_name; END IF;
        IF has_table_privilege('authenticated', 'public.'||role_name, 'INSERT')
            OR has_table_privilege('authenticated', 'public.'||role_name, 'UPDATE')
            OR has_table_privilege('authenticated', 'public.'||role_name, 'DELETE') THEN
            RAISE EXCEPTION 'authenticated direct write drift: %', role_name;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='quest_command_owner'
        AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
        RAISE EXCEPTION 'unsafe quest command owner';
    END IF;
    IF has_schema_privilege('quest_command_owner', 'public', 'CREATE') THEN RAISE EXCEPTION 'owner retains CREATE'; END IF;
    IF pg_has_role('authenticated', 'quest_command_owner', 'MEMBER') OR pg_has_role('anon', 'quest_command_owner', 'MEMBER') THEN
        RAISE EXCEPTION 'browser membership leaked';
    END IF;
END;
$catalog$;

ROLLBACK;