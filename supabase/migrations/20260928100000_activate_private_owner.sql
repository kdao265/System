-- ADR-015 stage 2 activation, promoted into the automatic migration directory by
-- Product Owner authorization on 2026-09-28. Its fail-closed preflight still requires
-- one verified owner configuration with an Auth user and Profile, so the normal
-- migration sequence cannot activate an unprovisioned database. Apply only after
-- stage 1 plus approved owner provisioning and identity verification.
-- See docs/04-development/private-auth-database.md. Atomic and fail-closed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE system_private.owner_configuration IN SHARE MODE;
DO $preflight$
BEGIN
    IF (SELECT count(*) FROM system_private.owner_configuration) <> 1
        OR NOT EXISTS (
            SELECT 1 FROM system_private.owner_configuration c
            JOIN auth.users u ON u.id = c.user_id
            JOIN public.profiles p ON p.user_id = c.user_id
            WHERE c.singleton
        ) THEN
        RAISE EXCEPTION 'Private owner activation requires verified owner configuration and Profile';
    END IF;
END;
$preflight$;

-- Preserve every existing permissive policy; these predicates can only narrow it.
-- The assignment executor is also row-bound to the approved owner, not merely
-- allowed to read any target when the requesting actor happens to be the owner.
DO $policies$
DECLARE target text;
BEGIN
    FOREACH target IN ARRAY ARRAY[
        'public.profiles', 'public.quests', 'public.quest_recurrence_rules',
        'public.quest_occurrences', 'public.quest_events', 'public.exp_ledger',
        'public.progression_policy_assignments', 'public.level_milestones',
        'public.level_reward_definitions', 'public.level_reward_unlocks',
        'public.level_reward_events', 'system_internal.operator_grants',
        'system_internal.quest_completion_aliases'
    ] LOOP
        EXECUTE format(
            'CREATE POLICY system_single_owner ON %s AS RESTRICTIVE FOR ALL
             TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner
             USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
             WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))',
            target::regclass);
    END LOOP;
    FOREACH target IN ARRAY ARRAY['public.level_policies', 'public.level_thresholds'] LOOP
        EXECUTE format(
            'CREATE POLICY system_single_owner ON %s AS RESTRICTIVE FOR ALL
             TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner
             USING ((SELECT system_private.is_owner())) WITH CHECK ((SELECT system_private.is_owner()))',
            target::regclass);
    END LOOP;
END;
$policies$;

