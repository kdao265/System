\set ON_ERROR_STOP on
-- Quest Reopen V2 catalog + security hardening validation.
-- Authority: ADR quest-reopen-guard-v2 (docs/02-architecture/decisions.md),
-- quest-command-api-v1.md and its V2 appendix, quest-database-schema.md,
-- operator-authorization-v1.md.
-- Read-only, transactional, local-only: every assertion runs inside one
-- transaction that rolls back; no persistent state is created.
-- Effective privileges are asserted with has_function_privilege, not by
-- textual grant inspection, so indirect role-inheritance paths are covered.

BEGIN;

SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS function_signature,
    p.prosecdef, p.proconfig, p.proacl,
    pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
        AND p.proname IN ('complete_quest_occurrence','reopen_quest_occurrence','reopen_quest_occurrence_v2')
    ORDER BY 1;

DO $catalog$
DECLARE
    fn_v1  oid := 'public.reopen_quest_occurrence(uuid,uuid,text)'::regprocedure;
    fn_v2  oid := 'public.reopen_quest_occurrence_v2(uuid,uuid,integer,text)'::regprocedure;
    fn_c   oid := 'public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text)'::regprocedure;
    expected_reopen_cols text :=
        'command_id:uuid,occurrence_id:uuid,quest_id:uuid,undone_cycle:integer,' ||
        'correction_event_id:uuid,reopened_event_id:uuid,reversal_entry_id:uuid,' ||
        'reversed_amount:bigint,original_credit_entry_id:uuid,replay:boolean';
    v1_owner text;
    v2_owner text;
    v2_secdef boolean;
    v2_config text[];
    role_name text;
    application_roles text[] := ARRAY['anon','authenticated','service_role',
        'progression_command_owner','level_policy_assignment_owner'];
    inappropriate text[] := ARRAY['anon','service_role',
        'progression_command_owner','level_policy_assignment_owner'];
BEGIN
    -- Exactly one overload each; V2 signature frozen.
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='reopen_quest_occurrence_v2') <> 1 THEN
        RAISE EXCEPTION 'V2 function count/overload mismatch';
    END IF;
    IF fn_v2 IS NULL THEN
        RAISE EXCEPTION 'V2 function signature mismatch';
    END IF;

    -- Return composite is the unchanged historical quest_reopen_receipt.
    IF (SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ',' ORDER BY a.attnum)
        FROM pg_type t
        JOIN pg_namespace n ON n.oid=t.typnamespace
        JOIN pg_attribute a ON a.attrelid=t.typrelid AND NOT a.attisdropped
        WHERE t.typname='quest_reopen_receipt' AND n.nspname='public'
            AND (SELECT relkind FROM pg_class WHERE oid=t.typrelid)='c')
        IS DISTINCT FROM expected_reopen_cols THEN
        RAISE EXCEPTION 'quest_reopen_receipt shape changed';
    END IF;
    IF (SELECT p.prorettype FROM pg_proc p WHERE p.oid = fn_v2)
        IS DISTINCT FROM 'public.quest_reopen_receipt'::regtype THEN
        RAISE EXCEPTION 'V2 return type mismatch';
    END IF;

    -- Owners and definer configuration follow the frozen command pattern.
    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
        INTO v2_owner, v2_secdef, v2_config
        FROM pg_proc p WHERE p.oid = fn_v2;
    SELECT pg_get_userbyid(p.proowner) INTO v1_owner FROM pg_proc p WHERE p.oid = fn_v1;
    IF v1_owner IS DISTINCT FROM 'quest_command_owner'
        OR v2_owner IS DISTINCT FROM 'quest_command_owner' THEN
        RAISE EXCEPTION 'Command owner mismatch: v1=% v2=%', v1_owner, v2_owner;
    END IF;
    IF v2_secdef IS NOT TRUE
        OR v2_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
        RAISE EXCEPTION 'V2 definer/search_path configuration drift';
    END IF;

    -- V2 EXECUTE: authenticated only among browser/runtime roles.
    IF NOT has_function_privilege('authenticated', fn_v2, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated lost EXECUTE on V2';
    END IF;
    FOREACH role_name IN ARRAY inappropriate LOOP
        IF has_function_privilege(role_name, fn_v2, 'EXECUTE') THEN
            RAISE EXCEPTION '% has EXECUTE on V2', role_name;
        END IF;
    END LOOP;
    IF has_function_privilege('public', fn_v2, 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC has EXECUTE on V2';
    END IF;

    -- V1 permission change (ADR): authenticated must no longer hold EXECUTE,
    -- directly or through any inherited role. PUBLIC and the other application
    -- roles must also be denied, and the denial must hold from the
    -- authenticator switch perspective.
    IF has_function_privilege('authenticated', fn_v1, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated still has EXECUTE on V1';
    END IF;
    IF has_function_privilege('anon', fn_v1, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon has EXECUTE on V1';
    END IF;
    IF has_function_privilege('service_role', fn_v1, 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role has EXECUTE on V1';
    END IF;
    IF has_function_privilege('public', fn_v1, 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC has EXECUTE on V1';
    END IF;
    FOREACH role_name IN ARRAY
        ARRAY['progression_command_owner','level_policy_assignment_owner'] LOOP
        IF has_function_privilege(role_name, fn_v1, 'EXECUTE') THEN
            RAISE EXCEPTION '% has EXECUTE on V1', role_name;
        END IF;
    END LOOP;
    -- No role-membership path from authenticated reaches quest_command_owner.
    IF EXISTS (
        WITH RECURSIVE reachable AS (
            SELECT 'authenticated'::regrole AS role
            UNION
            SELECT m.roleid
            FROM pg_auth_members m
            JOIN reachable r ON m.member = r.role
        )
        SELECT 1 FROM reachable WHERE role = 'quest_command_owner'::regrole
    ) THEN
        RAISE EXCEPTION 'authenticated membership path reaches quest_command_owner';
    END IF;
    FOREACH role_name IN ARRAY application_roles LOOP
        IF pg_has_role(role_name, 'quest_command_owner', 'MEMBER') THEN
            RAISE EXCEPTION 'application role membership reaches quest_command_owner: %', role_name;
        END IF;
    END LOOP;
    IF has_schema_privilege('quest_command_owner', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'quest_command_owner retains CREATE on schema public';
    END IF;

    -- The historical completion command is untouched by this migration.
    IF NOT has_function_privilege('authenticated', fn_c, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated lost EXECUTE on completion command';
    END IF;

    RAISE NOTICE 'Reopen V2 catalog/security assertions passed';
END;
$catalog$;

ROLLBACK;
