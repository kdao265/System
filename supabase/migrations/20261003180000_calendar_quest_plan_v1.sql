-- ADR-022 / locked Calendar Quest Timeline & Detail V1 contract.
-- Additive, after recurring retirement. No historical data backfill or grants to clients to write tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.quest_occurrences ADD COLUMN planned_end_at timestamptz;
ALTER TABLE public.quest_occurrences ADD CONSTRAINT ck_occurrence_planned_interval CHECK (
    planned_end_at IS NULL OR (scheduled_at IS NOT NULL AND isfinite(scheduled_at)
        AND isfinite(planned_end_at) AND planned_end_at > scheduled_at)
);

CREATE FUNCTION public.get_calendar_events_v2(p_from date, p_to date)
RETURNS TABLE (
    source text, entry_id uuid, quest_id uuid, title text, status text,
    start_at timestamptz, end_at timestamptz, all_day boolean,
    start_date date, end_date date, category text, notes text, source_slot_date date,
    execution_cycle integer, reward_exp_snapshot integer, occurrence_id uuid, deadline_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    zone text;
    range_start timestamptz;
    range_end timestamptz;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
    IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
        OR p_from > p_to OR p_to - p_from > 91 THEN
        RAISE EXCEPTION 'Calendar range requires at most 92 ordered days' USING ERRCODE = '22023';
    END IF;
    SELECT p.timezone INTO zone FROM public.profiles p WHERE p.user_id = actor;
    IF zone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z
        WHERE z.name = zone AND z.name NOT LIKE 'posix/%' AND z.name NOT LIKE 'right/%' AND z.name <> 'localtime') THEN
        RAISE EXCEPTION 'Profile timezone is required' USING ERRCODE = 'PZ001';
    END IF;
    range_start := p_from::timestamp AT TIME ZONE zone;
    range_end := (p_to + 1)::timestamp AT TIME ZONE zone;
    RETURN QUERY SELECT c.* FROM (
        SELECT 'quest_occurrence'::text AS source, o.id AS entry_id, o.quest_id,
            q.title, o.status, o.scheduled_at AS start_at, o.planned_end_at AS end_at,
            false AS all_day, NULL::date AS start_date, NULL::date AS end_date,
            NULL::text AS category, NULL::text AS notes, o.source_slot_date,
            o.execution_cycle, o.reward_exp_snapshot, o.id AS occurrence_id, o.deadline_at
        FROM public.quest_occurrences o JOIN public.quests q ON q.id = o.quest_id AND q.user_id = actor
        WHERE o.user_id = actor AND q.archived_at IS NULL AND q.deleted_at IS NULL
            AND ((o.scheduled_at < range_end AND (o.planned_end_at > range_start
                OR (o.planned_end_at IS NULL AND o.scheduled_at >= range_start)))
                OR (o.scheduled_at IS NULL AND o.source_slot_date BETWEEN p_from AND p_to))
        UNION ALL
        SELECT 'schedule_event'::text, e.id, NULL::uuid, e.title, NULL::text,
            CASE WHEN e.all_day THEN NULL ELSE e.start_at END,
            CASE WHEN e.all_day THEN NULL ELSE e.end_at END,
            e.all_day, e.start_date, e.end_date, e.category, e.notes,
            NULL::date, NULL::integer, NULL::integer, NULL::uuid, NULL::timestamptz
        FROM public.schedule_events e WHERE e.user_id = actor AND e.removed_at IS NULL
            AND ((e.all_day AND e.start_date <= p_to AND e.end_date > p_from)
                OR (NOT e.all_day AND e.start_at < range_end
                    AND (e.end_at > range_start OR (e.end_at IS NULL AND e.start_at >= range_start))))
    ) c ORDER BY coalesce(c.start_date, (c.start_at AT TIME ZONE zone)::date, c.source_slot_date),
        c.start_at NULLS FIRST, c.source, c.entry_id;
END;
$function$;

