\set ON_ERROR_STOP on
-- Level/Reward catalog validation. Read-only structure/privilege assertions against the
-- frozen design; disposable LOCAL database only. Every check runs in a rollback transaction.
BEGIN;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid IN ('public.level_policies'::regclass,'public.level_thresholds'::regclass,
        'public.progression_policy_assignments'::regclass,'public.level_milestones'::regclass,
        'public.level_reward_definitions'::regclass,'public.level_reward_unlocks'::regclass,
        'public.level_reward_events'::regclass,'system_internal.operator_grants'::regclass)
    ORDER BY conrelid::regclass::text, conname;
SELECT policyname, roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname IN ('public','system_internal') AND tablename IN
        ('level_policies','level_thresholds','progression_policy_assignments','level_milestones',
         'level_reward_definitions','level_reward_unlocks','level_reward_events','operator_grants')
    ORDER BY tablename, policyname;
SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema IN ('public','system_internal') AND table_name IN
        ('level_policies','level_thresholds','progression_policy_assignments','level_milestones',
         'level_reward_definitions','level_reward_unlocks','level_reward_events','operator_grants')
    ORDER BY table_name, grantee, privilege_type;
SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('progression_internal','system_internal')
        OR (n.nspname='public' AND p.proname IN ('assign_level_policy','configure_level_reward',
            'update_level_reward','cancel_level_reward','redeem_level_reward','get_progression_status',
            'list_level_rewards','get_reward_history'))
    ORDER BY p.oid::regprocedure::text;
DO $catalog$
DECLARE
    tbl text; privilege text; routine record;
    expected_tables text[] := ARRAY['level_policies','level_thresholds','progression_policy_assignments',
        'level_milestones','level_reward_definitions','level_reward_unlocks','level_reward_events'];
