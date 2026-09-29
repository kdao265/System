\set ON_ERROR_STOP on
-- Catalog/security contract for the four Calendar routines, the two composite types and
-- the schedule_events table created by 20260929120000_create_schedule_events.sql.
-- Authority: docs/01-requirements/calendar-schedule.md CS-03/CS-07/CS-12 and
-- docs/02-architecture/decisions.md ADR-019/ADR-015.
BEGIN;

SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    p.prosecdef, p.proconfig, p.proacl, pg_get_userbyid(p.proowner)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN
    ('get_calendar_events', 'create_schedule_event', 'update_schedule_event',
     'delete_schedule_event')
ORDER BY p.proname;

DO $catalog$
DECLARE
    item record;
    fn oid;
    role_name text;
    owner_name text;
    config_text text;
    is_security_definer boolean;
    stable_flag boolean;
    acl_text text[];
    body_text text;
    guard_at integer;
    identity_at integer;
    actual_cols text[];
    expected_cols text[];
    table_name regclass := 'public.schedule_events';
BEGIN
    CREATE TEMP TABLE calendar_contract (
        signature text PRIMARY KEY,
        proname text NOT NULL,
        secdef boolean NOT NULL,
        via_command_role boolean NOT NULL,
        want_stable boolean NOT NULL
    ) ON COMMIT DROP;
    INSERT INTO calendar_contract VALUES
        ('public.get_calendar_events(date,date)', 'get_calendar_events', false, false, true),
        ('public.create_schedule_event(uuid,text,timestamptz,timestamptz,boolean,text,text)',
            'create_schedule_event', true, true, false),
        ('public.update_schedule_event(uuid,text,timestamptz,timestamptz,boolean,text,text)',
            'update_schedule_event', true, true, false),
        ('public.delete_schedule_event(uuid)', 'delete_schedule_event', true, true, false);

    FOR item IN SELECT * FROM calendar_contract ORDER BY signature LOOP
        fn := item.signature::regprocedure;
        IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = item.proname) <> 1 THEN
            RAISE EXCEPTION 'calendar routine overload mismatch: %', item.proname;
        END IF;
        SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig::text, (p.provolatile = 's'),
            p.prosrc, p.proacl
            INTO owner_name, is_security_definer, config_text, stable_flag, body_text, acl_text
            FROM pg_proc p WHERE p.oid = fn;
        IF owner_name IS DISTINCT FROM (CASE WHEN item.via_command_role
                THEN 'schedule_command_owner' ELSE current_user END) THEN
            RAISE EXCEPTION 'calendar routine owner mismatch: % is %', item.signature, owner_name;
        END IF;
        IF is_security_definer IS DISTINCT FROM item.secdef
            OR config_text IS DISTINCT FROM '{search_path=pg_catalog}' THEN
            RAISE EXCEPTION 'calendar routine definer/search_path mismatch: %', item.signature;
        END IF;
        IF stable_flag IS DISTINCT FROM item.want_stable THEN
            RAISE EXCEPTION 'calendar routine volatility mismatch: %', item.signature;
        END IF;
        -- ADR-015: the owner guard is the first thing the body does, before it reads
        -- identity and before any row access (CS-12).
        guard_at := position('system_private.require_owner()' in body_text);
        identity_at := position('system_internal.request_user_id()' in body_text);
        IF guard_at = 0 OR identity_at = 0 OR guard_at > identity_at THEN
            RAISE EXCEPTION 'calendar routine entry guard missing or out of order: %', item.signature;
        END IF;
        -- CS-07/CS-AC-07: the read is provably write-free and never materializes a slot.
        IF item.proname = 'get_calendar_events'
            AND (position('materialize_quest_day' in body_text) <> 0
                OR position('INSERT' in upper(body_text)) <> 0) THEN
            RAISE EXCEPTION 'the Calendar read routine is no longer write-free (CS-07)';
        END IF;
        IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'authenticated missing EXECUTE: %', item.signature;
        END IF;
        FOREACH role_name IN ARRAY ARRAY['public', 'anon', 'service_role', 'schedule_command_owner',
            'quest_command_owner', 'progression_command_owner', 'level_policy_assignment_owner'] LOOP
            IF has_function_privilege(role_name, fn, 'EXECUTE') THEN
                RAISE EXCEPTION 'unexpected EXECUTE on %: %', item.signature, role_name;
            END IF;
        END LOOP;
        -- Ownership transfer drops the previous owner's entry, so a routine left with the
        -- migration role keeps its default owner grant in addition to the client grant.
        IF (SELECT array_agg(entry ORDER BY entry) FROM unnest(acl_text) AS entry)
            IS DISTINCT FROM (SELECT array_agg(entry ORDER BY entry) FROM unnest(
                CASE WHEN item.via_command_role THEN ARRAY['authenticated=X/schedule_command_owner']
                ELSE ARRAY[owner_name || '=X/' || owner_name,
                            'authenticated=X/' || owner_name] END) AS entry) THEN
            RAISE EXCEPTION 'calendar routine ACL mismatch on %: %', item.signature, acl_text;
        END IF;
    END LOOP;


    -- Both composite shapes are exactly what the client boundary reads.
    SELECT array_agg(att.attname::text ORDER BY att.attname::text) INTO actual_cols
        FROM pg_attribute AS att
        WHERE att.attrelid = 'public.calendar_entry'::regclass
          AND att.attnum > 0 AND NOT att.attisdropped;
    SELECT array_agg(expected::text ORDER BY expected::text) INTO expected_cols
        FROM unnest(ARRAY['start_date', 'end_date', 'all_day', 'category', 'end_at', 'entry_id', 'execution_cycle',
            'notes', 'quest_id', 'reward_exp_snapshot', 'source', 'source_slot_date',
            'start_at', 'status', 'title']) AS expected;
    IF actual_cols IS DISTINCT FROM expected_cols THEN
        RAISE EXCEPTION 'calendar_entry column mismatch: %', actual_cols;
    END IF;
    SELECT array_agg(att.attname::text ORDER BY att.attname::text) INTO actual_cols
        FROM pg_attribute AS att
        WHERE att.attrelid = 'public.schedule_event_receipt'::regclass
          AND att.attnum > 0 AND NOT att.attisdropped;
    SELECT array_agg(expected::text ORDER BY expected::text) INTO expected_cols
        FROM unnest(ARRAY['start_date', 'end_date', 'all_day', 'category', 'created_at', 'end_at', 'event_id', 'notes',
            'replay', 'start_at', 'title', 'updated_at', 'user_id']) AS expected;
    IF actual_cols IS DISTINCT FROM expected_cols THEN
        RAISE EXCEPTION 'schedule_event_receipt column mismatch: %', actual_cols;
    END IF;

    -- The table is RLS-bound and carries the frozen ADR-015 restrictive guard under the
    -- same policy name the activation migration uses for every other owner table.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = table_name) THEN
        RAISE EXCEPTION 'schedule_events RLS is not enabled';
    END IF;
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = table_name) <> 5 THEN
        RAISE EXCEPTION 'schedule_events policy count changed: %',
            (SELECT count(*) FROM pg_policy WHERE polrelid = table_name);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = table_name AND polname = 'system_single_owner'
            AND NOT polpermissive AND polcmd = '*'
            AND cardinality(polroles) = 2
            AND polroles @> ARRAY['authenticated'::regrole::oid, 'schedule_command_owner'::regrole::oid]
            AND pg_get_expr(polqual, polrelid) LIKE '%system_private.is_owner()%'
            AND pg_get_expr(polwithcheck, polrelid) LIKE '%system_private.is_owner()%'
            AND pg_get_expr(polqual, polrelid) LIKE '%user_id =%request_user_id()%'
            AND pg_get_expr(polwithcheck, polrelid) LIKE '%user_id =%request_user_id()%'
    ) THEN
        RAISE EXCEPTION 'schedule_events restrictive owner guard missing or weakened';
    END IF;
    -- Unlike the Quest tables, this table is editable by design: the DELETE policy exists
    -- and is bound to the command role only (CS-02).
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = table_name AND polcmd = 'd') <> 1
        OR NOT EXISTS (
            SELECT 1 FROM pg_policy
            WHERE polrelid = table_name AND polcmd = 'd'
                AND polname = 'schedule_events_command_delete'
                AND polroles = ARRAY['schedule_command_owner'::regrole::oid]
                AND pg_get_expr(polqual, polrelid) LIKE '%request_user_id()%'
        ) THEN
        RAISE EXCEPTION 'schedule_events DELETE policy is not command-role bound';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['ck_schedule_title', 'ck_schedule_end', 'ck_schedule_category',
        'ck_schedule_notes', 'ck_schedule_span', 'ck_schedule_dates', 'ck_schedule_finite'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = table_name
            AND conname = role_name AND contype = 'c') THEN
            RAISE EXCEPTION 'schedule_events constraint missing: %', role_name;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
            AND indexname = 'ix_schedule_events_owner_start'
            AND indexdef = 'CREATE INDEX ix_schedule_events_owner_start ON public.schedule_events USING btree (user_id, start_at, id)') <> 1
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
            AND indexname = 'ix_schedule_events_owner_end'
            AND indexdef = 'CREATE INDEX ix_schedule_events_owner_end ON public.schedule_events USING btree (user_id, end_at, id) WHERE (end_at IS NOT NULL)') <> 1 THEN
        RAISE EXCEPTION 'schedule_events range indexes missing or changed';
    END IF;

    -- Client roles read through RLS and write through routines only.
    IF NOT has_table_privilege('authenticated', table_name, 'SELECT')
        OR has_table_privilege('authenticated', table_name, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'authenticated table privileges widened on schedule_events';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon', 'service_role', 'quest_command_owner',
        'progression_command_owner', 'level_policy_assignment_owner', 'profile_provisioner'] LOOP
        IF has_table_privilege(role_name, table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
            RAISE EXCEPTION 'unexpected table privilege on schedule_events: %', role_name;
        END IF;
    END LOOP;
    IF NOT has_table_privilege('schedule_command_owner', table_name, 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('schedule_command_owner', table_name, 'TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'schedule_command_owner table privileges changed';
    END IF;

    -- The command role stays a narrow, non-login, non-bypassing identity that can reach
    -- nothing but its own table plus the two Profile columns the write routines need.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schedule_command_owner'
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
        AND NOT rolcreaterole AND NOT rolcreatedb) THEN
        RAISE EXCEPTION 'schedule_command_owner is not a constrained role';
    END IF;
    IF has_schema_privilege('schedule_command_owner', 'public', 'CREATE')
        OR has_schema_privilege('schedule_command_owner', 'system_private', 'CREATE') THEN
        RAISE EXCEPTION 'schedule_command_owner retained schema CREATE';
    END IF;
    -- ADR-015: the command role can run the owner guard and read the request identity, and
    -- it reaches nothing else in the two system schemas (no operator capability, no receipt
    -- helper, no operator_grants row).
    IF NOT has_schema_privilege('schedule_command_owner', 'system_internal', 'USAGE')
        OR NOT has_function_privilege('schedule_command_owner',
            'system_internal.request_user_id()', 'EXECUTE')
        OR NOT has_schema_privilege('schedule_command_owner', 'system_private', 'USAGE')
        OR NOT has_function_privilege('schedule_command_owner',
            'system_private.require_owner()', 'EXECUTE')
        OR NOT has_function_privilege('schedule_command_owner',
            'system_private.is_owner()', 'EXECUTE') THEN
        RAISE EXCEPTION 'schedule_command_owner cannot execute the ADR-015 guard path: internal_schema=% internal_identity=% private_schema=% require=% is_owner=%',
            has_schema_privilege('schedule_command_owner', 'system_internal', 'USAGE'),
            has_function_privilege('schedule_command_owner', 'system_internal.request_user_id()', 'EXECUTE'),
            has_schema_privilege('schedule_command_owner', 'system_private', 'USAGE'),
            has_function_privilege('schedule_command_owner', 'system_private.require_owner()', 'EXECUTE'),
            (SELECT 'owner=' || pg_get_userbyid(p.proowner) || ' acl=' || coalesce(p.proacl::text, 'default')
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'system_private' AND p.proname = 'is_owner');
    END IF;
    IF has_table_privilege('schedule_command_owner', 'system_internal.operator_grants', 'SELECT')
        OR has_function_privilege('schedule_command_owner',
            'system_internal.has_capability(text)', 'EXECUTE')
        OR has_function_privilege('schedule_command_owner',
            'system_internal.reject_operator_grant_mutation()', 'EXECUTE') THEN
        RAISE EXCEPTION 'schedule_command_owner reaches unrelated system_internal state';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon', 'authenticator'] LOOP
        IF pg_has_role(role_name, 'schedule_command_owner', 'MEMBER') THEN
            RAISE EXCEPTION 'client role % is a member of the command role', role_name;
        END IF;
    END LOOP;
    IF NOT has_column_privilege('schedule_command_owner', 'public.profiles', 'timezone', 'SELECT')
        OR has_column_privilege('schedule_command_owner', 'public.profiles', 'display_name', 'SELECT') THEN
        RAISE EXCEPTION 'schedule_command_owner Profile timezone privilege is not column-scoped';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.profiles'::regclass
            AND polname = 'profiles_schedule_owner_select'
            AND polpermissive AND polcmd = 'r'
            AND polroles = ARRAY['schedule_command_owner'::regrole::oid]
            AND pg_get_expr(polqual, 'public.profiles'::regclass) LIKE '%system_private.is_owner()%'
            AND pg_get_expr(polqual, 'public.profiles'::regclass) LIKE '%request_user_id()%'
    ) THEN
        RAISE EXCEPTION 'Profile timezone read for the command role is not identity bound';
    END IF;
END;
$catalog$;

ROLLBACK;