CREATE FUNCTION public.get_quest_occurrence_detail_v1(p_occurrence_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid; result jsonb;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object('version',1,'occurrence_id',o.id,'quest_id',q.id,
        'title',q.title,'description',q.description,'notes',q.notes,
        'status',o.status,'scheduled_at',o.scheduled_at,'planned_end_at',o.planned_end_at,
        'deadline_at',o.deadline_at,'execution_cycle',o.execution_cycle,
        'reward_exp_snapshot',o.reward_exp_snapshot,
        'estimated_duration_minutes_snapshot',o.estimated_duration_minutes_snapshot,
        'source_slot_date',o.source_slot_date,'source_timezone',o.source_timezone,
        'recurrence_rule_id',o.recurrence_rule_id,'recurrence_revision',o.recurrence_revision,
        'recurrence_mode',q.recurrence_mode,
        'rule',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
            'recurrence_type',r.recurrence_type,'weekdays',r.weekdays,'month_day',r.month_day,
            'interval_count',r.interval_count,'anchor_date',r.anchor_date,'end_date',r.end_date,
            'occurrence_limit',r.occurrence_limit,'revision',r.revision,'paused',r.stopped_at IS NOT NULL) END,
        'goal',(SELECT jsonb_build_object('id',g.id,'title',g.title,'archived',g.archived_at IS NOT NULL)
            FROM public.goal_quest_links l JOIN public.goals g ON g.id = l.goal_id AND g.user_id = actor
            WHERE l.quest_id = q.id AND l.occurrence_id = o.id AND l.user_id = actor
                AND l.detached_at IS NULL AND q.recurrence_mode = 'one_off'),
        'plannable',o.status IN ('draft','scheduled','active')) INTO result
    FROM public.quest_occurrences o JOIN public.quests q ON q.id = o.quest_id AND q.user_id = actor
    LEFT JOIN public.quest_recurrence_rules r ON r.id = o.recurrence_rule_id AND r.user_id = actor
    WHERE o.id = p_occurrence_id AND o.user_id = actor AND q.archived_at IS NULL AND q.deleted_at IS NULL;
    RETURN result;
END;
$function$;

