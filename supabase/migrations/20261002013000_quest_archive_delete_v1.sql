-- Quest Archive/Delete V1
-- One-off Quest archive/restore plus non-restorable tombstone deletion.
-- Historical Quest events, completion aliases and EXP ledger remain retained/immutable.
-- Delete never physically removes Quest history and never mutates EXP rows.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Permanent-delete marker. deleted_at implies archived_at and is never cleared.
ALTER TABLE public.quests
    ADD COLUMN deleted_at timestamptz;

ALTER TABLE public.quests
    ADD CONSTRAINT ck_quest_deleted_archived
    CHECK (deleted_at IS NULL OR archived_at IS NOT NULL);

COMMENT ON COLUMN public.quests.deleted_at IS
    'Non-restorable Quest tombstone. Physical Quest/history deletion remains forbidden; deleted_at always implies archived_at.';

-- Deletion is a retained definition-level event.
ALTER TABLE public.quest_events DROP CONSTRAINT ck_event_type;
ALTER TABLE public.quest_events
    ADD CONSTRAINT ck_event_type CHECK (
        event_type IN ('created', 'scheduled', 'activated', 'completed', 'completion_corrected',
            'failed', 'failure_reason_changed', 'penalty_waived', 'rescheduled', 'cancelled',
            'reopened', 'archived', 'deleted', 'recurrence_changed', 'recurrence_stopped',
            'deferred', 'occurrence_edited', 'definition_edited')
    );

ALTER TABLE public.quest_events DROP CONSTRAINT ck_event_subject;
ALTER TABLE public.quest_events
    ADD CONSTRAINT ck_event_subject CHECK (
        CASE
            WHEN event_type IN ('completed', 'failed', 'activated', 'scheduled', 'rescheduled',
                'deferred', 'reopened', 'completion_corrected', 'failure_reason_changed',
                'penalty_waived', 'occurrence_edited') THEN occurrence_id IS NOT NULL
            WHEN event_type IN ('archived', 'deleted', 'recurrence_changed', 'recurrence_stopped',
                'definition_edited') THEN occurrence_id IS NULL
            ELSE true
        END
    );

-- Browser-facing raw reads must not expose permanently deleted Quest projections.
-- Command executors still retain owner-scoped access so accepted historical commands can replay.
CREATE POLICY quests_hide_deleted_from_browser ON public.quests
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (deleted_at IS NULL);

CREATE POLICY rules_hide_deleted_from_browser ON public.quest_recurrence_rules
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.quests q
        WHERE q.id = quest_recurrence_rules.quest_id
          AND q.user_id = quest_recurrence_rules.user_id
          AND q.deleted_at IS NULL
    ));

CREATE POLICY occurrences_hide_deleted_from_browser ON public.quest_occurrences
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.quests q
        WHERE q.id = quest_occurrences.quest_id
          AND q.user_id = quest_occurrences.user_id
          AND q.deleted_at IS NULL
    ));

CREATE POLICY events_hide_deleted_from_browser ON public.quest_events
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.quests q
        WHERE q.id = quest_events.quest_id
          AND q.user_id = quest_events.user_id
          AND q.deleted_at IS NULL
    ));

-- The Quest executor needs a narrow read-only view of current Goal membership so
-- permanent deletion can fail closed instead of leaving a live Main Quest link.
GRANT SELECT ON public.goal_quest_links TO quest_command_owner;

CREATE POLICY quest_delete_goal_link_reader ON public.goal_quest_links
    FOR SELECT TO quest_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));

CREATE POLICY quest_delete_goal_link_single_owner ON public.goal_quest_links
    AS RESTRICTIVE FOR SELECT TO quest_command_owner
    USING (
        (SELECT system_private.is_owner())
        AND user_id = (SELECT system_internal.request_user_id())
    );

-- Once a Quest is permanently deleted, its definition and mutable children are frozen.
CREATE FUNCTION system_internal.guard_deleted_quest_definition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical Quest deletion is disabled' USING ERRCODE = '55000';
    END IF;

    IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Permanently deleted Quest is immutable' USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER quest_deleted_definition_guard
    BEFORE UPDATE OR DELETE ON public.quests
    FOR EACH ROW
    EXECUTE FUNCTION system_internal.guard_deleted_quest_definition();

