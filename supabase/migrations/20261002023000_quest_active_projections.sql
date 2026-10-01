-- Quest Archive/Delete V1: active reads must exclude retired definitions.
-- Proven by fresh authenticated day/Calendar RPCs after a committed archive.
-- Preserve signatures, owner entry guards, SECURITY INVOKER, grants and RLS.
-- Apply after private-owner activation; historical migrations are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.list_day_quest_occurrences(p_day date DEFAULT NULL)
RETURNS TABLE (
    occurrence_id uuid,
    quest_id uuid,
    quest_title text,
    status text,
    scheduled_at timestamptz,
    deadline_at timestamptz,
    source_slot_date date,
    execution_cycle integer,
    reward_exp_snapshot integer,
    progression_ready boolean,
    completable boolean,
    already_completed_cycle integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    profile_timezone text;
    selected_day date;
    day_start timestamptz;
    day_end timestamptz;
    progression_available boolean;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '42501';
    END IF;

    -- The authoritative timezone is the Profile-owned profile.timezone,
    -- revalidated at read time; no default is ever guessed (frozen RR-03).
    SELECT p.timezone INTO profile_timezone
        FROM public.profiles AS p
        WHERE p.user_id = actor;
    IF profile_timezone IS NULL THEN
        RAISE EXCEPTION 'Profile timezone is not set; complete Profile timezone setup before listing Quest days'
            USING ERRCODE = 'PZ001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
        WHERE zone.name = profile_timezone
            AND zone.name NOT LIKE 'posix/%'
            AND zone.name NOT LIKE 'right/%'
            AND zone.name <> 'localtime'
    ) THEN
        RAISE EXCEPTION 'Profile timezone is not a supported IANA zone; update Profile timezone settings'
            USING ERRCODE = 'PZ001';
    END IF;

    IF p_day IS NULL THEN
        selected_day := (pg_catalog.now() AT TIME ZONE profile_timezone)::date;
    ELSE
        selected_day := p_day;
    END IF;

    -- Separate profile-local midnights for D and D+1, each converted to an
    -- absolute instant so DST offsets are honored; never a fixed 24-hour step.
    day_start := selected_day::timestamp AT TIME ZONE profile_timezone;
    day_end := (selected_day + 1)::timestamp AT TIME ZONE profile_timezone;

    -- Published-policy availability, identical to get_progression_status().available,
    -- resolved once per invocation (not once per occurrence).
    SELECT s.available INTO progression_available
        FROM public.get_progression_status() AS s;

    RETURN QUERY
    SELECT
        o.id,
        o.quest_id,
        q.title,
        o.status,
        o.scheduled_at,
        o.deadline_at,
        o.source_slot_date,
        o.execution_cycle,
        o.reward_exp_snapshot,
        progression_available,
        (progression_available
            AND o.status IN ('draft', 'scheduled', 'active')
            AND o.reward_exp_snapshot IS NOT NULL),
        (SELECT max(e.execution_cycle)
            FROM public.quest_events AS e
            WHERE e.occurrence_id = o.id
                AND e.event_type = 'completed'
                AND e.execution_cycle = o.execution_cycle)
    FROM public.quest_occurrences AS o
    JOIN public.quests AS q
        ON q.id = o.quest_id AND q.user_id = actor
    WHERE o.user_id = actor
        AND q.archived_at IS NULL
        AND q.deleted_at IS NULL
        AND (
            (o.source_slot_date IS NOT NULL AND o.source_slot_date = selected_day)
            OR (o.scheduled_at >= day_start AND o.scheduled_at < day_end)
            OR (o.deadline_at >= day_start AND o.deadline_at < day_end)
        )
    ORDER BY COALESCE(o.scheduled_at, o.deadline_at) NULLS LAST, o.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_calendar_events(p_from date, p_to date)
