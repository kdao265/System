\set ON_ERROR_STOP on
-- Quest atomic command catalog + security hardening validation.
-- Authority: quest-command-api-v1.md (frozen signatures, receipts, privilege matrix),
-- quest-database-schema.md, operator-authorization-v1.md.
-- Read-only, transactional, local-only: every assertion runs inside one
-- transaction that rolls back; no persistent state is created.
-- Follows the established sibling pattern (player-exp-catalog.sql,
-- level-rewards-catalog.sql) and runner:
--   Get-Content -Raw supabase/tests/quest-commands-catalog.sql | docker exec -i supabase_db_System psql -U postgres -d postgres -v ON_ERROR_STOP=1

BEGIN;

-- Catalog evidence dumps (read-only, order-stable).
SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS function_signature,
    p.prosecdef, p.proconfig, p.proacl,
    pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('complete_quest_occurrence','reopen_quest_occurrence')
    ORDER BY 1;
SELECT c.relname AS composite_type,
    string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ', ' ORDER BY a.attnum) AS attributes
    FROM pg_type t
    JOIN pg_namespace n ON n.oid=t.typnamespace
    JOIN pg_class c ON c.oid=t.typrelid
    JOIN pg_attribute a ON a.attrelid=t.typrelid
    WHERE n.nspname='public' AND t.typname IN ('quest_completion_receipt','quest_reopen_receipt')
    GROUP BY c.relname ORDER BY 1;
DO $catalog$


DECLARE
    fn_complete oid := 'public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text)'::regprocedure;
    fn_reopen  oid := 'public.reopen_quest_occurrence(uuid,uuid,text)'::regprocedure;
    expected_complete_cols text :=
        'command_id:uuid,occurrence_id:uuid,quest_id:uuid,execution_cycle:integer,' ||
        'completed_event_id:uuid,exp_entry_id:uuid,exp_amount:bigint,' ||
        'reported_completed_at:timestamp with time zone,' ||
        'recorded_completed_at:timestamp with time zone,replay:boolean';
    expected_reopen_cols text :=
        'command_id:uuid,occurrence_id:uuid,quest_id:uuid,undone_cycle:integer,' ||
        'correction_event_id:uuid,reopened_event_id:uuid,reversal_entry_id:uuid,' ||
        'reversed_amount:bigint,original_credit_entry_id:uuid,replay:boolean';
    browser_roles text[] := ARRAY['anon','authenticated','authenticator','service_role'];
    role_name text;
