-- ADR-020 / GM-01..12: Goals group existing one-off Quests; no second lifecycle.
-- Additive Phase A only. ADR-015 guards are installed immediately on new objects.
-- Historical migrations, Quest/EXP routines and Calendar remain unchanged.
BEGIN;

CREATE ROLE goal_command_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, system_internal, system_private, progression_internal TO goal_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.request_user_id(), system_private.require_owner(),
    progression_internal.lock_owner(uuid) TO goal_command_owner;
GRANT system_owner_reader TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION system_private.is_owner() TO goal_command_owner;
REVOKE system_owner_reader FROM CURRENT_USER;

CREATE TABLE public.goals (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    title text NOT NULL,
    description text,
    archived_at timestamptz,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_goal_owner UNIQUE (id, user_id),
    CONSTRAINT ck_goal_title CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
    CONSTRAINT ck_goal_description CHECK (char_length(description) <= 4000),
    CONSTRAINT ck_goal_revision CHECK (revision >= 1)
);
CREATE INDEX ix_goals_owner ON public.goals(user_id, id);

CREATE TABLE public.goal_quest_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    goal_id uuid NOT NULL,
    quest_id uuid NOT NULL,
    occurrence_id uuid NOT NULL,
    position integer NOT NULL,
    attached_at timestamptz NOT NULL DEFAULT now(),
    detached_at timestamptz,
    CONSTRAINT fk_goal_link_goal_owner FOREIGN KEY (goal_id, user_id)
        REFERENCES public.goals(id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_goal_link_quest_owner FOREIGN KEY (quest_id, user_id)
        REFERENCES public.quests(id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_goal_link_occurrence_owner FOREIGN KEY (occurrence_id, quest_id, user_id)
        REFERENCES public.quest_occurrences(id, quest_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_goal_link_position CHECK (position >= 1),
    CONSTRAINT ck_goal_link_interval CHECK (detached_at IS NULL OR detached_at >= attached_at)
);
CREATE UNIQUE INDEX uq_goal_quest_current ON public.goal_quest_links(quest_id) WHERE detached_at IS NULL;
CREATE INDEX ix_goal_links_current_order ON public.goal_quest_links(user_id, goal_id, position, id) WHERE detached_at IS NULL;
CREATE INDEX ix_goal_links_goal_owner ON public.goal_quest_links(goal_id, user_id);
CREATE INDEX ix_goal_links_occurrence_owner ON public.goal_quest_links(occurrence_id, quest_id, user_id);
CREATE INDEX ix_goal_links_quest_owner ON public.goal_quest_links(quest_id, user_id);

CREATE TABLE system_internal.goal_commands (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    command_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    command_type text NOT NULL,
    request jsonb NOT NULL,
    result jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, command_id),
    CONSTRAINT fk_goal_command_owner FOREIGN KEY (goal_id, user_id)
        REFERENCES public.goals(id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    -- Reserved storage vocabulary only: no V1 routine accepts reorder.
    CONSTRAINT ck_goal_command_type CHECK (command_type IN ('create', 'update_metadata', 'set_archived', 'attach', 'detach', 'reorder')),
    CONSTRAINT ck_goal_command_request CHECK (jsonb_typeof(request) = 'object'),
    CONSTRAINT ck_goal_command_result CHECK (jsonb_typeof(result) = 'object')
);
CREATE INDEX ix_goal_commands_history ON system_internal.goal_commands(user_id, goal_id, recorded_at, command_id);

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_quest_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_internal.goal_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goals, public.goal_quest_links, system_internal.goal_commands
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner, schedule_command_owner;
GRANT SELECT ON public.goals, public.goal_quest_links TO authenticated, goal_command_owner;
GRANT INSERT ON public.goals, public.goal_quest_links TO goal_command_owner;
GRANT UPDATE (title, description, archived_at, revision, updated_at) ON public.goals TO goal_command_owner;
GRANT UPDATE (detached_at) ON public.goal_quest_links TO goal_command_owner;
GRANT SELECT, INSERT ON system_internal.goal_commands TO goal_command_owner;

-- Preserve all historical policies; the new executor needs its own restrictive
-- guard because the historical activation enumerates its roles explicitly.
GRANT SELECT ON public.quests, public.quest_occurrences, public.quest_recurrence_rules TO goal_command_owner;
DO $policies$
DECLARE target text;
BEGIN
    FOREACH target IN ARRAY ARRAY['public.goals', 'public.goal_quest_links', 'system_internal.goal_commands'] LOOP
        EXECUTE format('CREATE POLICY goal_owner_select ON %s FOR SELECT TO %s USING (user_id = (SELECT system_internal.request_user_id()))',
            target, CASE WHEN target = 'system_internal.goal_commands' THEN 'goal_command_owner' ELSE 'authenticated, goal_command_owner' END);
        EXECUTE format('CREATE POLICY goal_command_insert ON %s FOR INSERT TO goal_command_owner WITH CHECK (user_id = (SELECT system_internal.request_user_id()))', target);
        IF target <> 'system_internal.goal_commands' THEN
            EXECUTE format('CREATE POLICY goal_command_update ON %s FOR UPDATE TO goal_command_owner USING (user_id = (SELECT system_internal.request_user_id())) WITH CHECK (user_id = (SELECT system_internal.request_user_id()))', target);
        END IF;
        EXECUTE format('CREATE POLICY system_single_owner ON %s AS RESTRICTIVE FOR ALL TO authenticated, goal_command_owner
            USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
            WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))', target);
    END LOOP;
    FOREACH target IN ARRAY ARRAY['public.quests', 'public.quest_occurrences', 'public.quest_recurrence_rules'] LOOP
        EXECUTE format('CREATE POLICY goal_reader_select ON %s FOR SELECT TO goal_command_owner USING (user_id = (SELECT system_internal.request_user_id()))', target);
        EXECUTE format('CREATE POLICY goal_reader_single_owner ON %s AS RESTRICTIVE FOR ALL TO goal_command_owner
            USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
            WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))', target);
    END LOOP;
