-- SYSTEM Activities & Opportunities V1 — L1-02 PHYSICAL SCHEMA REVIEW DRAFT.
-- Authority: approved AO V1 L0 + ADR-024, feat/ao-v1-l1 L1-01 model.ts.
-- This is NOT a deployable migration. DO NOT copy into the active migration directory.
-- L1-03 security + L1-04 typed RPC drafting appended (ALL UNTESTED).
-- G-01 instant shape/offset/IANA/DST resolution DRAFTED; real PostgreSQL parity UNTESTED.
-- Once fully integrated/reviewed, replace the review-only name with a new UTC-timestamped
-- additive migration, remove this deliberate abort gate, and run ONLY disposable DB QA.
BEGIN;
DO $ao_review_only$
BEGIN
    RAISE EXCEPTION 'BLOCKED: AO G-01 refinement review-only; SQL, ACL/RLS, RPC and timezone parity not verified'
       USING ERRCODE = '0A000';
END;
$ao_review_only$;

-- Value-only helpers (later L1-03 must lock down default function EXECUTE grants).
CREATE FUNCTION system_internal.ao_trim_v1(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$function$;

CREATE FUNCTION system_internal.ao_text_valid_v1(value text, max_chars integer,
    required boolean DEFAULT false, multiline boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF max_chars IS NULL OR max_chars < 1 OR required IS NULL OR multiline IS NULL THEN RETURN false; END IF;
    IF value IS NULL THEN RETURN NOT required; END IF;
    IF char_length(value) > max_chars OR system_internal.ao_trim_v1(value) = '' THEN RETURN false; END IF;
    IF multiline THEN
        RETURN value = replace(replace(value, E'\r\n', E'\n'), E'\r', E'\n');
    END IF;
    RETURN value = system_internal.ao_trim_v1(value);
END;
$function$;

-- Numeric JSON fields must be integral numbers in the approved civil year 0001..9999.
-- Numeric representation/canonicalization must be compared against L1-01 TS fixtures.
CREATE FUNCTION system_internal.ao_partial_valid_v1(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE p text; y integer; m integer; d integer; k text[];
BEGIN
    IF value IS NULL THEN RETURN true; END IF;
    IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    p := value ->> 'precision';
    SELECT array_agg(key ORDER BY key) INTO k FROM jsonb_object_keys(value) AS key;
    IF p = 'unknown' THEN RETURN k = ARRAY['precision']; END IF;
    IF p IS NULL OR p NOT IN ('year','month','day') OR
       jsonb_typeof(value -> 'year') IS DISTINCT FROM 'number' OR
       (value ->> 'year') !~ '^[0-9]{1,4}$' THEN RETURN false; END IF;
    y := (value ->> 'year')::integer;
    IF y NOT BETWEEN 1 AND 9999 THEN RETURN false; END IF;
    IF p = 'year' THEN RETURN k = ARRAY['precision','year']; END IF;
    IF jsonb_typeof(value -> 'month') IS DISTINCT FROM 'number' OR
       (value ->> 'month') !~ '^(0?[1-9]|1[0-2])$' THEN RETURN false; END IF;
    m := (value ->> 'month')::integer;
    IF p = 'month' THEN RETURN k = ARRAY['month','precision','year']; END IF;
    IF p <> 'day' OR k <> ARRAY['day','month','precision','year'] OR
       jsonb_typeof(value -> 'day') IS DISTINCT FROM 'number' OR
       (value ->> 'day') !~ '^[0-9]{1,2}$' THEN RETURN false; END IF;
    d := (value ->> 'day')::integer;
    RETURN d BETWEEN 1 AND CASE m
        WHEN 2 THEN CASE WHEN y % 4 = 0 AND (y % 100 <> 0 OR y % 400 = 0) THEN 29 ELSE 28 END
        WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END;
END;
$function$;

CREATE FUNCTION system_internal.ao_partial_bounds_v1(value jsonb) RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE p text; y integer; m integer; lo integer; hi integer; last_day integer;
BEGIN
    IF NOT system_internal.ao_partial_valid_v1(value) THEN RETURN NULL; END IF;
    IF value IS NULL OR value ->> 'precision' = 'unknown' THEN RETURN NULL; END IF;
    p := value ->> 'precision'; y := (value ->> 'year')::integer;
    m := CASE WHEN p = 'year' THEN 1 ELSE (value ->> 'month')::integer END;
    lo := y*10000 + m*100 + CASE WHEN p='day' THEN (value ->> 'day')::integer ELSE 1 END;
    IF p='day' THEN hi := lo;
    ELSE
        m := CASE WHEN p='year' THEN 12 ELSE m END;
        last_day := CASE m WHEN 2 THEN CASE WHEN y % 4 = 0 AND (y % 100 <> 0 OR y % 400 = 0) THEN 29 ELSE 28 END
            WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END;
        hi := y*10000 + m*100 + last_day;
    END IF;
    RETURN ARRAY[lo,hi];
END;
$function$;

CREATE FUNCTION system_internal.ao_partial_order_v1(start_value jsonb, end_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE a integer[]; b integer[];
BEGIN
    IF NOT system_internal.ao_partial_valid_v1(start_value) OR
       NOT system_internal.ao_partial_valid_v1(end_value) THEN RETURN false; END IF;
    a := system_internal.ao_partial_bounds_v1(start_value);
    b := system_internal.ao_partial_bounds_v1(end_value);
    RETURN a IS NULL OR b IS NULL OR a[1] <= b[2];
END;
$function$;

CREATE FUNCTION system_internal.ao_partial_known_v1(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(system_internal.ao_partial_valid_v1(value) AND value ->> 'precision' <> 'unknown',false);
$function$;

-- G-01 REVIEW DRAFT. Separate immutable data-shape validation from timezone-rule
-- resolution so future tzdb upgrades do NOT retroactively invalidate stored UTC
-- instants or rewrite old rows during unrelated updates.
-- All instant wall times have minute precision; offset is signed *minutes east* UTC.
CREATE FUNCTION system_internal.ao_deadline_spec_valid_v1(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE p text; k text[]; civil jsonb; date_text text; clock_text text; zone_text text;
        offset_value numeric;
BEGIN
    IF value IS NULL THEN RETURN true; END IF;
    IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    p := value ->> 'precision';
    IF p = 'instant' THEN
        SELECT array_agg(key ORDER BY key) INTO k FROM jsonb_object_keys(value) AS key;
        IF k <> ARRAY['precision','source_date','source_offset_minutes','source_time'] AND
           k <> ARRAY['precision','source_date','source_offset_minutes','source_time','source_zone'] THEN
            RETURN false;
        END IF;
        IF jsonb_typeof(value -> 'source_date') IS DISTINCT FROM 'string' OR
           jsonb_typeof(value -> 'source_time') IS DISTINCT FROM 'string' OR
           jsonb_typeof(value -> 'source_offset_minutes') IS DISTINCT FROM 'number' THEN
            RETURN false;
        END IF;
        date_text := value ->> 'source_date';
        clock_text := value ->> 'source_time';
        IF date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
           clock_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN false; END IF;
        civil := jsonb_build_object('precision','day',
            'year',substring(date_text FROM 1 FOR 4)::integer,
            'month',substring(date_text FROM 6 FOR 2)::integer,
            'day',substring(date_text FROM 9 FOR 2)::integer);
        IF NOT system_internal.ao_partial_valid_v1(civil) THEN RETURN false; END IF;
        offset_value := (value ->> 'source_offset_minutes')::numeric;
        IF offset_value <> trunc(offset_value) OR
           offset_value NOT BETWEEN -840 AND 840 THEN RETURN false; END IF;
        IF value ? 'source_zone' THEN
            IF jsonb_typeof(value -> 'source_zone') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
            zone_text := value ->> 'source_zone';
            IF zone_text !~ '^[A-Za-z0-9_+./-]{1,120}$' THEN RETURN false; END IF;
        END IF;
        RETURN true;
    END IF;
    IF p = 'day' AND value ? 'source_time' THEN
        SELECT array_agg(key ORDER BY key) INTO k FROM jsonb_object_keys(value) AS key;
        IF k <> ARRAY['day','month','precision','source_time','source_time_state','year'] OR
           value ->> 'source_time_state' IS DISTINCT FROM 'unresolved' OR
           jsonb_typeof(value -> 'source_time') IS DISTINCT FROM 'string' OR
           (value ->> 'source_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN false; END IF;
        RETURN system_internal.ao_partial_valid_v1(value - 'source_time' - 'source_time_state');
    END IF;
    RETURN system_internal.ao_partial_valid_v1(value);
END;
$function$;

-- This CHECK is deliberately tzdb-independent: a timezone rule update must never
-- corrupt retained historical instants. The trigger below proves the UTC mapping
-- upon first INSERT or an intentional change to application_deadline.
CREATE FUNCTION system_internal.ao_deadline_valid_v1(value jsonb, derived_utc timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(system_internal.ao_deadline_spec_valid_v1(value), false)
        AND CASE WHEN value ->> 'precision' = 'instant'
                 THEN derived_utc IS NOT NULL AND isfinite(derived_utc)
                 ELSE derived_utc IS NULL END;
$function$;

-- PostgreSQL rules source is the installed server tzdb. Verify offset+wall-time
-- against the *candidate instant* rather than letting AT TIME ZONE select a fold.
-- This rejects DST gaps, wrong offsets and ambiguous folds lacking an explicit
-- offset. Offset-only timestamps are valid without guessing an IANA zone.
-- Calling code must NOT use Profile timezone as a substitute.
CREATE FUNCTION system_internal.ao_deadline_resolve_v1(value jsonb)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE date_text text; time_text text; zone_text text; candidate timestamptz;
        wall_time timestamp without time zone; signed_offset integer; civil_utc timestamp without time zone;
BEGIN
    IF NOT system_internal.ao_deadline_spec_valid_v1(value) THEN
        RAISE EXCEPTION 'Invalid AO deadline spec' USING ERRCODE = '22023';
    END IF;
    IF value IS NULL OR value ->> 'precision' <> 'instant' THEN RETURN NULL; END IF;
    date_text := value ->> 'source_date'; time_text := value ->> 'source_time';
    signed_offset := (value ->> 'source_offset_minutes')::integer;
    wall_time := pg_catalog.make_timestamp(
        substring(date_text FROM 1 FOR 4)::integer,
        substring(date_text FROM 6 FOR 2)::integer,
        substring(date_text FROM 9 FOR 2)::integer,
        substring(time_text FROM 1 FOR 2)::integer,
        substring(time_text FROM 4 FOR 2)::integer, 0);
    civil_utc := wall_time - pg_catalog.make_interval(mins => signed_offset);
    candidate := civil_utc AT TIME ZONE 'UTC';
    IF NOT isfinite(candidate) OR
       extract(year FROM (candidate AT TIME ZONE 'UTC')) NOT BETWEEN 1 AND 9999 THEN
        RAISE EXCEPTION 'AO deadline UTC outside supported civil years' USING ERRCODE = '22023';
    END IF;
    IF value ? 'source_zone' THEN
        zone_text := value ->> 'source_zone';
        -- pg_timezone_names is the database's actual installed tzdb catalog.
        -- No arbitrary POSIX zone or caller-defined timezone expressions.
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE t.name = zone_text) THEN
            RAISE EXCEPTION 'Unsupported AO timezone identifier' USING ERRCODE = '22023';
        END IF;
        IF (candidate AT TIME ZONE zone_text) IS DISTINCT FROM wall_time THEN
            RAISE EXCEPTION 'AO timezone/offset does not match source wall time' USING ERRCODE = '22023';
        END IF;
    END IF;
    RETURN candidate;
END;
$function$;

-- Only database-owned UTC values; no user-editable column privilege. Compare
-- NEW/OLD BEFORE recalculating so unrelated modifications do not mutate accepted
-- instants when tzdb rules are subsequently updated.
CREATE FUNCTION system_internal.ao_deadline_derive_trigger_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.deadline_at_utc := system_internal.ao_deadline_resolve_v1(NEW.application_deadline);
    ELSIF NEW.application_deadline IS DISTINCT FROM OLD.application_deadline THEN
        NEW.deadline_at_utc := system_internal.ao_deadline_resolve_v1(NEW.application_deadline);
    ELSIF NEW.deadline_at_utc IS DISTINCT FROM OLD.deadline_at_utc THEN
        RAISE EXCEPTION 'AO deadline UTC is database-owned' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

-- Pure syntactic subset mirrored from existing Library URL validation.
-- No DNS lookup, HTTP, credential use, URL rewriting or outgoing network activity.
CREATE FUNCTION system_internal.ao_https_v1(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE authority text; parts text[]; host text; dns text; label text; octets text[];
BEGIN
    IF value IS NULL OR char_length(value) > 2048 OR value !~* '^https://' OR
       value ~ U&'[\0001-\0020\007F-\009F\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' OR
       strpos(value, chr(92)) > 0 THEN RETURN false; END IF;
    authority := substring(value FROM '(?i)^https://([^/?#]+)');
    IF authority IS NULL OR strpos(authority, '@') > 0 THEN RETURN false; END IF;
    parts := regexp_match(authority, '^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(:([0-9]{1,5}))?$');
    IF parts IS NULL OR (parts[3] IS NOT NULL AND parts[3]::integer > 65535) THEN RETURN false; END IF;
    host := parts[1];
    IF left(host, 1) = '[' THEN
        BEGIN RETURN family(substring(host FROM 2 FOR length(host)-2)::inet) = 6;
        EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
    END IF;
    dns := regexp_replace(host, '\.$', '');
    IF dns = '' OR length(dns) > 253 THEN RETURN false; END IF;
    FOREACH label IN ARRAY string_to_array(dns, '.') LOOP
        IF label !~ '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$' THEN RETURN false; END IF;
    END LOOP;
    label := (string_to_array(dns, '.'))[cardinality(string_to_array(dns, '.'))];
    IF label ~ '^[0-9]+$' OR label ~* '^0x[0-9a-f]+$' THEN
        octets := string_to_array(dns, '.');
        IF host <> dns OR cardinality(octets) <> 4 THEN RETURN false; END IF;
        FOREACH label IN ARRAY octets LOOP
            IF label !~ '^(0|[1-9][0-9]{0,2})$' OR label::integer > 255 THEN RETURN false; END IF;
        END LOOP;
    END IF;
    RETURN true;
END;
$function$;

CREATE FUNCTION system_internal.ao_resources_valid_v1(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE item jsonb; k text[]; link_id text; label_value text; url_value text; seen_ids text[] := ARRAY[]::text[];
BEGIN
    IF value IS NULL OR jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(value) > 30 THEN RETURN false; END IF;
    FOR item IN SELECT child FROM jsonb_array_elements(value) AS child LOOP
        IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
        SELECT array_agg(key ORDER BY key) INTO k FROM jsonb_object_keys(item) AS key;
        IF k <> ARRAY['id','label','url'] OR
           jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR
           jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR
           jsonb_typeof(item->'url') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
        link_id := item->>'id'; label_value := item->>'label'; url_value := item->>'url';
        IF link_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR
           lower(link_id) = ANY(seen_ids) OR
           NOT system_internal.ao_text_valid_v1(label_value,120,true,false) OR
           NOT system_internal.ao_https_v1(url_value) THEN RETURN false; END IF;
        seen_ids := array_append(seen_ids,lower(link_id));
    END LOOP;
    RETURN true;
END;
$function$;

-- Guard retained intervals; updating detached_at once is the only allowed UPDATE.
CREATE FUNCTION system_internal.ao_interval_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AO link intervals cannot be deleted' USING ERRCODE='23514'; END IF;
    IF OLD.detached_at IS NOT NULL OR NEW.detached_at IS NULL OR
       (to_jsonb(NEW) - 'detached_at') IS DISTINCT FROM (to_jsonb(OLD) - 'detached_at') THEN
        RAISE EXCEPTION 'AO interval identity is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE FUNCTION system_internal.ao_immutable_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'AO accepted receipts and history are immutable' USING ERRCODE = '23514';
END;
$function$;

CREATE TABLE public.opportunities (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    archived_at timestamptz,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    title text NOT NULL,
    category text,
    organization text,
    description text,
    eligibility_notes text,
    benefits_notes text,
    tracking_stage text NOT NULL DEFAULT 'saved',
    selection_outcome text NOT NULL DEFAULT 'unknown',
    entry_mode text NOT NULL DEFAULT 'unknown',
    selection_applicability text NOT NULL DEFAULT 'unknown',
    closed_reason text,
    closed_note text,
    application_deadline jsonb,
    deadline_at_utc timestamptz,
    program_start jsonb,
    program_end jsonb,
    applied_at jsonb,
    decision_at jsonb,
    priority text,
    notes text,
    resource_links jsonb NOT NULL DEFAULT '[]'::jsonb,
    CHECK (system_internal.ao_text_valid_v1(title,240,true,false)),
    CHECK (system_internal.ao_text_valid_v1(organization,240,false,false)),
    CHECK (system_internal.ao_text_valid_v1(description,4000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(eligibility_notes,10000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(benefits_notes,10000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(closed_note,2000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(notes,10000,false,true)),
    CHECK (category IS NULL OR category IN ('scholarship','internship','fellowship','competition','research','training','program','event','other')),
    CHECK (tracking_stage IN ('saved','preparing','submitted','closed')),
    CHECK (selection_outcome IN ('unknown','pending','shortlisted','waitlisted','accepted','rejected')),
    CHECK (entry_mode IN ('unknown','application','registration','invitation','direct_access','other')),
    CHECK (selection_applicability IN ('unknown','applicable','not_applicable')),
    CHECK (closed_reason IS NULL OR closed_reason IN ('not_interested','withdrawn','declined_offer','deadline_missed','program_cancelled','process_finished','other')),
    CHECK (priority IS NULL OR priority IN ('low','medium','high')),
    CHECK (selection_applicability <> 'not_applicable' OR selection_outcome = 'unknown'),
    CHECK (tracking_stage = 'closed' OR (closed_reason IS NULL AND closed_note IS NULL)),
    CHECK (closed_reason IS DISTINCT FROM 'other' OR closed_note IS NOT NULL),
    CHECK (system_internal.ao_deadline_valid_v1(application_deadline,deadline_at_utc)),
    CHECK (system_internal.ao_partial_valid_v1(program_start)),
    CHECK (system_internal.ao_partial_valid_v1(program_end)),
    CHECK (system_internal.ao_partial_valid_v1(applied_at)),
    CHECK (system_internal.ao_partial_valid_v1(decision_at)),
    CHECK (system_internal.ao_partial_order_v1(program_start,program_end)),
    CHECK (system_internal.ao_resources_valid_v1(resource_links)),
    UNIQUE (id, user_id),
    CONSTRAINT ao_root_revision CHECK (revision >= 1),
    CONSTRAINT ao_root_clock CHECK (isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at AND (archived_at IS NULL OR (isfinite(archived_at) AND archived_at >= created_at AND archived_at <= updated_at)))
);

CREATE TABLE public.activities (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    archived_at timestamptz,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    title text NOT NULL,
    category text,
    organization text,
    role text,
    description text,
    status text NOT NULL,
    planned_start jsonb,
    planned_end jsonb,
    actual_start jsonb,
    actual_end jsonb,
    participation_confirmed_at timestamptz,
    confirmation_note text,
    contributions text,
    outcomes text,
    lessons text,
    notes text,
    resource_links jsonb NOT NULL DEFAULT '[]'::jsonb,
    CHECK (system_internal.ao_text_valid_v1(title,240,true,false)),
    CHECK (system_internal.ao_text_valid_v1(organization,240,false,false)),
    CHECK (system_internal.ao_text_valid_v1(role,160,false,false)),
    CHECK (system_internal.ao_text_valid_v1(description,4000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(confirmation_note,2000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(contributions,10000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(outcomes,10000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(lessons,10000,false,true)),
    CHECK (system_internal.ao_text_valid_v1(notes,10000,false,true)),
    CHECK (category IS NULL OR category IN ('research','project','club','volunteer','training','competition','internship','event','other')),
    CHECK (status IN ('upcoming','ongoing','paused','completed','ended_early','cancelled_before_start')),
    CHECK (system_internal.ao_partial_valid_v1(planned_start)),
    CHECK (system_internal.ao_partial_valid_v1(planned_end)),
    CHECK (system_internal.ao_partial_valid_v1(actual_start)),
    CHECK (system_internal.ao_partial_valid_v1(actual_end)),
    CHECK (system_internal.ao_partial_order_v1(planned_start,planned_end)),
    CHECK (system_internal.ao_partial_order_v1(actual_start,actual_end)),
    CHECK (status NOT IN ('upcoming','cancelled_before_start') OR (NOT system_internal.ao_partial_known_v1(actual_start) AND NOT system_internal.ao_partial_known_v1(actual_end))),
    CHECK (participation_confirmed_at IS NULL OR isfinite(participation_confirmed_at)),
    CHECK (system_internal.ao_resources_valid_v1(resource_links)),
    UNIQUE (id, user_id),
    CONSTRAINT ao_root_revision CHECK (revision >= 1),
    CONSTRAINT ao_root_clock CHECK (isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at AND (archived_at IS NULL OR (isfinite(archived_at) AND archived_at >= created_at AND archived_at <= updated_at)))
);

-- G-01: install before tables become callable; never recalculate on unrelated edits.
CREATE TRIGGER ao_opportunities_deadline_derive
    BEFORE INSERT OR UPDATE OF application_deadline, deadline_at_utc ON public.opportunities
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_deadline_derive_trigger_v1();

CREATE INDEX ix_ao_opportunities_active_page ON public.opportunities(user_id,created_at DESC,id DESC) WHERE archived_at IS NULL;
CREATE INDEX ix_ao_opportunities_archived_page ON public.opportunities(user_id,created_at DESC,id DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX ix_ao_opportunities_category ON public.opportunities(user_id,category,created_at DESC,id DESC);

CREATE INDEX ix_ao_activities_active_page ON public.activities(user_id,created_at DESC,id DESC) WHERE archived_at IS NULL;
CREATE INDEX ix_ao_activities_archived_page ON public.activities(user_id,created_at DESC,id DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX ix_ao_activities_category ON public.activities(user_id,category,created_at DESC,id DESC);

CREATE TABLE public.activity_source_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    activity_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    attached_at timestamptz NOT NULL DEFAULT now(),
    detached_at timestamptz,
    CONSTRAINT fk_activity_source_links_source_owner FOREIGN KEY (activity_id,user_id) REFERENCES public.activities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_activity_source_links_target_owner FOREIGN KEY (opportunity_id,user_id) REFERENCES public.opportunities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (isfinite(attached_at) AND (detached_at IS NULL OR (isfinite(detached_at) AND detached_at >= attached_at)))
);

CREATE UNIQUE INDEX uq_ao_activity_source_links_current ON public.activity_source_links(activity_id) WHERE detached_at IS NULL;
CREATE INDEX ix_ao_activity_source_links_source_history ON public.activity_source_links(user_id,activity_id,attached_at DESC,id DESC);
CREATE INDEX ix_ao_activity_source_links_target_history ON public.activity_source_links(user_id,opportunity_id,attached_at DESC,id DESC);
CREATE TRIGGER ao_activity_source_links_interval_immutable BEFORE UPDATE OR DELETE ON public.activity_source_links
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_interval_guard_v1();

CREATE TABLE public.opportunity_goal_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    opportunity_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    attached_at timestamptz NOT NULL DEFAULT now(),
    detached_at timestamptz,
    CONSTRAINT fk_opportunity_goal_links_source_owner FOREIGN KEY (opportunity_id,user_id) REFERENCES public.opportunities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_opportunity_goal_links_target_owner FOREIGN KEY (goal_id,user_id) REFERENCES public.goals(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (isfinite(attached_at) AND (detached_at IS NULL OR (isfinite(detached_at) AND detached_at >= attached_at)))
);

CREATE UNIQUE INDEX uq_ao_opportunity_goal_links_current ON public.opportunity_goal_links(opportunity_id,goal_id) WHERE detached_at IS NULL;
CREATE INDEX ix_ao_opportunity_goal_links_source_history ON public.opportunity_goal_links(user_id,opportunity_id,attached_at DESC,id DESC);
CREATE INDEX ix_ao_opportunity_goal_links_target_history ON public.opportunity_goal_links(user_id,goal_id,attached_at DESC,id DESC);
CREATE TRIGGER ao_opportunity_goal_links_interval_immutable BEFORE UPDATE OR DELETE ON public.opportunity_goal_links
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_interval_guard_v1();

CREATE TABLE public.opportunity_quest_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    opportunity_id uuid NOT NULL,
    quest_id uuid NOT NULL,
    attached_at timestamptz NOT NULL DEFAULT now(),
    detached_at timestamptz,
    CONSTRAINT fk_opportunity_quest_links_source_owner FOREIGN KEY (opportunity_id,user_id) REFERENCES public.opportunities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_opportunity_quest_links_target_owner FOREIGN KEY (quest_id,user_id) REFERENCES public.quests(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (isfinite(attached_at) AND (detached_at IS NULL OR (isfinite(detached_at) AND detached_at >= attached_at)))
);

CREATE UNIQUE INDEX uq_ao_opportunity_quest_links_current ON public.opportunity_quest_links(opportunity_id,quest_id) WHERE detached_at IS NULL;
CREATE INDEX ix_ao_opportunity_quest_links_source_history ON public.opportunity_quest_links(user_id,opportunity_id,attached_at DESC,id DESC);
CREATE INDEX ix_ao_opportunity_quest_links_target_history ON public.opportunity_quest_links(user_id,quest_id,attached_at DESC,id DESC);
CREATE TRIGGER ao_opportunity_quest_links_interval_immutable BEFORE UPDATE OR DELETE ON public.opportunity_quest_links
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_interval_guard_v1();

CREATE TABLE public.activity_goal_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    activity_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    attached_at timestamptz NOT NULL DEFAULT now(),
    detached_at timestamptz,
    CONSTRAINT fk_activity_goal_links_source_owner FOREIGN KEY (activity_id,user_id) REFERENCES public.activities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_activity_goal_links_target_owner FOREIGN KEY (goal_id,user_id) REFERENCES public.goals(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (isfinite(attached_at) AND (detached_at IS NULL OR (isfinite(detached_at) AND detached_at >= attached_at)))
);

CREATE UNIQUE INDEX uq_ao_activity_goal_links_current ON public.activity_goal_links(activity_id,goal_id) WHERE detached_at IS NULL;
CREATE INDEX ix_ao_activity_goal_links_source_history ON public.activity_goal_links(user_id,activity_id,attached_at DESC,id DESC);
CREATE INDEX ix_ao_activity_goal_links_target_history ON public.activity_goal_links(user_id,goal_id,attached_at DESC,id DESC);
CREATE TRIGGER ao_activity_goal_links_interval_immutable BEFORE UPDATE OR DELETE ON public.activity_goal_links
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_interval_guard_v1();

CREATE TABLE public.activity_quest_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    activity_id uuid NOT NULL,
    quest_id uuid NOT NULL,
    attached_at timestamptz NOT NULL DEFAULT now(),
    detached_at timestamptz,
    CONSTRAINT fk_activity_quest_links_source_owner FOREIGN KEY (activity_id,user_id) REFERENCES public.activities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_activity_quest_links_target_owner FOREIGN KEY (quest_id,user_id) REFERENCES public.quests(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (isfinite(attached_at) AND (detached_at IS NULL OR (isfinite(detached_at) AND detached_at >= attached_at)))
);

CREATE UNIQUE INDEX uq_ao_activity_quest_links_current ON public.activity_quest_links(activity_id,quest_id) WHERE detached_at IS NULL;
CREATE INDEX ix_ao_activity_quest_links_source_history ON public.activity_quest_links(user_id,activity_id,attached_at DESC,id DESC);
CREATE INDEX ix_ao_activity_quest_links_target_history ON public.activity_quest_links(user_id,quest_id,attached_at DESC,id DESC);
CREATE TRIGGER ao_activity_quest_links_interval_immutable BEFORE UPDATE OR DELETE ON public.activity_quest_links
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_interval_guard_v1();

CREATE TABLE system_internal.ao_commands (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    command_id uuid NOT NULL,
    command_type text NOT NULL,
    subject_kind text NOT NULL,
    opportunity_id uuid,
    activity_id uuid,
    canonical_request jsonb NOT NULL,
    result jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id,command_id),
    UNIQUE (user_id,command_id,opportunity_id),
    UNIQUE (user_id,command_id,activity_id),
    CONSTRAINT fk_ao_command_opportunity_owner FOREIGN KEY (opportunity_id,user_id) REFERENCES public.opportunities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_ao_command_activity_owner FOREIGN KEY (activity_id,user_id) REFERENCES public.activities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK ((subject_kind='opportunity' AND opportunity_id IS NOT NULL AND activity_id IS NULL) OR (subject_kind='activity' AND activity_id IS NOT NULL AND opportunity_id IS NULL)),
    CHECK (command_type IN ('create_opportunity_v1','update_opportunity_v1','set_opportunity_stage_v1','record_opportunity_outcome_v1','set_opportunity_archived_v1','create_activity_v1','update_activity_v1','transition_activity_v1','correct_activity_status_v1','set_activity_archived_v1','set_activity_source_v1','attach_ao_context_v1','detach_ao_context_v1')),
    CHECK (jsonb_typeof(canonical_request) = 'object' AND jsonb_typeof(result) = 'object'),
    CHECK (isfinite(recorded_at))
);

CREATE INDEX ix_ao_commands_opportunity_history ON system_internal.ao_commands(user_id,opportunity_id,recorded_at DESC,command_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX ix_ao_commands_activity_history ON system_internal.ao_commands(user_id,activity_id,recorded_at DESC,command_id) WHERE activity_id IS NOT NULL;
CREATE TRIGGER ao_commands_immutable BEFORE UPDATE OR DELETE ON system_internal.ao_commands
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_immutable_guard_v1();

CREATE TABLE public.opportunity_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    opportunity_id uuid NOT NULL,
    command_id uuid NOT NULL,
    event_seq integer NOT NULL,
    event_type text NOT NULL,
    before_value jsonb,
    after_value jsonb,
    reason text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_opportunity_history_owner FOREIGN KEY (opportunity_id,user_id) REFERENCES public.opportunities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_opportunity_history_command FOREIGN KEY (user_id,command_id,opportunity_id) REFERENCES system_internal.ao_commands(user_id,command_id,opportunity_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (user_id,command_id,event_seq),
    CHECK (event_seq >= 1),
    CHECK (system_internal.ao_text_valid_v1(event_type,80,true,false)),
    CHECK (isfinite(recorded_at))
);

CREATE INDEX ix_ao_opportunity_history_page ON public.opportunity_history(user_id,opportunity_id,recorded_at DESC,id DESC);
CREATE TRIGGER ao_opportunity_history_immutable BEFORE UPDATE OR DELETE ON public.opportunity_history
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_immutable_guard_v1();

CREATE TABLE public.activity_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    activity_id uuid NOT NULL,
    command_id uuid NOT NULL,
    event_seq integer NOT NULL,
    event_type text NOT NULL,
    before_value jsonb,
    after_value jsonb,
    reason text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_activity_history_owner FOREIGN KEY (activity_id,user_id) REFERENCES public.activities(id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_activity_history_command FOREIGN KEY (user_id,command_id,activity_id) REFERENCES system_internal.ao_commands(user_id,command_id,activity_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (user_id,command_id,event_seq),
    CHECK (event_seq >= 1),
    CHECK (system_internal.ao_text_valid_v1(event_type,80,true,false)),
    CHECK (isfinite(recorded_at))
);

CREATE INDEX ix_ao_activity_history_page ON public.activity_history(user_id,activity_id,recorded_at DESC,id DESC);
CREATE TRIGGER ao_activity_history_immutable BEFORE UPDATE OR DELETE ON public.activity_history
    FOR EACH ROW EXECUTE FUNCTION system_internal.ao_immutable_guard_v1();

-- Security *default deny*: RLS enabled; L1-03 MUST provide verified per-role policies
-- and the dedicated least-privilege command executor in the same final migration.
-- No direct client INSERT/UPDATE/DELETE/SELECT permissions on any AO table yet.

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.opportunities FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.activities FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.activity_source_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.activity_source_links FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.opportunity_goal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.opportunity_goal_links FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.opportunity_quest_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.opportunity_quest_links FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.activity_goal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.activity_goal_links FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.activity_quest_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.activity_quest_links FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.opportunity_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.opportunity_history FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.activity_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.activity_history FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE system_internal.ao_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE system_internal.ao_commands FROM PUBLIC, anon, authenticated, service_role;


-- L1-03 SECURITY REVIEW DRAFT: new role and policies ONLY. No callable public RPC exists
-- in this partial artifact. Never apply until L1-04 and G-01 are completed and tested.
-- Explicit grants are narrower than a table-level write permission.
CREATE ROLE ao_command_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, system_internal, system_private, progression_internal
    TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.request_user_id(),
    system_private.require_owner(), progression_internal.lock_owner(uuid)
    TO ao_command_owner;

-- system_private.is_owner() is owned by system_owner_reader. Mirror the Library
-- installation technique: borrow membership only if USAGE is unavailable and restore.
-- L1-05 must compare pg_auth_members before/after and prove NO lasting membership.
DO $ao_owner_predicate_grant$
DECLARE borrowed boolean := NOT pg_has_role(current_user,'system_owner_reader','USAGE');
BEGIN
    IF borrowed THEN GRANT system_owner_reader TO CURRENT_USER; END IF;
    GRANT EXECUTE ON FUNCTION system_private.is_owner() TO ao_command_owner;
    IF borrowed THEN REVOKE system_owner_reader FROM CURRENT_USER; END IF;
END;
$ao_owner_predicate_grant$;

-- Closed helper allowlist: revoke PostgreSQL's default function EXECUTE from PUBLIC.
-- Schema usage remains private to approved executors. Existing function ACLs untouched.
REVOKE ALL ON FUNCTION system_internal.ao_trim_v1(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_text_valid_v1(text,integer,boolean,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_partial_valid_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_partial_bounds_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_partial_order_v1(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_partial_known_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_deadline_valid_v1(jsonb,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_deadline_spec_valid_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_deadline_resolve_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_deadline_derive_trigger_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_https_v1(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_resources_valid_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_interval_guard_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION system_internal.ao_immutable_guard_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_trim_v1(text) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_text_valid_v1(text,integer,boolean,boolean) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_partial_valid_v1(jsonb) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_partial_bounds_v1(jsonb) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_partial_order_v1(jsonb,jsonb) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_partial_known_v1(jsonb) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_deadline_valid_v1(jsonb,timestamp with time zone) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_deadline_spec_valid_v1(jsonb) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_deadline_resolve_v1(jsonb) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_https_v1(text) TO ao_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.ao_resources_valid_v1(jsonb) TO ao_command_owner;

-- AO owned rows: executor-only table access. Browser roles have no direct AO
-- table SELECT/DML privileges; later L1-04 must expose guarded typed read RPCs.

-- public.opportunities
GRANT SELECT ON TABLE public.opportunities TO ao_command_owner;
GRANT INSERT (id, user_id, title, category, organization, description, eligibility_notes, benefits_notes, tracking_stage, selection_outcome, entry_mode, selection_applicability, closed_reason, closed_note, application_deadline, deadline_at_utc, program_start, program_end, applied_at, decision_at, priority, notes, resource_links) ON TABLE public.opportunities TO ao_command_owner;
GRANT UPDATE (title, category, organization, description, eligibility_notes, benefits_notes, tracking_stage, selection_outcome, entry_mode, selection_applicability, closed_reason, closed_note, application_deadline, deadline_at_utc, program_start, program_end, applied_at, decision_at, priority, notes, resource_links, archived_at, revision, updated_at) ON TABLE public.opportunities TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.opportunities FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.opportunities FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_update_v1 ON public.opportunities FOR UPDATE TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.opportunities AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.activities
GRANT SELECT ON TABLE public.activities TO ao_command_owner;
GRANT INSERT (id, user_id, title, category, organization, role, description, status, planned_start, planned_end, actual_start, actual_end, participation_confirmed_at, confirmation_note, contributions, outcomes, lessons, notes, resource_links) ON TABLE public.activities TO ao_command_owner;
GRANT UPDATE (title, category, organization, role, description, status, planned_start, planned_end, actual_start, actual_end, participation_confirmed_at, confirmation_note, contributions, outcomes, lessons, notes, resource_links, archived_at, revision, updated_at) ON TABLE public.activities TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.activities FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.activities FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_update_v1 ON public.activities FOR UPDATE TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.activities AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.activity_source_links
GRANT SELECT ON TABLE public.activity_source_links TO ao_command_owner;
GRANT INSERT (user_id, activity_id, opportunity_id) ON TABLE public.activity_source_links TO ao_command_owner;
GRANT UPDATE (detached_at) ON TABLE public.activity_source_links TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.activity_source_links FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.activity_source_links FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_update_v1 ON public.activity_source_links FOR UPDATE TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.activity_source_links AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.opportunity_goal_links
GRANT SELECT ON TABLE public.opportunity_goal_links TO ao_command_owner;
GRANT INSERT (user_id, opportunity_id, goal_id) ON TABLE public.opportunity_goal_links TO ao_command_owner;
GRANT UPDATE (detached_at) ON TABLE public.opportunity_goal_links TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.opportunity_goal_links FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.opportunity_goal_links FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_update_v1 ON public.opportunity_goal_links FOR UPDATE TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.opportunity_goal_links AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.opportunity_quest_links
GRANT SELECT ON TABLE public.opportunity_quest_links TO ao_command_owner;
GRANT INSERT (user_id, opportunity_id, quest_id) ON TABLE public.opportunity_quest_links TO ao_command_owner;
GRANT UPDATE (detached_at) ON TABLE public.opportunity_quest_links TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.opportunity_quest_links FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.opportunity_quest_links FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_update_v1 ON public.opportunity_quest_links FOR UPDATE TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.opportunity_quest_links AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.activity_goal_links
GRANT SELECT ON TABLE public.activity_goal_links TO ao_command_owner;
GRANT INSERT (user_id, activity_id, goal_id) ON TABLE public.activity_goal_links TO ao_command_owner;
GRANT UPDATE (detached_at) ON TABLE public.activity_goal_links TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.activity_goal_links FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.activity_goal_links FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_update_v1 ON public.activity_goal_links FOR UPDATE TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.activity_goal_links AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.activity_quest_links
GRANT SELECT ON TABLE public.activity_quest_links TO ao_command_owner;
GRANT INSERT (user_id, activity_id, quest_id) ON TABLE public.activity_quest_links TO ao_command_owner;
GRANT UPDATE (detached_at) ON TABLE public.activity_quest_links TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.activity_quest_links FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.activity_quest_links FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_update_v1 ON public.activity_quest_links FOR UPDATE TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.activity_quest_links AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.opportunity_history
GRANT SELECT ON TABLE public.opportunity_history TO ao_command_owner;
GRANT INSERT (user_id,opportunity_id,command_id,event_seq,event_type,before_value,after_value,reason)
  ON TABLE public.opportunity_history TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.opportunity_history FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.opportunity_history FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.opportunity_history AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- public.activity_history
GRANT SELECT ON TABLE public.activity_history TO ao_command_owner;
GRANT INSERT (user_id,activity_id,command_id,event_seq,event_type,before_value,after_value,reason)
  ON TABLE public.activity_history TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON public.activity_history FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON public.activity_history FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.activity_history AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- system_internal.ao_commands
GRANT SELECT ON TABLE system_internal.ao_commands TO ao_command_owner;
GRANT INSERT (user_id,command_id,command_type,subject_kind,opportunity_id,activity_id,canonical_request,result)
  ON TABLE system_internal.ao_commands TO ao_command_owner;
CREATE POLICY ao_owner_select_v1 ON system_internal.ao_commands FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_owner_insert_v1 ON system_internal.ao_commands FOR INSERT TO ao_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON system_internal.ao_commands AS RESTRICTIVE FOR ALL TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- Existing Goal/Quest catalog: SELECT *never* becomes UPDATE/DELETE/REFERENCES
-- for the AO executor. Grant only columns needed for eligibility and owner-safe
-- projections, and add an AO-specific allow + restrictive configured-owner RLS.
-- No change to existing Quest Delete checks or policy/function bodies.
GRANT SELECT (id,user_id,title,archived_at)
    ON public.goals TO ao_command_owner;
GRANT SELECT (id,user_id,title,archived_at,deleted_at,recurrence_mode,direct_goal_id,project_id)
    ON public.quests TO ao_command_owner;
GRANT SELECT (id,quest_id,user_id,status,recurrence_rule_id,recurrence_revision,
    source_slot_date,source_timezone,direct_goal_id_snapshot,project_id_snapshot)
    ON public.quest_occurrences TO ao_command_owner;
GRANT SELECT (id,quest_id,user_id)
    ON public.quest_recurrence_rules TO ao_command_owner;

CREATE POLICY ao_reader_select_v1 ON public.goals FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_reader_single_owner_v1 ON public.goals AS RESTRICTIVE FOR SELECT TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_reader_select_v1 ON public.quests FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_reader_single_owner_v1 ON public.quests AS RESTRICTIVE FOR SELECT TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_reader_select_v1 ON public.quest_occurrences FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_reader_single_owner_v1 ON public.quest_occurrences AS RESTRICTIVE FOR SELECT TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_reader_select_v1 ON public.quest_recurrence_rules FOR SELECT TO ao_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY ao_reader_single_owner_v1 ON public.quest_recurrence_rules AS RESTRICTIVE FOR SELECT TO ao_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

-- SAFE by-construction label primitive for L1-04 read projections. The executor
-- can inspect the owner-scoped deleted_at flag, but this value-only function
-- returns no title, archived state or Quest status for a deleted Quest.
-- Any future public AO RPC MUST call this allowlisted projection and must not
-- emit whole Quest rows, raw query errors or snapshots in history/receipts.
CREATE FUNCTION system_internal.ao_quest_safe_label_v1(p_quest_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT CASE WHEN q.deleted_at IS NOT NULL
        THEN jsonb_build_object('id', q.id, 'deleted', true, 'label', 'Quest đã xóa')
        ELSE jsonb_build_object('id', q.id, 'deleted', false, 'label', q.title,
                                'archived', q.archived_at IS NOT NULL)
        END
      FROM public.quests AS q
     WHERE q.id = p_quest_id AND q.user_id = system_internal.request_user_id()
       AND system_private.is_owner();
$function$;
REVOKE ALL ON FUNCTION system_internal.ao_quest_safe_label_v1(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_quest_safe_label_v1(uuid)
    TO ao_command_owner;

-- Keep normal Goal title/archival visibility separately owner-gated.
CREATE FUNCTION system_internal.ao_goal_safe_label_v1(p_goal_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT jsonb_build_object('id',g.id,'label',g.title,'archived',g.archived_at IS NOT NULL)
      FROM public.goals AS g
     WHERE g.id = p_goal_id AND g.user_id = system_internal.request_user_id()
       AND system_private.is_owner();
$function$;
REVOKE ALL ON FUNCTION system_internal.ao_goal_safe_label_v1(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_goal_safe_label_v1(uuid)
    TO ao_command_owner;

-- No public write/read RPCs, no privileged EXECUTE grant to authenticated,
-- no grant of write or blanket table SELECT on external Quest/Goal/EXP/Calendar.
-- SQL trigger guards prevent UPDATE/DELETE of AO receipt/history; column grants
-- prevent callers/executor from choosing server-owned timestamps on INSERT.
-- SECURITY REVIEW GATES: L1-04 must produce strictly allowlisted DTOs, no Quest
-- raw projection and no secrets in history/errors/receipt responses. L1-05 must
-- verify SQL compile/catalog grants/RLS and missing-config/other/anon behavior.

-- INCOMPLETE BY DESIGN / RELEASE BLOCKERS:
-- L1-03: security draft is static only; prove role/ACL/RLS and safe projections in
--         actual disposable PostgreSQL tests, including old ACL and membership parity.
-- L1-04: review-only 13 typed mutation RPC + 7 read RPC proposed below, NOT tested;
--         SQL compile, transactional FK/replay semantics, redaction/DDL and permissions
--         remain unverified until separately authorized disposable L1-05 tests.
-- G-01: timezone/DST/offset/UTC trigger and verifier now DRAFTED, NOT tested.
--         PostgreSQL vs TS Intl rules and 0001..9999 boundaries must be proved.
-- L1-05: PostgreSQL catalog, owner/other/anon, multi-session concurrency and E2E/wire
--         in isolated disposable test environment; prior ADR-015 checkpoints retained.
-- DO NOT remove the fail-closed abort or install this file to Local/Cloud.
-- L1-04 REVIEW ONLY / NOT EXECUTED: guarded command and query API draft.
-- Do not remove the initial unconditional SQLSTATE 0A000 safety abort.
-- This API appendix is not an executable/validated PostgreSQL migration.
-- All JSON values and SQLSTATE/error-mapping require L1-05 disposable verification.

-- Authoritative closed field vocabulary. Fields outside this vocabulary are rejected.
CREATE FUNCTION system_internal.ao_fields_v1(p_kind text,p_payload jsonb,p_create boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $fn$
DECLARE k text; v jsonb; o jsonb := '{}'::jsonb; allowed text[]; text_limit integer; is_long boolean; normalized text; field_kind text;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_create IS NULL THEN
    RAISE EXCEPTION 'Invalid AO field shape' USING ERRCODE='22023'; END IF;
 IF p_kind='opportunity' THEN
  IF p_create THEN
   allowed:=ARRAY['title','category','organization','description','eligibility_notes','benefits_notes','tracking_stage','selection_outcome','entry_mode','selection_applicability','closed_reason','closed_note','application_deadline','program_start','program_end','applied_at','decision_at','priority','notes','resource_links'];
  ELSE
   allowed:=ARRAY['title','category','organization','description','eligibility_notes','benefits_notes','entry_mode','application_deadline','program_start','program_end','applied_at','priority','notes','resource_links'];
  END IF;
 ELSIF p_kind='activity' THEN
  IF p_create THEN
   allowed:=ARRAY['intent','title','category','organization','role','description','planned_start','planned_end','actual_start','actual_end','confirmation_note','contributions','outcomes','lessons','notes','resource_links'];
  ELSE
   allowed:=ARRAY['title','category','organization','role','description','planned_start','planned_end','actual_start','actual_end','confirmation_note','contributions','outcomes','lessons','notes','resource_links'];
  END IF;
 ELSE RAISE EXCEPTION 'Invalid AO subject kind' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) q WHERE NOT q=ANY(allowed))
    OR (NOT p_create AND p_payload='{}'::jsonb) THEN
    RAISE EXCEPTION 'Invalid AO field keys' USING ERRCODE='22023'; END IF;
 IF p_create THEN
   IF p_kind='opportunity' THEN
    o:=jsonb_build_object('title',null,'category',null,'organization',null,'description',null,
       'eligibility_notes',null,'benefits_notes',null,'tracking_stage','saved',
       'selection_outcome','unknown','entry_mode','unknown','selection_applicability','unknown',
       'closed_reason',null,'closed_note',null,'application_deadline',null,'program_start',null,
       'program_end',null,'applied_at',null,'decision_at',null,'priority',null,'notes',null,
       'resource_links','[]'::jsonb);
   ELSE
    IF jsonb_typeof(p_payload->'intent') IS DISTINCT FROM 'string' OR p_payload->>'intent' NOT IN
      ('confirmed_plan','confirmed_started','historical_completed','historical_ended_early') THEN
      RAISE EXCEPTION 'Missing Activity creation intent' USING ERRCODE='22023'; END IF;
    o:=jsonb_build_object('title',null,'category',null,'organization',null,'role',null,
      'description',null,'planned_start',null,'planned_end',null,'actual_start',null,'actual_end',null,
      'confirmation_note',null,'contributions',null,'outcomes',null,'lessons',null,'notes',null,
      'resource_links','[]'::jsonb,'status',CASE p_payload->>'intent'
       WHEN 'confirmed_plan' THEN 'upcoming' WHEN 'confirmed_started' THEN 'ongoing'
       WHEN 'historical_completed' THEN 'completed' ELSE 'ended_early' END);
    -- Preserve intent in canonical request, but never as a column.
   END IF;
 END IF;
 FOR k IN SELECT jsonb_object_keys(p_payload) LOOP
   IF k='intent' THEN CONTINUE; END IF;
   v:=p_payload->k;
   text_limit:=CASE k
     WHEN 'title' THEN 240 WHEN 'organization' THEN 240 WHEN 'role' THEN 160
     WHEN 'description' THEN 4000 WHEN 'eligibility_notes' THEN 10000
     WHEN 'benefits_notes' THEN 10000 WHEN 'closed_note' THEN 2000
     WHEN 'confirmation_note' THEN 2000 WHEN 'contributions' THEN 10000
     WHEN 'outcomes' THEN 10000 WHEN 'lessons' THEN 10000 WHEN 'notes' THEN 10000
     ELSE NULL END;
   IF text_limit IS NOT NULL THEN
     IF jsonb_typeof(v) NOT IN ('string','null') THEN
       RAISE EXCEPTION 'Invalid AO text' USING ERRCODE='22023'; END IF;
     normalized:=v #>> '{}';
     is_long:= k=ANY(ARRAY['description','eligibility_notes','benefits_notes','notes','contributions','outcomes','lessons','confirmation_note','closed_note']);
     IF is_long AND normalized IS NOT NULL THEN
       normalized:=replace(replace(normalized,E'\r\n',E'\n'),E'\r',E'\n');
     ELSIF normalized IS NOT NULL THEN normalized:=system_internal.ao_trim_v1(normalized); END IF;
     IF normalized IS NOT NULL AND system_internal.ao_trim_v1(normalized)='' THEN normalized:=NULL; END IF;
     IF NOT system_internal.ao_text_valid_v1(normalized,text_limit,k='title',is_long) THEN
       RAISE EXCEPTION 'Invalid AO text value' USING ERRCODE='22023'; END IF;
     o:=o||jsonb_build_object(k,normalized); CONTINUE;
   END IF;
   IF k='resource_links' THEN
     IF NOT system_internal.ao_resources_valid_v1(v) THEN
      RAISE EXCEPTION 'Invalid AO resource links' USING ERRCODE='22023'; END IF;
     o:=o||jsonb_build_object(k,v); CONTINUE;
   END IF;
   IF k=ANY(ARRAY['application_deadline','program_start','program_end','applied_at','decision_at','planned_start','planned_end','actual_start','actual_end']) THEN
     IF (v IS DISTINCT FROM 'null'::jsonb) AND
       ((k='application_deadline' AND NOT system_internal.ao_deadline_spec_valid_v1(v)) OR
        (k<>'application_deadline' AND NOT system_internal.ao_partial_valid_v1(v))) THEN
       RAISE EXCEPTION 'Invalid AO date' USING ERRCODE='22023'; END IF;
     o:=o||jsonb_build_object(k,v); CONTINUE;
   END IF;
   IF jsonb_typeof(v) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'Invalid AO enum type' USING ERRCODE='22023'; END IF;
   normalized:=v #>> '{}';
   IF k=ANY(ARRAY['category','priority','closed_reason']) AND normalized IS NULL THEN
     o:=o||jsonb_build_object(k,NULL); CONTINUE; END IF;
   IF NOT (CASE k
     WHEN 'category' THEN CASE WHEN p_kind='opportunity' THEN normalized=ANY(ARRAY['scholarship','internship','fellowship','competition','research','training','program','event','other'])
       ELSE normalized=ANY(ARRAY['research','project','club','volunteer','training','competition','internship','event','other']) END
     WHEN 'priority' THEN normalized=ANY(ARRAY['low','medium','high'])
     WHEN 'closed_reason' THEN normalized=ANY(ARRAY['not_interested','withdrawn','declined_offer','deadline_missed','program_cancelled','process_finished','other'])
     WHEN 'tracking_stage' THEN normalized=ANY(ARRAY['saved','preparing','submitted','closed'])
     WHEN 'selection_outcome' THEN normalized=ANY(ARRAY['unknown','pending','shortlisted','waitlisted','accepted','rejected'])
     WHEN 'entry_mode' THEN normalized=ANY(ARRAY['unknown','application','registration','invitation','direct_access','other'])
     WHEN 'selection_applicability' THEN normalized=ANY(ARRAY['unknown','applicable','not_applicable'])
     ELSE false END) THEN RAISE EXCEPTION 'Invalid AO enum value' USING ERRCODE='22023'; END IF;
   o:=o||jsonb_build_object(k,normalized);
 END LOOP;
 IF p_create AND o->>'title' IS NULL THEN
   RAISE EXCEPTION 'Required AO title missing' USING ERRCODE='22023'; END IF;
 -- Activity intent is part of canonical request, not public.activities storage.
 IF p_create AND p_kind='activity' THEN o:=o||jsonb_build_object('intent',p_payload->>'intent'); END IF;
 RETURN o;
END;
$fn$;

CREATE FUNCTION system_internal.ao_receipt_v1(p_op text,p_cmd uuid,p_kind text,p_id uuid,
  p_before bigint,p_after bigint,p_changed boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $fn$
 SELECT jsonb_build_object('version',1,'command_id',p_cmd,'subject_kind',p_kind,
  'subject_id',p_id,'operation',p_op,'revision_before',p_before::text,
  'revision_after',p_after::text,'changed',p_changed,'replay',false);
$fn$;

CREATE FUNCTION system_internal.ao_assert_owner_v1() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE actor uuid;
BEGIN
 PERFORM system_private.require_owner();
 actor:=system_internal.request_user_id();
 IF actor IS NULL THEN RAISE EXCEPTION 'SYSTEM owner required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END;
$fn$;

CREATE FUNCTION system_internal.ao_projection_root_v1(p_kind text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE actor uuid; data jsonb;
BEGIN
 actor:=system_internal.ao_assert_owner_v1();
 IF p_kind='opportunity' THEN
  SELECT to_jsonb(o)-'user_id' INTO data FROM public.opportunities o
    WHERE o.id=p_id AND o.user_id=actor;
 ELSIF p_kind='activity' THEN
  SELECT to_jsonb(a)-'user_id' INTO data FROM public.activities a
    WHERE a.id=p_id AND a.user_id=actor;
 ELSE RAISE EXCEPTION 'Invalid AO subject' USING ERRCODE='22023'; END IF;
 IF data IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',1,'subject_kind',p_kind,'root',data,
   'contexts',system_internal.ao_context_projection_v1(p_kind,p_id),
   'source',CASE WHEN p_kind='activity' THEN system_internal.ao_activity_source_projection_v1(p_id) ELSE NULL END,
   'derived_activities',CASE WHEN p_kind='opportunity' THEN system_internal.ao_derived_activities_v1(p_id) ELSE NULL END);
END;
$fn$;


-- One internal closed dispatcher. Access is revoked from browser/anonymous roles.
-- All public wrappers pass one constant operation, not attacker-selected SQL identifiers.
CREATE FUNCTION system_internal.ao_run_v1(p_op text,p_cmd uuid,p_kind text,p_id uuid,
 p_rev bigint,p_req jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_actor uuid; v_data jsonb; v_fields jsonb; v_intent jsonb;
 v_prior system_internal.ao_commands; v_before bigint; v_after bigint; v_now timestamptz;
 v_changed boolean:=false; v_receipt jsonb; v_old jsonb; v_new jsonb;
 v_target uuid; v_link uuid; v_existing uuid; v_old_target uuid; v_kind text;
 v_opportunity public.opportunities; v_activity public.activities;
 v_goal public.goals; v_quest public.quests; v_occ public.quest_occurrences;
 v_status text; v_stage text; v_rule text; v_detail jsonb; v_direction text; v_stage_note text;
BEGIN
 v_actor:=system_internal.ao_assert_owner_v1();
 IF p_cmd IS NULL OR p_id IS NULL OR p_op IS NULL OR p_kind IS NULL OR
  p_req IS NULL OR jsonb_typeof(p_req)<>'object' OR
  p_kind NOT IN ('opportunity','activity') OR p_op NOT IN (
  'create_opportunity_v1','update_opportunity_v1','set_opportunity_stage_v1',
  'record_opportunity_outcome_v1','set_opportunity_archived_v1',
  'create_activity_v1','update_activity_v1','transition_activity_v1',
  'correct_activity_status_v1','set_activity_archived_v1','set_activity_source_v1',
  'attach_ao_context_v1','detach_ao_context_v1') THEN
  RAISE EXCEPTION 'Invalid AO command identity' USING ERRCODE='22023'; END IF;
 IF (p_kind='opportunity' AND p_op=ANY(ARRAY['create_activity_v1','update_activity_v1','transition_activity_v1',
    'correct_activity_status_v1','set_activity_archived_v1','set_activity_source_v1'])) OR
    (p_kind='activity' AND p_op=ANY(ARRAY['create_opportunity_v1','update_opportunity_v1',
    'set_opportunity_stage_v1','record_opportunity_outcome_v1','set_opportunity_archived_v1'])) THEN
   RAISE EXCEPTION 'Invalid AO command subject' USING ERRCODE='22023'; END IF;
 IF p_op IN ('create_opportunity_v1','create_activity_v1') THEN
  IF p_rev IS NOT NULL THEN RAISE EXCEPTION 'Create revision must be absent' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_rev IS NULL OR p_rev<1 THEN RAISE EXCEPTION 'Invalid AO revision' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_op IN ('create_opportunity_v1','update_opportunity_v1') THEN
  v_fields:=system_internal.ao_fields_v1('opportunity',p_req,p_op='create_opportunity_v1');
  v_intent:=v_fields;
 ELSIF p_op IN ('create_activity_v1','update_activity_v1') THEN
  v_fields:=system_internal.ao_fields_v1('activity',p_req,p_op='create_activity_v1');
  v_intent:=v_fields;
 ELSIF p_op='set_opportunity_stage_v1' THEN
  -- R-07: canonicalize before receipt lookup, not after the source is locked.
  -- Preserve omitted keys; explicit null and whitespace-only note normalize to JSON null.
  v_intent:=p_req;
  IF jsonb_typeof(p_req->'details')='object' AND p_req->'details' ? 'closed_note'
     AND jsonb_typeof(p_req->'details'->'closed_note') IN ('string','null') THEN
   v_stage_note:=p_req#>>'{details,closed_note}';
   IF v_stage_note IS NOT NULL THEN
    v_stage_note:=replace(replace(v_stage_note,E'\r\n',E'\n'),E'\r',E'\n');
    IF system_internal.ao_trim_v1(v_stage_note)='' THEN v_stage_note:=NULL; END IF;
   END IF;
   v_intent:=jsonb_set(v_intent,'{details,closed_note}',to_jsonb(v_stage_note),false);
  END IF;
 ELSE
  v_intent:=p_req;
 END IF;
 -- Pre-lock validation is limited to value shapes; authorization already verified.
 -- All mutation paths acquire transaction-scoped owner lock before any row lock.
 PERFORM progression_internal.lock_owner(v_actor);
 SELECT * INTO v_prior FROM system_internal.ao_commands c
   WHERE c.user_id=v_actor AND c.command_id=p_cmd;
 IF FOUND THEN
  IF v_prior.subject_kind<>p_kind OR v_prior.command_type<>p_op OR
    (CASE p_kind WHEN 'opportunity' THEN v_prior.opportunity_id ELSE v_prior.activity_id END)<>p_id OR
    v_prior.canonical_request IS DISTINCT FROM jsonb_build_object(
      'operation',p_op,'subject_kind',p_kind,'subject_id',p_id,
      'expected_revision',p_rev::text,'request',v_intent) THEN
    RAISE EXCEPTION 'Conflicting AO command identity reuse' USING ERRCODE='23505'; END IF;
  RETURN v_prior.result || jsonb_build_object('replay',true);
 END IF;
 v_now:=clock_timestamp();
 IF p_op='create_opportunity_v1' THEN
  -- Retained client UUID, no automatic state transitions. DB CHECKs verify fields.
  INSERT INTO public.opportunities(id,user_id,title,category,organization,description,eligibility_notes,benefits_notes,tracking_stage,selection_outcome,entry_mode,selection_applicability,closed_reason,closed_note,application_deadline,program_start,program_end,applied_at,decision_at,priority,notes,resource_links)
   VALUES (p_id,v_actor,v_fields->>'title',v_fields->>'category',v_fields->>'organization',v_fields->>'description',v_fields->>'eligibility_notes',v_fields->>'benefits_notes',v_fields->>'tracking_stage',v_fields->>'selection_outcome',v_fields->>'entry_mode',v_fields->>'selection_applicability',v_fields->>'closed_reason',v_fields->>'closed_note',NULLIF(v_fields->'application_deadline','null'::jsonb),NULLIF(v_fields->'program_start','null'::jsonb),NULLIF(v_fields->'program_end','null'::jsonb),NULLIF(v_fields->'applied_at','null'::jsonb),NULLIF(v_fields->'decision_at','null'::jsonb),v_fields->>'priority',v_fields->>'notes',v_fields->'resource_links');
  v_before:=0;v_after:=1;v_changed:=true;
 ELSIF p_op='create_activity_v1' THEN
  -- Explicit intent creates a single terminal or participation state, no fake events.
  INSERT INTO public.activities(id,user_id,title,category,organization,role,description,status,planned_start,planned_end,actual_start,actual_end,confirmation_note,contributions,outcomes,lessons,notes,resource_links,participation_confirmed_at)
   VALUES (p_id,v_actor,v_fields->>'title',v_fields->>'category',v_fields->>'organization',v_fields->>'role',v_fields->>'description',v_fields->>'status',NULLIF(v_fields->'planned_start','null'::jsonb),NULLIF(v_fields->'planned_end','null'::jsonb),NULLIF(v_fields->'actual_start','null'::jsonb),NULLIF(v_fields->'actual_end','null'::jsonb),v_fields->>'confirmation_note',v_fields->>'contributions',v_fields->>'outcomes',v_fields->>'lessons',v_fields->>'notes',v_fields->'resource_links',CASE WHEN v_fields->>'intent'='confirmed_plan' THEN v_now ELSE NULL END);
  v_before:=0;v_after:=1;v_changed:=true;
 ELSE
  IF p_kind='opportunity' THEN
    SELECT * INTO v_opportunity FROM public.opportunities o WHERE o.id=p_id AND o.user_id=v_actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AO subject not found' USING ERRCODE='P0002'; END IF;
    v_data:=to_jsonb(v_opportunity)-'user_id';v_before:=v_opportunity.revision;
    IF v_opportunity.archived_at IS NOT NULL AND p_op<>'set_opportunity_archived_v1' THEN
      RAISE EXCEPTION 'AO subject archived' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO v_activity FROM public.activities a WHERE a.id=p_id AND a.user_id=v_actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AO subject not found' USING ERRCODE='P0002'; END IF;
    v_data:=to_jsonb(v_activity)-'user_id';v_before:=v_activity.revision;
    IF v_activity.archived_at IS NOT NULL AND p_op<>'set_activity_archived_v1' THEN
      RAISE EXCEPTION 'AO subject archived' USING ERRCODE='23514'; END IF;
  END IF;
  IF v_before<>p_rev THEN RAISE EXCEPTION 'Stale AO revision' USING ERRCODE='23514'; END IF;
  IF p_op IN ('update_opportunity_v1','update_activity_v1') THEN
    SELECT EXISTS(SELECT 1 FROM jsonb_each(v_fields) kv WHERE v_data->kv.key IS DISTINCT FROM kv.value)
      INTO v_changed;
    IF v_changed THEN
      IF p_kind='opportunity' THEN
       UPDATE public.opportunities SET
  title=CASE WHEN v_fields ? 'title' THEN v_fields->>'title' ELSE title END,
  category=CASE WHEN v_fields ? 'category' THEN v_fields->>'category' ELSE category END,
  organization=CASE WHEN v_fields ? 'organization' THEN v_fields->>'organization' ELSE organization END,
  description=CASE WHEN v_fields ? 'description' THEN v_fields->>'description' ELSE description END,
  eligibility_notes=CASE WHEN v_fields ? 'eligibility_notes' THEN v_fields->>'eligibility_notes' ELSE eligibility_notes END,
  benefits_notes=CASE WHEN v_fields ? 'benefits_notes' THEN v_fields->>'benefits_notes' ELSE benefits_notes END,
  entry_mode=CASE WHEN v_fields ? 'entry_mode' THEN v_fields->>'entry_mode' ELSE entry_mode END,
  application_deadline=CASE WHEN v_fields ? 'application_deadline' THEN NULLIF(v_fields->'application_deadline','null'::jsonb) ELSE application_deadline END,
  program_start=CASE WHEN v_fields ? 'program_start' THEN NULLIF(v_fields->'program_start','null'::jsonb) ELSE program_start END,
  program_end=CASE WHEN v_fields ? 'program_end' THEN NULLIF(v_fields->'program_end','null'::jsonb) ELSE program_end END,
  applied_at=CASE WHEN v_fields ? 'applied_at' THEN NULLIF(v_fields->'applied_at','null'::jsonb) ELSE applied_at END,
  priority=CASE WHEN v_fields ? 'priority' THEN v_fields->>'priority' ELSE priority END,
  notes=CASE WHEN v_fields ? 'notes' THEN v_fields->>'notes' ELSE notes END,
  resource_links=CASE WHEN v_fields ? 'resource_links' THEN v_fields->'resource_links' ELSE resource_links END,
  revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor;
      ELSE
       UPDATE public.activities SET
  title=CASE WHEN v_fields ? 'title' THEN v_fields->>'title' ELSE title END,
  category=CASE WHEN v_fields ? 'category' THEN v_fields->>'category' ELSE category END,
  organization=CASE WHEN v_fields ? 'organization' THEN v_fields->>'organization' ELSE organization END,
  role=CASE WHEN v_fields ? 'role' THEN v_fields->>'role' ELSE role END,
  description=CASE WHEN v_fields ? 'description' THEN v_fields->>'description' ELSE description END,
  planned_start=CASE WHEN v_fields ? 'planned_start' THEN NULLIF(v_fields->'planned_start','null'::jsonb) ELSE planned_start END,
  planned_end=CASE WHEN v_fields ? 'planned_end' THEN NULLIF(v_fields->'planned_end','null'::jsonb) ELSE planned_end END,
  actual_start=CASE WHEN v_fields ? 'actual_start' THEN NULLIF(v_fields->'actual_start','null'::jsonb) ELSE actual_start END,
  actual_end=CASE WHEN v_fields ? 'actual_end' THEN NULLIF(v_fields->'actual_end','null'::jsonb) ELSE actual_end END,
  confirmation_note=CASE WHEN v_fields ? 'confirmation_note' THEN v_fields->>'confirmation_note' ELSE confirmation_note END,
  contributions=CASE WHEN v_fields ? 'contributions' THEN v_fields->>'contributions' ELSE contributions END,
  outcomes=CASE WHEN v_fields ? 'outcomes' THEN v_fields->>'outcomes' ELSE outcomes END,
  lessons=CASE WHEN v_fields ? 'lessons' THEN v_fields->>'lessons' ELSE lessons END,
  notes=CASE WHEN v_fields ? 'notes' THEN v_fields->>'notes' ELSE notes END,
  resource_links=CASE WHEN v_fields ? 'resource_links' THEN v_fields->'resource_links' ELSE resource_links END,
  revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor;
      END IF;
    END IF;
  ELSIF p_op='set_opportunity_stage_v1' THEN
   -- request: {stage,kind,details}; correction and reopen are explicit intent.
   IF (SELECT count(*) FROM jsonb_object_keys(p_req))<>3 OR
      NOT(p_req ?& ARRAY['stage','kind','details']) OR
      jsonb_typeof(p_req->'stage')<>'string' OR
      jsonb_typeof(p_req->'kind')<>'string' OR
      p_req->>'stage' NOT IN ('saved','preparing','submitted','closed') OR
      p_req->>'kind' NOT IN ('advance','reopen','correction') OR
      jsonb_typeof(p_req->'details')<>'object' THEN
     RAISE EXCEPTION 'Invalid opportunity stage intent' USING ERRCODE='22023'; END IF;
   v_stage:=p_req->>'stage';v_rule:=p_req->>'kind'; v_detail:=v_intent->'details';
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_detail) k WHERE k NOT IN ('closed_reason','closed_note')) THEN
     RAISE EXCEPTION 'Invalid closed details' USING ERRCODE='22023'; END IF;
   IF v_rule='reopen' AND (v_opportunity.tracking_stage<>'closed' OR v_stage='closed') OR
      v_rule='advance' AND (v_opportunity.tracking_stage='closed' OR
        array_position(ARRAY['saved','preparing','submitted','closed'],v_stage) <=
        array_position(ARRAY['saved','preparing','submitted','closed'],v_opportunity.tracking_stage)) OR
      false THEN
     RAISE EXCEPTION 'Invalid stage transition' USING ERRCODE='23514'; END IF;
   IF v_stage<>'closed' AND v_detail<>'{}'::jsonb THEN RAISE EXCEPTION 'Closed details only for Closed stage' USING ERRCODE='22023'; END IF;
   IF v_stage='closed' AND v_detail ? 'closed_reason' AND
       (jsonb_typeof(v_detail->'closed_reason') NOT IN ('string','null') OR
        (v_detail->>'closed_reason' IS NOT NULL AND v_detail->>'closed_reason' NOT IN
         ('not_interested','withdrawn','declined_offer','deadline_missed','program_cancelled','process_finished','other'))) THEN
       RAISE EXCEPTION 'Invalid closed reason' USING ERRCODE='22023'; END IF;
   -- Normalize lifecycle details with the same multiline contract as metadata
   -- creation: CRLF/CR -> LF and boundary-whitespace-only -> SQL NULL.
   v_stage_note:=NULL;
   IF v_detail ? 'closed_note' THEN
     IF jsonb_typeof(v_detail->'closed_note') NOT IN ('string','null') THEN
       RAISE EXCEPTION 'Invalid closed note' USING ERRCODE='22023'; END IF;
     v_stage_note:=v_detail->>'closed_note';
     IF v_stage_note IS NOT NULL THEN
       v_stage_note:=replace(replace(v_stage_note,E'\r\n',E'\n'),E'\r',E'\n');
       IF system_internal.ao_trim_v1(v_stage_note)='' THEN v_stage_note:=NULL; END IF;
     END IF;
     IF NOT system_internal.ao_text_valid_v1(v_stage_note,2000,false,true) THEN
       RAISE EXCEPTION 'Invalid closed note' USING ERRCODE='22023'; END IF;
   END IF;
   v_changed:=v_opportunity.tracking_stage IS DISTINCT FROM v_stage OR
     (CASE WHEN v_stage='closed' THEN v_detail->>'closed_reason' ELSE NULL END) IS DISTINCT FROM v_opportunity.closed_reason OR
     (CASE WHEN v_stage='closed' THEN v_stage_note ELSE NULL END) IS DISTINCT FROM v_opportunity.closed_note;
   IF v_changed THEN
    UPDATE public.opportunities SET tracking_stage=v_stage,
      closed_reason=CASE WHEN v_stage='closed' THEN v_detail->>'closed_reason' ELSE NULL END,
      closed_note=CASE WHEN v_stage='closed' THEN v_stage_note ELSE NULL END,
      revision=revision+1, updated_at=v_now WHERE id=p_id AND user_id=v_actor;
   END IF;
  ELSIF p_op='record_opportunity_outcome_v1' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_req))<>3 OR
     NOT(p_req ?& ARRAY['outcome','kind','details']) OR
     jsonb_typeof(p_req->'outcome')<>'string' OR jsonb_typeof(p_req->'kind')<>'string' OR
     p_req->>'outcome' NOT IN ('unknown','pending','shortlisted','waitlisted','accepted','rejected') OR
     p_req->>'kind' NOT IN ('new_decision','correction') OR
     jsonb_typeof(p_req->'details')<>'object' THEN
     RAISE EXCEPTION 'Invalid opportunity outcome intent' USING ERRCODE='22023'; END IF;
   v_detail:=p_req->'details';
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_detail) k WHERE k NOT IN ('selection_applicability','decision_at')) THEN
     RAISE EXCEPTION 'Invalid outcome detail keys' USING ERRCODE='22023'; END IF;
   IF v_detail ? 'selection_applicability' AND
       v_detail->>'selection_applicability' NOT IN ('unknown','applicable','not_applicable') THEN
     RAISE EXCEPTION 'Invalid selection applicability' USING ERRCODE='22023'; END IF;
   IF v_detail ? 'decision_at' AND NOT system_internal.ao_partial_valid_v1(NULLIF(v_detail->'decision_at','null'::jsonb)) THEN
      RAISE EXCEPTION 'Invalid decision date' USING ERRCODE='22023'; END IF;
   v_changed:= v_opportunity.selection_outcome IS DISTINCT FROM p_req->>'outcome' OR
      v_opportunity.selection_applicability IS DISTINCT FROM COALESCE(v_detail->>'selection_applicability',v_opportunity.selection_applicability) OR
      (v_detail ? 'decision_at' AND v_opportunity.decision_at IS DISTINCT FROM NULLIF(v_detail->'decision_at','null'::jsonb));
   IF v_changed THEN
     UPDATE public.opportunities SET selection_outcome=p_req->>'outcome',
       selection_applicability=COALESCE(v_detail->>'selection_applicability',selection_applicability),
       decision_at=CASE WHEN v_detail ? 'decision_at' THEN NULLIF(v_detail->'decision_at','null'::jsonb) ELSE decision_at END,
       revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor;
   END IF;
  ELSIF p_op IN ('set_opportunity_archived_v1','set_activity_archived_v1') THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_req))<>1 OR NOT p_req?'archived' OR
       jsonb_typeof(p_req->'archived')<>'boolean' THEN
     RAISE EXCEPTION 'Invalid archive request' USING ERRCODE='22023'; END IF;
   v_changed:=(v_data->>'archived_at' IS NOT NULL) IS DISTINCT FROM (p_req->>'archived')::boolean;
   IF v_changed THEN
    IF p_kind='opportunity' THEN
      UPDATE public.opportunities SET archived_at=CASE WHEN (p_req->>'archived')::boolean THEN v_now ELSE NULL END,
        revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor;
    ELSE
      UPDATE public.activities SET archived_at=CASE WHEN (p_req->>'archived')::boolean THEN v_now ELSE NULL END,
        revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor;
    END IF;
   END IF;
  ELSIF p_op='transition_activity_v1' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_req))<>2 OR
      NOT(p_req ?& ARRAY['action','details']) OR jsonb_typeof(p_req->'details')<>'object' OR
      p_req->'details'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid activity transition details' USING ERRCODE='22023'; END IF;
   v_status:=CASE v_activity.status ||':'|| p_req->>'action'
      WHEN 'upcoming:start' THEN 'ongoing' WHEN 'upcoming:cancel_before_start' THEN 'cancelled_before_start'
      WHEN 'ongoing:pause' THEN 'paused' WHEN 'paused:resume' THEN 'ongoing'
      WHEN 'ongoing:complete' THEN 'completed' WHEN 'paused:complete' THEN 'completed'
      WHEN 'ongoing:end_early' THEN 'ended_early' WHEN 'paused:end_early' THEN 'ended_early'
      ELSE NULL END;
   IF v_status IS NULL THEN RAISE EXCEPTION 'Invalid activity transition' USING ERRCODE='23514'; END IF;
   v_changed:=true;
   UPDATE public.activities SET status=v_status,revision=revision+1,updated_at=v_now
     WHERE id=p_id AND user_id=v_actor;
  ELSIF p_op='correct_activity_status_v1' THEN
   IF NOT(p_req ?& ARRAY['target_status','correction']) OR
     (SELECT count(*) FROM jsonb_object_keys(p_req))<>2 OR
     p_req->>'target_status' NOT IN ('upcoming','ongoing','paused','completed','ended_early','cancelled_before_start') OR
     jsonb_typeof(p_req->'correction')<>'object' THEN
    RAISE EXCEPTION 'Invalid activity status correction' USING ERRCODE='22023'; END IF;
   v_detail:=p_req->'correction';
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_detail) k WHERE k NOT IN ('reason','actual_start','actual_end')) THEN
    RAISE EXCEPTION 'Invalid status correction details' USING ERRCODE='22023'; END IF;
   IF v_detail ? 'reason' AND
     (jsonb_typeof(v_detail->'reason') NOT IN ('string','null') OR
      NOT system_internal.ao_text_valid_v1(v_detail->>'reason',2000,false,false)) THEN
     RAISE EXCEPTION 'Invalid status correction reason' USING ERRCODE='22023'; END IF;
   IF v_detail ? 'actual_start' AND NOT system_internal.ao_partial_valid_v1(NULLIF(v_detail->'actual_start','null'::jsonb)) OR
      v_detail ? 'actual_end' AND NOT system_internal.ao_partial_valid_v1(NULLIF(v_detail->'actual_end','null'::jsonb)) THEN
     RAISE EXCEPTION 'Invalid corrected actual dates' USING ERRCODE='22023'; END IF;
   v_changed:=v_activity.status IS DISTINCT FROM p_req->>'target_status' OR
      (v_detail ? 'actual_start' AND v_activity.actual_start IS DISTINCT FROM NULLIF(v_detail->'actual_start','null'::jsonb)) OR
      (v_detail ? 'actual_end' AND v_activity.actual_end IS DISTINCT FROM NULLIF(v_detail->'actual_end','null'::jsonb));
   IF v_changed THEN
    UPDATE public.activities SET status=p_req->>'target_status',
      actual_start=CASE WHEN v_detail ? 'actual_start' THEN NULLIF(v_detail->'actual_start','null'::jsonb) ELSE actual_start END,
      actual_end=CASE WHEN v_detail ? 'actual_end' THEN NULLIF(v_detail->'actual_end','null'::jsonb) ELSE actual_end END,
      revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor;
   END IF;
  ELSE
   -- All link operations are delegated below to a *closed allowlist* helper.
   v_changed:=system_internal.ao_relationship_command_v1(p_op,v_actor,p_kind,p_id,p_req,v_now);
   IF v_changed THEN
    IF p_kind='opportunity' THEN UPDATE public.opportunities SET revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor;
    ELSE UPDATE public.activities SET revision=revision+1,updated_at=v_now WHERE id=p_id AND user_id=v_actor; END IF;
   END IF;
  END IF;
  v_after:=v_before+CASE WHEN v_changed THEN 1 ELSE 0 END;
 END IF;
 IF v_after IS NULL OR v_after<1 OR v_after>9223372036854775807::bigint THEN
  RAISE EXCEPTION 'AO revision overflow' USING ERRCODE='22003'; END IF;
 v_receipt:=system_internal.ao_receipt_v1(p_op,p_cmd,p_kind,p_id,v_before,v_after,v_changed);
 -- Deferrable history->command FKs permit accepted history insert after root write
 -- and before command receipt, committing atomically in the same transaction.
 IF v_changed THEN
   IF p_kind='opportunity' THEN
    INSERT INTO public.opportunity_history(user_id,opportunity_id,command_id,event_seq,event_type,before_value,after_value)
      VALUES (v_actor,p_id,p_cmd,1,
         CASE WHEN p_op IN ('set_opportunity_stage_v1','record_opportunity_outcome_v1') THEN p_op||':'||(p_req->>'kind') ELSE p_op END,
         CASE WHEN p_op IN ('attach_ao_context_v1','detach_ao_context_v1') THEN jsonb_build_object('root',v_data,'link_intent',p_req) ELSE v_data END,
         CASE WHEN p_op IN ('attach_ao_context_v1','detach_ao_context_v1') THEN jsonb_build_object('root',
           (SELECT to_jsonb(o)-'user_id' FROM public.opportunities o WHERE id=p_id AND user_id=v_actor), 'link_intent',p_req)
         ELSE (SELECT to_jsonb(o)-'user_id' FROM public.opportunities o WHERE id=p_id AND user_id=v_actor) END);
   ELSE
    -- R-06: retain the allowlisted correction reason in immutable Activity history.
    -- A no-op correction retains its receipt only and does not invent a history event.
    INSERT INTO public.activity_history(user_id,activity_id,command_id,event_seq,event_type,before_value,after_value,reason)
      VALUES (v_actor,p_id,p_cmd,1,p_op,
         CASE WHEN p_op IN ('set_activity_source_v1','attach_ao_context_v1','detach_ao_context_v1')
           THEN jsonb_build_object('root',v_data,'link_intent',p_req) ELSE v_data END,
         CASE WHEN p_op IN ('set_activity_source_v1','attach_ao_context_v1','detach_ao_context_v1')
           THEN jsonb_build_object('root',(SELECT to_jsonb(a)-'user_id' FROM public.activities a WHERE id=p_id AND user_id=v_actor),'link_intent',p_req)
         ELSE (SELECT to_jsonb(a)-'user_id' FROM public.activities a WHERE id=p_id AND user_id=v_actor) END,
         CASE WHEN p_op='correct_activity_status_v1' THEN v_detail->>'reason' ELSE NULL END);
   END IF;
 END IF;
 INSERT INTO system_internal.ao_commands(user_id,command_id,command_type,subject_kind,opportunity_id,activity_id,
      canonical_request,result)
 VALUES (v_actor,p_cmd,p_op,p_kind,CASE WHEN p_kind='opportunity' THEN p_id ELSE NULL END,
         CASE WHEN p_kind='activity' THEN p_id ELSE NULL END,
         jsonb_build_object('operation',p_op,'subject_kind',p_kind,'subject_id',p_id,
           'expected_revision',p_rev::text,'request',v_intent),v_receipt);
 RETURN v_receipt;
END;
$fn$;

-- Owner-guarded target eligibility. Caller has already acquired owner lock.
CREATE FUNCTION system_internal.ao_require_context_target_v1(p_kind text,p_id uuid,p_owner uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE g record; q record; occ record;
BEGIN
 IF p_kind='goal' THEN
  SELECT id,archived_at INTO g FROM public.goals
    WHERE id=p_id AND user_id=p_owner;
  IF NOT FOUND OR g.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'AO contextual target not eligible' USING ERRCODE='23514'; END IF;
 ELSIF p_kind='quest' THEN
  SELECT id,archived_at,deleted_at,recurrence_mode,direct_goal_id,project_id INTO q
    FROM public.quests WHERE id=p_id AND user_id=p_owner;
  IF NOT FOUND OR q.deleted_at IS NOT NULL OR q.archived_at IS NOT NULL OR
    q.recurrence_mode<>'one_off' OR q.direct_goal_id IS NOT NULL OR q.project_id IS NOT NULL OR
    EXISTS(SELECT 1 FROM public.quest_recurrence_rules r WHERE r.quest_id=p_id AND r.user_id=p_owner) OR
    (SELECT count(*) FROM public.quest_occurrences o WHERE o.quest_id=p_id AND o.user_id=p_owner)<>1 THEN
   RAISE EXCEPTION 'AO contextual target not eligible' USING ERRCODE='23514'; END IF;
  SELECT recurrence_rule_id,recurrence_revision,source_slot_date,source_timezone,
    direct_goal_id_snapshot,project_id_snapshot INTO occ
   FROM public.quest_occurrences WHERE quest_id=p_id AND user_id=p_owner;
  IF occ.recurrence_rule_id IS NOT NULL OR occ.recurrence_revision IS NOT NULL OR
    occ.source_slot_date IS NOT NULL OR occ.source_timezone IS NOT NULL OR
    occ.direct_goal_id_snapshot IS NOT NULL OR occ.project_id_snapshot IS NOT NULL THEN
   RAISE EXCEPTION 'AO contextual target not eligible' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Invalid contextual target kind' USING ERRCODE='22023'; END IF;
END;
$fn$;

CREATE FUNCTION system_internal.ao_relationship_command_v1(p_op text,p_actor uuid,
 p_kind text,p_source uuid,p_req jsonb,p_now timestamptz)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_target uuid; v_link uuid; v_expected uuid; v_old_target uuid; v_old_link uuid;
 v_detached timestamptz; v_current uuid; v_kind text; v_table text;
BEGIN
 IF p_op='set_activity_source_v1' THEN
  IF p_kind<>'activity' OR NOT(p_req ?& ARRAY['expected_source_link_id','desired_opportunity_id','note']) OR
    (SELECT count(*) FROM jsonb_object_keys(p_req))<>3 OR
    jsonb_typeof(p_req->'expected_source_link_id') NOT IN ('string','null') OR
    jsonb_typeof(p_req->'desired_opportunity_id') NOT IN ('string','null') OR
    jsonb_typeof(p_req->'note') NOT IN ('string','null') OR
    NOT system_internal.ao_text_valid_v1(p_req->>'note',2000,false,false) THEN
    RAISE EXCEPTION 'Invalid Activity source intent' USING ERRCODE='22023'; END IF;
  v_expected:=(p_req->>'expected_source_link_id')::uuid;
  v_target:=(p_req->>'desired_opportunity_id')::uuid;
  SELECT l.id,l.opportunity_id INTO v_old_link,v_old_target
   FROM public.activity_source_links l WHERE l.activity_id=p_source AND l.user_id=p_actor
       AND l.detached_at IS NULL;
  IF v_old_link IS DISTINCT FROM v_expected THEN
   RAISE EXCEPTION 'Activity source changed' USING ERRCODE='23514'; END IF;
  IF v_old_target IS NOT DISTINCT FROM v_target THEN RETURN false; END IF;
  IF v_target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.opportunities o
   WHERE o.id=v_target AND o.user_id=p_actor AND o.archived_at IS NULL) THEN
   RAISE EXCEPTION 'AO source Opportunity unavailable' USING ERRCODE='23514'; END IF;
  IF v_old_link IS NOT NULL THEN UPDATE public.activity_source_links
    SET detached_at=p_now WHERE id=v_old_link AND user_id=p_actor; END IF;
  IF v_target IS NOT NULL THEN INSERT INTO public.activity_source_links(user_id,activity_id,opportunity_id)
   VALUES(p_actor,p_source,v_target); END IF;
  RETURN true;
 END IF;
 IF p_op='attach_ao_context_v1' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_req))<>2 OR
    NOT(p_req ?& ARRAY['target_kind','target_id']) OR
    jsonb_typeof(p_req->'target_kind')<>'string' OR
    jsonb_typeof(p_req->'target_id')<>'string' OR
    p_req->>'target_kind' NOT IN ('goal','quest') THEN
    RAISE EXCEPTION 'Invalid AO context attach intent' USING ERRCODE='22023'; END IF;
  v_kind:=p_req->>'target_kind';v_target:=(p_req->>'target_id')::uuid;
  PERFORM system_internal.ao_require_context_target_v1(v_kind,v_target,p_actor);
 ELSE
  IF p_op<>'detach_ao_context_v1' OR (SELECT count(*) FROM jsonb_object_keys(p_req))<>2 OR
     NOT(p_req ?& ARRAY['target_kind','link_id']) OR
     jsonb_typeof(p_req->'target_kind')<>'string' OR
     jsonb_typeof(p_req->'link_id')<>'string' OR
     p_req->>'target_kind' NOT IN ('goal','quest') THEN
    RAISE EXCEPTION 'Invalid AO context detach intent' USING ERRCODE='22023'; END IF;
  v_kind:=p_req->>'target_kind';v_link:=(p_req->>'link_id')::uuid;
 END IF;
 IF p_kind='opportunity' AND v_kind='goal' THEN
  IF p_op='attach_ao_context_v1' THEN
    SELECT id INTO v_current FROM public.opportunity_goal_links WHERE user_id=p_actor AND opportunity_id=p_source
      AND goal_id=v_target AND detached_at IS NULL;
    IF FOUND THEN RETURN false; END IF;
    INSERT INTO public.opportunity_goal_links(user_id,opportunity_id,goal_id) VALUES(p_actor,p_source,v_target);
    RETURN true;
  ELSE
    SELECT detached_at INTO v_detached FROM public.opportunity_goal_links WHERE id=v_link AND user_id=p_actor
      AND opportunity_id=p_source;
    IF NOT FOUND THEN RAISE EXCEPTION 'AO link unavailable' USING ERRCODE='P0002'; END IF;
    IF v_detached IS NOT NULL THEN RETURN false; END IF;
    UPDATE public.opportunity_goal_links SET detached_at=p_now WHERE id=v_link AND user_id=p_actor;
    RETURN true;
  END IF;
 END IF;
 IF p_kind='opportunity' AND v_kind='quest' THEN
  IF p_op='attach_ao_context_v1' THEN
    SELECT id INTO v_current FROM public.opportunity_quest_links WHERE user_id=p_actor AND opportunity_id=p_source
      AND quest_id=v_target AND detached_at IS NULL;
    IF FOUND THEN RETURN false; END IF;
    INSERT INTO public.opportunity_quest_links(user_id,opportunity_id,quest_id) VALUES(p_actor,p_source,v_target);
    RETURN true;
  ELSE
    SELECT detached_at INTO v_detached FROM public.opportunity_quest_links WHERE id=v_link AND user_id=p_actor
      AND opportunity_id=p_source;
    IF NOT FOUND THEN RAISE EXCEPTION 'AO link unavailable' USING ERRCODE='P0002'; END IF;
    IF v_detached IS NOT NULL THEN RETURN false; END IF;
    UPDATE public.opportunity_quest_links SET detached_at=p_now WHERE id=v_link AND user_id=p_actor;
    RETURN true;
  END IF;
 END IF;
 IF p_kind='activity' AND v_kind='goal' THEN
  IF p_op='attach_ao_context_v1' THEN
    SELECT id INTO v_current FROM public.activity_goal_links WHERE user_id=p_actor AND activity_id=p_source
      AND goal_id=v_target AND detached_at IS NULL;
    IF FOUND THEN RETURN false; END IF;
    INSERT INTO public.activity_goal_links(user_id,activity_id,goal_id) VALUES(p_actor,p_source,v_target);
    RETURN true;
  ELSE
    SELECT detached_at INTO v_detached FROM public.activity_goal_links WHERE id=v_link AND user_id=p_actor
      AND activity_id=p_source;
    IF NOT FOUND THEN RAISE EXCEPTION 'AO link unavailable' USING ERRCODE='P0002'; END IF;
    IF v_detached IS NOT NULL THEN RETURN false; END IF;
    UPDATE public.activity_goal_links SET detached_at=p_now WHERE id=v_link AND user_id=p_actor;
    RETURN true;
  END IF;
 END IF;
 IF p_kind='activity' AND v_kind='quest' THEN
  IF p_op='attach_ao_context_v1' THEN
    SELECT id INTO v_current FROM public.activity_quest_links WHERE user_id=p_actor AND activity_id=p_source
      AND quest_id=v_target AND detached_at IS NULL;
    IF FOUND THEN RETURN false; END IF;
    INSERT INTO public.activity_quest_links(user_id,activity_id,quest_id) VALUES(p_actor,p_source,v_target);
    RETURN true;
  ELSE
    SELECT detached_at INTO v_detached FROM public.activity_quest_links WHERE id=v_link AND user_id=p_actor
      AND activity_id=p_source;
    IF NOT FOUND THEN RAISE EXCEPTION 'AO link unavailable' USING ERRCODE='P0002'; END IF;
    IF v_detached IS NOT NULL THEN RETURN false; END IF;
    UPDATE public.activity_quest_links SET detached_at=p_now WHERE id=v_link AND user_id=p_actor;
    RETURN true;
  END IF;
 END IF;
 RAISE EXCEPTION 'Invalid AO link category' USING ERRCODE='22023';
END;
$fn$;

-- L1-04 typed, fixed public entry points. All run under the isolated AO executor.
CREATE FUNCTION public.create_opportunity_v1(p_command_id uuid,p_opportunity_id uuid,p_fields jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('create_opportunity_v1',p_command_id,'opportunity',p_opportunity_id,NULL,p_fields);
$fn$;

CREATE FUNCTION public.update_opportunity_v1(p_command_id uuid,p_opportunity_id uuid,p_expected_revision bigint,p_changes jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('update_opportunity_v1',p_command_id,'opportunity',p_opportunity_id,p_expected_revision,p_changes);
$fn$;

CREATE FUNCTION public.set_opportunity_stage_v1(p_command_id uuid,p_opportunity_id uuid,p_expected_revision bigint,p_stage text,p_kind text,p_details jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('set_opportunity_stage_v1',p_command_id,'opportunity',p_opportunity_id,p_expected_revision,jsonb_build_object('stage',p_stage,'kind',p_kind,'details',p_details));
$fn$;

CREATE FUNCTION public.record_opportunity_outcome_v1(p_command_id uuid,p_opportunity_id uuid,p_expected_revision bigint,p_outcome text,p_kind text,p_details jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('record_opportunity_outcome_v1',p_command_id,'opportunity',p_opportunity_id,p_expected_revision,jsonb_build_object('outcome',p_outcome,'kind',p_kind,'details',p_details));
$fn$;

CREATE FUNCTION public.set_opportunity_archived_v1(p_command_id uuid,p_opportunity_id uuid,p_expected_revision bigint,p_archived boolean) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('set_opportunity_archived_v1',p_command_id,'opportunity',p_opportunity_id,p_expected_revision,jsonb_build_object('archived',p_archived));
$fn$;

CREATE FUNCTION public.create_activity_v1(p_command_id uuid,p_activity_id uuid,p_fields jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('create_activity_v1',p_command_id,'activity',p_activity_id,NULL,p_fields);
$fn$;

CREATE FUNCTION public.update_activity_v1(p_command_id uuid,p_activity_id uuid,p_expected_revision bigint,p_changes jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('update_activity_v1',p_command_id,'activity',p_activity_id,p_expected_revision,p_changes);
$fn$;

CREATE FUNCTION public.transition_activity_v1(p_command_id uuid,p_activity_id uuid,p_expected_revision bigint,p_action text,p_details jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('transition_activity_v1',p_command_id,'activity',p_activity_id,p_expected_revision,jsonb_build_object('action',p_action,'details',p_details));
$fn$;

CREATE FUNCTION public.correct_activity_status_v1(p_command_id uuid,p_activity_id uuid,p_expected_revision bigint,p_target_status text,p_correction jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('correct_activity_status_v1',p_command_id,'activity',p_activity_id,p_expected_revision,jsonb_build_object('target_status',p_target_status,'correction',p_correction));
$fn$;

CREATE FUNCTION public.set_activity_archived_v1(p_command_id uuid,p_activity_id uuid,p_expected_revision bigint,p_archived boolean) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('set_activity_archived_v1',p_command_id,'activity',p_activity_id,p_expected_revision,jsonb_build_object('archived',p_archived));
$fn$;

CREATE FUNCTION public.set_activity_source_v1(p_command_id uuid,p_activity_id uuid,p_expected_revision bigint,p_expected_source_link_id uuid,p_desired_opportunity_id uuid,p_note text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('set_activity_source_v1',p_command_id,'activity',p_activity_id,p_expected_revision,jsonb_build_object('expected_source_link_id',p_expected_source_link_id,'desired_opportunity_id',p_desired_opportunity_id,'note',p_note));
$fn$;

CREATE FUNCTION public.attach_ao_context_v1(p_command_id uuid,p_source_kind text,p_source_id uuid,p_expected_revision bigint,p_target_kind text,p_target_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('attach_ao_context_v1',p_command_id,p_source_kind,p_source_id,p_expected_revision,jsonb_build_object('target_kind',p_target_kind,'target_id',p_target_id));
$fn$;

CREATE FUNCTION public.detach_ao_context_v1(p_command_id uuid,p_source_kind text,p_source_id uuid,p_expected_revision bigint,p_target_kind text,p_link_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_run_v1('detach_ao_context_v1',p_command_id,p_source_kind,p_source_id,p_expected_revision,jsonb_build_object('target_kind',p_target_kind,'link_id',p_link_id));
$fn$;

-- Strict timestamp+uuid keyset cursors. Later L1-05 must prove use of PostgreSQL
-- microsecond timestamps (no JavaScript millisecond truncation).
CREATE FUNCTION system_internal.ao_cursor_v1(p_cursor jsonb,p_date_field text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF p_cursor IS NULL THEN RETURN; END IF;
 IF p_date_field NOT IN ('created_at','recorded_at') THEN
   RAISE EXCEPTION 'Invalid AO cursor field' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_cursor)<>'object' OR NOT(p_cursor ?& ARRAY[p_date_field,'id']) OR
    (SELECT count(*) FROM jsonb_object_keys(p_cursor))<>2 OR
    jsonb_typeof(p_cursor->p_date_field)<>'string' OR
    jsonb_typeof(p_cursor->'id')<>'string' THEN
  RAISE EXCEPTION 'Invalid AO pagination cursor' USING ERRCODE='22023'; END IF;
 -- PostgreSQL timestamptz text parsing is STABLE rather than IMMUTABLE.
 -- Validate shape before conversion; malformed calendar/UUID values normalize to 22023.
 IF (p_cursor->>p_date_field) !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' OR
    (p_cursor->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Invalid AO pagination cursor' USING ERRCODE='22023'; END IF;
 BEGIN
   IF NOT isfinite((p_cursor->>p_date_field)::timestamptz) THEN
     RAISE EXCEPTION 'Invalid AO cursor timestamp' USING ERRCODE='22023'; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'Invalid AO cursor timestamp' USING ERRCODE='22023';
 END;
END;
$fn$;

CREATE FUNCTION system_internal.ao_read_list_v1(p_kind text,p_scope text,p_filters jsonb,
 p_cursor jsonb,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE actor uuid; rows jsonb:='[]'::jsonb; rec record; emitted integer:=0;
 last_cursor jsonb:=NULL; filters jsonb; result_row jsonb; v_has_extra boolean:=false;
BEGIN
 actor:=system_internal.ao_assert_owner_v1();
 IF p_kind IS NULL OR p_scope IS NULL OR p_limit IS NULL OR
     p_kind NOT IN ('activity','opportunity') OR p_scope NOT IN ('active','archived') OR
     p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid AO list options' USING ERRCODE='22023'; END IF;
 filters:=COALESCE(p_filters,'{}'::jsonb);
 IF jsonb_typeof(filters)<>'object' OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(filters) k WHERE k NOT IN ('search','category','tracking_stage','selection_outcome','status','deadline_known','source_opportunity_id')) OR
  (filters ? 'search' AND (jsonb_typeof(filters->'search')<>'string' OR char_length(filters->>'search')>120)) OR
  EXISTS(SELECT 1 FROM jsonb_each(filters) e WHERE e.key<>'deadline_known' AND jsonb_typeof(e.value) NOT IN ('string','null')) OR
  (filters ? 'deadline_known' AND jsonb_typeof(filters->'deadline_known')<>'boolean') OR
  (filters ? 'source_opportunity_id' AND filters->'source_opportunity_id' IS DISTINCT FROM 'null'::jsonb AND
    (jsonb_typeof(filters->'source_opportunity_id') IS DISTINCT FROM 'string' OR
     (filters->>'source_opportunity_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')) THEN
  RAISE EXCEPTION 'Invalid AO list filters' USING ERRCODE='22023'; END IF;
 PERFORM system_internal.ao_cursor_v1(p_cursor,'created_at');
 IF p_kind='opportunity' AND (filters ? 'status' OR filters ? 'source_opportunity_id') OR
    p_kind='activity' AND (filters ? 'tracking_stage' OR filters ? 'selection_outcome' OR filters ? 'deadline_known') THEN
   RAISE EXCEPTION 'Unsupported AO filter' USING ERRCODE='22023'; END IF;
 IF p_kind='opportunity' THEN
  FOR rec IN SELECT o.id,o.revision,o.archived_at,o.created_at,o.updated_at,o.title,
   o.category,o.organization,o.tracking_stage,o.selection_outcome
   FROM public.opportunities o WHERE o.user_id=actor
    AND ((p_scope='active' AND o.archived_at IS NULL) OR (p_scope='archived' AND o.archived_at IS NOT NULL))
    AND (filters->>'category' IS NULL OR o.category=filters->>'category')
    AND (filters->>'tracking_stage' IS NULL OR o.tracking_stage=filters->>'tracking_stage')
    AND (filters->>'selection_outcome' IS NULL OR o.selection_outcome=filters->>'selection_outcome')
    AND (filters->>'deadline_known' IS NULL OR COALESCE(o.application_deadline->>'precision' NOT IN ('unknown'),false)=(filters->>'deadline_known')::boolean)
    AND (filters->>'search' IS NULL OR o.title ILIKE '%'||filters->>'search'||'%' OR o.organization ILIKE '%'||filters->>'search'||'%')
    AND (p_cursor IS NULL OR (o.created_at,o.id)<((p_cursor->>'created_at')::timestamptz,(p_cursor->>'id')::uuid))
   ORDER BY o.created_at DESC,o.id DESC LIMIT p_limit+1 LOOP
    IF emitted=p_limit THEN v_has_extra:=true; EXIT; END IF;
    -- F-01: closed, owner-scoped list DTO; never serialize whole root or Quest rows.
    result_row:=jsonb_build_object('version',1,'subject_kind','opportunity','id',rec.id,
     'title',rec.title,'category',rec.category,'organization',rec.organization,
     'tracking_stage',rec.tracking_stage,'selection_outcome',rec.selection_outcome,
     'revision',rec.revision::text,'archived_at',rec.archived_at,
     'created_at',rec.created_at,'updated_at',rec.updated_at);
    rows:=rows||jsonb_build_array(result_row);
    last_cursor:=jsonb_build_object('created_at',rec.created_at,'id',rec.id);
    emitted:=emitted+1;
  END LOOP;
 ELSE
  FOR rec IN SELECT a.id,a.revision,a.archived_at,a.created_at,a.updated_at,a.title,
   a.category,a.organization,a.status
   FROM public.activities a WHERE a.user_id=actor
    AND ((p_scope='active' AND a.archived_at IS NULL) OR (p_scope='archived' AND a.archived_at IS NOT NULL))
    AND (filters->>'category' IS NULL OR a.category=filters->>'category')
    AND (filters->>'status' IS NULL OR a.status=filters->>'status')
    AND (filters->>'source_opportunity_id' IS NULL OR EXISTS(
       SELECT 1 FROM public.activity_source_links sl WHERE sl.activity_id=a.id
       AND sl.user_id=actor AND sl.opportunity_id=(filters->>'source_opportunity_id')::uuid
       AND sl.detached_at IS NULL))
    AND (filters->>'search' IS NULL OR a.title ILIKE '%'||filters->>'search'||'%' OR a.organization ILIKE '%'||filters->>'search'||'%')
    AND (p_cursor IS NULL OR (a.created_at,a.id)<((p_cursor->>'created_at')::timestamptz,(p_cursor->>'id')::uuid))
   ORDER BY a.created_at DESC,a.id DESC LIMIT p_limit+1 LOOP
    IF emitted=p_limit THEN v_has_extra:=true; EXIT; END IF;
    -- F-01: list cards receive only allowlisted metadata and lifecycle status.
    result_row:=jsonb_build_object('version',1,'subject_kind','activity','id',rec.id,
     'title',rec.title,'category',rec.category,'organization',rec.organization,
     'status',rec.status,
     'revision',rec.revision::text,'archived_at',rec.archived_at,
     'created_at',rec.created_at,'updated_at',rec.updated_at);
    rows:=rows||jsonb_build_array(result_row);
    last_cursor:=jsonb_build_object('created_at',rec.created_at,'id',rec.id);
    emitted:=emitted+1;
  END LOOP;
 END IF;
 -- Only return a cursor when the filtered query itself contained another row.
 RETURN jsonb_build_object('version',1,'items',rows,
   'next_cursor',CASE WHEN v_has_extra THEN last_cursor ELSE NULL END);
END;
$fn$;

CREATE FUNCTION public.get_opportunity_v1(p_opportunity_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_projection_root_v1('opportunity',p_opportunity_id);
$fn$;
CREATE FUNCTION public.get_activity_v1(p_activity_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_projection_root_v1('activity',p_activity_id);
$fn$;
CREATE FUNCTION public.list_opportunities_v1(p_scope text,p_filters jsonb,p_cursor jsonb,p_limit integer DEFAULT 50)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_read_list_v1('opportunity',p_scope,p_filters,p_cursor,p_limit);
$fn$;
CREATE FUNCTION public.list_activities_v1(p_scope text,p_filters jsonb,p_cursor jsonb,p_limit integer DEFAULT 50)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT system_internal.ao_read_list_v1('activity',p_scope,p_filters,p_cursor,p_limit);
$fn$;

CREATE FUNCTION public.list_ao_history_v1(p_subject_kind text,p_subject_id uuid,p_cursor jsonb,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor uuid; events jsonb:='[]'::jsonb; rec record; last_cursor jsonb:=NULL;count_rows integer:=0;
BEGIN
 actor:=system_internal.ao_assert_owner_v1();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR
    system_internal.ao_projection_root_v1(p_subject_kind,p_subject_id) IS NULL THEN
   RAISE EXCEPTION 'AO history subject unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM system_internal.ao_cursor_v1(p_cursor,'recorded_at');
 IF p_subject_kind='opportunity' THEN
  FOR rec IN SELECT h.id,h.recorded_at,to_jsonb(h)-'user_id' AS body FROM public.opportunity_history h
   WHERE h.opportunity_id=p_subject_id AND h.user_id=actor
    AND (p_cursor IS NULL OR (h.recorded_at,h.id)<((p_cursor->>'recorded_at')::timestamptz,(p_cursor->>'id')::uuid))
   ORDER BY h.recorded_at DESC,h.id DESC LIMIT p_limit+1 LOOP
   IF count_rows=p_limit THEN RETURN jsonb_build_object('version',1,'items',events,'next_cursor',last_cursor); END IF;
   events:=events||jsonb_build_array(rec.body);last_cursor:=jsonb_build_object('recorded_at',rec.recorded_at,'id',rec.id);count_rows:=count_rows+1;
  END LOOP;
 ELSE
  FOR rec IN SELECT h.id,h.recorded_at,to_jsonb(h)-'user_id' AS body FROM public.activity_history h
   WHERE h.activity_id=p_subject_id AND h.user_id=actor
    AND (p_cursor IS NULL OR (h.recorded_at,h.id)<((p_cursor->>'recorded_at')::timestamptz,(p_cursor->>'id')::uuid))
   ORDER BY h.recorded_at DESC,h.id DESC LIMIT p_limit+1 LOOP
   IF count_rows=p_limit THEN RETURN jsonb_build_object('version',1,'items',events,'next_cursor',last_cursor); END IF;
   events:=events||jsonb_build_array(rec.body);last_cursor:=jsonb_build_object('recorded_at',rec.recorded_at,'id',rec.id);count_rows:=count_rows+1;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('version',1,'items',events,'next_cursor',NULL);
END;
$fn$;

CREATE FUNCTION public.search_ao_link_candidates_v1(p_source_kind text,p_source_id uuid,
 p_target_kind text,p_query text,p_after_id uuid,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor uuid; rows jsonb:='[]'::jsonb; rec record; n integer:=0;after_id uuid:=NULL;
BEGIN
 actor:=system_internal.ao_assert_owner_v1();
 IF p_source_kind IS NULL OR p_target_kind IS NULL OR
    p_source_kind NOT IN ('opportunity','activity') OR p_target_kind NOT IN ('goal','quest') OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_query IS NULL OR char_length(p_query)>120 OR
    NOT system_internal.ao_text_valid_v1(p_query,120,false,false) THEN
    RAISE EXCEPTION 'Invalid AO candidate search' USING ERRCODE='22023'; END IF;
 IF (p_source_kind='opportunity' AND NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id=p_source_id AND o.user_id=actor AND o.archived_at IS NULL)) OR
    (p_source_kind='activity' AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.id=p_source_id AND a.user_id=actor AND a.archived_at IS NULL)) THEN
    RAISE EXCEPTION 'AO candidate source unavailable' USING ERRCODE='P0002'; END IF;
 IF p_target_kind='goal' THEN
  FOR rec IN SELECT g.id FROM public.goals g
    WHERE g.user_id=actor AND g.archived_at IS NULL AND g.title ILIKE '%'||p_query||'%'
      AND (p_after_id IS NULL OR g.id>p_after_id) ORDER BY g.id LIMIT p_limit+1 LOOP
    IF n=p_limit THEN RETURN jsonb_build_object('version',1,'items',rows,'next_after_id',after_id); END IF;
    rows:=rows||jsonb_build_array(system_internal.ao_goal_safe_label_v1(rec.id));n:=n+1;after_id:=rec.id;
  END LOOP;
 ELSE
  FOR rec IN SELECT q.id FROM public.quests q
    WHERE q.user_id=actor AND q.deleted_at IS NULL AND q.archived_at IS NULL AND q.recurrence_mode='one_off'
      AND q.direct_goal_id IS NULL AND q.project_id IS NULL AND q.title ILIKE '%'||p_query||'%'
      AND NOT EXISTS (SELECT 1 FROM public.quest_recurrence_rules r WHERE r.quest_id=q.id AND r.user_id=actor)
      AND (SELECT count(*) FROM public.quest_occurrences o WHERE o.quest_id=q.id AND o.user_id=actor)=1
      AND EXISTS(SELECT 1 FROM public.quest_occurrences o WHERE o.quest_id=q.id AND o.user_id=actor
       AND o.recurrence_rule_id IS NULL AND o.recurrence_revision IS NULL
       AND o.source_slot_date IS NULL AND o.source_timezone IS NULL
       AND o.direct_goal_id_snapshot IS NULL AND o.project_id_snapshot IS NULL)
      AND (p_after_id IS NULL OR q.id>p_after_id) ORDER BY q.id LIMIT p_limit+1 LOOP
    IF n=p_limit THEN RETURN jsonb_build_object('version',1,'items',rows,'next_after_id',after_id); END IF;
    rows:=rows||jsonb_build_array(system_internal.ao_quest_safe_label_v1(rec.id));n:=n+1;after_id:=rec.id;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('version',1,'items',rows,'next_after_id',NULL);
END;
$fn$;

CREATE FUNCTION public.resolve_ao_command_v1(p_command_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor uuid; prior system_internal.ao_commands;
BEGIN
 actor:=system_internal.ao_assert_owner_v1();
 IF p_command_id IS NULL THEN RAISE EXCEPTION 'Invalid command ID' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM system_internal.ao_commands c WHERE c.user_id=actor AND c.command_id=p_command_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('version',1,'outcome','unknown'); END IF;
 -- The receipt never embeds target Goal/Quest descriptions or their mutable state.
 RETURN jsonb_build_object('version',1,'outcome','recorded','receipt',prior.result||jsonb_build_object('replay',true));
END;
$fn$;


-- Allowlisted linked-entity projection: never pass through Quest/Goal raw rows.
CREATE FUNCTION system_internal.ao_context_projection_v1(p_kind text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE actor uuid; result jsonb:='[]'::jsonb; rec record;
BEGIN
 actor:=system_internal.ao_assert_owner_v1();
 IF p_kind='opportunity' THEN
  FOR rec IN SELECT l.id,l.attached_at,l.goal_id AS target_id
   FROM public.opportunity_goal_links l WHERE l.opportunity_id=p_id AND l.user_id=actor AND l.detached_at IS NULL
   ORDER BY l.attached_at,l.id LOOP
    result:=result||jsonb_build_array(jsonb_build_object('link_id',rec.id,'target_kind','goal',
      'target',system_internal.ao_goal_safe_label_v1(rec.target_id),'attached_at',rec.attached_at));
  END LOOP;
  FOR rec IN SELECT l.id,l.attached_at,l.quest_id AS target_id
   FROM public.opportunity_quest_links l WHERE l.opportunity_id=p_id AND l.user_id=actor AND l.detached_at IS NULL
   ORDER BY l.attached_at,l.id LOOP
    result:=result||jsonb_build_array(jsonb_build_object('link_id',rec.id,'target_kind','quest',
      'target',system_internal.ao_quest_safe_label_v1(rec.target_id),'attached_at',rec.attached_at));
  END LOOP;
 ELSIF p_kind='activity' THEN
  FOR rec IN SELECT l.id,l.attached_at,l.goal_id AS target_id
   FROM public.activity_goal_links l WHERE l.activity_id=p_id AND l.user_id=actor AND l.detached_at IS NULL
   ORDER BY l.attached_at,l.id LOOP
    result:=result||jsonb_build_array(jsonb_build_object('link_id',rec.id,'target_kind','goal',
      'target',system_internal.ao_goal_safe_label_v1(rec.target_id),'attached_at',rec.attached_at));
  END LOOP;
  FOR rec IN SELECT l.id,l.attached_at,l.quest_id AS target_id
   FROM public.activity_quest_links l WHERE l.activity_id=p_id AND l.user_id=actor AND l.detached_at IS NULL
   ORDER BY l.attached_at,l.id LOOP
    result:=result||jsonb_build_array(jsonb_build_object('link_id',rec.id,'target_kind','quest',
      'target',system_internal.ao_quest_safe_label_v1(rec.target_id),'attached_at',rec.attached_at));
  END LOOP;
 ELSE RAISE EXCEPTION 'Invalid AO kind' USING ERRCODE='22023'; END IF;
 RETURN result;
END;
$fn$;

CREATE FUNCTION system_internal.ao_activity_source_projection_v1(p_activity_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('link_id',l.id,'opportunity_id',o.id,'title',o.title,
    'archived',o.archived_at IS NOT NULL)
  FROM public.activity_source_links l JOIN public.opportunities o
  ON o.id=l.opportunity_id AND o.user_id=l.user_id
  WHERE l.activity_id=p_activity_id AND l.user_id=system_internal.ao_assert_owner_v1()
    AND l.detached_at IS NULL;
$fn$;

-- Bounded, owner-scoped Opportunity -> Activity provenance preview.
-- The mixed active+archived preview is NOT a single pageable list: continued
-- browsing uses list_activities_v1 with source_opportunity_id, separately for
-- active and archived scopes, each with its own keyset cursor. Never silently
-- imply that a 50-item preview is the complete set.
CREATE FUNCTION system_internal.ao_derived_activities_v1(p_opportunity_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 WITH candidates AS MATERIALIZED (
   SELECT a.id,a.title,a.status,a.archived_at,a.created_at
   FROM public.activity_source_links l JOIN public.activities a
     ON a.id=l.activity_id AND a.user_id=l.user_id
   WHERE l.opportunity_id=p_opportunity_id AND l.user_id=system_internal.ao_assert_owner_v1()
     AND l.detached_at IS NULL
   ORDER BY a.created_at DESC,a.id DESC LIMIT 51
 ), preview AS (
   SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT 50
 )
 SELECT jsonb_build_object(
   'items',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,
     'status',t.status,'archived',t.archived_at IS NOT NULL)
     ORDER BY t.created_at DESC,t.id DESC),'[]'::jsonb) FROM preview t),
   'has_more',(SELECT count(*)>50 FROM candidates),
   'continuation',CASE WHEN (SELECT count(*)>50 FROM candidates) THEN
     jsonb_build_object('rpc','list_activities_v1',
       'filters',jsonb_build_object('source_opportunity_id',p_opportunity_id),
       'scopes',jsonb_build_array('active','archived')) ELSE NULL END
 );
$fn$;
-- Post-definition ACLs; no default EXECUTE to PUBLIC or service_role.
REVOKE ALL ON FUNCTION system_internal.ao_fields_v1(text,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_fields_v1(text,jsonb,boolean) TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_receipt_v1(text,uuid,text,uuid,bigint,bigint,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_receipt_v1(text,uuid,text,uuid,bigint,bigint,boolean) TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_assert_owner_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_assert_owner_v1() TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_projection_root_v1(text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_projection_root_v1(text,uuid) TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_run_v1(text,uuid,text,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_run_v1(text,uuid,text,uuid,bigint,jsonb) TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_require_context_target_v1(text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_require_context_target_v1(text,uuid,uuid) TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_relationship_command_v1(text,uuid,text,uuid,jsonb,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_relationship_command_v1(text,uuid,text,uuid,jsonb,timestamp with time zone) TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_cursor_v1(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_cursor_v1(jsonb,text) TO ao_command_owner;
REVOKE ALL ON FUNCTION system_internal.ao_read_list_v1(text,text,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_read_list_v1(text,text,jsonb,jsonb,integer) TO ao_command_owner;

REVOKE ALL ON FUNCTION system_internal.ao_context_projection_v1(text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_context_projection_v1(text,uuid) TO ao_command_owner;

REVOKE ALL ON FUNCTION system_internal.ao_activity_source_projection_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_activity_source_projection_v1(uuid) TO ao_command_owner;

REVOKE ALL ON FUNCTION system_internal.ao_derived_activities_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION system_internal.ao_derived_activities_v1(uuid) TO ao_command_owner;

-- Public typed wrappers are owned by isolated AO executor.
GRANT ao_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO ao_command_owner;
ALTER FUNCTION public.create_opportunity_v1(uuid,uuid,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.update_opportunity_v1(uuid,uuid,bigint,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.set_opportunity_stage_v1(uuid,uuid,bigint,text,text,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.record_opportunity_outcome_v1(uuid,uuid,bigint,text,text,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.set_opportunity_archived_v1(uuid,uuid,bigint,boolean) OWNER TO ao_command_owner;
ALTER FUNCTION public.create_activity_v1(uuid,uuid,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.update_activity_v1(uuid,uuid,bigint,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.transition_activity_v1(uuid,uuid,bigint,text,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.correct_activity_status_v1(uuid,uuid,bigint,text,jsonb) OWNER TO ao_command_owner;
ALTER FUNCTION public.set_activity_archived_v1(uuid,uuid,bigint,boolean) OWNER TO ao_command_owner;
ALTER FUNCTION public.set_activity_source_v1(uuid,uuid,bigint,uuid,uuid,text) OWNER TO ao_command_owner;
ALTER FUNCTION public.attach_ao_context_v1(uuid,text,uuid,bigint,text,uuid) OWNER TO ao_command_owner;
ALTER FUNCTION public.detach_ao_context_v1(uuid,text,uuid,bigint,text,uuid) OWNER TO ao_command_owner;
ALTER FUNCTION public.get_opportunity_v1(uuid) OWNER TO ao_command_owner;
ALTER FUNCTION public.list_opportunities_v1(text,jsonb,jsonb,integer) OWNER TO ao_command_owner;
ALTER FUNCTION public.get_activity_v1(uuid) OWNER TO ao_command_owner;
ALTER FUNCTION public.list_activities_v1(text,jsonb,jsonb,integer) OWNER TO ao_command_owner;
ALTER FUNCTION public.list_ao_history_v1(text,uuid,jsonb,integer) OWNER TO ao_command_owner;
ALTER FUNCTION public.search_ao_link_candidates_v1(text,uuid,text,text,uuid,integer) OWNER TO ao_command_owner;
ALTER FUNCTION public.resolve_ao_command_v1(uuid) OWNER TO ao_command_owner;
REVOKE ALL ON FUNCTION public.create_opportunity_v1(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.create_opportunity_v1(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_opportunity_v1(uuid,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.update_opportunity_v1(uuid,uuid,bigint,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_opportunity_stage_v1(uuid,uuid,bigint,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.set_opportunity_stage_v1(uuid,uuid,bigint,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.record_opportunity_outcome_v1(uuid,uuid,bigint,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.record_opportunity_outcome_v1(uuid,uuid,bigint,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_opportunity_archived_v1(uuid,uuid,bigint,boolean) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.set_opportunity_archived_v1(uuid,uuid,bigint,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.create_activity_v1(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.create_activity_v1(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_activity_v1(uuid,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.update_activity_v1(uuid,uuid,bigint,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.transition_activity_v1(uuid,uuid,bigint,text,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.transition_activity_v1(uuid,uuid,bigint,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.correct_activity_status_v1(uuid,uuid,bigint,text,jsonb) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.correct_activity_status_v1(uuid,uuid,bigint,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_activity_archived_v1(uuid,uuid,bigint,boolean) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.set_activity_archived_v1(uuid,uuid,bigint,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.set_activity_source_v1(uuid,uuid,bigint,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.set_activity_source_v1(uuid,uuid,bigint,uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.attach_ao_context_v1(uuid,text,uuid,bigint,text,uuid) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.attach_ao_context_v1(uuid,text,uuid,bigint,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.detach_ao_context_v1(uuid,text,uuid,bigint,text,uuid) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.detach_ao_context_v1(uuid,text,uuid,bigint,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_opportunity_v1(uuid) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.get_opportunity_v1(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.list_opportunities_v1(text,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.list_opportunities_v1(text,jsonb,jsonb,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_activity_v1(uuid) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.get_activity_v1(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.list_activities_v1(text,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.list_activities_v1(text,jsonb,jsonb,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.list_ao_history_v1(text,uuid,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.list_ao_history_v1(text,uuid,jsonb,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.search_ao_link_candidates_v1(text,uuid,text,text,uuid,integer) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.search_ao_link_candidates_v1(text,uuid,text,text,uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_ao_command_v1(uuid) FROM PUBLIC, anon, authenticated, service_role, ao_command_owner;
GRANT EXECUTE ON FUNCTION public.resolve_ao_command_v1(uuid) TO authenticated;
REVOKE CREATE ON SCHEMA public FROM ao_command_owner;
REVOKE ao_command_owner FROM CURRENT_USER;

COMMIT;
