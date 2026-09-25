\set ON_ERROR_STOP on
BEGIN;
DO $catalog$
DECLARE
    alias_table oid := 'system_internal.quest_completion_aliases'::regclass;
    resolver oid := 'public.get_quest_completion_resolution_v1(uuid,uuid,integer)'::regprocedure;
    fn oid;
    role_name text;
    columns text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        resolver,
        'public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text)'::regprocedure::oid,
        'public.create_one_off_quest(uuid,jsonb,text)'::regprocedure::oid,
        'public.reopen_quest_occurrence_v2(uuid,uuid,integer,text)'::regprocedure::oid
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = fn AND prosecdef
            AND proowner = 'quest_command_owner'::regrole
            AND proconfig = ARRAY['search_path=pg_catalog']) THEN
            RAISE EXCEPTION 'Command security configuration drift: %', fn::regprocedure;
        END IF;
        IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION 'Missing authenticated execution'; END IF;
        FOREACH role_name IN ARRAY ARRAY['public','anon','service_role','progression_command_owner','level_policy_assignment_owner'] LOOP
            IF has_function_privilege(role_name, fn, 'EXECUTE') THEN RAISE EXCEPTION 'Unexpected execution: % %', role_name, fn::regprocedure; END IF;
        END LOOP;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_quest_completion_resolution_v1') <> 1
        OR (SELECT prorettype FROM pg_proc WHERE oid = resolver) <> 'public.quest_completion_resolution_v1'::regtype
        OR (SELECT provolatile FROM pg_proc WHERE oid = resolver) <> 'v' THEN
        RAISE EXCEPTION 'Resolution signature/volatility drift';
    END IF;
    SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) INTO columns
        FROM pg_attribute WHERE attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'public.quest_completion_receipt'::regtype)
            AND attnum > 0 AND NOT attisdropped;
    IF columns IS DISTINCT FROM 'command_id:uuid,occurrence_id:uuid,quest_id:uuid,execution_cycle:integer,completed_event_id:uuid,exp_entry_id:uuid,exp_amount:bigint,reported_completed_at:timestamp with time zone,recorded_completed_at:timestamp with time zone,replay:boolean' THEN
        RAISE EXCEPTION 'Ten-field completion receipt changed';
    END IF;
    SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) INTO columns
        FROM pg_attribute WHERE attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'public.quest_completion_resolution_v1'::regtype)
            AND attnum > 0 AND NOT attisdropped;
    IF columns IS DISTINCT FROM 'version:integer,outcome:text,command_id:uuid,occurrence_id:uuid,expected_execution_cycle:integer,current_execution_cycle:integer,current_status:text,receipt:quest_completion_receipt,canonical_receipt:quest_completion_receipt,correction_event_id:uuid,reopened_event_id:uuid,reversal_entry_id:uuid' THEN
        RAISE EXCEPTION 'Resolution envelope changed: %', columns;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = alias_table AND relrowsecurity AND relowner <> 'quest_command_owner'::regrole)
        OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quest_command_owner' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
        RAISE EXCEPTION 'Alias role bypasses RLS';
    END IF;
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = alias_table) <> 2
        OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = alias_table
            AND (polroles <> ARRAY['quest_command_owner'::regrole::oid] OR polcmd NOT IN ('r','a'))) THEN
        RAISE EXCEPTION 'Alias policies broadened';
    END IF;
    IF NOT has_table_privilege('quest_command_owner', alias_table, 'SELECT')
        OR NOT has_table_privilege('quest_command_owner', alias_table, 'INSERT')
        OR has_table_privilege('quest_command_owner', alias_table, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Command alias table privileges drift';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['public','anon','authenticated','service_role','progression_command_owner','level_policy_assignment_owner'] LOOP
        IF has_table_privilege(role_name, alias_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(role_name, alias_table, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
            RAISE EXCEPTION 'Private alias access granted: %', role_name;
        END IF;
        IF has_function_privilege(role_name, 'public.reopen_quest_occurrence(uuid,uuid,text)', 'EXECUTE') THEN
            RAISE EXCEPTION 'Reopen V1 was regranted: %', role_name;
        END IF;
    END LOOP;
    FOREACH fn IN ARRAY ARRAY[
        'system_internal.completion_receipt(uuid,uuid)'::regprocedure::oid,
        'system_internal.completion_binding(uuid,uuid,integer)'::regprocedure::oid,
        'system_internal.reject_completion_alias(uuid)'::regprocedure::oid,
        'system_internal.guard_completion_alias()'::regprocedure::oid
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = fn AND NOT prosecdef AND proconfig = ARRAY['search_path=pg_catalog'])
            OR NOT has_function_privilege('quest_command_owner', fn, 'EXECUTE') THEN RAISE EXCEPTION 'Private helper security drift'; END IF;
        FOREACH role_name IN ARRAY ARRAY['public','anon','authenticated','service_role','progression_command_owner','level_policy_assignment_owner'] LOOP
            IF has_function_privilege(role_name, fn, 'EXECUTE') THEN RAISE EXCEPTION 'Private helper execution granted: %', role_name; END IF;
        END LOOP;
    END LOOP;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = alias_table AND NOT tgisinternal AND tgenabled = 'O') <> 2
        OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = alias_table AND contype = 'p'
            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, command_id)')
        OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = alias_table AND contype = 'f'
            AND confrelid = 'public.quest_events'::regclass AND confdeltype = 'r' AND confupdtype = 'r'
            AND cardinality(conkey) = 3) THEN
        RAISE EXCEPTION 'Alias identity/FK/immutability constraints drift';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','progression_command_owner','level_policy_assignment_owner'] LOOP
        IF pg_has_role(role_name, 'quest_command_owner', 'MEMBER') THEN RAISE EXCEPTION 'Command owner membership leaked'; END IF;
    END LOOP;
    IF has_schema_privilege('quest_command_owner', 'public', 'CREATE')
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'quest_command_owner'::regrole
            AND member = current_user::regrole AND (inherit_option OR set_option)) THEN
        -- PostgreSQL 17 retains the role creator's ADMIN-only membership.
        RAISE EXCEPTION 'Temporary migration privilege retained';
    END IF;
    RAISE NOTICE 'PASS: alias catalog, RLS, effective ACLs, fixed paths, owner boundaries and frozen receipts';
END;
$catalog$;
ROLLBACK;