BEGIN
    -- Eight relations, RLS enabled, owned by the migration role, plus the private grant table.
    FOREACH tbl IN ARRAY expected_tables LOOP
        IF (SELECT c.relowner <> (SELECT oid FROM pg_roles WHERE rolname='postgres')
            OR NOT c.relrowsecurity OR c.relforcerowsecurity
            FROM pg_class c WHERE c.oid = ('public.'||tbl)::regclass::oid) IS DISTINCT FROM false THEN
            RAISE EXCEPTION 'Relation boundary mismatch: %', tbl;
        END IF;
    END LOOP;
    IF (SELECT relowner <> (SELECT oid FROM pg_roles WHERE rolname='postgres') OR NOT relrowsecurity
        FROM pg_class WHERE oid='system_internal.operator_grants'::regclass) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Grant table boundary mismatch';
    END IF;
    IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='system_internal' AND c.relkind='r') <> 1 THEN
        RAISE EXCEPTION 'Unexpected system_internal relation';
    END IF;

    -- Exact column sets per table (order-sensitive).
    IF (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='public.level_policies'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'id,policy_key,version,name,status,created_at,published_at'
        OR (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='public.level_thresholds'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'policy_id,level,required_exp'
        OR (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='public.progression_policy_assignments'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'id,user_id,policy_id,assignment_sequence,command_id,evaluated_exp,actor_user_id,origin,recorded_at'
        OR (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='public.level_milestones'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'id,user_id,level,policy_assignment_id,policy_id,evaluated_exp,cause_kind,cause_ledger_entry_id,actor_user_id,origin,reached_at' THEN
        RAISE EXCEPTION 'Level/Reward columns mismatch (configuration/history)';
    END IF;
    IF (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='public.level_reward_definitions'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'id,user_id,required_level,title,description,category,estimated_cost,currency_label,revision,archived_at,created_at,updated_at'
        OR (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='public.level_reward_unlocks'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'id,user_id,reward_id,milestone_id,definition_event_id,required_level,definition_revision,title,description,category,estimated_cost,currency_label,unlocked_at'
        OR (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='public.level_reward_events'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'id,user_id,command_id,event_type,reward_id,unlock_id,definition_revision,payload_version,request,before,after,actor_user_id,origin,recorded_at'
        OR (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
        WHERE attrelid='system_internal.operator_grants'::regclass AND attnum>0 AND NOT attisdropped)
        IS DISTINCT FROM 'id,user_id,capability,granted_at,revoked_at' THEN
        RAISE EXCEPTION 'Level/Reward columns mismatch (rewards/grants)';
    END IF;

    -- Keys, checks, indexes, policies and guards per table.
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.level_policies'::regclass) <> 8
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.level_thresholds'::regclass) <> 5
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.progression_policy_assignments'::regclass) <> 11
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.level_milestones'::regclass) <> 13
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.level_reward_definitions'::regclass) <> 8
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.level_reward_events'::regclass) <> 15
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.level_reward_unlocks'::regclass) <> 12
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='system_internal.operator_grants'::regclass) <> 4 THEN
        RAISE EXCEPTION 'Constraint inventory mismatch';
    END IF;
    IF (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='level_policies') <> 3
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='level_thresholds') <> 2
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='progression_policy_assignments') <> 6
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='level_milestones') <> 4
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='level_reward_definitions') <> 3
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='level_reward_events') <> 7
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='level_reward_unlocks') <> 5
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='system_internal' AND tablename='operator_grants') <> 2 THEN
        RAISE EXCEPTION 'Index inventory mismatch';
    END IF;
    IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.level_policies'::regclass) <> 1
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.level_thresholds'::regclass) <> 1
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.progression_policy_assignments'::regclass) <> 3
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.level_milestones'::regclass) <> 4
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.level_reward_definitions'::regclass) <> 4
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.level_reward_events'::regclass) <> 3
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.level_reward_unlocks'::regclass) <> 4
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='system_internal.operator_grants'::regclass) <> 1 THEN
        RAISE EXCEPTION 'Policy inventory mismatch';
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.level_policies'::regclass AND NOT tgisinternal AND tgenabled='O') <> 3
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.level_thresholds'::regclass AND NOT tgisinternal AND tgenabled='O') <> 2
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.progression_policy_assignments'::regclass AND NOT tgisinternal AND tgenabled='O') <> 2
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.level_milestones'::regclass AND NOT tgisinternal AND tgenabled='O') <> 2
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.level_reward_definitions'::regclass AND NOT tgisinternal AND tgenabled='O') <> 3
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.level_reward_events'::regclass AND NOT tgisinternal AND tgenabled='O') <> 2
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.level_reward_unlocks'::regclass AND NOT tgisinternal AND tgenabled='O') <> 2
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='system_internal.operator_grants'::regclass AND NOT tgisinternal AND tgenabled='O') <> 4 THEN
        RAISE EXCEPTION 'Trigger inventory mismatch';
    END IF;

    -- Frozen executor roles: non-login, unprivileged, not inherited by browser roles.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('progression_command_owner','level_policy_assignment_owner')
        AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
        RAISE EXCEPTION 'Unsafe executor role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members am
        JOIN pg_roles r ON r.oid=am.roleid JOIN pg_roles m ON m.oid=am.member
        WHERE r.rolname IN ('progression_command_owner','level_policy_assignment_owner')
            AND m.rolname IN ('anon','authenticated','authenticator','service_role','quest_command_owner')) THEN
        RAISE EXCEPTION 'Leaked executor role membership';
    END IF;

    -- Private schemas and routines: browser roles get nothing new.
    FOREACH privilege IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF has_schema_privilege(privilege,'progression_internal','USAGE')
            OR has_schema_privilege(privilege,'progression_internal','CREATE') THEN
            RAISE EXCEPTION 'Leaked progression_internal schema access: %', privilege;
        END IF;
        IF has_schema_privilege(privilege,'system_internal','CREATE') THEN
            RAISE EXCEPTION 'Leaked system_internal schema CREATE: %', privilege;
        END IF;
        FOR routine IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='progression_internal' LOOP
            IF has_function_privilege(privilege,routine.oid,'EXECUTE') THEN
                RAISE EXCEPTION 'Leaked private execution: % %', privilege, routine.oid::regprocedure;
            END IF;
        END LOOP;
        FOR routine IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='system_internal'
                AND p.oid <> 'system_internal.request_user_id()'::regprocedure LOOP
            IF has_function_privilege(privilege,routine.oid,'EXECUTE') THEN
                RAISE EXCEPTION 'Leaked system_internal execution: % %', privilege, routine.oid::regprocedure;
            END IF;
        END LOOP;
    END LOOP;
    IF NOT has_function_privilege('authenticated','system_internal.request_user_id()'::regprocedure,'EXECUTE')
        OR has_function_privilege('anon','system_internal.request_user_id()'::regprocedure,'EXECUTE') THEN
        RAISE EXCEPTION 'Request identity EXECUTE boundary mismatch';
    END IF;

    -- Table grants: browser SELECT-only; executors per the frozen matrix; anon/service_role nothing.
    FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege('authenticated','public.level_policies',privilege)
            OR has_table_privilege('authenticated','public.level_thresholds',privilege)
            OR has_table_privilege('authenticated','public.progression_policy_assignments',privilege)
            OR has_table_privilege('authenticated','public.level_milestones',privilege)
            OR has_table_privilege('authenticated','public.level_reward_definitions',privilege)
            OR has_table_privilege('authenticated','public.level_reward_unlocks',privilege)
            OR has_table_privilege('authenticated','public.level_reward_events',privilege) THEN
            RAISE EXCEPTION 'Browser write grant on level tables';
        END IF;
    END LOOP;
    FOREACH tbl IN ARRAY expected_tables LOOP
        IF has_table_privilege('anon','public.'||tbl,'SELECT')
            OR has_table_privilege('service_role','public.'||tbl,'SELECT')
            OR NOT has_table_privilege('authenticated','public.'||tbl,'SELECT') THEN
            RAISE EXCEPTION 'Owner SELECT boundary mismatch: %', tbl;
        END IF;
    END LOOP;
    IF NOT (has_table_privilege('quest_command_owner','public.level_milestones','INSERT')
        AND has_table_privilege('quest_command_owner','public.level_reward_unlocks','INSERT'))
        OR has_table_privilege('quest_command_owner','public.level_reward_definitions','INSERT')
        OR has_table_privilege('quest_command_owner','public.level_reward_events','INSERT') THEN
        RAISE EXCEPTION 'Quest command grant matrix mismatch';
    END IF;
    IF NOT (has_table_privilege('progression_command_owner','public.level_reward_definitions','UPDATE')
        AND has_table_privilege('progression_command_owner','public.level_reward_events','INSERT'))
        OR has_table_privilege('progression_command_owner','public.level_policies','INSERT')
        OR has_table_privilege('progression_command_owner','public.level_thresholds','INSERT') THEN
        RAISE EXCEPTION 'Progression command grant matrix mismatch';
    END IF;
    IF NOT (has_table_privilege('level_policy_assignment_owner','public.progression_policy_assignments','INSERT')
        AND has_table_privilege('level_policy_assignment_owner','public.level_milestones','INSERT')
        AND has_table_privilege('level_policy_assignment_owner','public.level_reward_unlocks','INSERT')
        AND has_table_privilege('level_policy_assignment_owner','system_internal.operator_grants','SELECT'))
        OR has_table_privilege('level_policy_assignment_owner','system_internal.operator_grants','INSERT')
        OR has_table_privilege('level_policy_assignment_owner','public.level_reward_events','INSERT')
        OR has_table_privilege('level_policy_assignment_owner','public.level_reward_definitions','INSERT')
        OR has_table_privilege('level_policy_assignment_owner','public.level_reward_definitions','UPDATE') THEN
        RAISE EXCEPTION 'Assignment executor grant matrix mismatch';
    END IF;

    -- Routine security: fixed search_path everywhere; definer only for the five commands;
    -- exact private routine inventory.
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE (n.nspname IN ('progression_internal','system_internal')
            OR (n.nspname='public' AND p.proname IN ('assign_level_policy','configure_level_reward',
                'update_level_reward','cancel_level_reward','redeem_level_reward','get_progression_status',
                'list_level_rewards','get_reward_history')))
            AND (p.prosecdef AND NOT (n.nspname='public' AND p.proname IN ('assign_level_policy',
                'configure_level_reward','update_level_reward','cancel_level_reward','redeem_level_reward')))) THEN
        RAISE EXCEPTION 'Unexpected SECURITY DEFINER routine';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE (n.nspname IN ('progression_internal','system_internal')
            OR (n.nspname='public' AND p.proname IN ('assign_level_policy','configure_level_reward',
                'update_level_reward','cancel_level_reward','redeem_level_reward','get_progression_status',
                'list_level_rewards','get_reward_history')))
            AND NOT ('search_path=pg_catalog'=ANY(p.proconfig))) THEN
        RAISE EXCEPTION 'Routine search_path mismatch';
    END IF;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='progression_internal') <> 26
        OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='system_internal') <> 5 THEN
        RAISE EXCEPTION 'Private routine inventory mismatch';
    END IF;

    -- Public command/read EXECUTE: authenticated only, never PUBLIC/anon/service_role.
    FOR routine IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('assign_level_policy','configure_level_reward',
            'update_level_reward','cancel_level_reward','redeem_level_reward','get_progression_status',
            'list_level_rewards','get_reward_history') LOOP
        IF has_function_privilege('anon',routine.oid,'EXECUTE')
            OR has_function_privilege('public',routine.oid,'EXECUTE')
            OR has_function_privilege('service_role',routine.oid,'EXECUTE')
            OR NOT has_function_privilege('authenticated',routine.oid,'EXECUTE') THEN
            RAISE EXCEPTION 'Public routine EXECUTE boundary mismatch: %', routine.oid::regprocedure;
        END IF;
    END LOOP;

    -- Seed: exactly one published v1 policy with 100 exact thresholds and an empty runtime state.
    IF (SELECT count(*) FROM public.level_policies WHERE status='published') <> 1
        OR NOT EXISTS (SELECT 1 FROM public.level_policies
            WHERE policy_key='level_policy_v1' AND version=1 AND status='published'
            AND published_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Seed policy mismatch';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.level_policies p JOIN public.level_thresholds t ON t.policy_id=p.id
        WHERE p.policy_key='level_policy_v1' AND p.version=1
        GROUP BY p.id
        HAVING count(*) = 100
            AND min(t.level)=1 AND max(t.level)=100
            AND min(t.required_exp)=0 AND max(t.required_exp)=980100
            AND bool_and(t.required_exp = (100*(t.level-1)*(t.level-1))::numeric)) THEN
        RAISE EXCEPTION 'Seed threshold mismatch';
    END IF;
    IF (SELECT count(*) FROM public.progression_policy_assignments) <> 0
        OR (SELECT count(*) FROM public.level_milestones) <> 0
        OR (SELECT count(*) FROM public.level_reward_definitions) <> 0
        OR (SELECT count(*) FROM public.level_reward_unlocks) <> 0
        OR (SELECT count(*) FROM public.level_reward_events) <> 0
        OR (SELECT count(*) FROM system_internal.operator_grants) <> 0 THEN
        RAISE EXCEPTION 'Fresh deployment state mismatch';
    END IF;
    RAISE NOTICE 'Level/Reward catalog assertions passed';
END;
$catalog$;
ROLLBACK;