CREATE FUNCTION system_internal.guard_deleted_quest_occurrence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_quest uuid;
    v_user uuid;
    v_deleted_at timestamptz;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_quest := NEW.quest_id;
        v_user := NEW.user_id;
    ELSE
        v_quest := OLD.quest_id;
        v_user := OLD.user_id;
    END IF;

    SELECT q.deleted_at
      INTO v_deleted_at
      FROM public.quests q
     WHERE q.id = v_quest
       AND q.user_id = v_user;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown Quest definition' USING ERRCODE = '23514';
    END IF;

    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Permanently deleted Quest occurrence is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER quest_deleted_occurrence_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.quest_occurrences
    FOR EACH ROW
    EXECUTE FUNCTION system_internal.guard_deleted_quest_occurrence();

CREATE FUNCTION system_internal.guard_deleted_quest_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_quest uuid;
    v_user uuid;
    v_deleted_at timestamptz;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_quest := NEW.quest_id;
        v_user := NEW.user_id;
    ELSE
        v_quest := OLD.quest_id;
        v_user := OLD.user_id;
    END IF;

    SELECT q.deleted_at
      INTO v_deleted_at
      FROM public.quests q
     WHERE q.id = v_quest
       AND q.user_id = v_user;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown Quest definition' USING ERRCODE = '23514';
    END IF;

    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Permanently deleted Quest recurrence is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER quest_deleted_rule_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.quest_recurrence_rules
    FOR EACH ROW
    EXECUTE FUNCTION system_internal.guard_deleted_quest_rule();

-- Archived one-off Quests are frozen from new Quest events. Historical accepted
-- command replay remains possible because replay paths do not mint a new event.
-- Archive-state events themselves, and the final delete event, remain allowed.
CREATE FUNCTION system_internal.guard_quest_event_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_archived_at timestamptz;
    v_deleted_at timestamptz;
BEGIN
    SELECT q.archived_at, q.deleted_at
      INTO v_archived_at, v_deleted_at
      FROM public.quests q
     WHERE q.id = NEW.quest_id
       AND q.user_id = NEW.user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown Quest definition' USING ERRCODE = '23514';
    END IF;

    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Permanently deleted Quest cannot accept new events'
            USING ERRCODE = '55000';
    END IF;

    IF v_archived_at IS NOT NULL
       AND NEW.event_type NOT IN ('archived', 'deleted') THEN
        RAISE EXCEPTION 'Archived Quest cannot accept new events'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER quest_event_state_guard
    BEFORE INSERT ON public.quest_events
    FOR EACH ROW
    EXECUTE FUNCTION system_internal.guard_quest_event_state();

REVOKE ALL ON FUNCTION
    system_internal.guard_deleted_quest_definition(),
    system_internal.guard_deleted_quest_occurrence(),
    system_internal.guard_deleted_quest_rule(),
    system_internal.guard_quest_event_state()
FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
     progression_command_owner, level_policy_assignment_owner, goal_command_owner,
     schedule_command_owner;

CREATE TYPE public.quest_archive_receipt_v1 AS (
    command_id uuid,
    quest_id uuid,
    archived boolean,
    archived_at timestamptz,
    archived_event_id uuid,
    changed boolean,
    replay boolean
);

CREATE TYPE public.quest_delete_receipt_v1 AS (
    command_id uuid,
    quest_id uuid,
    occurrence_id uuid,
    deleted_event_id uuid,
    deleted_at timestamptz,
    prior_status text,
    replay boolean
);

