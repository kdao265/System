-- JWT identity compatibility fix (PostgREST JSON claims + legacy scalar sub).
-- Authority: the existing SYSTEM identity boundary in player-exp-database-schema.md
-- section 7 and operator-authorization-v1.md; task scope is this helper only.
-- CREATE OR REPLACE preserves the existing owner, OID, dependent policies and ACL
-- (including the two Level/Reward executor grants). No privilege/RLS changes.
BEGIN;

CREATE OR REPLACE FUNCTION system_internal.request_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    legacy_sub text := nullif(current_setting('request.jwt.claim.sub', true), '');
    claims_text text := nullif(current_setting('request.jwt.claims', true), '');
    claims jsonb;
    modern_sub text;
    legacy_id uuid;
    modern_id uuid;
BEGIN
    -- Parse every supplied format before choosing an identity. A malformed
    -- format must not be ignored merely because the other format is valid.
    BEGIN
        IF claims_text IS NOT NULL THEN
            claims := claims_text::jsonb;
            IF jsonb_typeof(claims) IS DISTINCT FROM 'object' THEN
                RAISE EXCEPTION 'Invalid request identity claims' USING ERRCODE = '22P02';
            END IF;
            IF claims ? 'sub' AND jsonb_typeof(claims -> 'sub') NOT IN ('string', 'null') THEN
                RAISE EXCEPTION 'Invalid request identity claims' USING ERRCODE = '22P02';
            END IF;
            modern_sub := nullif(claims ->> 'sub', '');
        END IF;
        legacy_id := legacy_sub::uuid;
        modern_id := modern_sub::uuid;
    EXCEPTION WHEN data_exception THEN
        -- Preserve legacy invalid-UUID rejection without echoing raw claims,
        -- JSON parser detail or cast input into the response/log message.
        RAISE EXCEPTION 'Invalid request identity claims' USING ERRCODE = '22P02';
    END;

    IF legacy_id IS NOT NULL AND modern_id IS NOT NULL AND legacy_id <> modern_id THEN
        RAISE EXCEPTION 'Conflicting request identities' USING ERRCODE = '42501';
    END IF;

    -- Missing/empty settings, missing sub, JSON-null sub and empty-string sub
    -- contain no identity. Whitespace-only or non-UUID subjects are invalid.
    -- Equal UUIDs are equal identities even if their text representations differ.
    -- Only verified gateway/controlled-command JWT context is trusted here:
    -- no headers, metadata, application GUC, role name or caller-ID fallback.
    -- This helper reads identity; it does not verify JWT signatures itself.
    RETURN coalesce(modern_id, legacy_id);
END;
$function$;

COMMIT;
