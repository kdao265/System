-- SYSTEM V1 Calendar / Schedule: one owner-owned non-Quest time block table plus
-- one unified read projection over the two existing owning tables.
-- Authority: docs/01-requirements/calendar-schedule.md CS-01..CS-12, CS-AC-01..CS-AC-07
-- (Product Owner decisions OQ-1 all-day + timed, OQ-2 no recurring Schedule Events,
-- OQ-4 last-write-wins, OQ-6 dedicated /calendar protected route),
-- docs/02-architecture/decisions.md ADR-019, ADR-015 (single-owner enforcement),
-- ADR-018 (Calendar reuses occurrences; it never generates slots).
--
-- Additive only. One new role, one new table, two new composite types and four new
-- routines. No pre-existing table, column, constraint, index, policy, role or grant is
-- replaced, and no previously applied migration is modified. The new command role
-- receives the column-scoped Profile read policy and helper grants below. quest_occurrences
-- is read, never written: the Calendar stores no copy of Quest data (BR-06) and
-- materialize_quest_day is NOT called here (CS-07, CS-AC-07).
--
-- ADR-015 shape applied to a new table. The deferred activation migration
-- (20260928100000) owns its own frozen table/RPC list, so this migration activates the
-- same three defenses itself, byte-comparable with what that migration installs:
--   1. RLS plus a RESTRICTIVE policy named system_single_owner over the verified
--      singleton owner AND the row owner, for every role that can touch the table.
--   2. system_private.require_owner() as the first statement of every routine.
--   3. Identity only from system_internal.request_user_id(); no caller-supplied owner.
-- Table privileges follow the frozen quest-engine shape instead of a new one:
-- SELECT for authenticated (read path only), INSERT/UPDATE/DELETE for the dedicated
-- NOLOGIN schedule_command_owner, which also owns the three write routines as their
-- SECURITY DEFINER identity. anon and service_role receive nothing. The only additions to
-- pre-existing objects are the two schema-usage/identity-function grants that every command
-- role needs in order to run an ADR-015 guard (below, next to the new role).

BEGIN;

-- Deliberately NOT a client member: the RLS-bound identity the three write routines
-- execute under (same template as quest_command_owner).
CREATE ROLE schedule_command_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

-- The ADR-015 guard and the identity helper live in schemas closed to PUBLIC, so the new
-- command role is given exactly the access each sibling command role was given when it was
-- created (20260919063117 for quest_command_owner, 20260920050000 for the two Level roles):
-- schema USAGE plus EXECUTE on the two functions these routines actually call. No existing
-- ACL entry is changed and nothing else in system_private or system_internal is reachable.
-- system_private.is_owner() is owned by system_owner_reader, so this follows the install
-- migration's own idiom (20260928090000 lines 33-57): hold that membership only for the
-- statement that needs it, then give it back inside the same transaction.
GRANT USAGE ON SCHEMA system_internal TO schedule_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.request_user_id() TO schedule_command_owner;
GRANT USAGE ON SCHEMA system_private TO schedule_command_owner;
GRANT EXECUTE ON FUNCTION system_private.require_owner() TO schedule_command_owner;
GRANT system_owner_reader TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION system_private.is_owner() TO schedule_command_owner;
REVOKE system_owner_reader FROM CURRENT_USER;

CREATE TABLE public.schedule_events (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    title text NOT NULL,
    start_at timestamptz NOT NULL,
    end_at timestamptz,
    all_day boolean NOT NULL DEFAULT false,
    start_date date,
    end_date date, -- exclusive; authoritative for all-day entries
    removed_at timestamptz, -- retains spent identities against late create retries
    category text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- id is supplied by the caller and doubles as the CS-08 command identity, so no
    -- second receipt table is needed for retry safety (see create_schedule_event).
    CONSTRAINT ck_schedule_title CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
    -- BR-03: an end only ever follows its start.
    CONSTRAINT ck_schedule_end CHECK (end_at IS NULL OR end_at > start_at),
    CONSTRAINT ck_schedule_dates CHECK (
        (all_day AND start_date IS NOT NULL AND end_date IS NOT NULL
            AND end_date > start_date AND end_date - start_date <= 366)
        OR (NOT all_day AND start_date IS NULL AND end_date IS NULL)),
    CONSTRAINT ck_schedule_finite CHECK (isfinite(start_at) AND (end_at IS NULL OR isfinite(end_at))),
    -- BR-05/OQ-3 interim: a category is a short owner-chosen label, never a rule.
    CONSTRAINT ck_schedule_category CHECK (
        category IS NULL OR (category = btrim(category) AND category <> '' AND char_length(category) <= 40)),
    CONSTRAINT ck_schedule_notes CHECK (notes IS NULL OR char_length(notes) <= 4000),
    -- A bounded span keeps the "long event" edge case renderable: the day slice stays
    -- the rendering unit and no single row can cover an unbounded number of days.
    CONSTRAINT ck_schedule_span CHECK (all_day OR end_at IS NULL OR end_at - start_at <= interval '366 days')
);