BEGIN
    -- ------------------------------------------------------------------
    -- Command functions: exactly one overload each, frozen signature.
    -- ------------------------------------------------------------------
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='complete_quest_occurrence') <> 1
        OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='reopen_quest_occurrence') <> 1 THEN
        RAISE EXCEPTION 'Command function count/overload mismatch';
    END IF;
    IF fn_complete IS NULL OR fn_reopen IS NULL THEN
        RAISE EXCEPTION 'Command function signature mismatch';
    END IF;

    -- ------------------------------------------------------------------
    -- Receipt composite types: exact ordered attribute sets.
    -- ------------------------------------------------------------------
    IF (SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ',' ORDER BY a.attnum)
        FROM pg_type t
        JOIN pg_attribute a ON a.attrelid=t.typrelid AND NOT a.attisdropped
        WHERE t.oid='public.quest_completion_receipt'::regtype)
        IS DISTINCT FROM expected_complete_cols THEN
        RAISE EXCEPTION 'quest_completion_receipt attribute mismatch';
    END IF;
    IF (SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ',' ORDER BY a.attnum)
        FROM pg_type t
        JOIN pg_attribute a ON a.attrelid=t.typrelid AND NOT a.attisdropped
        WHERE t.oid='public.quest_reopen_receipt'::regtype)
        IS DISTINCT FROM expected_reopen_cols THEN
        RAISE EXCEPTION 'quest_reopen_receipt attribute mismatch';
    END IF;
    IF (SELECT t.typtype FROM pg_type t WHERE t.oid='public.quest_completion_receipt'::regtype) <> 'c'
        OR (SELECT t.typtype FROM pg_type t WHERE t.oid='public.quest_reopen_receipt'::regtype) <> 'c' THEN
        RAISE EXCEPTION 'Receipt types are not composite types';
    END IF;

    -- ------------------------------------------------------------------
    -- Function ownership and definer hygiene.
    -- ------------------------------------------------------------------
    IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid=fn_complete) <> 'quest_command_owner'
        OR (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid=fn_reopen) <> 'quest_command_owner' THEN
        RAISE EXCEPTION 'Command function owner mismatch';
    END IF;
    IF (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid=fn_complete)
        OR (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid=fn_reopen) THEN
        RAISE EXCEPTION 'Command functions must be SECURITY DEFINER';
    END IF;
    IF (SELECT p.proconfig FROM pg_proc p WHERE p.oid=fn_complete) IS DISTINCT FROM ARRAY['search_path=pg_catalog']
        OR (SELECT p.proconfig FROM pg_proc p WHERE p.oid=fn_reopen) IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
        RAISE EXCEPTION 'Command function search_path mismatch';
    END IF;

    -- ------------------------------------------------------------------
    -- EXECUTE matrix: authenticated only; never PUBLIC/anon/service_role;
    -- no unintended grants to sibling executor roles or the owner itself.
    -- ------------------------------------------------------------------
    IF NOT has_function_privilege('authenticated', fn_complete, 'EXECUTE')
        OR NOT has_function_privilege('authenticated', fn_reopen, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated must have EXECUTE on both commands';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','public','service_role','quest_command_owner',
        'progression_command_owner','level_policy_assignment_owner'] LOOP
        IF has_function_privilege(role_name, fn_complete, 'EXECUTE')
            OR has_function_privilege(role_name, fn_reopen, 'EXECUTE') THEN
            RAISE EXCEPTION 'Unintended EXECUTE grant on quest commands: %', role_name;
        END IF;
    END LOOP;
    -- The function ACL must be exactly the frozen grant set: only
    -- authenticated holds EXECUTE, granted by quest_command_owner.
    IF (SELECT p.proacl::text[] FROM pg_proc p WHERE p.oid=fn_complete)
        IS DISTINCT FROM ARRAY['authenticated=X/quest_command_owner']
        OR (SELECT p.proacl::text[] FROM pg_proc p WHERE p.oid=fn_reopen)
        IS DISTINCT FROM ARRAY['authenticated=X/quest_command_owner'] THEN
        RAISE EXCEPTION 'Function ACL grant set mismatch';
    END IF;

    -- ------------------------------------------------------------------
    -- Durable post-migration state of the temporary owner-transfer grant:
    -- no CREATE on public, no login/bypass capability, no browser role
    -- membership on quest_command_owner.
    -- ------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname='quest_command_owner') THEN
        RAISE EXCEPTION 'quest_command_owner missing';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname='quest_command_owner'
        AND (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolreplication
            OR r.rolcreatedb OR r.rolcreaterole)) THEN
        RAISE EXCEPTION 'quest_command_owner unsafe role attributes';
    END IF;
    IF has_schema_privilege('quest_command_owner','public','CREATE') THEN
        RAISE EXCEPTION 'quest_command_owner retains CREATE on schema public';
    END IF;
    IF has_database_privilege('quest_command_owner','postgres','CREATE') THEN
        RAISE EXCEPTION 'quest_command_owner retains CREATE on database';
    END IF;
    FOREACH role_name IN ARRAY browser_roles LOOP
        IF pg_has_role(role_name,'quest_command_owner','MEMBER') THEN
            RAISE EXCEPTION 'quest_command_owner membership leaked to %', role_name;
        END IF;
    END LOOP;
    -- USAGE on schema public is a legitimate architectural requirement and is
    -- intentionally not revoked; CREATE (the temporary migration capability)
    -- must not survive.
    IF NOT has_schema_privilege('quest_command_owner','public','USAGE') THEN
        RAISE EXCEPTION 'quest_command_owner lost required USAGE on schema public';
    END IF;

    -- ------------------------------------------------------------------
    -- Frozen boundary: no durable ownership outside the command functions.
    -- ------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public'
            AND pg_get_userbyid(c.relowner)='quest_command_owner'
            AND c.relkind IN ('r','v','m','S','f','p')) THEN
        RAISE EXCEPTION 'quest_command_owner unexpectedly owns a public relation';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace n
        WHERE pg_get_userbyid(n.nspowner)='quest_command_owner') THEN
        RAISE EXCEPTION 'quest_command_owner unexpectedly owns a schema';
    END IF;
    -- Receipt types follow the sibling convention: the migration runner owns
    -- relations/types and only command functions are transferred to the
    -- executor role, so assert only that no browser-facing role owns them.
    IF EXISTS (SELECT 1 FROM pg_type t
        WHERE t.oid IN ('public.quest_completion_receipt'::regtype,
                        'public.quest_reopen_receipt'::regtype)
            AND t.typowner::regrole::text IN
                ('anon','authenticated','authenticator','service_role')) THEN
        RAISE EXCEPTION 'Receipt type owned by a browser-facing role';
    END IF;
END;
$catalog$;

-- Table-privilege boundary evidence.
SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name IN
        ('quests','quest_occurrences','quest_events','exp_ledger','level_milestones','level_reward_unlocks')
    GROUP BY grantee, table_name ORDER BY table_name, grantee;
SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolreplication
    FROM pg_roles r
    WHERE r.rolname IN ('quest_command_owner','progression_command_owner','level_policy_assignment_owner')
    ORDER BY r.rolname;

