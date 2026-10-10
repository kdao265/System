\set ON_ERROR_STOP on
-- L1-05 future disposable PostgreSQL catalog test. NOT executed in preparation phase.
-- Run only after an explicitly authorized FULL migration in fixture-owned PostgreSQL.
BEGIN;
CREATE FUNCTION pg_temp.ao_require(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'AO catalog: %', label; END IF; END $$;
DO $tests$
DECLARE
  t text;
  p record;
  ao_tables text[] := ARRAY[
    'public.opportunities','public.activities','public.activity_source_links',
    'public.opportunity_goal_links','public.opportunity_quest_links',
    'public.activity_goal_links','public.activity_quest_links',
    'public.opportunity_history','public.activity_history','system_internal.ao_commands'
  ];
  public_apis text[] := ARRAY[
    'create_opportunity_v1','update_opportunity_v1','set_opportunity_stage_v1',
    'record_opportunity_outcome_v1','set_opportunity_archived_v1',
    'create_activity_v1','update_activity_v1','transition_activity_v1',
    'correct_activity_status_v1','set_activity_archived_v1',
    'set_activity_source_v1','attach_ao_context_v1','detach_ao_context_v1',
    'get_opportunity_v1','list_opportunities_v1','get_activity_v1',
    'list_activities_v1','list_ao_history_v1',
    'search_ao_link_candidates_v1','resolve_ao_command_v1'
  ];
BEGIN
  PERFORM pg_temp.ao_require((SELECT count(*)=10 FROM pg_class c
      WHERE c.oid=ANY(ARRAY(SELECT unnest(ao_tables)::regclass)) AND c.relkind IN ('r','p')),
      'ten exact AO relations');
  SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,r.rolinherit
    INTO p FROM pg_roles r WHERE r.rolname='ao_command_owner';
  PERFORM pg_temp.ao_require(FOUND AND NOT p.rolcanlogin AND NOT p.rolsuper
      AND NOT p.rolbypassrls AND NOT p.rolinherit, 'executor is NOLOGIN/NOBYPASSRLS/NOINHERIT');
  FOREACH t IN ARRAY ao_tables LOOP
    PERFORM pg_temp.ao_require((SELECT relrowsecurity FROM pg_class WHERE oid=t::regclass),
        t||' RLS enabled');
    PERFORM pg_temp.ao_require((SELECT count(*)>=1 FROM pg_policy
       WHERE polrelid=t::regclass AND polname='system_single_owner' AND NOT polpermissive),
       t||' restrictive configured-owner policy');
    PERFORM pg_temp.ao_require(NOT has_table_privilege('authenticated',t,'INSERT')
       AND NOT has_table_privilege('authenticated',t,'UPDATE')
       AND NOT has_table_privilege('authenticated',t,'DELETE')
       AND NOT has_table_privilege('authenticated',t,'SELECT'),t||' no raw auth table DML/SELECT');
    PERFORM pg_temp.ao_require(NOT has_table_privilege('anon',t,'SELECT')
       AND NOT has_table_privilege('anon',t,'INSERT'),t||' no anonymous SELECT/INSERT');
    PERFORM pg_temp.ao_require(NOT has_table_privilege('ao_command_owner',t,'DELETE'),
       t||' no executor DELETE');
  END LOOP;
  PERFORM pg_temp.ao_require((SELECT count(*)=20 FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname=ANY(public_apis)),
      'all twenty typed AO public routines present');
  FOR p IN SELECT oid, proname, proowner, proacl, prosecdef, proconfig FROM pg_proc
     WHERE pronamespace='public'::regnamespace AND proname=ANY(public_apis) LOOP
     PERFORM pg_temp.ao_require(p.prosecdef AND p.proowner='ao_command_owner'::regrole,
       p.proname||' security definer ownership');
     PERFORM pg_temp.ao_require('search_path=pg_catalog'=ANY(p.proconfig),
       p.proname||' fixed catalog search path');
     PERFORM pg_temp.ao_require(has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
        p.proname||' execute privileges');
  END LOOP;
  PERFORM pg_temp.ao_require(NOT has_table_privilege('ao_command_owner','public.goals','UPDATE')
      AND NOT has_table_privilege('ao_command_owner','public.quests','UPDATE')
      AND NOT has_table_privilege('ao_command_owner','public.quest_events','INSERT')
      AND NOT has_table_privilege('ao_command_owner','public.exp_ledger','INSERT')
      AND NOT has_table_privilege('ao_command_owner','public.schedule_events','INSERT'),
      'no external-domain command writes');
  PERFORM pg_temp.ao_require((SELECT count(*)=3 FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid=ANY(ARRAY[
        'system_internal.ao_commands'::regclass,
        'public.opportunity_history'::regclass,
        'public.activity_history'::regclass
      ]) AND (tgtype & 8)<>0), 'three receipt/history immutable delete guards');
  PERFORM pg_temp.ao_require((SELECT count(*)=5 FROM pg_index i
      WHERE i.indisunique AND i.indpred IS NOT NULL AND
        i.indrelid=ANY(ARRAY[
          'public.activity_source_links'::regclass,
          'public.opportunity_goal_links'::regclass,
          'public.opportunity_quest_links'::regclass,
          'public.activity_goal_links'::regclass,
          'public.activity_quest_links'::regclass
        ])), 'five unique-current relationship indexes');
  PERFORM pg_temp.ao_require((SELECT count(*)=2 FROM pg_constraint c
      WHERE c.conname IN ('fk_opportunity_history_command','fk_activity_history_command')
        AND c.contype='f' AND c.condeferrable AND c.condeferred),
       'history=>receipt deferred FK');
  RAISE NOTICE 'AO catalog pass (disposable only). Legacy OIDs/ACLs and role memberships must also be compared externally.';
END;
$tests$;
ROLLBACK;
