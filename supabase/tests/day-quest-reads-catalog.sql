\set ON_ERROR_STOP on
-- Day Quest occurrence read catalog + security validation.
-- Authority: ui-read-query-v1-draft.md sections 3.3 and 5, quest-database-schema.md,
-- quest-command-api-v1.md, auth-profile-database-schema.md and operator-authorization-v1.md.
-- Read-only, transactional, local-only: every assertion runs inside one
-- transaction that rolls back; no persistent state is created.
-- Follows the established sibling pattern (player-exp-catalog.sql,
-- level-rewards-catalog.sql, quest-commands-catalog.sql) and runner:
--   Get-Content -Raw supabase/tests/day-quest-reads-catalog.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1

BEGIN;

-- Catalog evidence dumps (read-only, order-stable).
SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS function_signature,
    l.lanname AS language, p.provolatile, p.prosecdef, p.proconfig, p.proacl,
    pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.proname = 'list_day_quest_occurrences'
    ORDER BY 1;

DO $catalog$
DECLARE
    fn oid := 'public.list_day_quest_occurrences(date)'::regprocedure;
    tbl text; privilege text;
    v_volatile "char"; v_secdef boolean; v_config text; v_lang name; v_owner oid;
    v_argnames text[]; v_argmodes text[]; v_argtypes text[]; v_nargdefaults integer;
