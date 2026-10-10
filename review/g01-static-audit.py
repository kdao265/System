#!/usr/bin/env python3
"""No PostgreSQL/Docker/network or repository mutation. Source checks only."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
s=(root/'review/sql/REVIEW_ONLY_create_activities_opportunities_v1.sql').read_text()
# Frozen architecture contracts instead of reading a separate handoff by absolute path.
tables=['public.opportunities','public.activities','public.activity_source_links',
 'public.opportunity_goal_links','public.opportunity_quest_links','public.activity_goal_links',
 'public.activity_quest_links','public.opportunity_history','public.activity_history',
 'system_internal.ao_commands']
public_rpcs=['create_opportunity_v1','update_opportunity_v1','set_opportunity_stage_v1',
 'record_opportunity_outcome_v1','set_opportunity_archived_v1','create_activity_v1',
 'update_activity_v1','transition_activity_v1','correct_activity_status_v1',
 'set_activity_archived_v1','set_activity_source_v1','attach_ao_context_v1',
 'detach_ao_context_v1','get_opportunity_v1','list_opportunities_v1','get_activity_v1',
 'list_activities_v1','list_ao_history_v1','search_ao_link_candidates_v1',
 'resolve_ao_command_v1']
checks=[]
def check(label,condition):
  assert condition,label
  checks.append(label)
check('one transaction and unconditional abort',s.count('BEGIN;')==1 and "RAISE EXCEPTION 'BLOCKED: AO G-01" in s[:1000] and s.strip().endswith('COMMIT;'))
check('ten tables unchanged',sorted(re.findall(r'CREATE TABLE ((?:public|system_internal)\.\w+)',s))==sorted(tables))
check('20 public RPC names unchanged',sorted(re.findall(r'CREATE FUNCTION public\.(\w+)',s))==sorted(public_rpcs))
check('no historical schema alteration',not re.search(r'ALTER TABLE public\.(?:quests|goals|exp_ledger|books|schedule_events)',s))
check('no source-zone inferred from Profile',not re.search(r'(?:profile_timezone|profiles\.timezone|FROM public\.profiles)',s,re.I))
check('shape validation is immutable',bool(re.search(r'CREATE FUNCTION system_internal\.ao_deadline_spec_valid_v1\(value jsonb\)[\s\S]*?IMMUTABLE',s)))
check('trigger is invoker',bool(re.search(r'CREATE FUNCTION system_internal\.ao_deadline_derive_trigger_v1\(\)[\s\S]*?SECURITY INVOKER',s)))
check('resolver is STABLE (tzdb)',bool(re.search(r'CREATE FUNCTION system_internal\.ao_deadline_resolve_v1\(value jsonb\)[\s\S]*?STABLE SECURITY INVOKER',s)))
check('tzdb source pg_timezone_names', 'FROM pg_catalog.pg_timezone_names' in s)
check('offset-only allowed','IF value ? \'source_zone\' THEN' in s)
check('candidate UTC constructed independently of session TZ',"candidate := civil_utc AT TIME ZONE 'UTC';" in s)
check('roundtrip disambiguates DST folds/gaps','(candidate AT TIME ZONE zone_text) IS DISTINCT FROM wall_time' in s)
check('numeric offset bounded', 'offset_value NOT BETWEEN -840 AND 840' in s and 'offset_value <> trunc(offset_value)' in s)
check('server-owned UTC update guarded', "RAISE EXCEPTION 'AO deadline UTC is database-owned'" in s)
check('UTC not recomputed on unrelated updates', 'NEW.application_deadline IS DISTINCT FROM OLD.application_deadline' in s)
check('root column CHECK remains independent of tzdb','CHECK (system_internal.ao_deadline_valid_v1(application_deadline,deadline_at_utc))' in s)
check('opportunity trigger exists before exposure','CREATE TRIGGER ao_opportunities_deadline_derive' in s)
check('command validates instant shape, not null UTC','k=\'application_deadline\' AND NOT system_internal.ao_deadline_spec_valid_v1(v)' in s)
check('root insert leaves derived UTC to trigger','INSERT INTO public.opportunities(id,user_id,title,category,organization' in s and 'deadline_at_utc' not in re.search(r'INSERT INTO public.opportunities\((.*?)\)\s*VALUES',s,re.S).group(1))
check('role grants narrow helper access','GRANT EXECUTE ON FUNCTION system_internal.ao_deadline_resolve_v1(jsonb) TO ao_command_owner;' in s)
check('new helper functions not callable to PUBLIC',all('REVOKE ALL ON FUNCTION system_internal.'+f+' FROM PUBLIC' in s for f in ['ao_deadline_resolve_v1(jsonb)','ao_deadline_spec_valid_v1(jsonb)','ao_deadline_derive_trigger_v1()']))
check('nullable JSON dates normalized to SQL NULL on create/update',
      all("NULLIF(v_fields->'"+f+"','null'::jsonb)" in s
          for f in ['application_deadline','program_start','program_end','applied_at','decision_at',
                    'planned_start','planned_end','actual_start','actual_end']))
check('explicit nullable date accepts jsonb null input',
      "IF (v IS DISTINCT FROM 'null'::jsonb) AND" in s)
check('no return of raw deleted Quest fields',"'Quest đã xóa'" in s)
print(f'PASS {len(checks)}/{len(checks)} offline static structural checks; NOT SQL compilation, runtime, RLS or TS-parity verification.')
for c in checks: print('PASS',c)
