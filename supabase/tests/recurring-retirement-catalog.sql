-- Checks belong only at the new migration boundary.
DO $test$
DECLARE name text; f regprocedure; r record;
BEGIN
    FOREACH name IN ARRAY ARRAY[
        'public.set_recurring_quest_archived_v1(uuid,uuid,boolean,text)',
        'public.delete_recurring_quest_v1(uuid,uuid,text)',
        'public.list_archived_recurring_quests_v1()'
    ] LOOP
        f := name::regprocedure;
        IF NOT has_function_privilege('authenticated',f,'EXECUTE')
            OR has_function_privilege('anon',f,'EXECUTE')
            OR has_function_privilege('service_role',f,'EXECUTE') THEN
            RAISE EXCEPTION 'Unexpected retirement ACL: %',name;
        END IF;
        SELECT * INTO r FROM pg_proc WHERE oid=f;
        IF NOT ('search_path=pg_catalog' = ANY(r.proconfig))
            OR position('require_owner()' in r.prosrc)=0 THEN
            RAISE EXCEPTION 'Missing retirement guard';
        END IF;
        IF name LIKE '%list_archived%' THEN
            IF r.prosecdef OR r.provolatile <> 's' THEN RAISE EXCEPTION 'Unsafe read'; END IF;
        ELSIF NOT r.prosecdef OR r.proowner <> 'quest_command_owner'::regrole THEN
            RAISE EXCEPTION 'Unsafe command ownership';
        END IF;
    END LOOP;
    IF has_function_privilege('authenticated',
        'system_internal.retire_recurring_quest_v1(uuid,uuid,text,text)','EXECUTE') THEN
        RAISE EXCEPTION 'Internal command exposed';
    END IF;
    IF (SELECT rolbypassrls FROM pg_roles WHERE rolname='quest_command_owner') THEN
        RAISE EXCEPTION 'Command bypasses RLS';
    END IF;
END;
$test$;
