\set ON_ERROR_STOP on
-- Read-only catalog assertions after the six baseline migrations + JWT fix.
-- PROPOSED local validation, only after database operations are authorized:
-- Get-Content -Raw supabase/tests/request-identity-compat-catalog.sql | docker exec -i supabase_db_System psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
-- Baseline: helper/schema owned by postgres; EXECUTE/USAGE for authenticated,
-- quest_command_owner, progression_command_owner, level_policy_assignment_owner.
-- Historical migrations and all existing catalog suites remain unchanged.
BEGIN READ ONLY;
DO $catalog$
DECLARE
    fn oid := 'system_internal.request_user_id()'::regprocedure;
    helper pg_proc;
    schema_row pg_namespace;
    expected_roles text[] := ARRAY['authenticated', 'level_policy_assignment_owner',
        'progression_command_owner', 'quest_command_owner'];
    actual_roles text[];
    role_name text;
    client_role text;
    table_name text;
    rpc text;
BEGIN
    SELECT * INTO STRICT helper FROM pg_proc WHERE oid = fn;
    SELECT * INTO STRICT schema_row FROM pg_namespace WHERE nspname = 'system_internal';
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = schema_row.oid
            AND proname = 'request_user_id') <> 1
        OR helper.pronargs <> 0 OR helper.prorettype <> 'uuid'::regtype
        OR helper.proretset OR helper.prokind <> 'f' THEN
        RAISE EXCEPTION 'Identity helper signature/overload changed';
    END IF;
    IF helper.provolatile <> 's' OR helper.prosecdef OR helper.proleakproof
        OR helper.proisstrict OR helper.proparallel <> 'u'
        OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
        RAISE EXCEPTION 'Identity helper security/planner properties changed';
    END IF;
    -- The sole intentional catalog-property change is SQL -> PL/pgSQL so
    -- invalid JSON/UUID data can be rejected with a sanitized exception.
    IF (SELECT lanname FROM pg_language WHERE oid = helper.prolang) <> 'plpgsql' THEN
        RAISE EXCEPTION 'Unexpected helper implementation language';
    END IF;
    IF pg_get_userbyid(helper.proowner) <> 'postgres'
        OR pg_get_userbyid(schema_row.nspowner) <> 'postgres' THEN
        RAISE EXCEPTION 'Identity helper/schema ownership changed';
    END IF;

    -- Inspect explicit ACLs, including PUBLIC (OID 0), unknown roles and grant
    -- options; effective-privilege checks alone can miss these regressions.
    SELECT array_agg(pg_get_userbyid(a.grantee)::text ORDER BY pg_get_userbyid(a.grantee)::text)
        INTO actual_roles
        FROM aclexplode(coalesce(helper.proacl, acldefault('f', helper.proowner))) a
        WHERE a.grantee <> helper.proowner;
    IF actual_roles IS DISTINCT FROM expected_roles THEN
        RAISE EXCEPTION 'Identity helper EXECUTE grantee set changed';
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(coalesce(helper.proacl, acldefault('f', helper.proowner))) a
        WHERE a.privilege_type <> 'EXECUTE' OR a.is_grantable OR a.grantor <> helper.proowner) THEN
        RAISE EXCEPTION 'Identity helper ACL or grant option changed';
    END IF;
    SELECT array_agg(pg_get_userbyid(a.grantee)::text ORDER BY pg_get_userbyid(a.grantee)::text)
        INTO actual_roles
        FROM aclexplode(coalesce(schema_row.nspacl, acldefault('n', schema_row.nspowner))) a
        WHERE a.grantee <> schema_row.nspowner;
    IF actual_roles IS DISTINCT FROM expected_roles THEN
        RAISE EXCEPTION 'Identity schema USAGE grantee set changed';
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(coalesce(schema_row.nspacl, acldefault('n', schema_row.nspowner))) a
        WHERE a.grantee <> schema_row.nspowner
            AND (a.privilege_type <> 'USAGE' OR a.is_grantable OR a.grantor <> schema_row.nspowner)) THEN
        RAISE EXCEPTION 'Identity schema CREATE/grant-option boundary changed';
    END IF;
    FOREACH role_name IN ARRAY expected_roles LOOP
        IF NOT has_schema_privilege(role_name, 'system_internal', 'USAGE')
            OR has_schema_privilege(role_name, 'system_internal', 'CREATE')
            OR NOT has_function_privilege(role_name, fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'Identity helper effective access changed: %', role_name;
        END IF;
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY['anon', 'service_role', 'authenticator'] LOOP
        IF has_schema_privilege(role_name, 'system_internal', 'USAGE')
            OR has_schema_privilege(role_name, 'system_internal', 'CREATE')
            OR has_function_privilege(role_name, fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'Identity helper access widened: %', role_name;
        END IF;
    END LOOP;

    FOREACH role_name IN ARRAY ARRAY['quest_command_owner', 'progression_command_owner', 'level_policy_assignment_owner'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name
            AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
            AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolinherit)
            OR has_schema_privilege(role_name, 'auth', 'USAGE')
            OR pg_has_role(role_name, 'authenticated', 'MEMBER')
            OR pg_has_role(role_name, 'service_role', 'MEMBER') THEN
            RAISE EXCEPTION 'Unsafe command role/managed-auth access: %', role_name;
        END IF;
        FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'authenticator', 'service_role'] LOOP
            IF pg_has_role(client_role, role_name, 'MEMBER') THEN
                RAISE EXCEPTION 'Client acquired command-role membership: %', client_role;
            END IF;
        END LOOP;
    END LOOP;

    FOREACH table_name IN ARRAY ARRAY['public.quests', 'public.quest_recurrence_rules',
        'public.quest_occurrences', 'public.quest_events', 'public.profiles', 'public.exp_ledger',
        'public.level_policies', 'public.level_thresholds', 'public.progression_policy_assignments',
        'public.level_milestones', 'public.level_reward_definitions', 'public.level_reward_unlocks',
        'public.level_reward_events', 'system_internal.operator_grants'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = table_name::regclass
            AND relrowsecurity AND pg_get_userbyid(relowner) = 'postgres') THEN
            RAISE EXCEPTION 'RLS/table ownership boundary changed: %', table_name;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE 'quest_command_owner' = ANY(roles)
        AND (coalesce(qual, '') LIKE '%auth.uid%' OR coalesce(with_check, '') LIKE '%auth.uid%')) THEN
        RAISE EXCEPTION 'Quest command policies now depend on managed auth';
    END IF;
    -- Existing consumer entry points retain their own security boundary.
    FOREACH rpc IN ARRAY ARRAY['public.get_progression_status()', 'public.get_current_exp()',
        'public.list_day_quest_occurrences(date)'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = rpc::regprocedure
            AND NOT prosecdef AND provolatile = 's'
            AND proconfig = ARRAY['search_path=pg_catalog'])
            OR NOT has_function_privilege('authenticated', rpc, 'EXECUTE')
            OR has_function_privilege('anon', rpc, 'EXECUTE')
            OR has_function_privilege('service_role', rpc, 'EXECUTE') THEN
            RAISE EXCEPTION 'Consumer security boundary changed: %', rpc;
        END IF;
    END LOOP;
    RAISE NOTICE 'JWT compatibility catalog/security assertions passed';
END;
$catalog$;
ROLLBACK;