CREATE INDEX ix_schedule_events_owner_start ON public.schedule_events (user_id, start_at, id);
CREATE INDEX ix_schedule_events_owner_end ON public.schedule_events (user_id, end_at, id)
    WHERE end_at IS NOT NULL;

-- RLS is enabled before any grant, and Supabase default privileges are revoked
-- explicitly including TRUNCATE/REFERENCES/TRIGGER.
ALTER TABLE public.schedule_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schedule_events
    FROM PUBLIC, anon, authenticated, service_role, schedule_command_owner;

GRANT SELECT ON TABLE public.schedule_events TO authenticated, schedule_command_owner;
GRANT INSERT, UPDATE, DELETE ON TABLE public.schedule_events TO schedule_command_owner;

CREATE POLICY schedule_events_owner_select ON public.schedule_events
    FOR SELECT TO authenticated, schedule_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY schedule_events_command_insert ON public.schedule_events
    FOR INSERT TO schedule_command_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY schedule_events_command_update ON public.schedule_events
    FOR UPDATE TO schedule_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY schedule_events_command_delete ON public.schedule_events
    FOR DELETE TO schedule_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));

-- The ADR-015 stage-two guard, named identically so the single-owner invariant stays
-- auditable under one name. It can only narrow the permissive policies above.
CREATE POLICY system_single_owner ON public.schedule_events AS RESTRICTIVE FOR ALL
    TO authenticated, schedule_command_owner
    USING ((SELECT system_private.is_owner())
        AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner())
        AND user_id = (SELECT system_internal.request_user_id()));



-- One ordered Calendar entry from either owning table. CS-06: an entry never carries a
-- start, end, status or reward the source row does not already hold, so every Quest
-- column is null for a Schedule Event; category/notes are null for a Quest entry.
-- All-day entries carry authoritative date bounds and no projected clock values.
CREATE TYPE public.calendar_entry AS (
    source text,
    entry_id uuid,
    quest_id uuid,
    title text,
    status text,
    start_at timestamptz,
    end_at timestamptz,
    all_day boolean,
    start_date date,
    end_date date,
    category text,
    notes text,
    source_slot_date date,
    execution_cycle integer,
    reward_exp_snapshot integer
);

-- The full stored state after one accepted write, plus the CS-08 replay marker.
CREATE TYPE public.schedule_event_receipt AS (
    event_id uuid,
    user_id uuid,
    title text,
    start_at timestamptz,
    end_at timestamptz,
    all_day boolean,
    start_date date,
    end_date date,
    category text,
    notes text,
    created_at timestamptz,
    updated_at timestamptz,
    replay boolean
);

-- The single Calendar read. SECURITY INVOKER and STABLE exactly like
-- list_recurring_quests/list_day_quest_occurrences, so caller RLS stays the final
-- barrier on both branches and nothing is elevated. It opens with
-- system_private.require_owner() like every other public routine, so a non-owner token is
-- refused rather than answered with an empty set (CS-12). It writes nothing at all: no
-- materialization, no status change, no EXP (CS-07, CS-AC-04, CS-AC-07).
CREATE FUNCTION public.get_calendar_events(p_from date, p_to date)
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