CREATE FUNCTION public.set_quest_occurrence_plan_v1(
    p_command_id uuid, p_occurrence_id uuid, p_expected_execution_cycle integer,
    p_expected_scheduled_at timestamptz, p_expected_planned_end_at timestamptz,
    p_scheduled_at timestamptz, p_planned_end_at timestamptz, p_origin text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid; quest uuid; q public.quests; o public.quest_occurrences;
    prior public.quest_events; event_count bigint; request jsonb; receipt jsonb;
    v_before jsonb; v_after jsonb; v_status text; v_changed boolean; v_event uuid; v_now timestamptz;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL OR p_command_id IS NULL OR p_occurrence_id IS NULL OR p_origin IS NULL THEN
        RAISE EXCEPTION 'Authentication and planning identity required' USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(p_origin);
    IF p_expected_execution_cycle IS NULL OR p_expected_execution_cycle < 1
        OR (p_scheduled_at IS NOT NULL AND NOT isfinite(p_scheduled_at))
        OR (p_planned_end_at IS NOT NULL AND (NOT isfinite(p_planned_end_at)
            OR p_scheduled_at IS NULL OR p_planned_end_at <= p_scheduled_at)) THEN
        RAISE EXCEPTION 'Invalid occurrence plan' USING ERRCODE = '22023';
    END IF;
    request := jsonb_build_object('occurrence_id',p_occurrence_id,'execution_cycle',p_expected_execution_cycle,
        'expected_scheduled_at',p_expected_scheduled_at,'expected_planned_end_at',p_expected_planned_end_at,
        'scheduled_at',p_scheduled_at,'planned_end_at',p_planned_end_at,'origin',p_origin);
    PERFORM progression_internal.lock_owner(actor);
    PERFORM system_internal.reject_completion_alias(p_command_id);
    SELECT x.quest_id INTO quest FROM public.quest_occurrences x WHERE x.id = p_occurrence_id AND x.user_id = actor;
    SELECT * INTO q FROM public.quests x WHERE x.id = quest AND x.user_id = actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Quest subject not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO o FROM public.quest_occurrences x WHERE x.id = p_occurrence_id AND x.user_id = actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Quest subject not found' USING ERRCODE = 'P0002'; END IF;
    SELECT count(*) INTO event_count FROM public.quest_events e WHERE e.user_id = actor AND e.command_id = p_command_id;
    IF event_count > 0 THEN
        SELECT * INTO prior FROM public.quest_events e WHERE e.user_id = actor AND e.command_id = p_command_id
            AND e.occurrence_id = o.id AND e.quest_id = q.id AND e.event_type = 'occurrence_edited';
        IF event_count <> 1 OR NOT FOUND OR prior.actor_user_id IS DISTINCT FROM actor
            OR prior.actor_kind IS DISTINCT FROM 'user' OR prior.payload_version IS DISTINCT FROM 1
            OR prior.execution_cycle IS DISTINCT FROM p_expected_execution_cycle
            OR prior.payload ->> 'command_kind' IS DISTINCT FROM 'occurrence_plan_v1'
            OR prior.payload -> 'request' IS DISTINCT FROM request THEN
            RAISE EXCEPTION 'Conflicting occurrence plan command reuse' USING ERRCODE = '23505';
        END IF;
        RETURN (prior.payload -> 'receipt') || jsonb_build_object('replay',true);
    END IF;
    IF q.archived_at IS NOT NULL OR q.deleted_at IS NOT NULL OR o.status NOT IN ('draft','scheduled','active') THEN
        RAISE EXCEPTION 'Quest occurrence is not plannable' USING ERRCODE = '23514';
    END IF;
    IF o.execution_cycle IS DISTINCT FROM p_expected_execution_cycle
        OR o.scheduled_at IS DISTINCT FROM p_expected_scheduled_at
        OR o.planned_end_at IS DISTINCT FROM p_expected_planned_end_at THEN
        RAISE EXCEPTION 'Stale occurrence plan' USING ERRCODE = '23514';
    END IF;
    IF p_scheduled_at IS NOT NULL AND o.deadline_at < p_scheduled_at THEN
        RAISE EXCEPTION 'Planned start is after deadline' USING ERRCODE = '23514';
    END IF;
    v_status := CASE WHEN o.status = 'scheduled' AND p_scheduled_at IS NULL AND o.deadline_at IS NULL
        THEN 'draft' ELSE o.status END;
    v_before := jsonb_build_object('scheduled_at',o.scheduled_at,'planned_end_at',o.planned_end_at,'status',o.status);
    v_after := jsonb_build_object('scheduled_at',p_scheduled_at,'planned_end_at',p_planned_end_at,'status',v_status);
    v_changed := v_before IS DISTINCT FROM v_after;
    v_event := gen_random_uuid(); v_now := clock_timestamp();
    receipt := jsonb_build_object('version',1,'command_id',p_command_id,'occurrence_id',o.id,'quest_id',q.id,
        'execution_cycle',o.execution_cycle,'event_id',v_event,'before',v_before,'after',v_after,
        'changed',v_changed,'replay',false);
    INSERT INTO public.quest_events(id,quest_id,user_id,occurrence_id,event_type,actor_kind,actor_user_id,
        occurred_at,command_id,execution_cycle,payload_version,payload)
    VALUES(v_event,q.id,actor,o.id,'occurrence_edited','user',actor,v_now,p_command_id,o.execution_cycle,1,
        jsonb_build_object('command_kind','occurrence_plan_v1','request',request,'receipt',receipt));
    IF v_changed THEN
        UPDATE public.quest_occurrences SET scheduled_at = p_scheduled_at, planned_end_at = p_planned_end_at,
            status = v_status, updated_at = v_now WHERE id = o.id AND user_id = actor;
    END IF;
    RETURN receipt;
END;
$function$;

-- Same RLS-bound executor as existing occurrence mutations, never table owner.
GRANT quest_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO quest_command_owner;
ALTER FUNCTION public.set_quest_occurrence_plan_v1(uuid,uuid,integer,timestamptz,timestamptz,timestamptz,timestamptz,text) OWNER TO quest_command_owner;
REVOKE CREATE ON SCHEMA public FROM quest_command_owner;
-- The borrowed owner membership must outlive the ACL fixes: the executor-owned planning
-- function can only be revoked/granted while the migration role is still a member of its
-- owning role. Earlier archive/delete and recurring retirement migrations release this
-- membership last for the same reason.
REVOKE ALL ON FUNCTION public.get_calendar_events_v2(date,date), public.get_quest_occurrence_detail_v1(uuid),
    public.set_quest_occurrence_plan_v1(uuid,uuid,integer,timestamptz,timestamptz,timestamptz,timestamptz,text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_calendar_events_v2(date,date), public.get_quest_occurrence_detail_v1(uuid),
    public.set_quest_occurrence_plan_v1(uuid,uuid,integer,timestamptz,timestamptz,timestamptz,timestamptz,text) TO authenticated;
REVOKE quest_command_owner FROM CURRENT_USER;
NOTIFY pgrst, 'reload schema';
COMMIT;