END;
$policies$;

CREATE FUNCTION system_internal.guard_goal_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_TABLE_NAME = 'goal_commands' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Goal history is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.detached_at IS NOT NULL
        OR ROW(NEW.id, NEW.user_id, NEW.goal_id, NEW.quest_id, NEW.occurrence_id, NEW.attached_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.goal_id, OLD.quest_id, OLD.occurrence_id, OLD.attached_at) THEN
        RAISE EXCEPTION 'Goal membership identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE TRIGGER goal_commands_immutable BEFORE UPDATE OR DELETE ON system_internal.goal_commands
    FOR EACH ROW EXECUTE FUNCTION system_internal.guard_goal_history();
CREATE TRIGGER goal_links_retained BEFORE UPDATE OR DELETE ON public.goal_quest_links
    FOR EACH ROW EXECUTE FUNCTION system_internal.guard_goal_history();

-- Invoker helper, callable only by the dedicated executor. Public typed wrappers
-- fix the operation/request shape; no generic command endpoint is exposed.
CREATE FUNCTION system_internal.run_goal_command_v1(
    p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_type text, p_request jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    g public.goals;
    q public.quests;
    o public.quest_occurrences;
    link public.goal_quest_links;
    prior system_internal.goal_commands;
    request_value jsonb;
    result_value jsonb;
    v_title text;
    v_description text;
    v_quest uuid;
    v_link uuid;
    v_archived boolean;
    v_position bigint;
    v_before bigint;
    v_after bigint;
    v_changed boolean := false;
    v_now timestamptz;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF p_command_id IS NULL OR p_goal_id IS NULL OR p_type IS NULL
        OR p_type NOT IN ('create', 'update_metadata', 'set_archived', 'attach', 'detach')
        OR (p_type <> 'create' AND (p_expected_revision IS NULL OR p_expected_revision < 1)) THEN
        RAISE EXCEPTION 'Invalid Goal command inputs' USING ERRCODE = '22023';
    END IF;
    request_value := jsonb_build_object('p_goal_id', p_goal_id);
    IF p_type <> 'create' THEN
        request_value := request_value || jsonb_build_object('p_expected_revision', p_expected_revision::text);
    END IF;
    IF p_type IN ('create', 'update_metadata') THEN
        v_title := btrim(p_request ->> 'p_title');
        v_description := nullif(btrim(p_request ->> 'p_description'), '');
        IF v_title IS NULL OR v_title !~ '[^[:space:]]' OR char_length(v_title) > 120
            OR char_length(v_description) > 4000 THEN
            RAISE EXCEPTION 'Invalid Goal metadata' USING ERRCODE = '22023';
        END IF;
        request_value := request_value || jsonb_build_object('p_title', v_title, 'p_description', v_description);
    ELSIF p_type = 'set_archived' THEN
        v_archived := (p_request ->> 'p_archived')::boolean;
        IF v_archived IS NULL THEN RAISE EXCEPTION 'Invalid Goal archive state' USING ERRCODE = '22023'; END IF;
        request_value := request_value || jsonb_build_object('p_archived', v_archived);
    ELSIF p_type = 'attach' THEN
        v_quest := (p_request ->> 'p_quest_id')::uuid;
        IF v_quest IS NULL THEN RAISE EXCEPTION 'Invalid Goal Quest identity' USING ERRCODE = '22023'; END IF;
        request_value := request_value || jsonb_build_object('p_quest_id', v_quest);
    ELSE
        v_link := (p_request ->> 'p_link_id')::uuid;
        IF v_link IS NULL THEN RAISE EXCEPTION 'Invalid Goal link identity' USING ERRCODE = '22023'; END IF;
        request_value := request_value || jsonb_build_object('p_link_id', v_link);
    END IF;
    PERFORM progression_internal.lock_owner(actor);
    SELECT * INTO prior FROM system_internal.goal_commands c
        WHERE c.user_id = actor AND c.command_id = p_command_id;
    IF FOUND THEN
        IF prior.goal_id <> p_goal_id OR prior.command_type <> p_type OR prior.request IS DISTINCT FROM request_value THEN
            RAISE EXCEPTION 'Conflicting Goal command reuse' USING ERRCODE = '23505';
        END IF;
        RETURN prior.result || jsonb_build_object('replay', true);
    END IF;
    v_now := clock_timestamp();
    IF p_type = 'create' THEN
        INSERT INTO public.goals(id, user_id, title, description, created_at, updated_at)
            VALUES (p_goal_id, actor, v_title, v_description, v_now, v_now) ON CONFLICT (id) DO NOTHING;
        IF NOT FOUND THEN RAISE EXCEPTION 'Goal identity already exists' USING ERRCODE = '23505'; END IF;
        v_before := 0;
        v_after := 1;
        v_changed := true;
    ELSE
        SELECT * INTO g FROM public.goals WHERE id = p_goal_id AND user_id = actor FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Goal subject not found' USING ERRCODE = 'P0002'; END IF;
        IF g.revision <> p_expected_revision THEN
            RAISE EXCEPTION 'Stale Goal revision' USING ERRCODE = '23514';
        END IF;
        IF g.archived_at IS NOT NULL AND p_type <> 'set_archived' THEN
            RAISE EXCEPTION 'Archived Goal cannot be edited' USING ERRCODE = '23514';
        END IF;
        v_before := g.revision;
        IF p_type = 'update_metadata' THEN
            v_changed := ROW(g.title, g.description) IS DISTINCT FROM ROW(v_title, v_description);
            IF v_changed THEN
                UPDATE public.goals SET title = v_title, description = v_description WHERE id = p_goal_id AND user_id = actor;
            END IF;
        ELSIF p_type = 'set_archived' THEN
            v_changed := (g.archived_at IS NOT NULL) IS DISTINCT FROM v_archived;
            IF v_changed THEN
                UPDATE public.goals SET archived_at = CASE WHEN v_archived THEN v_now ELSE NULL END WHERE id = p_goal_id AND user_id = actor;
            END IF;
        ELSIF p_type = 'attach' THEN
            SELECT * INTO q FROM public.quests WHERE id = v_quest AND user_id = actor;
            IF NOT FOUND THEN RAISE EXCEPTION 'Goal subject not found' USING ERRCODE = 'P0002'; END IF;
            IF q.archived_at IS NOT NULL OR q.recurrence_mode <> 'one_off'
                OR q.direct_goal_id IS NOT NULL OR q.project_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM public.quest_recurrence_rules r WHERE r.quest_id = q.id AND r.user_id = actor)
                OR (SELECT count(*) FROM public.quest_occurrences occ WHERE occ.quest_id = q.id AND occ.user_id = actor) <> 1 THEN
                RAISE EXCEPTION 'Quest is not eligible for Goal membership' USING ERRCODE = '23514';
            END IF;
            SELECT * INTO o FROM public.quest_occurrences WHERE quest_id = q.id AND user_id = actor;
            IF o.recurrence_rule_id IS NOT NULL OR o.recurrence_revision IS NOT NULL
                OR o.source_slot_date IS NOT NULL OR o.source_timezone IS NOT NULL
                OR o.direct_goal_id_snapshot IS NOT NULL OR o.project_id_snapshot IS NOT NULL THEN
                RAISE EXCEPTION 'Quest is not eligible for Goal membership' USING ERRCODE = '23514';
            END IF;
            SELECT * INTO link FROM public.goal_quest_links l WHERE l.quest_id = q.id AND l.user_id = actor AND l.detached_at IS NULL;
            IF FOUND THEN
                IF link.goal_id <> p_goal_id THEN
                    RAISE EXCEPTION 'Quest already belongs to a Goal' USING ERRCODE = '23505';
                END IF;
                v_link := link.id;
            ELSE
                SELECT coalesce(max(l.position)::bigint, 0) + 1 INTO v_position
                    FROM public.goal_quest_links l WHERE l.goal_id = p_goal_id AND l.user_id = actor AND l.detached_at IS NULL;
                IF v_position > 2147483647 THEN RAISE EXCEPTION 'Goal position exhausted' USING ERRCODE = '23514'; END IF;
                INSERT INTO public.goal_quest_links(user_id, goal_id, quest_id, occurrence_id, position, attached_at)
                    VALUES (actor, p_goal_id, q.id, o.id, v_position::integer, v_now) RETURNING id INTO v_link;
                v_changed := true;
            END IF;
        ELSE
            SELECT * INTO link FROM public.goal_quest_links l
                WHERE l.id = v_link AND l.goal_id = p_goal_id AND l.user_id = actor FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Goal subject not found' USING ERRCODE = 'P0002'; END IF;
            v_changed := link.detached_at IS NULL;
            IF v_changed THEN
                UPDATE public.goal_quest_links SET detached_at = v_now WHERE id = v_link AND user_id = actor;
            END IF;
        END IF;
        IF v_changed AND v_before = 9223372036854775807 THEN
            RAISE EXCEPTION 'Goal revision exhausted' USING ERRCODE = '23514';
        END IF;
        v_after := v_before + CASE WHEN v_changed THEN 1 ELSE 0 END;
        IF v_changed THEN
            UPDATE public.goals SET revision = v_after, updated_at = v_now WHERE id = p_goal_id AND user_id = actor;
        END IF;
    END IF;
    result_value := jsonb_build_object('version', 1, 'command_id', p_command_id, 'goal_id', p_goal_id,
        'command_type', p_type, 'revision_before', v_before::text, 'revision_after', v_after::text,
        'changed', v_changed, 'link_id', v_link, 'recorded_at', v_now);
    INSERT INTO system_internal.goal_commands(user_id, command_id, goal_id, command_type, request, result, recorded_at)
        VALUES (actor, p_command_id, p_goal_id, p_type, request_value, result_value, v_now);
    RETURN result_value || jsonb_build_object('replay', false);