-- Creates one Schedule Event. SECURITY DEFINER under the RLS-bound schedule_command_owner
-- so the caller needs no table write privilege; ADR-015 authorization is the first
-- statement and identity is never an argument. p_event_id is caller-generated and is
-- simultaneously the primary key and the CS-08 command identity, which is what makes a
-- retry idempotent without adding a second receipt table: the second and every later
-- submission of the same identity return the stored row with replay = true and write
-- nothing. An identity already spent by a removed row is refused rather than
-- resurrected, and one held by another owner is refused without saying whose it is.
CREATE FUNCTION public.create_schedule_event(
    p_event_id uuid,
    p_title text,
    p_start_at timestamptz,
    p_end_at timestamptz,
    p_all_day boolean,
    p_category text,
    p_notes text
) RETURNS public.schedule_event_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    profile_timezone text;
    receipt public.schedule_event_receipt;
    v_all_day boolean;
    v_start timestamptz;
    v_end timestamptz;
    v_start_date date;
    v_end_date date;
    inserted integer;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL OR p_event_id IS NULL THEN
        RAISE EXCEPTION 'Authentication and a Schedule Event identity are mandatory'
            USING ERRCODE = '42501';
    END IF;
    IF p_title IS NULL OR btrim(p_title) = '' OR char_length(p_title) > 120 THEN
        RAISE EXCEPTION 'title is required, must be nonblank and at most 120 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_start_at IS NULL OR NOT isfinite(p_start_at) OR (p_end_at IS NOT NULL AND NOT isfinite(p_end_at)) THEN
        RAISE EXCEPTION 'start_at is required' USING ERRCODE = '22023';
    END IF;
    IF NOT coalesce(p_all_day, false) AND p_end_at IS NOT NULL AND p_end_at <= p_start_at THEN
        RAISE EXCEPTION 'end_at must be after start_at' USING ERRCODE = '22023';
    END IF;
    IF p_category IS NOT NULL AND (btrim(p_category) = '' OR p_category <> btrim(p_category)
        OR char_length(p_category) > 40) THEN
        RAISE EXCEPTION 'category must be a trimmed nonblank label of at most 40 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_notes IS NOT NULL AND char_length(p_notes) > 4000 THEN
        RAISE EXCEPTION 'notes must be at most 4000 characters' USING ERRCODE = '22023';
    END IF;

    v_all_day := coalesce(p_all_day, false);
    v_start := p_start_at;
    v_end := p_end_at;
    IF v_all_day THEN
        -- BR-03: an all-day block carries day granularity and no wall-clock start. The
        -- submitted instants transport Profile-local dates. Authoritative date columns
        -- survive timezone changes. Compatibility instant columns are normalized to
        -- midnight but never used for all-day membership or clock labels.
        SELECT p.timezone INTO profile_timezone
            FROM public.profiles AS p
            WHERE p.user_id = actor;
        IF profile_timezone IS NULL OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
            WHERE zone.name = profile_timezone
                AND zone.name NOT LIKE 'posix/%'
                AND zone.name NOT LIKE 'right/%'
                AND zone.name <> 'localtime'
        ) THEN
            RAISE EXCEPTION 'Profile timezone is required to store an all-day Schedule Event'
                USING ERRCODE = 'PZ001';
        END IF;
        v_start_date := (p_start_at AT TIME ZONE profile_timezone)::date;
        v_end_date := coalesce((p_end_at AT TIME ZONE profile_timezone)::date, v_start_date) + 1;
        v_start := date_trunc('day', p_start_at AT TIME ZONE profile_timezone)
            AT TIME ZONE profile_timezone;
        v_end := v_end_date::timestamp AT TIME ZONE profile_timezone;
        IF v_end IS NOT NULL AND v_end <= v_start THEN
            RAISE EXCEPTION 'end_at must be after start_at' USING ERRCODE = '22023';
        END IF;
    END IF;
    IF (v_all_day AND v_end_date - v_start_date > 366) OR
        (NOT v_all_day AND v_end IS NOT NULL AND v_end - v_start > interval '366 days') THEN
        RAISE EXCEPTION 'a Schedule Event may span at most 366 days' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.schedule_events (
        id, user_id, title, start_at, end_at, all_day, start_date, end_date, category, notes
    ) VALUES (
        p_event_id, actor, btrim(p_title), v_start, v_end, v_all_day, v_start_date, v_end_date, p_category, p_notes
    )
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;

    -- inserted = 0 means this exact identity was accepted before: replay the receipt.
    SELECT e.id, e.user_id, e.title, e.start_at, e.end_at, e.all_day, e.start_date, e.end_date, e.category,
        e.notes, e.created_at, e.updated_at, inserted = 0
        INTO receipt.event_id, receipt.user_id, receipt.title, receipt.start_at,
            receipt.end_at, receipt.all_day, receipt.start_date, receipt.end_date, receipt.category, receipt.notes,
            receipt.created_at, receipt.updated_at, receipt.replay
        FROM public.schedule_events AS e
        WHERE e.id = p_event_id AND e.removed_at IS NULL;
    IF NOT FOUND THEN
        IF inserted = 0 THEN
            RAISE EXCEPTION 'That Schedule Event identity is already in use'
                USING ERRCODE = '23505';
        END IF;
        RAISE EXCEPTION 'Schedule Event write could not be read back'
            USING ERRCODE = '55000';
    END IF;
    RETURN receipt;