CREATE FUNCTION public.set_one_off_quest_archived_v1(
    p_command_id uuid,
    p_quest_id uuid,
    p_archived boolean,
    p_origin text
) RETURNS public.quest_archive_receipt_v1
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    q public.quests;
    prior public.quest_events;
    event_count bigint;
    occurrence_count bigint;
    v_now timestamptz;
    v_after timestamptz;
    v_event_id uuid;
    v_changed boolean;
    v_payload jsonb;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();

    IF actor IS NULL OR p_command_id IS NULL OR p_quest_id IS NULL
       OR p_archived IS NULL OR p_origin IS NULL THEN
        RAISE EXCEPTION 'Authentication and required archive inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;

    PERFORM progression_internal.require_origin(p_origin);
    PERFORM progression_internal.lock_owner(actor);
    PERFORM system_internal.reject_completion_alias(p_command_id);

    SELECT count(*)
      INTO event_count
      FROM public.quest_events e
     WHERE e.user_id = actor
       AND e.command_id = p_command_id;

    IF event_count > 0 THEN
        SELECT *
          INTO prior
          FROM public.quest_events e
         WHERE e.user_id = actor
           AND e.command_id = p_command_id
           AND e.event_type = 'archived'
           AND e.occurrence_id IS NULL;

        IF event_count <> 1 OR NOT FOUND
           OR prior.quest_id IS DISTINCT FROM p_quest_id
           OR prior.payload_version IS DISTINCT FROM 1
           OR jsonb_typeof(prior.payload) IS DISTINCT FROM 'object'
           OR jsonb_typeof(prior.payload -> 'archived') IS DISTINCT FROM 'boolean'
           OR (prior.payload ->> 'archived')::boolean IS DISTINCT FROM p_archived
           OR prior.payload ->> 'origin' IS DISTINCT FROM p_origin
           OR jsonb_typeof(prior.payload -> 'changed') IS DISTINCT FROM 'boolean'
           OR NOT (prior.payload ? 'archived_at') THEN
            RAISE EXCEPTION 'Conflicting Quest archive command reuse'
                USING ERRCODE = '23505';
        END IF;

        RETURN (
            p_command_id,
            p_quest_id,
            p_archived,
            (prior.payload ->> 'archived_at')::timestamptz,
            prior.id,
            (prior.payload ->> 'changed')::boolean,
            true
        );
    END IF;

    SELECT *
      INTO q
      FROM public.quests x
     WHERE x.id = p_quest_id
       AND x.user_id = actor
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quest subject not found' USING ERRCODE = 'P0002';
    END IF;

    IF q.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Permanently deleted Quest cannot be restored or archived'
            USING ERRCODE = '23514';
    END IF;

    IF q.recurrence_mode <> 'one_off'
       OR EXISTS (
            SELECT 1
              FROM public.quest_recurrence_rules r
             WHERE r.quest_id = q.id
               AND r.user_id = actor
       ) THEN
        RAISE EXCEPTION 'Quest Archive V1 supports one-off Quests only'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
      INTO occurrence_count
      FROM public.quest_occurrences o
     WHERE o.quest_id = q.id
       AND o.user_id = actor;

    IF occurrence_count <> 1 THEN
        RAISE EXCEPTION 'One-off Quest occurrence history is inconsistent'
            USING ERRCODE = '23514';
    END IF;

    v_now := clock_timestamp();
    v_changed := (q.archived_at IS NOT NULL) IS DISTINCT FROM p_archived;
    v_after := CASE
        WHEN p_archived THEN COALESCE(q.archived_at, v_now)
        ELSE NULL
    END;
    v_event_id := gen_random_uuid();

    v_payload := jsonb_build_object(
        'origin', p_origin,
        'archived', p_archived,
        'changed', v_changed,
        'prior_archived_at', q.archived_at,
        'archived_at', v_after
    );

    INSERT INTO public.quest_events (
        id, quest_id, user_id, occurrence_id, event_type, actor_kind,
        actor_user_id, occurred_at, command_id, execution_cycle,
        related_event_id, payload_version, payload
    ) VALUES (
        v_event_id, q.id, actor, NULL, 'archived', 'user',
        actor, v_now, p_command_id, NULL,
        NULL, 1, v_payload
    );

    IF v_changed THEN
        UPDATE public.quests x
           SET archived_at = v_after,
               updated_at = v_now
         WHERE x.id = q.id
           AND x.user_id = actor;
    END IF;

    RETURN (
        p_command_id,
        q.id,
        p_archived,
        v_after,
        v_event_id,
        v_changed,
        false
    );
END;
$function$;

