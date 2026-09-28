\set ON_ERROR_STOP on
-- Run only after activation on the disposable owner/non-owner fixtures.
BEGIN;
GRANT authenticated, anon, quest_command_owner, progression_command_owner,
    level_policy_assignment_owner, profile_provisioner, system_owner_reader TO CURRENT_USER;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
    IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Private owner assertion failed: %', label; END IF;
END $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
    RAISE EXCEPTION 'Expected permission denial';
END $$;

DO $catalog$
DECLARE
    role_name text;
    target regclass;
    actor uuid;
    approved uuid := (SELECT user_id FROM system_private.owner_configuration);
    outsider uuid := (SELECT id FROM auth.users WHERE id <> (SELECT user_id FROM system_private.owner_configuration) LIMIT 1);
    count_visible bigint;
    affected bigint;
    config_table regclass := 'system_private.owner_configuration';
    protected regclass[] := ARRAY[
        'public.profiles'::regclass, 'public.quests', 'public.quest_recurrence_rules',
        'public.quest_occurrences', 'public.quest_events', 'public.exp_ledger',
        'public.level_policies', 'public.level_thresholds', 'public.progression_policy_assignments',
        'public.level_milestones', 'public.level_reward_definitions', 'public.level_reward_unlocks',
        'public.level_reward_events', 'system_internal.operator_grants', 'system_internal.quest_completion_aliases'
    ];