END;
$function$;

-- Replaces the whole stored state of one Schedule Event (OQ-4: last write wins, no
-- expected-version guard). A null end_at, category or notes clears that field, so the
-- caller always sends the complete desired state and there is no unset-versus-clear
-- ambiguity. Re-submitting state that already holds writes nothing new and answers with
-- replay = true, which is what makes a retried edit return the same outcome (CS-08).
-- Nothing outside public.schedule_events is touched (CS-02, CS-AC-04).
CREATE FUNCTION public.update_schedule_event(
    p_event_id uuid,
    p_title text,
    p_start_at timestamptz,
    p_end_at timestamptz,
    p_all_day boolean,
    p_category text,
    p_notes text
) RETURNS public.schedule_event_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    profile_timezone text;
    receipt public.schedule_event_receipt;
    v_all_day boolean;
    v_title text;
    v_start timestamptz;
    v_end timestamptz;
    v_start_date date;
    v_end_date date;
    updated integer;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL OR p_event_id IS NULL THEN
        RAISE EXCEPTION 'Authentication and a Schedule Event identity are mandatory'
            USING ERRCODE = '42501';
    END IF;
    IF p_title IS NULL OR btrim(p_title) = '' OR char_length(p_title) > 120 THEN
        RAISE EXCEPTION 'title is required, must be nonblank and at most 120 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_start_at IS NULL OR NOT isfinite(p_start_at) OR (p_end_at IS NOT NULL AND NOT isfinite(p_end_at)) THEN
        RAISE EXCEPTION 'start_at is required' USING ERRCODE = '22023';
    END IF;
    IF NOT coalesce(p_all_day, false) AND p_end_at IS NOT NULL AND p_end_at <= p_start_at THEN
        RAISE EXCEPTION 'end_at must be after start_at' USING ERRCODE = '22023';
    END IF;
    IF p_category IS NOT NULL AND (btrim(p_category) = '' OR p_category <> btrim(p_category)
        OR char_length(p_category) > 40) THEN
        RAISE EXCEPTION 'category must be a trimmed nonblank label of at most 40 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_notes IS NOT NULL AND char_length(p_notes) > 4000 THEN
        RAISE EXCEPTION 'notes must be at most 4000 characters' USING ERRCODE = '22023';
    END IF;

    v_all_day := coalesce(p_all_day, false);
    v_title := btrim(p_title);
    v_start := p_start_at;
    v_end := p_end_at;
    IF v_all_day THEN
        -- Same BR-03 normalization and BR-04 rule as create_schedule_event, applied to
        -- the instants this edit submits; an event stored under an older timezone
        -- alignment is realigned by this write rather than rejected by a constraint.
        SELECT p.timezone INTO profile_timezone
            FROM public.profiles AS p
            WHERE p.user_id = actor;
        IF profile_timezone IS NULL OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
            WHERE zone.name = profile_timezone
                AND zone.name NOT LIKE 'posix/%'
                AND zone.name NOT LIKE 'right/%'
                AND zone.name <> 'localtime'
        ) THEN
            RAISE EXCEPTION 'Profile timezone is required to store an all-day Schedule Event'
                USING ERRCODE = 'PZ001';
        END IF;
        v_start_date := (p_start_at AT TIME ZONE profile_timezone)::date;
        v_end_date := coalesce((p_end_at AT TIME ZONE profile_timezone)::date, v_start_date) + 1;
        v_start := date_trunc('day', p_start_at AT TIME ZONE profile_timezone)
            AT TIME ZONE profile_timezone;
        v_end := v_end_date::timestamp AT TIME ZONE profile_timezone;
        IF v_end IS NOT NULL AND v_end <= v_start THEN
            RAISE EXCEPTION 'end_at must be after start_at' USING ERRCODE = '22023';
        END IF;
    END IF;
    IF (v_all_day AND v_end_date - v_start_date > 366) OR
        (NOT v_all_day AND v_end IS NOT NULL AND v_end - v_start > interval '366 days') THEN
        RAISE EXCEPTION 'a Schedule Event may span at most 366 days' USING ERRCODE = '22023';
    END IF;

    UPDATE public.schedule_events AS e
        SET title = v_title, start_at = v_start, end_at = v_end, all_day = v_all_day,
            start_date = v_start_date, end_date = v_end_date,
            category = p_category, notes = p_notes, updated_at = pg_catalog.clock_timestamp()
        WHERE e.id = p_event_id AND e.removed_at IS NULL
            AND ROW (e.title, e.start_at, e.end_at, e.all_day, e.start_date, e.end_date, e.category, e.notes)
                IS DISTINCT FROM ROW (v_title, v_start, v_end, v_all_day, v_start_date, v_end_date, p_category, p_notes);
    GET DIAGNOSTICS updated = ROW_COUNT;

    SELECT e.id, e.user_id, e.title, e.start_at, e.end_at, e.all_day, e.start_date, e.end_date, e.category,
        e.notes, e.created_at, e.updated_at, updated = 0
        INTO receipt.event_id, receipt.user_id, receipt.title, receipt.start_at,
            receipt.end_at, receipt.all_day, receipt.start_date, receipt.end_date, receipt.category, receipt.notes,
            receipt.created_at, receipt.updated_at, receipt.replay
        FROM public.schedule_events AS e
        WHERE e.id = p_event_id AND e.removed_at IS NULL;
    IF NOT FOUND THEN
        -- RLS has already hidden any row belonging to another owner, so this cannot say
        -- whether the identity exists elsewhere.
        RAISE EXCEPTION 'No Schedule Event with that identity belongs to this account'
            USING ERRCODE = 'PZ002';
    END IF;
    RETURN receipt;