-- Guard exact, audited migration-10 implementations without copying domain code.
-- pg_get_functiondef retains signature/defaults/volatility/security/search_path;
-- CREATE OR REPLACE retains OIDs, owners, dependencies, grants and comments.
-- Reject source drift rather than silently patching an unfamiliar implementation.
DO $rpc_guards$
DECLARE
    item record;
    routine pg_catalog.pg_proc;
    definition text;
    guarded text;
    entry_guard text;
    role_name text;
    migration_role text := current_user;
    membership record;
    saved_memberships jsonb := '[]'::jsonb;
    added_create text[] := ARRAY[]::text[];
    temporary_execute boolean;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['quest_command_owner', 'progression_command_owner', 'level_policy_assignment_owner'] LOOP
        IF NOT pg_catalog.pg_has_role(current_user, role_name, 'SET') THEN
            saved_memberships := saved_memberships || jsonb_build_array(jsonb_build_object(
                'role', role_name, 'previous', (SELECT to_jsonb(m) FROM pg_catalog.pg_auth_members m
                    WHERE m.roleid = role_name::regrole AND m.member = current_user::regrole
                        AND m.grantor = current_user::regrole)));
            EXECUTE format('GRANT %I TO %I WITH SET TRUE', role_name, current_user);
        END IF;
        IF NOT pg_catalog.has_schema_privilege(role_name, 'public', 'CREATE') THEN
            EXECUTE format('GRANT CREATE ON SCHEMA public TO %I', role_name);
            added_create := array_append(added_create, role_name);
        END IF;
    END LOOP;
    FOR item IN SELECT * FROM (VALUES
        ('public.get_current_exp()', '0f8e26e78908c280323dc6f36ff83a12', NULL::text),
        ('public.get_progression_status()', '59da5d62d29265d08ad49e44fcef4489', NULL),
        ('public.list_level_rewards()', 'eff66b984db5526b52a715d27d23fe35', NULL),
        ('public.get_reward_history()', 'dbbf7c96d47400150f56fe704ae2617e', NULL),
        ('public.list_day_quest_occurrences(date)', '0e4ab233d7c67f63b95a9e3a79c5a6db', NULL),
        ('public.assign_level_policy(uuid,uuid,uuid,text)', '8f69a026c86876d6573d5b80ee226831', 'level_policy_assignment_owner'),
        ('public.configure_level_reward(uuid,jsonb,text)', '35c48b8e682ccf1a3433945032404580', 'progression_command_owner'),
        ('public.update_level_reward(uuid,jsonb,text)', '8ef50c31f4222dc7c244cc638d036268', 'progression_command_owner'),
        ('public.cancel_level_reward(uuid,jsonb,text)', 'ff3bfa41cebbcc42d009fd049bdace3b', 'progression_command_owner'),
        ('public.redeem_level_reward(uuid,jsonb,text)', '2b724250e3e8d4c3353af5bd05b90110', 'progression_command_owner'),
        ('public.create_one_off_quest(uuid,jsonb,text)', '0c4d3fa647bd014a28535b3d77056990', 'quest_command_owner'),
        ('public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text)', 'f2fa62694c49112ca77373d38a9093d2', 'quest_command_owner'),
        ('public.reopen_quest_occurrence_v2(uuid,uuid,integer,text)', '31758b6b9ed451f454364da84de8945c', 'quest_command_owner'),
        ('public.get_quest_completion_resolution_v1(uuid,uuid,integer)', '2195a0ae5fb95a4d88db78c5c2f01af7', 'quest_command_owner')
    ) AS expected(signature, source_hash, executor) LOOP
        SELECT * INTO routine FROM pg_catalog.pg_proc WHERE oid = to_regprocedure(item.signature);
        IF routine.oid IS NULL
            OR md5(replace(routine.prosrc, E'\r', '')) <> item.source_hash
            OR routine.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
            OR routine.prosecdef <> (item.executor IS NOT NULL)
            OR (item.executor IS NOT NULL AND pg_catalog.pg_get_userbyid(routine.proowner) <> item.executor)
            OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
            RAISE EXCEPTION 'Private owner RPC preflight failed: %', item.signature;
        END IF;
        entry_guard := E'    PERFORM system_private.require_owner();\n';
        IF routine.proname = 'assign_level_policy' THEN
            entry_guard := entry_guard || E'    IF target_user_id IS DISTINCT FROM system_internal.request_user_id() THEN\n'
                || E'        RAISE EXCEPTION ''SYSTEM owner target required'' USING ERRCODE = ''42501'';\n'
                || E'    END IF;\n';
        END IF;
        -- Every audited body has its first outer BEGIN at the start of a line.
        guarded := regexp_replace(routine.prosrc, E'(^|\n)BEGIN(\r?\n)', E'\\1BEGIN\\2' || entry_guard);
        IF guarded = routine.prosrc THEN
            RAISE EXCEPTION 'Private owner RPC entry point not found: %', item.signature;
        END IF;
        definition := pg_catalog.pg_get_functiondef(routine.oid);
        IF item.executor IS NOT NULL THEN
            EXECUTE format('SET LOCAL ROLE %I', item.executor);
        END IF;
        -- Replacing a function needs EXECUTE even for its own owner, and the frozen
        -- command migrations revoke EXECUTE from that owner (for example
        -- create_one_off_quest). Borrow the privilege for this replacement only and
        -- revoke it again, so the resulting pg_proc row keeps its exact OID, owner
        -- and ACL and the activation stays rollback-only on any later failure.
        temporary_execute := NOT pg_catalog.has_function_privilege(
            pg_catalog.to_regprocedure(item.signature), 'EXECUTE');
        IF temporary_execute THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO CURRENT_USER', item.signature);
        END IF;
        EXECUTE replace(definition, routine.prosrc, guarded);
        IF temporary_execute THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM CURRENT_USER', item.signature);
        END IF;
        EXECUTE format('SET LOCAL ROLE %I', migration_role);
    END LOOP;
    FOREACH role_name IN ARRAY added_create LOOP
        EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', role_name);
    END LOOP;
    FOR membership IN SELECT value FROM jsonb_array_elements(saved_memberships) LOOP
        IF membership.value->'previous' = 'null'::jsonb THEN
            EXECUTE format('REVOKE %I FROM %I', membership.value->>'role', current_user);
        ELSE
            EXECUTE format('GRANT %I TO %I WITH ADMIN %s, INHERIT %s, SET %s',
                membership.value->>'role', current_user,
                membership.value#>>'{previous,admin_option}',
                membership.value#>>'{previous,inherit_option}',
                membership.value#>>'{previous,set_option}');
        END IF;
    END LOOP;
END;
$rpc_guards$;

NOTIFY pgrst, 'reload schema';
COMMIT;