DO $boundary$
DECLARE
    tbl text;
    privilege text;
BEGIN
    -- ------------------------------------------------------------------
    -- quest_command_owner table privileges: SELECT/INSERT everywhere in its
    -- boundary, UPDATE only on the Quest projection tables, and never
    -- DELETE/TRUNCATE/UPDATE on append-only history.
    -- ------------------------------------------------------------------
    FOREACH tbl IN ARRAY ARRAY['quests','quest_occurrences','quest_events','exp_ledger',
        'level_milestones','level_reward_unlocks'] LOOP
        IF NOT has_table_privilege('quest_command_owner','public.'||tbl,'SELECT')
            OR NOT has_table_privilege('quest_command_owner','public.'||tbl,'INSERT') THEN
            RAISE EXCEPTION 'quest_command_owner missing boundary grant: %', tbl;
        END IF;
        IF has_table_privilege('quest_command_owner','public.'||tbl,'DELETE')
            OR has_table_privilege('quest_command_owner','public.'||tbl,'TRUNCATE') THEN
            RAISE EXCEPTION 'quest_command_owner retains history mutation: %', tbl;
        END IF;
    END LOOP;
    IF NOT has_table_privilege('quest_command_owner','public.quest_occurrences','UPDATE')
        OR NOT has_table_privilege('quest_command_owner','public.quests','UPDATE') THEN
        RAISE EXCEPTION 'quest_command_owner missing projection UPDATE grant';
    END IF;
    IF has_table_privilege('quest_command_owner','public.quest_events','UPDATE')
        OR has_table_privilege('quest_command_owner','public.exp_ledger','UPDATE')
        OR has_table_privilege('quest_command_owner','public.level_milestones','UPDATE')
        OR has_table_privilege('quest_command_owner','public.level_reward_unlocks','UPDATE') THEN
        RAISE EXCEPTION 'quest_command_owner retains UPDATE on append-only history';
    END IF;
    -- The whole durable grant inventory of the role is exactly its documented
    -- boundary: the Quest domain, its EXP append authority and the Level
    -- recognition read grants (frozen by level-rewards-catalog.sql).
    IF (SELECT string_agg(DISTINCT table_name, ',' ORDER BY table_name)
        FROM information_schema.role_table_grants WHERE grantee='quest_command_owner')
        IS DISTINCT FROM 'exp_ledger,level_milestones,level_policies,level_reward_definitions,' ||
            'level_reward_events,level_reward_unlocks,level_thresholds,' ||
            'progression_policy_assignments,quest_events,quest_occurrences,quest_recurrence_rules,quests' THEN
        RAISE EXCEPTION 'quest_command_owner unexpected table grant inventory';
    END IF;
    IF (SELECT string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type)
        FROM information_schema.role_table_grants WHERE grantee='quest_command_owner')
        IS DISTINCT FROM 'INSERT,SELECT,UPDATE' THEN
        RAISE EXCEPTION 'quest_command_owner unexpected table privilege inventory';
    END IF;

    -- ------------------------------------------------------------------
    -- Browser/runtime roles: no direct mutation of protected history/state.
    -- authenticated keeps only documented SELECT reads.
    -- ------------------------------------------------------------------
    FOREACH tbl IN ARRAY ARRAY['quests','quest_occurrences','quest_events','exp_ledger',
        'level_milestones','level_reward_unlocks'] LOOP
        IF NOT has_table_privilege('authenticated','public.'||tbl,'SELECT') THEN
            RAISE EXCEPTION 'authenticated lost documented SELECT: %', tbl;
        END IF;
        FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
            IF has_table_privilege('authenticated','public.'||tbl,privilege) THEN
                RAISE EXCEPTION 'authenticated direct mutation drift: % %', tbl, privilege;
            END IF;
        END LOOP;
    END LOOP;
    FOREACH tbl IN ARRAY ARRAY['quests','quest_occurrences','quest_events','exp_ledger',
        'level_milestones','level_reward_unlocks'] LOOP
        FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
            'REFERENCES','TRIGGER'] LOOP
            IF has_table_privilege('anon','public.'||tbl,privilege) THEN
                RAISE EXCEPTION 'anon table privilege drift: % %', tbl, privilege;
            END IF;
        END LOOP;
    END LOOP;
    -- No browser-facing or sibling-executor membership on the command owner.
    IF EXISTS (SELECT 1 FROM pg_auth_members m
        WHERE m.roleid='quest_command_owner'::regrole
            AND m.member::regrole::text IN
                ('anon','authenticated','authenticator','service_role',
                 'progression_command_owner','level_policy_assignment_owner')) THEN
        RAISE EXCEPTION 'quest_command_owner membership leak';
    END IF;

    RAISE NOTICE 'Quest command catalog/security assertions passed';
END;
$boundary$;

ROLLBACK;