END;
$function$;

-- Removes an Event from the projection while retaining its spent identity. It has
-- no state machine (requirements section 7) and no EXP, reward or evidence relationship
-- to reverse (BR-02). The RLS UPDATE policy limits this to the owner's own row, and a
-- repeat call finds nothing left to remove and answers false, so the effect stays at most
-- one while the answer stays truthful (CS-08).
CREATE FUNCTION public.delete_schedule_event(p_event_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    removed integer;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL OR p_event_id IS NULL THEN
        RAISE EXCEPTION 'Authentication and a Schedule Event identity are mandatory'
            USING ERRCODE = '42501';
    END IF;
    UPDATE public.schedule_events AS e SET removed_at = pg_catalog.clock_timestamp()
        WHERE e.id = p_event_id AND e.removed_at IS NULL;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed > 0;
END;
$function$;

-- The read routine runs as the caller and therefore needs no new table privilege:
-- authenticated already holds owner-scoped SELECT on quests/quest_occurrences (migration
-- one) and on schedule_events (above). It stays owned by the migration role, matching the
-- frozen grant shape of list_day_quest_occurrences and list_recurring_quests.
REVOKE ALL ON FUNCTION public.get_calendar_events(date, date)
    FROM PUBLIC, anon, authenticated, service_role, schedule_command_owner,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.get_calendar_events(date, date) TO authenticated;

-- Command routines are owned by the RLS-bound command role, never by the migration role.
-- The temporary CREATE grant exists only so ownership transfer is permitted inside this
-- transaction, mirroring 20260923120000_create_one_off_quest.sql and
-- 20260928181000_create_recurring_quests.sql.
GRANT schedule_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO schedule_command_owner;

ALTER FUNCTION public.create_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text)
    OWNER TO schedule_command_owner;
ALTER FUNCTION public.update_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text)
    OWNER TO schedule_command_owner;
ALTER FUNCTION public.delete_schedule_event(uuid)
    OWNER TO schedule_command_owner;

REVOKE CREATE ON SCHEMA public FROM schedule_command_owner;

-- The caller-facing surface is exactly these four routines for the authenticated owner.
-- Every sibling role, PUBLIC and the command roles themselves lose EXECUTE.
REVOKE ALL ON FUNCTION public.create_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text)
    FROM PUBLIC, anon, authenticated, service_role, schedule_command_owner,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.create_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text)
    TO authenticated;

REVOKE ALL ON FUNCTION public.update_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text)
    FROM PUBLIC, anon, authenticated, service_role, schedule_command_owner,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.update_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text)
    TO authenticated;

REVOKE ALL ON FUNCTION public.delete_schedule_event(uuid)
    FROM PUBLIC, anon, authenticated, service_role, schedule_command_owner,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.delete_schedule_event(uuid) TO authenticated;