END;
$function$;

CREATE FUNCTION public.create_goal_v1(p_command_id uuid, p_goal_id uuid, p_title text, p_description text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    RETURN system_internal.run_goal_command_v1(p_command_id, p_goal_id, NULL, 'create',
        jsonb_build_object('p_title', p_title, 'p_description', p_description));
END;
$function$;
CREATE FUNCTION public.update_goal_v1(p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_title text, p_description text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    RETURN system_internal.run_goal_command_v1(p_command_id, p_goal_id, p_expected_revision, 'update_metadata',
        jsonb_build_object('p_title', p_title, 'p_description', p_description));
END;
$function$;
CREATE FUNCTION public.set_goal_archived_v1(p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_archived boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    RETURN system_internal.run_goal_command_v1(p_command_id, p_goal_id, p_expected_revision, 'set_archived',
        jsonb_build_object('p_archived', p_archived));
END;
$function$;
CREATE FUNCTION public.attach_goal_quest_v1(p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_quest_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    RETURN system_internal.run_goal_command_v1(p_command_id, p_goal_id, p_expected_revision, 'attach',
        jsonb_build_object('p_quest_id', p_quest_id));
END;
$function$;
CREATE FUNCTION public.detach_goal_quest_v1(p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_link_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    RETURN system_internal.run_goal_command_v1(p_command_id, p_goal_id, p_expected_revision, 'detach',
        jsonb_build_object('p_link_id', p_link_id));
END;
$function$;

-- One canonical, RLS-bound current read model. STABLE throughout the call chain
-- keeps metadata, reference-integrity checks, counts and details in one snapshot.
CREATE FUNCTION system_internal.goal_projection_v1(p_goal_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    g public.goals;
    total bigint;
    completed bigint;
    invalid bigint;
    members jsonb;
    complete boolean;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    SELECT * INTO g FROM public.goals WHERE id = p_goal_id AND user_id = actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Goal subject not found' USING ERRCODE = 'P0002'; END IF;
    SELECT count(l.id), count(l.id) FILTER (WHERE o.status = 'completed'),
        count(l.id) FILTER (WHERE q.id IS NULL OR o.id IS NULL),
        coalesce(jsonb_agg(jsonb_build_object('link_id', l.id, 'quest_id', l.quest_id,
            'occurrence_id', l.occurrence_id, 'position', l.position, 'attached_at', l.attached_at,
            'title', q.title, 'quest_archived_at', q.archived_at, 'status', o.status,
            'execution_cycle', o.execution_cycle, 'scheduled_at', o.scheduled_at,
            'deadline_at', o.deadline_at, 'reward_exp_snapshot', o.reward_exp_snapshot)
            ORDER BY l.position, l.id), '[]'::jsonb)
        INTO total, completed, invalid, members
        FROM public.goal_quest_links l
        LEFT JOIN public.quests q ON q.id = l.quest_id AND q.user_id = l.user_id
        LEFT JOIN public.quest_occurrences o ON o.id = l.occurrence_id AND o.quest_id = l.quest_id AND o.user_id = l.user_id
        WHERE l.goal_id = g.id AND l.user_id = actor AND l.detached_at IS NULL;
    IF invalid <> 0 THEN RAISE EXCEPTION 'Goal membership is inconsistent' USING ERRCODE = '23514'; END IF;
    complete := total > 0 AND completed = total;
    RETURN jsonb_build_object('version', 1, 'goal', jsonb_build_object(
        'id', g.id, 'title', g.title, 'description', g.description, 'archived_at', g.archived_at,
        'created_at', g.created_at, 'updated_at', g.updated_at, 'revision', g.revision::text,
        'total_subquests', total::text, 'completed_subquests', completed::text, 'is_complete', complete,
        'display_state', CASE WHEN g.archived_at IS NOT NULL THEN 'archived' WHEN complete THEN 'completed' ELSE 'active' END),
        'subquests', members);
END;
$function$;
CREATE FUNCTION public.get_goal_v1(p_goal_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM system_private.require_owner();
    IF p_goal_id IS NULL THEN RAISE EXCEPTION 'Invalid Goal identity' USING ERRCODE = '22023'; END IF;
    RETURN system_internal.goal_projection_v1(p_goal_id);
END;
$function$;
CREATE FUNCTION public.list_goals_v1(p_scope text DEFAULT 'unarchived', p_after_id uuid DEFAULT NULL, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    item record;
    results jsonb := '[]'::jsonb;
    last_id uuid;
    next_id uuid;
    emitted integer := 0;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF p_scope IS NULL OR p_scope NOT IN ('unarchived', 'archived', 'all') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Invalid Goal list inputs' USING ERRCODE = '22023';
    END IF;
    FOR item IN SELECT g.id FROM public.goals g WHERE g.user_id = actor
        AND (p_after_id IS NULL OR g.id > p_after_id)
        AND (p_scope = 'all' OR (p_scope = 'archived' AND g.archived_at IS NOT NULL)
            OR (p_scope = 'unarchived' AND g.archived_at IS NULL))
        ORDER BY g.id LIMIT p_limit + 1 LOOP
        IF emitted = p_limit THEN next_id := last_id; EXIT; END IF;
        results := results || jsonb_build_array(system_internal.goal_projection_v1(item.id) -> 'goal');
        last_id := item.id;
        emitted := emitted + 1;
    END LOOP;
    RETURN jsonb_build_object('version', 1, 'goals', results, 'next_after_id', next_id);
END;
$function$;

REVOKE ALL ON FUNCTION system_internal.guard_goal_history(),
    system_internal.run_goal_command_v1(uuid, uuid, bigint, text, jsonb), system_internal.goal_projection_v1(uuid)
    FROM PUBLIC, anon, authenticated, service_role, goal_command_owner, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner, schedule_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.run_goal_command_v1(uuid, uuid, bigint, text, jsonb) TO goal_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.goal_projection_v1(uuid) TO authenticated;

GRANT goal_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO goal_command_owner;
DO $routines$
DECLARE signature text;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.create_goal_v1(uuid,uuid,text,text)',
        'public.update_goal_v1(uuid,uuid,bigint,text,text)',
        'public.set_goal_archived_v1(uuid,uuid,bigint,boolean)',
        'public.attach_goal_quest_v1(uuid,uuid,bigint,uuid)',
        'public.detach_goal_quest_v1(uuid,uuid,bigint,uuid)',
        'public.get_goal_v1(uuid)', 'public.list_goals_v1(text,uuid,integer)'
    ] LOOP
        IF signature NOT IN ('public.get_goal_v1(uuid)', 'public.list_goals_v1(text,uuid,integer)') THEN
            EXECUTE format('ALTER FUNCTION %s OWNER TO goal_command_owner', signature);
        END IF;
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, goal_command_owner,
            quest_command_owner, progression_command_owner, level_policy_assignment_owner, schedule_command_owner', signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', signature);
    END LOOP;
END;
$routines$;
REVOKE CREATE ON SCHEMA public FROM goal_command_owner;
REVOKE goal_command_owner FROM CURRENT_USER;

COMMENT ON TABLE public.goals IS 'ADR-020: Main Quest metadata/archival only. Completion and progress derive from current linked occurrence state.';
COMMENT ON TABLE public.goal_quest_links IS 'Retained one-off Quest membership intervals. Current membership is detached_at IS NULL. No completion state or EXP ownership.';
COMMENT ON TABLE system_internal.goal_commands IS 'Private immutable owner-scoped Goal request/receipt bindings; replay never mutates live state. Reserved reorder type is not exposed in V1.';
NOTIFY pgrst, 'reload schema';
COMMIT;