CREATE FUNCTION public.delete_one_off_quest_v1(
    p_command_id uuid,
    p_quest_id uuid,
    p_origin text
) RETURNS public.quest_delete_receipt_v1
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    q public.quests;
    o public.quest_occurrences;
    prior public.quest_events;
    event_count bigint;
    occurrence_count bigint;
    v_now timestamptz;
    v_event_id uuid;
    v_prior_status text;
    v_occurrence_id uuid;
    v_payload jsonb;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();

    IF actor IS NULL OR p_command_id IS NULL OR p_quest_id IS NULL
       OR p_origin IS NULL THEN
        RAISE EXCEPTION 'Authentication and required delete inputs are mandatory'
            USING ERRCODE = '42501';
    END IF;

    PERFORM progression_internal.require_origin(p_origin);
    PERFORM progression_internal.lock_owner(actor);
    PERFORM system_internal.reject_completion_alias(p_command_id);

    SELECT count(*)
      INTO event_count
      FROM public.quest_events e
     WHERE e.user_id = actor
       AND e.command_id = p_command_id;

    IF event_count > 0 THEN
        SELECT *
          INTO prior
          FROM public.quest_events e
         WHERE e.user_id = actor
           AND e.command_id = p_command_id
           AND e.event_type = 'deleted'
           AND e.occurrence_id IS NULL;

        IF event_count <> 1 OR NOT FOUND
           OR prior.quest_id IS DISTINCT FROM p_quest_id
           OR prior.payload_version IS DISTINCT FROM 1
           OR jsonb_typeof(prior.payload) IS DISTINCT FROM 'object'
           OR prior.payload ->> 'origin' IS DISTINCT FROM p_origin
           OR jsonb_typeof(prior.payload -> 'occurrence_id') IS DISTINCT FROM 'string'
           OR jsonb_typeof(prior.payload -> 'prior_status') IS DISTINCT FROM 'string'
           OR jsonb_typeof(prior.payload -> 'deleted_at') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Conflicting Quest delete command reuse'
                USING ERRCODE = '23505';
        END IF;

        v_occurrence_id := (prior.payload ->> 'occurrence_id')::uuid;
        v_prior_status := prior.payload ->> 'prior_status';

        SELECT *
          INTO q
          FROM public.quests x
         WHERE x.id = p_quest_id
           AND x.user_id = actor;

        SELECT *
          INTO o
          FROM public.quest_occurrences x
         WHERE x.id = v_occurrence_id
           AND x.quest_id = p_quest_id
           AND x.user_id = actor;

        IF q.id IS NULL OR o.id IS NULL
           OR q.deleted_at IS NULL
           OR q.deleted_at IS DISTINCT FROM (prior.payload ->> 'deleted_at')::timestamptz
           OR q.archived_at IS NULL
           OR o.status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'Quest delete history is inconsistent'
                USING ERRCODE = '23514';
        END IF;

        RETURN (
            p_command_id,
            p_quest_id,
            v_occurrence_id,
            prior.id,
            q.deleted_at,
            v_prior_status,
            true
        );
    END IF;

    SELECT *
      INTO q
      FROM public.quests x
     WHERE x.id = p_quest_id
       AND x.user_id = actor
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quest subject not found' USING ERRCODE = 'P0002';
    END IF;

    IF q.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Quest is already permanently deleted'
            USING ERRCODE = '23514';
    END IF;

    IF q.recurrence_mode <> 'one_off'
       OR EXISTS (
            SELECT 1
              FROM public.quest_recurrence_rules r
             WHERE r.quest_id = q.id
               AND r.user_id = actor
       ) THEN
        RAISE EXCEPTION 'Quest Delete V1 supports one-off Quests only'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
      INTO occurrence_count
      FROM public.quest_occurrences x
     WHERE x.quest_id = q.id
       AND x.user_id = actor;

    IF occurrence_count <> 1 THEN
        RAISE EXCEPTION 'One-off Quest occurrence history is inconsistent'
            USING ERRCODE = '23514';
    END IF;

    SELECT *
      INTO o
      FROM public.quest_occurrences x
     WHERE x.quest_id = q.id
       AND x.user_id = actor
     FOR UPDATE;

    IF o.recurrence_rule_id IS NOT NULL
       OR o.recurrence_revision IS NOT NULL
       OR o.source_slot_date IS NOT NULL
       OR o.source_timezone IS NOT NULL THEN
        RAISE EXCEPTION 'Quest Delete V1 supports one-off Quests only'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.goal_quest_links l
         WHERE l.user_id = actor
           AND l.quest_id = q.id
           AND l.detached_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Detach Quest from Main Quest before permanent deletion'
            USING ERRCODE = '23514';
    END IF;

    IF o.status = 'completed' THEN
        RAISE EXCEPTION 'Reopen completed Quest before permanent deletion'
            USING ERRCODE = '23514';
    END IF;

    -- Every accepted completion must still have its immutable canonical credit.
    IF EXISTS (
        SELECT 1
          FROM public.quest_events e
          LEFT JOIN public.exp_ledger credit
            ON credit.user_id = actor
           AND credit.source_type = 'quest_completion'
           AND credit.source_id = e.id
           AND credit.reason = 'completion_reward'
         WHERE e.user_id = actor
           AND e.quest_id = q.id
           AND e.event_type = 'completed'
           AND credit.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Quest completion history is inconsistent'
            USING ERRCODE = '23514';
    END IF;

    -- Permanent deletion never manufactures a second reversal. All historical
    -- completion credits must already have been compensated through Reopen.
    IF EXISTS (
        SELECT 1
          FROM public.quest_events e
          JOIN public.exp_ledger credit
            ON credit.user_id = actor
           AND credit.source_type = 'quest_completion'
           AND credit.source_id = e.id
           AND credit.reason = 'completion_reward'
         WHERE e.user_id = actor
           AND e.quest_id = q.id
           AND e.event_type = 'completed'
           AND NOT EXISTS (
                SELECT 1
                  FROM public.exp_ledger reversal
                 WHERE reversal.user_id = actor
                   AND reversal.reverses_entry_id = credit.id
                   AND reversal.source_type = 'quest_completion_reversal'
                   AND reversal.reason = 'completion_reward_reversal'
           )
    ) THEN
        RAISE EXCEPTION 'Quest EXP must be fully reversed before permanent deletion'
            USING ERRCODE = '23514';
    END IF;

    v_now := clock_timestamp();
    v_event_id := gen_random_uuid();
    v_prior_status := o.status;

    -- Freeze the live projection first while the Quest is not yet tombstoned;
    -- the transaction rolls back as a unit if any later invariant fails.
    IF o.status <> 'cancelled' THEN
        UPDATE public.quest_occurrences x
           SET status = 'cancelled',
               recorded_completed_at = NULL,
               reported_completed_at = NULL,
               updated_at = v_now
         WHERE x.id = o.id
           AND x.user_id = actor;
    END IF;

    v_payload := jsonb_build_object(
        'origin', p_origin,
        'occurrence_id', o.id,
        'prior_status', v_prior_status,
        'new_status', 'cancelled',
        'execution_cycle', o.execution_cycle,
        'prior_archived_at', q.archived_at,
        'deleted_at', v_now
    );

    -- Insert before deleted_at is set. The state guard permits this event even
    -- when the Quest was already archived.
    INSERT INTO public.quest_events (
        id, quest_id, user_id, occurrence_id, event_type, actor_kind,
        actor_user_id, occurred_at, command_id, execution_cycle,
        related_event_id, payload_version, payload
    ) VALUES (
        v_event_id, q.id, actor, NULL, 'deleted', 'user',
        actor, v_now, p_command_id, NULL,
        NULL, 1, v_payload
    );

    UPDATE public.quests x
       SET archived_at = COALESCE(x.archived_at, v_now),
           deleted_at = v_now,
           updated_at = v_now
     WHERE x.id = q.id
       AND x.user_id = actor;

    RETURN (
        p_command_id,
        q.id,
        o.id,
        v_event_id,
        v_now,
        v_prior_status,
        false
    );
END;
$function$;

-- New public commands use the existing frozen Quest executor and directly enforce
-- ADR-015 owner authorization; no historical function body is rewritten.
GRANT quest_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO quest_command_owner;

ALTER FUNCTION public.set_one_off_quest_archived_v1(uuid, uuid, boolean, text)
    OWNER TO quest_command_owner;
ALTER FUNCTION public.delete_one_off_quest_v1(uuid, uuid, text)
    OWNER TO quest_command_owner;

REVOKE CREATE ON SCHEMA public FROM quest_command_owner;

REVOKE ALL ON FUNCTION
    public.set_one_off_quest_archived_v1(uuid, uuid, boolean, text),
    public.delete_one_off_quest_v1(uuid, uuid, text)
FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
     progression_command_owner, level_policy_assignment_owner, goal_command_owner,
     schedule_command_owner;

GRANT EXECUTE ON FUNCTION
    public.set_one_off_quest_archived_v1(uuid, uuid, boolean, text),
    public.delete_one_off_quest_v1(uuid, uuid, text)
TO authenticated;

COMMENT ON FUNCTION public.set_one_off_quest_archived_v1(uuid, uuid, boolean, text) IS
    'Owner-only one-off Quest archive/restore command. Retains occurrence, Quest events and EXP; archive freezes fresh Quest-event effects while historical accepted-command replay remains valid.';

COMMENT ON FUNCTION public.delete_one_off_quest_v1(uuid, uuid, text) IS
    'Owner-only non-restorable one-off Quest tombstone. Requires no current Main Quest link, no live completion, and fully reversed historical Quest EXP. Retains immutable Quest/EXP/alias history; performs no physical DELETE.';

REVOKE quest_command_owner FROM CURRENT_USER;

NOTIFY pgrst, 'reload schema';
COMMIT;