-- The Profile timezone is the only pre-existing column any Calendar routine reads, and
-- it is read under exactly the column grant and identity binding the Profile migration
-- already established for quest_command_owner. No other Profile column and no Quest write
-- path is reachable from schedule_command_owner.
GRANT SELECT (user_id, timezone) ON TABLE public.profiles TO schedule_command_owner;
CREATE POLICY profiles_schedule_owner_select ON public.profiles
    FOR SELECT TO schedule_command_owner
    USING ((SELECT system_private.is_owner())
        AND user_id = (SELECT system_internal.request_user_id()));

COMMENT ON TABLE public.schedule_events IS
    'CS-01/BR-01: the owner''s own non-Quest time blocks and the only table the Calendar writes. Carries no EXP, reward, level, penalty, evidence or completion status (BR-02, section 7), no recurrence and no caller-supplied owner. Timed instants are absolute and grouped in the Profile timezone. All-day membership uses authoritative date bounds (BR-04). Quest work is never copied here (BR-06): it is read live from quest_occurrences.';
COMMENT ON COLUMN public.schedule_events.id IS
    'Caller-generated identity that is also the CS-08 command identity. A retry of one create reuses it and replays the stored row instead of double-booking.';
COMMENT ON COLUMN public.schedule_events.all_day IS
    'BR-03 date semantics: start_date and exclusive end_date are authoritative. Compatibility instants are normalized at write time but never used for all-day grouping or clock labels.';
COMMENT ON COLUMN public.schedule_events.category IS
    'BR-05/OQ-3 interim: a short owner-chosen label with no business meaning, no scoring, no filtering privilege and no automation. A fixed category vocabulary stays an open question.';
COMMENT ON TYPE public.calendar_entry IS
    'One rendered Calendar entry from exactly one owner table (section 3). source is quest_occurrence or schedule_event and never a merged third object: Quest-only columns are null for a Schedule Event, category/notes are null for a Quest, and all-day entries have dates with null clock values.';
COMMENT ON TYPE public.schedule_event_receipt IS
    'The full stored Schedule Event state after one accepted write. replay=true means nothing new was written: for create, this command identity had already been accepted; for update, the stored state already matched the submitted state exactly.';
COMMENT ON FUNCTION public.get_calendar_events(date, date) IS
    'The single Calendar read for an inclusive pair of Profile-local days: quest_occurrences UNION ALL schedule_events in one real-instant order (CS-04). STABLE and SECURITY INVOKER like the other read routines, so caller RLS stays the final barrier, and system_private.require_owner() runs first so a non-owner or anonymous token is refused instead of answered with an empty set (CS-12). Occurrences qualify by scheduled_at or their existing untimed recurring source_slot_date, never by an invented start, deadline or reward (CS-05/CS-06); Schedule Events overlap the window half-open so a midnight-spanning block appears on each day it touches (CS-09). It materializes, completes, fails and cancels nothing (CS-07, CS-AC-07) and reads nothing for another owner (CS-03, CS-AC-02). Identity is system_internal.request_user_id() only: SQLSTATE 42501 when unauthenticated or not the configured owner, 22023 for a missing, reversed or over-92-day range, PZ001 when the Profile timezone is missing or invalid.';
COMMENT ON FUNCTION public.create_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text) IS
    'Creates one Schedule Event for the verified owner after system_private.require_owner(), never a caller-supplied owner, and writes nothing outside schedule_events (CS-01, CS-AC-04). Idempotent on the caller-generated p_event_id primary key: a repeated identity returns the stored row with replay=true and inserts nothing, a spent identity is refused with 23505 and a row belonging to another owner is refused without disclosure. Validation is 22023; an all-day block needs the Profile timezone and answers PZ001 without it.';
COMMENT ON FUNCTION public.update_schedule_event(uuid, text, timestamptz, timestamptz, boolean, text, text) IS
    'Replaces one Schedule Event''s whole state under last-write-wins (OQ-4): no expected-version guard exists in V1. A null end_at, category or notes clears it. Re-submitting the state that already holds writes nothing and answers replay=true, so a retried edit keeps the same outcome and timestamp (CS-08). PZ002 when no row with that identity is visible to this owner; nothing outside schedule_events changes (CS-02, CS-AC-04).';
COMMENT ON FUNCTION public.delete_schedule_event(uuid) IS
    'Removes one of the owner''s own Schedule Events and nothing else (CS-02, CS-AC-04). True means this call hid the event and retained its spent identity; false means it was already absent. Retries cannot remove twice or resurrect a spent create identity.';

NOTIFY pgrst, 'reload schema';
REVOKE schedule_command_owner FROM CURRENT_USER;
COMMIT;
