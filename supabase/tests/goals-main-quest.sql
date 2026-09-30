\set ON_ERROR_STOP on
-- GM-AC-01..10. Synthetic fixtures only; every change (including test privileges) rolls back.
BEGIN;
GRANT authenticated, anon, goal_command_owner TO CURRENT_USER;
CREATE SCHEMA goals_test;
CREATE FUNCTION goals_test.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Goal behavior: %', label; END IF; END;
$$;
CREATE FUNCTION goals_test.reject(statement text, state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = state THEN RETURN; END IF;
        RAISE EXCEPTION 'Goal behavior unexpected rejection for %: % %', label, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Goal behavior expected rejection: %', label;
END;
$$;
CREATE FUNCTION goals_test.progress(g uuid, done integer, total integer, archived boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE value jsonb := public.get_goal_v1(g)->'goal';
BEGIN
    PERFORM goals_test.check(value->>'completed_subquests'=done::text AND value->>'total_subquests'=total::text
        AND (value->>'is_complete')::boolean=(total>0 AND done=total)
        AND value->>'display_state'=CASE WHEN archived THEN 'archived' WHEN total>0 AND done=total THEN 'completed' ELSE 'active' END,
        'current progress ' || done || '/' || total);
    IF total=0 THEN
        PERFORM goals_test.check((CASE WHEN (value->>'total_subquests')::numeric=0 THEN 0
            ELSE 100*(value->>'completed_subquests')::numeric/(value->>'total_subquests')::numeric END)=0,
            'empty presentation percentage is zero');
    END IF;
END;
$$;
-- Full-row snapshots catch lifecycle, alias, ledger, recurrence and reward effects, not just counts.
CREATE FUNCTION goals_test.engine_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE relation text; value jsonb := '{}'::jsonb; rows_value jsonb;
BEGIN
    FOREACH relation IN ARRAY ARRAY['public.quests','public.quest_occurrences','public.quest_events',
        'public.quest_recurrence_rules','public.exp_ledger','system_internal.quest_completion_aliases',
        'public.progression_policy_assignments','public.level_milestones','public.level_reward_unlocks','public.level_reward_events'] LOOP
        EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM %s t',relation) INTO rows_value;
        value := value || jsonb_build_object(relation,rows_value);
    END LOOP;
    RETURN value;
END;
$$;
REVOKE ALL ON FUNCTION goals_test.engine_snapshot() FROM PUBLIC;
GRANT USAGE ON SCHEMA goals_test TO authenticated, anon, goal_command_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA goals_test TO authenticated, anon, goal_command_owner;

DO $behavior$
DECLARE
    a uuid := '00000000-0000-4000-8000-00000000f001';
    b uuid := '00000000-0000-4000-8000-00000000f002';
    g uuid := '10000000-0000-4000-8000-00000000f001';
    g2 uuid := '10000000-0000-4000-8000-00000000f002';
    empty_goal uuid := '10000000-0000-4000-8000-00000000f003';
    create_cmd uuid := gen_random_uuid();
    update_cmd uuid := gen_random_uuid();
    archive_cmd uuid := gen_random_uuid();
    restore_cmd uuid := gen_random_uuid();
    detach_cmd uuid := gen_random_uuid();
    attach_cmd uuid := gen_random_uuid();
    qids uuid[] := '{}'; oids uuid[] := '{}'; links uuid[] := '{}';
    receipt jsonb; previous jsonb; create_receipt jsonb; attach_receipt jsonb; detach_receipt jsonb;
    archive_receipt jsonb; restore_receipt jsonb; baseline jsonb; state_before jsonb;
    r public.quest_creation_receipt;
    done public.quest_completion_receipt;
    done_cmd uuid := gen_random_uuid();
    rev bigint; rev2 bigint; n integer; candidate uuid; foreign_q uuid; rule_id uuid; mode text;
    before_count bigint; invalid_cmd uuid; new_link uuid;
BEGIN
    INSERT INTO auth.users(id) VALUES(a),(b);
    UPDATE public.profiles SET timezone='UTC' WHERE user_id IN (a,b);
    DELETE FROM system_private.owner_configuration;
    INSERT INTO system_private.owner_configuration(user_id) VALUES(a);
    INSERT INTO system_internal.operator_grants(user_id,capability) VALUES(a,'level_policy_assign');
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM public.assign_level_policy(a,(SELECT id FROM public.level_policies WHERE policy_key='level_policy_v1'),gen_random_uuid(),'internal');
    FOR n IN 1..4 LOOP
        r := public.create_one_off_quest(gen_random_uuid(),jsonb_build_object('title','Sub Quest '||n,
            'scheduled_at','2031-01-01T10:00:00Z','default_reward_exp',CASE WHEN n=1 THEN 0 ELSE 10 END),'web_ui');
        qids := array_append(qids,r.quest_id); oids := array_append(oids,r.occurrence_id);
    END LOOP;
    baseline := goals_test.engine_snapshot();
    create_receipt := public.create_goal_v1(create_cmd,g,' Main Quest ','  ');
    PERFORM goals_test.check(create_receipt->>'revision_before'='0' AND create_receipt->>'revision_after'='1'
        AND create_receipt->>'changed'='true' AND create_receipt->>'replay'='false', 'creation receipt');
    PERFORM goals_test.progress(g,0,0);
    PERFORM goals_test.check(public.get_goal_v1(g)#>>'{goal,title}'='Main Quest'
        AND public.get_goal_v1(g)#>'{goal,description}'='null'::jsonb, 'metadata normalization');
    PERFORM public.create_goal_v1(gen_random_uuid(),g2,'Other Goal',NULL);
    PERFORM public.create_goal_v1(gen_random_uuid(),empty_goal,'Empty Goal',NULL);
    previous := public.update_goal_v1(update_cmd,g,1,'Changed',NULL);
    PERFORM goals_test.check(public.create_goal_v1(create_cmd,g,'Main Quest',NULL)=create_receipt||'{"replay":true}'::jsonb,'create replay after edit');
    PERFORM goals_test.check(public.update_goal_v1(update_cmd,g,1,'Changed',NULL)=previous||'{"replay":true}'::jsonb,'metadata replay');
    PERFORM goals_test.reject(format('SELECT public.create_goal_v1(%L,%L,''conflict'',NULL)',create_cmd,g),'23505','command reuse');
    PERFORM goals_test.reject(format('SELECT public.create_goal_v1(gen_random_uuid(),%L,''new identity'',NULL)',g),'23505','spent goal identity');
    PERFORM goals_test.reject(format('SELECT public.update_goal_v1(gen_random_uuid(),%L,1,''stale'',NULL)',g),'23514','stale metadata');
    PERFORM goals_test.reject('SELECT public.create_goal_v1(NULL,gen_random_uuid(),''X'',NULL)','22023','null command');
    PERFORM goals_test.reject('SELECT public.create_goal_v1(gen_random_uuid(),gen_random_uuid(),''   '',NULL)','22023','blank title');
    PERFORM goals_test.reject('SELECT public.create_goal_v1(gen_random_uuid(),gen_random_uuid(),repeat(''x'',121),NULL)','22023','long title');
    PERFORM goals_test.reject('SELECT public.create_goal_v1(gen_random_uuid(),gen_random_uuid(),''X'',repeat(''x'',4001))','22023','long description');
    PERFORM goals_test.reject(format('SELECT public.set_goal_archived_v1(gen_random_uuid(),%L,2,NULL)',g),'22023','null archive state');
    receipt := public.update_goal_v1(gen_random_uuid(),g,2,'Changed',NULL);
    PERFORM goals_test.check(receipt->>'changed'='false' AND receipt->>'revision_after'='2','metadata no-op');
    rev := 2;
    FOR n IN 1..3 LOOP
        receipt := public.attach_goal_quest_v1(CASE WHEN n=1 THEN attach_cmd ELSE gen_random_uuid() END,g,rev,qids[n]);
        IF n=1 THEN attach_receipt := receipt; END IF;
        links := array_append(links,(receipt->>'link_id')::uuid); rev := (receipt->>'revision_after')::bigint;
    END LOOP;
    PERFORM goals_test.progress(g,0,3);
    PERFORM goals_test.check(public.get_goal_v1(g)#>>'{subquests,0,position}'='1'
        AND public.get_goal_v1(g)#>>'{subquests,2,position}'='3','stable append order');
    receipt := public.attach_goal_quest_v1(gen_random_uuid(),g,rev,qids[1]);
    PERFORM goals_test.check(receipt->>'changed'='false' AND (receipt->>'link_id')::uuid=links[1],'same Goal attach no-op');
    PERFORM goals_test.reject(format('SELECT public.attach_goal_quest_v1(gen_random_uuid(),%L,1,%L)',g2,qids[1]),'23505','one current Goal');
    PERFORM goals_test.check(goals_test.engine_snapshot()=baseline,'create/update/attach produce no engine effects');

    FOR n IN 1..3 LOOP
        done := public.complete_quest_occurrence(CASE WHEN n=3 THEN done_cmd ELSE gen_random_uuid() END,oids[n],1,NULL,'web_ui');
        PERFORM goals_test.progress(g,n,3);
    END LOOP;
    PERFORM goals_test.check(public.get_current_exp()=20,'three credits, including zero EXP');
    PERFORM public.reopen_quest_occurrence_v2(gen_random_uuid(),oids[3],1,'web_ui');
    PERFORM goals_test.progress(g,2,3);
    PERFORM public.complete_quest_occurrence(done_cmd,oids[3],1,NULL,'web_ui');
    PERFORM goals_test.progress(g,2,3);
    PERFORM goals_test.check(public.get_current_exp()=10,'historical completion replay after reopen does not recredit');
    PERFORM public.complete_quest_occurrence(gen_random_uuid(),oids[3],2,NULL,'web_ui');
    PERFORM goals_test.progress(g,3,3);
    PERFORM public.complete_quest_occurrence(gen_random_uuid(),oids[4],1,NULL,'web_ui');
    baseline := goals_test.engine_snapshot();
    receipt := public.attach_goal_quest_v1(gen_random_uuid(),g,rev,qids[4]); rev := (receipt->>'revision_after')::bigint;
    PERFORM goals_test.progress(g,4,4);
    detach_receipt := public.detach_goal_quest_v1(detach_cmd,g,rev,links[1]); rev := (detach_receipt->>'revision_after')::bigint;
    PERFORM goals_test.progress(g,3,3);
    PERFORM goals_test.check(EXISTS(SELECT 1 FROM public.goal_quest_links WHERE id=links[1] AND detached_at IS NOT NULL),'detached history retained');
    PERFORM goals_test.check(public.attach_goal_quest_v1(attach_cmd,g,2,qids[1])=attach_receipt||'{"replay":true}'::jsonb,'late attach does not resurrect');
    PERFORM goals_test.progress(g,3,3);
    receipt := public.attach_goal_quest_v1(gen_random_uuid(),g2,1,qids[1]); rev2 := (receipt->>'revision_after')::bigint;
    new_link := (receipt->>'link_id')::uuid;
    PERFORM goals_test.progress(g2,1,1);
    PERFORM goals_test.check(public.detach_goal_quest_v1(detach_cmd,g,rev-1,links[1])=detach_receipt||'{"replay":true}'::jsonb,'late detach does not remove new interval');
    receipt := public.detach_goal_quest_v1(gen_random_uuid(),g,rev,links[1]);
    PERFORM goals_test.check(receipt->>'changed'='false','fresh detach of old interval is no-op');
    PERFORM goals_test.progress(g2,1,1);
    PERFORM goals_test.check(goals_test.engine_snapshot()=baseline,'attach completed/detach/move/replays do not alter engine');

    archive_receipt := public.set_goal_archived_v1(archive_cmd,g,rev,true); rev := (archive_receipt->>'revision_after')::bigint;
    PERFORM goals_test.progress(g,3,3,true);
    PERFORM goals_test.reject(format('SELECT public.update_goal_v1(gen_random_uuid(),%L,%s,''Changed'',NULL)',g,rev),'23514','archived metadata even no-op');
    PERFORM goals_test.reject(format('SELECT public.attach_goal_quest_v1(gen_random_uuid(),%L,%s,%L)',g,rev,qids[2]),'23514','archived attach even no-op');
    PERFORM goals_test.reject(format('SELECT public.detach_goal_quest_v1(gen_random_uuid(),%L,%s,%L)',g,rev,links[1]),'23514','archived detach even no-op');
    receipt := public.set_goal_archived_v1(gen_random_uuid(),g,rev,true);
    PERFORM goals_test.check(receipt->>'changed'='false','archive desired-state no-op');
    PERFORM goals_test.check(public.update_goal_v1(update_cmd,g,1,'Changed',NULL)=previous||'{"replay":true}'::jsonb,'historical edit replay while archived');
    PERFORM goals_test.check(jsonb_array_length(public.list_goals_v1()->'goals')=2
        AND jsonb_array_length(public.list_goals_v1('archived')->'goals')=1,'archive visibility');
    PERFORM goals_test.check(public.list_goals_v1('all',NULL,1)->>'next_after_id'=g::text
        AND jsonb_array_length(public.list_goals_v1('all',g,100)->'goals')=2,'keyset pagination');
    PERFORM goals_test.reject('SELECT public.list_goals_v1(''bad'')','22023','bad list scope');
    PERFORM goals_test.reject('SELECT public.list_goals_v1(''all'',NULL,0)','22023','bad list limit');
    PERFORM public.reopen_quest_occurrence_v2(gen_random_uuid(),oids[2],1,'web_ui');
    PERFORM goals_test.progress(g,2,3,true);
    baseline := goals_test.engine_snapshot();
    restore_receipt := public.set_goal_archived_v1(restore_cmd,g,rev,false); rev := (restore_receipt->>'revision_after')::bigint;
    PERFORM goals_test.check(public.set_goal_archived_v1(archive_cmd,g,rev-2,true)=archive_receipt||'{"replay":true}'::jsonb,'old archive retry does not rearchive');
    PERFORM goals_test.progress(g,2,3);
    receipt := public.update_goal_v1(gen_random_uuid(),g,rev,'Restored',NULL); rev := (receipt->>'revision_after')::bigint;
    receipt := public.set_goal_archived_v1(gen_random_uuid(),g,rev,true); rev := (receipt->>'revision_after')::bigint;
    PERFORM goals_test.check(public.set_goal_archived_v1(restore_cmd,g,(restore_receipt->>'revision_before')::bigint,false)=restore_receipt||'{"replay":true}'::jsonb,'old restore retry does not restore');
    PERFORM goals_test.progress(g,2,3,true);
    receipt := public.set_goal_archived_v1(gen_random_uuid(),g,rev,false); rev := (receipt->>'revision_after')::bigint;
    receipt := public.detach_goal_quest_v1(gen_random_uuid(),g2,rev2,new_link); rev2 := (receipt->>'revision_after')::bigint;
    PERFORM goals_test.progress(g2,0,0);
    receipt := public.attach_goal_quest_v1(gen_random_uuid(),g,rev,qids[1]); rev := (receipt->>'revision_after')::bigint;
    PERFORM goals_test.check(public.get_goal_v1(g)#>>'{subquests,3,position}'='5','reattach at end; survivor gaps retained');
    PERFORM goals_test.progress(g,3,4);
    PERFORM public.set_goal_archived_v1(gen_random_uuid(),empty_goal,1,true);
    PERFORM goals_test.progress(empty_goal,0,0,true);
    PERFORM goals_test.check(goals_test.engine_snapshot()=baseline,'archive/restore/order operations do not alter engine');
    RESET ROLE;

    -- Admin fixtures for states/invalid relationships not exposed by today's Quest UI/RPCs.
    UPDATE public.quests SET archived_at=now() WHERE id=qids[1];
    SET LOCAL ROLE authenticated;
    PERFORM goals_test.progress(g,3,4);
    PERFORM goals_test.check(public.get_goal_v1(g)#>'{subquests,3,quest_archived_at}' <> 'null'::jsonb,'archived Quest shown');
    PERFORM goals_test.reject(format('SELECT public.attach_goal_quest_v1(gen_random_uuid(),%L,%s,%L)',g,rev,qids[1]),'23514','fresh attach archived Quest');
    RESET ROLE;
    PERFORM goals_test.reject(format('DELETE FROM public.quests WHERE id=%L',qids[1]),'23503','Quest deletion restrict');
    PERFORM goals_test.reject(format('DELETE FROM public.quest_occurrences WHERE id=%L',oids[1]),'23503','occurrence deletion restrict');
    PERFORM goals_test.reject(format('DELETE FROM public.goal_quest_links WHERE id=%L',links[1]),'23514','membership history immutable');
    PERFORM goals_test.reject(format('UPDATE public.goal_quest_links SET detached_at=NULL WHERE id=%L',links[1]),'23514','no resurrection by update');
    PERFORM goals_test.reject(format('UPDATE system_internal.goal_commands SET result=''{}'' WHERE command_id=%L',create_cmd),'23514','receipt immutable');
    PERFORM goals_test.reject(format('DELETE FROM system_internal.goal_commands WHERE command_id=%L',create_cmd),'23514','receipt retained');

    -- Ineligibility must leave Goal state and private command rows identical.
    SELECT count(*) INTO before_count FROM system_internal.goal_commands;
    state_before := public.get_goal_v1(g);
    FOREACH mode IN ARRAY ARRAY['daily','weekly','monthly','custom','rule_only','missing','legacy_definition','legacy_occurrence'] LOOP
        INSERT INTO public.quests(user_id,title,recurrence_mode,direct_goal_id)
            VALUES(a,'Ineligible '||mode,CASE WHEN mode IN ('daily','weekly','monthly','custom') THEN mode ELSE 'one_off' END,
                CASE WHEN mode='legacy_definition' THEN g ELSE NULL END) RETURNING id INTO candidate;
        IF mode <> 'missing' THEN
            INSERT INTO public.quest_occurrences(quest_id,user_id,project_id_snapshot)
                VALUES(candidate,a,CASE WHEN mode='legacy_occurrence' THEN gen_random_uuid() ELSE NULL END);
        END IF;
        IF mode IN ('daily','rule_only') THEN
            INSERT INTO public.quest_recurrence_rules(quest_id,user_id,recurrence_type,anchor_date,stopped_at)
                VALUES(candidate,a,'daily','2031-01-01',now()) RETURNING id INTO rule_id;
        END IF;
        SET LOCAL ROLE authenticated;
        PERFORM goals_test.reject(format('SELECT public.attach_goal_quest_v1(gen_random_uuid(),%L,%s,%L)',g,rev,candidate),'23514','ineligible '||mode);
        RESET ROLE;
    END LOOP;
    PERFORM goals_test.check((SELECT count(*) FROM system_internal.goal_commands)=before_count
        AND public.get_goal_v1(g)=state_before,'rejected attach has no partial effects');
    INSERT INTO public.quests(user_id,title) VALUES(b,'Foreign Quest') RETURNING id INTO foreign_q;
    INSERT INTO public.quest_occurrences(quest_id,user_id) VALUES(foreign_q,b);
    SET LOCAL ROLE authenticated;
    PERFORM goals_test.reject(format('SELECT public.attach_goal_quest_v1(gen_random_uuid(),%L,%s,%L)',g,rev,foreign_q),'P0002','foreign Quest hidden');
    PERFORM goals_test.reject(format('SELECT public.detach_goal_quest_v1(gen_random_uuid(),%L,%s,%L)',g,rev,new_link),'P0002','wrong Goal link hidden');
    PERFORM goals_test.reject('SELECT public.get_goal_v1(gen_random_uuid())','P0002','unknown Goal');
    RESET ROLE;

    -- Late failure proves whole transaction rollback (including a tentative metadata update).
    UPDATE public.goals SET revision=9223372036854775807 WHERE id=g2;
    state_before := public.get_goal_v1(g2); invalid_cmd := gen_random_uuid();
    SET LOCAL ROLE authenticated;
    PERFORM goals_test.reject(format('SELECT public.update_goal_v1(%L,%L,9223372036854775807,''Must roll back'',NULL)',invalid_cmd,g2),'23514','revision overflow rollback');
    RESET ROLE;
    PERFORM goals_test.check(public.get_goal_v1(g2)=state_before
        AND NOT EXISTS(SELECT 1 FROM system_internal.goal_commands WHERE command_id=invalid_cmd),'rollback after tentative edit');

    -- Owner isolation under the actual new executor, as well as public authenticated RPCs.
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'user_metadata',jsonb_build_object('owner',true))::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM goals_test.reject(format('SELECT public.create_goal_v1(%L,%L,''Main Quest'',NULL)',create_cmd,g),'42501','non-owner replay rejected');
    PERFORM goals_test.reject(format('SELECT public.get_goal_v1(%L)',g),'42501','non-owner read rejected');
    PERFORM goals_test.reject('SELECT public.list_goals_v1()','42501','non-owner list rejected');
    PERFORM goals_test.check((SELECT count(*) FROM public.goals)=0 AND (SELECT count(*) FROM public.goal_quest_links)=0,'non-owner rows hidden');
    RESET ROLE;
    SET LOCAL ROLE goal_command_owner;
    PERFORM goals_test.check((SELECT count(*) FROM public.quests)=0 AND (SELECT count(*) FROM public.quest_occurrences)=0
        AND (SELECT count(*) FROM system_internal.goal_commands)=0,'executor is RLS-bound');
    PERFORM goals_test.reject(format('INSERT INTO public.goals(id,user_id,title) VALUES(gen_random_uuid(),%L,''Denied'')',b),'42501','executor non-owner insert');
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM goals_test.reject('SELECT system_internal.run_goal_command_v1(NULL,NULL,NULL,NULL,NULL)','42501','dispatcher private');
    PERFORM goals_test.reject('SELECT * FROM system_internal.goal_commands','42501','receipt table private');
    PERFORM goals_test.reject('UPDATE public.goals SET title=''forged''','42501','owner direct writes denied');
    RESET ROLE;
    DELETE FROM system_private.owner_configuration;
    SET LOCAL ROLE authenticated;
    PERFORM goals_test.reject('SELECT public.list_goals_v1()','42501','missing config');
    RESET ROLE;
END;
$behavior$;
ROLLBACK;