BEGIN
    PERFORM pg_temp.assert_true(approved IS NOT NULL AND outsider IS NOT NULL, 'populated owner/outsider fixtures');
    PERFORM pg_temp.assert_true((SELECT count(*) FROM pg_policy WHERE polname='system_single_owner')=15, '15 restrictive policies');
    FOREACH target IN ARRAY protected LOOP
        PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid=target), 'RLS enabled');
        PERFORM pg_temp.assert_true(EXISTS (
            SELECT 1 FROM pg_policy WHERE polrelid=target AND polname='system_single_owner'
                AND NOT polpermissive AND polcmd='*'
                AND cardinality(polroles)=4
                AND polroles @> ARRAY['authenticated'::regrole::oid, 'quest_command_owner'::regrole::oid,
                    'progression_command_owner'::regrole::oid, 'level_policy_assignment_owner'::regrole::oid]
                AND pg_get_expr(polqual, polrelid) LIKE '%system_private.is_owner()%'
                AND pg_get_expr(polwithcheck, polrelid) LIKE '%system_private.is_owner()%'
        ), 'restrictive ALL owner guard and WITH CHECK for every application role');
        IF target NOT IN ('public.level_policies'::regclass, 'public.level_thresholds'::regclass) THEN
            PERFORM pg_temp.assert_true((SELECT pg_get_expr(polqual, polrelid) LIKE '%user_id =%request_user_id()%'
                AND pg_get_expr(polwithcheck, polrelid) LIKE '%user_id =%request_user_id()%'
                FROM pg_policy WHERE polrelid=target AND polname='system_single_owner'), 'row identity retained including assignment executor');
        END IF;
    END LOOP;
    PERFORM pg_temp.assert_true((SELECT relrowsecurity AND relowner <> 'system_owner_reader'::regrole
        FROM pg_class WHERE oid=config_table), 'singleton reader is RLS bound and owns no table');
    PERFORM pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner='system_owner_reader'::regrole), 'reader owns no relation');
    PERFORM pg_temp.assert_true(EXISTS (SELECT 1 FROM pg_proc
        WHERE oid='system_private.is_owner()'::regprocedure AND prosecdef
            AND provolatile='s' AND proowner='system_owner_reader'::regrole
            AND proconfig=ARRAY['search_path=pg_catalog']), 'safe narrowly privileged predicate');
    PERFORM pg_temp.assert_true(EXISTS (SELECT 1 FROM pg_proc
        WHERE oid='system_private.require_owner()'::regprocedure AND NOT prosecdef
            AND proconfig=ARRAY['search_path=pg_catalog']), 'entry guard does not elevate');
    FOREACH role_name IN ARRAY ARRAY['quest_command_owner','progression_command_owner','level_policy_assignment_owner','profile_provisioner','system_owner_reader'] LOOP
        PERFORM pg_temp.assert_true(EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name
            AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb), 'constrained role');
        PERFORM pg_temp.assert_true(NOT has_schema_privilege(role_name, 'public', 'CREATE')
            AND NOT has_schema_privilege(role_name, 'system_private', 'CREATE'), 'temporary schema privileges removed');
        PERFORM pg_temp.assert_true(NOT pg_has_role('authenticated', role_name, 'MEMBER')
            AND NOT pg_has_role('anon', role_name, 'MEMBER')
            AND NOT pg_has_role('authenticator', role_name, 'MEMBER'), 'no client executor membership');
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY['authenticated','anon','service_role','quest_command_owner','progression_command_owner','level_policy_assignment_owner','profile_provisioner'] LOOP
        PERFORM pg_temp.assert_true(NOT has_table_privilege(role_name, config_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            AND NOT has_any_column_privilege(role_name, config_table, 'SELECT,INSERT,UPDATE,REFERENCES'), 'singleton inaccessible to clients/executors');
    END LOOP;
    PERFORM pg_temp.assert_true(has_table_privilege('system_owner_reader',config_table,'SELECT')
        AND NOT has_table_privilege('system_owner_reader',config_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'reader SELECT only');

    -- Actual table access under each executor with missing, wrong and correct
    -- identities. Fixtures populate every protected table, including history.
    FOREACH role_name IN ARRAY ARRAY['authenticated','anon','quest_command_owner','progression_command_owner','level_policy_assignment_owner'] LOOP
        FOREACH actor IN ARRAY ARRAY[approved, outsider, NULL::uuid] LOOP
            PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::text, true);
            PERFORM set_config('request.jwt.claim.sub', '', true);
            FOREACH target IN ARRAY protected LOOP
                IF has_table_privilege(role_name, target, 'SELECT') THEN
                    EXECUTE format('SET LOCAL ROLE %I', role_name);
                    EXECUTE format('SELECT count(*) FROM %s', target) INTO count_visible;
                    RESET ROLE;
                    IF actor IS DISTINCT FROM approved THEN
                        PERFORM pg_temp.assert_true(count_visible=0, 'non-owner/missing identity blocked under every execution role');
                    ELSE
                        PERFORM pg_temp.assert_true(count_visible>0, 'authorized executor retains nonempty reads');
                    END IF;
                END IF;
            END LOOP;
            EXECUTE format('SET LOCAL ROLE %I', role_name);
            PERFORM pg_temp.denied('SELECT * FROM system_private.owner_configuration');
            PERFORM pg_temp.denied('DELETE FROM system_private.owner_configuration');
            PERFORM pg_temp.denied(format('INSERT INTO system_private.owner_configuration(user_id) VALUES (%L)', outsider));
            PERFORM pg_temp.denied(format('UPDATE system_private.owner_configuration SET user_id=%L', outsider));
            RESET ROLE;
        END LOOP;
    END LOOP;
    -- Test WITH CHECK on a valid non-owner insert, and an UPDATE against an
    -- existing row. No business constraints can explain these denials.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',outsider)::text, true);
    SET LOCAL ROLE quest_command_owner;
    PERFORM pg_temp.denied(format('INSERT INTO public.quests(user_id,title) VALUES (%L,''Denied fixture'')', outsider));
    UPDATE public.quests SET title='Denied update' WHERE user_id=outsider;
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.assert_true(affected=0, 'command role cannot update its non-owner rows');
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',approved)::text, true);
    SET LOCAL ROLE quest_command_owner;
    PERFORM pg_temp.denied(format('INSERT INTO public.quests(user_id,title) VALUES (%L,''Foreign fixture'')', outsider));
    RESET ROLE;
    -- The approved identity cannot spoof authorization using client metadata or
    -- an application GUC. Only the verified request subject selects the actor.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'user_metadata',jsonb_build_object('owner',true,'user_id',approved))::text, true);
    PERFORM set_config('app.system_owner_user_id', approved::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.assert_true(NOT system_private.is_owner(), 'metadata/GUC cannot override singleton');
    PERFORM pg_temp.denied('SELECT system_private.require_owner()');
    RESET ROLE;
    -- Singleton shape/FK and admin-only provisioning; failures preserve config.
    BEGIN
        INSERT INTO system_private.owner_configuration(singleton,user_id) VALUES(false,outsider);
        RAISE EXCEPTION 'False singleton accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        INSERT INTO system_private.owner_configuration(user_id) VALUES(outsider);
        RAISE EXCEPTION 'Second owner accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN
        UPDATE system_private.owner_configuration SET user_id=gen_random_uuid();
        RAISE EXCEPTION 'Nonexistent Auth owner accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END;
$catalog$;
ROLLBACK;
