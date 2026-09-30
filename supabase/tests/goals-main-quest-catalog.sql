\set ON_ERROR_STOP on
-- ADR-020 storage/privilege contract, valid both at its checkpoint and after ADR-015 activation.
BEGIN;
CREATE FUNCTION pg_temp.goal_check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Goal catalog: %', label; END IF; END;
$$;
DO $catalog$
DECLARE
    item record;
    t regclass;
    role_name text;
    p pg_proc;
    cols text[];
BEGIN
    FOR item IN SELECT * FROM (VALUES
        ('public.goals', ARRAY['id:uuid','user_id:uuid','title:text','description:text','archived_at:timestamp with time zone','revision:bigint','created_at:timestamp with time zone','updated_at:timestamp with time zone']),
        ('public.goal_quest_links', ARRAY['id:uuid','user_id:uuid','goal_id:uuid','quest_id:uuid','occurrence_id:uuid','position:integer','attached_at:timestamp with time zone','detached_at:timestamp with time zone']),
        ('system_internal.goal_commands', ARRAY['user_id:uuid','command_id:uuid','goal_id:uuid','command_type:text','request:jsonb','result:jsonb','recorded_at:timestamp with time zone'])
    ) AS expected(tbl, columns) LOOP
        t := item.tbl::regclass;
        SELECT array_agg(attname || ':' || format_type(atttypid, atttypmod) ORDER BY attnum) INTO cols
            FROM pg_attribute WHERE attrelid=t AND attnum>0 AND NOT attisdropped;
        PERFORM pg_temp.goal_check(cols = item.columns, 'exact columns/types: ' || item.tbl);
        PERFORM pg_temp.goal_check((SELECT relrowsecurity AND relowner <> 'goal_command_owner'::regrole FROM pg_class WHERE oid=t), 'RLS/table nonownership');
        PERFORM pg_temp.goal_check(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=t AND polname='system_single_owner'
            AND NOT polpermissive AND polcmd='*' AND polroles=ARRAY['authenticated'::regrole::oid,'goal_command_owner'::regrole::oid]
            AND pg_get_expr(polqual,polrelid) LIKE '%is_owner()%'
            AND pg_get_expr(polwithcheck,polrelid) LIKE '%request_user_id()%'), 'restrictive owner policy');
        PERFORM pg_temp.goal_check(NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=t AND contype='f'
            AND (confdeltype<>'r' OR confupdtype<>'r')), 'all FK actions restrict');
        FOREACH role_name IN ARRAY ARRAY['anon','service_role','quest_command_owner','progression_command_owner','level_policy_assignment_owner','schedule_command_owner'] LOOP
            PERFORM pg_temp.goal_check(NOT has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                AND NOT has_any_column_privilege(role_name,t,'SELECT,INSERT,UPDATE,REFERENCES'), 'ungranted table role ' || role_name);
        END LOOP;
        PERFORM pg_temp.goal_check(NOT has_table_privilege('authenticated',t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            AND NOT has_any_column_privilege('authenticated',t,'INSERT,UPDATE,REFERENCES'), 'client writes denied');
        PERFORM pg_temp.goal_check(NOT has_table_privilege('goal_command_owner',t,'DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no executor deletion/DDL');
    END LOOP;
    PERFORM pg_temp.goal_check((SELECT count(*)=7 FROM pg_constraint WHERE contype='f'
        AND conrelid IN ('public.goals'::regclass,'public.goal_quest_links'::regclass,'system_internal.goal_commands'::regclass)), 'seven owner/subject FKs');
    PERFORM pg_temp.goal_check(EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_goal_link_occurrence_owner'
        AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (occurrence_id, quest_id, user_id) REFERENCES quest_occurrences(id, quest_id, user_id)%'), 'exact occurrence identity FK');
    PERFORM pg_temp.goal_check((SELECT indisunique AND pg_get_expr(indpred,indrelid)='(detached_at IS NULL)'
        AND pg_get_indexdef(indexrelid) LIKE '%(quest_id)%' FROM pg_index WHERE indexrelid='public.uq_goal_quest_current'::regclass), 'current-only uniqueness');
    PERFORM pg_temp.goal_check((SELECT count(*)=11 FROM pg_index WHERE indrelid IN
        ('public.goals'::regclass,'public.goal_quest_links'::regclass,'system_internal.goal_commands'::regclass)), 'exact index inventory');
    PERFORM pg_temp.goal_check((SELECT count(*)=2 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
        ('public.goal_quest_links'::regclass,'system_internal.goal_commands'::regclass)), 'history guards');
    PERFORM pg_temp.goal_check(has_column_privilege('goal_command_owner','public.goal_quest_links','detached_at','UPDATE')
        AND NOT has_column_privilege('goal_command_owner','public.goal_quest_links','position','UPDATE')
        AND NOT has_column_privilege('goal_command_owner','public.goals','user_id','UPDATE'), 'column-scoped mutations');
    PERFORM pg_temp.goal_check(NOT has_table_privilege('authenticated','system_internal.goal_commands','SELECT')
        AND NOT has_table_privilege('goal_command_owner','system_internal.goal_commands','UPDATE'), 'private append-only receipts');
    PERFORM pg_temp.goal_check(EXISTS (SELECT 1 FROM pg_roles WHERE rolname='goal_command_owner'
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
        AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication), 'executor flags');
    -- Managed Supabase grants the role creator postgres ADMIN only (no INHERIT/SET)
    -- from supabase_admin. Preserve that platform grant; forbid runtime memberships.
    PERFORM pg_temp.goal_check(NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member='goal_command_owner'::regrole
        OR (roleid='goal_command_owner'::regrole AND NOT (member=current_user::regrole
            AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option))), 'no runtime executor memberships');
    PERFORM pg_temp.goal_check(NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner='goal_command_owner'::regrole), 'executor owns no relation');
    FOREACH t IN ARRAY ARRAY['public.quests'::regclass,'public.quest_occurrences'::regclass,'public.quest_recurrence_rules'::regclass] LOOP
        PERFORM pg_temp.goal_check(has_table_privilege('goal_command_owner',t,'SELECT')
            AND NOT has_table_privilege('goal_command_owner',t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'Quest read-only');
        PERFORM pg_temp.goal_check(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=t AND polname='goal_reader_single_owner'
            AND NOT polpermissive AND polroles=ARRAY['goal_command_owner'::regrole::oid]
            AND pg_get_expr(polqual,polrelid) LIKE '%is_owner()%'
            AND pg_get_expr(polwithcheck,polrelid) LIKE '%request_user_id()%'), 'new executor gets restrictive Quest policy');
    END LOOP;
    FOREACH t IN ARRAY ARRAY['public.exp_ledger'::regclass,'public.level_reward_events'::regclass,'system_private.owner_configuration'::regclass] LOOP
        PERFORM pg_temp.goal_check(NOT has_table_privilege('goal_command_owner',t,'SELECT,INSERT,UPDATE,DELETE'), 'no EXP/reward/config privilege');
    END LOOP;
    FOR item IN SELECT * FROM (VALUES
        ('public.create_goal_v1(uuid,uuid,text,text)',true),
        ('public.update_goal_v1(uuid,uuid,bigint,text,text)',true),
        ('public.set_goal_archived_v1(uuid,uuid,bigint,boolean)',true),
        ('public.attach_goal_quest_v1(uuid,uuid,bigint,uuid)',true),
        ('public.detach_goal_quest_v1(uuid,uuid,bigint,uuid)',true),
        ('public.get_goal_v1(uuid)',false),('public.list_goals_v1(text,uuid,integer)',false)
    ) AS expected(signature, definer) LOOP
        SELECT * INTO p FROM pg_proc WHERE oid=item.signature::regprocedure;
        PERFORM pg_temp.goal_check(p.prosecdef=item.definer AND p.prorettype='jsonb'::regtype
            AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.provolatile=CASE WHEN item.definer THEN 'v'::"char" ELSE 's'::"char" END, 'RPC attributes ' || item.signature);
        PERFORM pg_temp.goal_check((p.proowner='goal_command_owner'::regrole)=item.definer, 'RPC owner');
        PERFORM pg_temp.goal_check(p.prosrc ~ 'BEGIN[[:space:]]+PERFORM system_private.require_owner\(\);', 'first executable owner guard');
        PERFORM pg_temp.goal_check(has_function_privilege('authenticated',p.oid,'EXECUTE'), 'authenticated EXECUTE');
        PERFORM pg_temp.goal_check((SELECT count(*)=1 FROM pg_proc WHERE pronamespace=p.pronamespace AND proname=p.proname), 'no overload');
        FOREACH role_name IN ARRAY ARRAY['public','anon','service_role','goal_command_owner','quest_command_owner','progression_command_owner','level_policy_assignment_owner','schedule_command_owner'] LOOP
            PERFORM pg_temp.goal_check(NOT has_function_privilege(role_name,p.oid,'EXECUTE'), 'unexpected RPC executor ' || role_name);
        END LOOP;
    END LOOP;
    PERFORM pg_temp.goal_check(to_regprocedure('public.reorder_goal_subquests_v1(uuid,uuid,bigint,uuid[])') IS NULL, 'no reorder endpoint');
    PERFORM pg_temp.goal_check(NOT has_function_privilege('authenticated','system_internal.run_goal_command_v1(uuid,uuid,bigint,text,jsonb)','EXECUTE'), 'private dispatcher');
    PERFORM pg_temp.goal_check(has_function_privilege('authenticated','system_internal.goal_projection_v1(uuid)','EXECUTE')
        AND (SELECT NOT prosecdef AND provolatile='s' FROM pg_proc WHERE oid='system_internal.goal_projection_v1(uuid)'::regprocedure), 'private projection respects caller RLS');
    PERFORM pg_temp.goal_check(NOT has_function_privilege('goal_command_owner','public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text)','EXECUTE')
        AND NOT has_function_privilege('goal_command_owner','public.reopen_quest_occurrence_v2(uuid,uuid,integer,text)','EXECUTE')
        AND NOT has_function_privilege('goal_command_owner','exp_internal.append_quest_event(uuid)','EXECUTE')
        AND NOT has_function_privilege('goal_command_owner','public.materialize_quest_day(date)','EXECUTE'), 'no engine capability');
    PERFORM pg_temp.goal_check(NOT has_schema_privilege('goal_command_owner','public','CREATE')
        AND NOT has_schema_privilege('goal_command_owner','system_internal','CREATE'), 'temporary CREATE revoked');
END;
$catalog$;
ROLLBACK;