RETURNS SETOF public.calendar_entry
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    profile_timezone text;
    range_start timestamptz;
    range_end timestamptz;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from > p_to THEN
        RAISE EXCEPTION 'Calendar range requires a from day and a to day in order'
            USING ERRCODE = '22023';
    END IF;
    -- A bounded window keeps the day slice the rendering unit (requirements section 8).
    IF p_to - p_from > 91 THEN
        RAISE EXCEPTION 'Calendar range may cover at most 92 profile-local days'
            USING ERRCODE = '22023';
    END IF;

    -- The authoritative timezone is the Profile-owned profile.timezone, revalidated at
    -- read time; no default is ever guessed (frozen RR-03, BR-04).
    SELECT p.timezone INTO profile_timezone
        FROM public.profiles AS p
        WHERE p.user_id = actor;
    IF profile_timezone IS NULL THEN
        RAISE EXCEPTION 'Profile timezone is not set; complete Profile timezone setup before reading the Calendar'
            USING ERRCODE = 'PZ001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
        WHERE zone.name = profile_timezone
            AND zone.name NOT LIKE 'posix/%'
            AND zone.name NOT LIKE 'right/%'
            AND zone.name <> 'localtime'
    ) THEN
        RAISE EXCEPTION 'Profile timezone is not a supported IANA zone; update Profile timezone settings'
            USING ERRCODE = 'PZ001';
    END IF;

    -- Separate profile-local midnights for the first day and the day after the last,
    -- each converted to an absolute instant so a DST day is 23 or 25 real hours; never a
    -- fixed 24-hour step (the same rule public.list_day_quest_occurrences applies).
    range_start := p_from::timestamp AT TIME ZONE profile_timezone;
    range_end := (p_to + 1)::timestamp AT TIME ZONE profile_timezone;

    RETURN QUERY
    SELECT combined.* FROM (
        SELECT
            'quest_occurrence'::text AS source,
            o.id AS entry_id,
            o.quest_id AS quest_id,
            q.title AS title,
            o.status AS status,
            o.scheduled_at AS start_at,
            o.deadline_at AS end_at,
            false AS all_day,
            NULL::date AS start_date,
            NULL::date AS end_date,
            NULL::text AS category,
            NULL::text AS notes,
            o.source_slot_date AS source_slot_date,
            o.execution_cycle AS execution_cycle,
            o.reward_exp_snapshot AS reward_exp_snapshot
        FROM public.quest_occurrences AS o
        JOIN public.quests AS q
            ON q.id = o.quest_id AND q.user_id = actor
        WHERE o.user_id = actor
        AND q.archived_at IS NULL
        AND q.deleted_at IS NULL
            -- CS-05/CS-06: use scheduled_at or the existing untimed recurring slot date.
            -- Deadline-only one-offs stay out; no scheduled instant is invented.
            AND ((o.scheduled_at >= range_start AND o.scheduled_at < range_end)
                OR (o.scheduled_at IS NULL AND o.source_slot_date BETWEEN p_from AND p_to))
        UNION ALL
        SELECT
            'schedule_event'::text AS source,
            e.id AS entry_id,
            NULL::uuid AS quest_id,
            e.title AS title,
            NULL::text AS status,
            CASE WHEN e.all_day THEN NULL ELSE e.start_at END AS start_at,
            CASE WHEN e.all_day THEN NULL ELSE e.end_at END AS end_at,
            e.all_day AS all_day,
            e.start_date AS start_date,
            e.end_date AS end_date,
            e.category AS category,
            e.notes AS notes,
            NULL::date AS source_slot_date,
            NULL::integer AS execution_cycle,
            NULL::integer AS reward_exp_snapshot
        FROM public.schedule_events AS e
        WHERE e.user_id = actor
            -- Half-open interval overlap: an event that begins before the window and is
            -- still running inside it appears (CS-09 midnight-spanning case), while an
            -- exclusive all-day end at the next local midnight does not leak into it.
            AND e.removed_at IS NULL
            AND ((e.all_day AND e.start_date <= p_to AND e.end_date > p_from)
                OR (NOT e.all_day AND e.start_at < range_end
                    AND (e.end_at > range_start OR (e.end_at IS NULL AND e.start_at >= range_start))))
    ) AS combined
    -- CS-04: order by calendar day, then instant (date-only entries first), source
    -- and identity. Repeated reads over the same state have identical ordering.
    ORDER BY coalesce(combined.start_date, combined.source_slot_date,
        (combined.start_at AT TIME ZONE profile_timezone)::date),
        combined.start_at NULLS FIRST, combined.source, combined.entry_id;

END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