BEGIN
    -- ------------------------------------------------------------------
    -- Exactly one overload, frozen date-argument signature.
    -- ------------------------------------------------------------------
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'list_day_quest_occurrences') <> 1 THEN
        RAISE EXCEPTION 'Day-read function count/overload mismatch';
    END IF;
    IF fn IS NULL THEN
        RAISE EXCEPTION 'Day-read function signature mismatch';
    END IF;
    IF (SELECT pg_get_function_identity_arguments(p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'list_day_quest_occurrences')
        IS DISTINCT FROM 'p_day date' THEN
        RAISE EXCEPTION 'Day-read identity-argument mismatch (expected p_day date DEFAULT NULL)';
    END IF;

    -- ------------------------------------------------------------------
    -- STABLE, SECURITY INVOKER, plpgsql, fixed pg_catalog search_path.
    -- ------------------------------------------------------------------
    SELECT p.provolatile, p.prosecdef, p.proconfig::text, l.lanname, p.proowner
        INTO v_volatile, v_secdef, v_config, v_lang, v_owner
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public' AND p.proname = 'list_day_quest_occurrences';
    IF v_volatile IS DISTINCT FROM 's' THEN
        RAISE EXCEPTION 'Day-read function must be STABLE';
    END IF;
    IF v_secdef IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Day-read function must be SECURITY INVOKER';
    END IF;
    IF v_config IS DISTINCT FROM '{search_path=pg_catalog}' THEN
        RAISE EXCEPTION 'Day-read search_path must be fixed to pg_catalog';
    END IF;
    IF v_lang IS DISTINCT FROM 'plpgsql' THEN
        RAISE EXCEPTION 'Day-read function language mismatch';
    END IF;

    -- ------------------------------------------------------------------
    -- Output contract: exact pg_proc signature check. RETURNS TABLE expands
    -- to OUT parameters; it does NOT create a named composite type, so the
    -- assertion reads proallargtypes/proargmodes/proargnames directly and
    -- verifies the single date input carries exactly one default.
    -- ------------------------------------------------------------------
    SELECT p.proargnames, p.proargmodes, p.pronargdefaults,
        (SELECT array_agg(format_type(t.oid, NULL) ORDER BY ord)
            FROM unnest(p.proallargtypes) WITH ORDINALITY AS t(oid, ord))
        INTO v_argnames, v_argmodes, v_nargdefaults, v_argtypes
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'list_day_quest_occurrences';
    IF v_argnames IS DISTINCT FROM ARRAY['p_day',
            'occurrence_id', 'quest_id', 'quest_title', 'status',
            'scheduled_at', 'deadline_at', 'source_slot_date',
            'execution_cycle', 'reward_exp_snapshot',
            'progression_ready', 'completable', 'already_completed_cycle'] THEN
        RAISE EXCEPTION 'Day-read argument names mismatch (input plus 12 ordered outputs)';
    END IF;
    IF v_argmodes IS DISTINCT FROM ARRAY['i',
            't', 't', 't', 't', 't', 't', 't', 't', 't', 't', 't', 't'] THEN
        RAISE EXCEPTION 'Day-read argument modes mismatch (one IN, twelve TABLE-mode outputs)';
    END IF;
    IF v_argtypes IS DISTINCT FROM ARRAY['date',
            'uuid', 'uuid', 'text', 'text',
            'timestamp with time zone', 'timestamp with time zone', 'date',
            'integer', 'integer', 'boolean', 'boolean', 'integer'] THEN
        RAISE EXCEPTION 'Day-read argument types mismatch (frozen order)';
    END IF;
    IF v_nargdefaults IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'Day-read must declare exactly one default argument (p_day DEFAULT NULL)';
    END IF;

    -- ------------------------------------------------------------------
    -- Ownership: the migration executor owns the read routine; it is never a
    -- browser or sibling-executor role.
    -- ------------------------------------------------------------------
    IF pg_get_userbyid(v_owner) IS DISTINCT FROM current_user THEN
        RAISE EXCEPTION 'Day-read function owner mismatch (expected the migration executor)';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_authid au WHERE au.oid = v_owner
        AND au.rolname IN ('anon', 'authenticated', 'authenticator', 'service_role',
            'quest_command_owner', 'progression_command_owner', 'level_policy_assignment_owner')) THEN
        RAISE EXCEPTION 'Day-read owner must not be a client or sibling-executor role';
    END IF;

    -- ------------------------------------------------------------------
    -- EXECUTE ACL: authenticated only; default PUBLIC and every sibling role
    -- revoked.
    -- ------------------------------------------------------------------
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated lost EXECUTE on the day-read function';
    END IF;
    IF has_function_privilege('public', fn, 'EXECUTE')
        OR has_function_privilege('anon', fn, 'EXECUTE')
        OR has_function_privilege('service_role', fn, 'EXECUTE')
        OR has_function_privilege('quest_command_owner', fn, 'EXECUTE')
        OR has_function_privilege('progression_command_owner', fn, 'EXECUTE')
        OR has_function_privilege('level_policy_assignment_owner', fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'Day-read EXECUTE granted beyond authenticated';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL unnest(COALESCE(p.proacl, '{}')) AS acl(a)
        WHERE n.nspname = 'public' AND p.proname = 'list_day_quest_occurrences'
            AND acl.a::text ~ '^='
    ) THEN
        RAISE EXCEPTION 'Day-read default PUBLIC EXECUTE not revoked';
    END IF;

    -- ------------------------------------------------------------------
    -- Additive-only guarantees: no new table and no drift to the existing
    -- Quest/Profile RLS + grant boundary.
    -- ------------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
            AND (c.relname LIKE '%day_quest%' OR c.relname LIKE '%day%occurrence%')
    ) THEN
        RAISE EXCEPTION 'Day-read migration must not create tables or views';
    END IF;
    -- Authenticated Quest/EXP/progression tables: read-only (unchanged loop).
    FOREACH tbl IN ARRAY ARRAY['quests', 'quest_recurrence_rules', 'quest_occurrences',
        'quest_events', 'exp_ledger', 'level_milestones', 'level_reward_unlocks'] LOOP
        IF NOT has_table_privilege('authenticated', 'public.'||tbl, 'SELECT') THEN
            RAISE EXCEPTION 'authenticated lost documented SELECT: %', tbl;
        END IF;
        FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
            IF has_table_privilege('authenticated', 'public.'||tbl, privilege) THEN
                RAISE EXCEPTION 'authenticated direct mutation drift: % %', tbl, privilege;
            END IF;
        END LOOP;
    END LOOP;
    -- Profiles contract (auth-profile-database-schema.md, Profiles migration):
    -- authenticated deliberately holds owner-scoped SELECT plus column-scoped
    -- UPDATE on exactly display_name and timezone, and nothing else. The
    -- assertion below matches that documented boundary instead of the generic
    -- read-only loop; it is tightened with column-level denials.
    IF NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN
        RAISE EXCEPTION 'authenticated lost documented SELECT on profiles';
    END IF;
    IF NOT has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
        OR NOT has_column_privilege('authenticated', 'public.profiles', 'timezone', 'UPDATE') THEN
        RAISE EXCEPTION 'authenticated lost documented column UPDATE on profiles';
    END IF;
    FOREACH tbl IN ARRAY ARRAY['user_id', 'created_at', 'updated_at'] LOOP
        IF has_column_privilege('authenticated', 'public.profiles', tbl, 'UPDATE') THEN
            RAISE EXCEPTION 'authenticated column UPDATE drift on profiles: %', tbl;
        END IF;
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['INSERT', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege('authenticated', 'public.profiles', privilege) THEN
            RAISE EXCEPTION 'authenticated profiles mutation drift: %', privilege;
        END IF;
    END LOOP;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon EXECUTE drift on day-read';
    END IF;
    FOREACH privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege('anon', 'public.quest_occurrences', privilege) THEN
            RAISE EXCEPTION 'anon table privilege drift: %', privilege;
        END IF;
    END LOOP;

    -- Frozen contract comment is attached.
    IF (SELECT obj_description(fn, 'pg_proc')) IS NULL THEN
        RAISE EXCEPTION 'Day-read function lacks its frozen contract comment';
    END IF;

    RAISE NOTICE 'Day-read catalog/security assertions passed';
END;
$catalog$;

ROLLBACK;


