-- SYSTEM V1 day Quest occurrence read layer.
-- Authority: docs/02-architecture/ui-read-query-v1-draft.md section 3.3
-- (Product Owner decisions 1-3), quest-database-schema.md,
-- quest-command-api-v1.md, player-exp-database-schema.md, level-reward-database-schema.md
-- and level-reward-domain-model.md.
-- Additive only: one STABLE SECURITY INVOKER read routine. No new role, table,
-- schema, policy or SECURITY DEFINER; no previously applied migration is modified.
-- Identity comes exclusively from system_internal.request_user_id(); the owner is
-- never a caller-supplied user_id. The routine runs with the caller's RLS-bound
-- privileges, so the existing owner-select policies remain the final barrier.
-- p_day NULL means today in the authenticated profile's timezone; an explicit
-- date is used verbatim as the profile-local day. Day membership is the approved
-- inclusive disjunction: materialized slot date OR scheduled_at OR deadline_at
-- within the profile-local day window. Local midnights of D and D+1 are computed
-- separately as profile-local wall times and converted to absolute instants
-- (DST-safe); a fixed 24-hour interval is never added. No intermediate day of a
-- long-running Quest is synthesized. Completable is an advisory projection of the
-- frozen completion-command conditions plus published-policy availability; the
-- atomic completion command is unchanged and re-validates everything at write time.

BEGIN;

CREATE FUNCTION public.list_day_quest_occurrences(p_day date DEFAULT NULL)
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
        AND (
            (o.source_slot_date IS NOT NULL AND o.source_slot_date = selected_day)
            OR (o.scheduled_at >= day_start AND o.scheduled_at < day_end)
            OR (o.deadline_at >= day_start AND o.deadline_at < day_end)
        )
    ORDER BY COALESCE(o.scheduled_at, o.deadline_at) NULLS LAST, o.id;
END;
$function$;

-- Read routines follow the existing public-read grant convention: explicit
-- revocation of default PUBLIC EXECUTE and of every sibling/browser role except
-- the authenticated caller (same shape as complete_quest_occurrence's grants).
REVOKE ALL ON FUNCTION public.list_day_quest_occurrences(date)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.list_day_quest_occurrences(date)
    TO authenticated;

COMMENT ON FUNCTION public.list_day_quest_occurrences(date) IS
    'Owner-scoped profile-local-day Quest occurrence projection for the UI read layer. Identity: system_internal.request_user_id() only; SQLSTATE 42501 when unauthenticated, PZ001 when the Profile timezone is missing or invalid (no default is ever guessed). Day membership: materialized source_slot_date = D OR scheduled_at/deadline_at within the D..D+1 profile-local window, DST-safe separate midnights, no synthesized intermediate days. progression_ready mirrors get_progression_status().available; completable is an advisory projection of the frozen completion conditions and the atomic completion command remains authoritative. already_completed_cycle reflects only a completed event at the occurrence''s current execution_cycle.';

COMMIT;

