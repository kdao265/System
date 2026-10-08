-- ADR-023 / LIB-01..15. L1 only: one books table, RLS-bound commands and reads.
-- No historical objects are replaced; no Quest/EXP permissions or recovery ledger.
BEGIN;

CREATE ROLE library_command_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, system_internal, system_private TO library_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.request_user_id(), system_private.require_owner() TO library_command_owner;
DO $grant_owner_predicate$
-- Managed postgres may hold ADMIN-only membership without inherited privileges.
-- MEMBER alone does not establish the ability to grant the predicate's EXECUTE.
DECLARE borrowed boolean := NOT pg_has_role(current_user, 'system_owner_reader', 'USAGE');
BEGIN
    IF borrowed THEN GRANT system_owner_reader TO CURRENT_USER; END IF;
    GRANT EXECUTE ON FUNCTION system_private.is_owner() TO library_command_owner;
    IF borrowed THEN REVOKE system_owner_reader FROM CURRENT_USER; END IF;
END;
$grant_owner_predicate$;

-- Value-only helpers; the explicit whitespace set matches model.ts exactly.
CREATE FUNCTION system_internal.book_trim_v1(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$function$;
CREATE FUNCTION system_internal.book_note_v1(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT CASE WHEN system_internal.book_trim_v1(value) = '' THEN NULL
        ELSE replace(replace(value, E'\r\n', E'\n'), E'\r', E'\n') END;
$function$;

-- Safe shared subset: ASCII DNS/punycode, canonical IPv4 or bracketed IPv6.
-- Pure syntax only. No DNS, HTTP, optimizer, extension or external provider.
CREATE FUNCTION system_internal.book_cover_valid_v1(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE authority text; parts text[]; host text; dns text; label text; octets text[];
BEGIN
    IF value IS NULL THEN RETURN true; END IF;
    IF char_length(value) > 2048 OR value !~* '^https://' OR
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
            IF label !~ '^(0|[1-9][0-9]{0,2})$' THEN RETURN false; END IF;
            IF label::integer > 255 THEN RETURN false; END IF;
        END LOOP;
    END IF;
    RETURN true;
END;
$function$;

CREATE FUNCTION system_internal.book_fields_v1(value jsonb, creating boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE key text; raw jsonb; normalized text; ceiling integer; result jsonb := '{}'::jsonb;
BEGIN
    IF value IS NULL OR jsonb_typeof(value) <> 'object' OR creating IS NULL THEN
        RAISE EXCEPTION 'Invalid Book fields' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(value) k WHERE k NOT IN
        ('title','author','cover_url','status','summary','content_notes','lessons'))
        OR (NOT creating AND value = '{}'::jsonb) THEN
        RAISE EXCEPTION 'Invalid Book fields' USING ERRCODE = '22023';
    END IF;
    FOREACH key IN ARRAY ARRAY['title','author','cover_url','status','summary','content_notes','lessons'] LOOP
        IF NOT creating AND NOT value ? key THEN CONTINUE; END IF;
        raw := value -> key;
        IF key = 'status' THEN
            IF creating AND NOT value ? key THEN raw := '"want_to_read"'::jsonb; END IF;
            IF jsonb_typeof(raw) IS DISTINCT FROM 'string' OR raw #>> '{}' NOT IN ('want_to_read','reading','finished') THEN
                RAISE EXCEPTION 'Invalid Book status' USING ERRCODE = '22023';
            END IF;
            result := result || jsonb_build_object(key, raw); CONTINUE;
        END IF;
        IF raw IS NOT NULL AND jsonb_typeof(raw) NOT IN ('string','null') THEN
            RAISE EXCEPTION 'Invalid Book text' USING ERRCODE = '22023';
        END IF;
        normalized := raw #>> '{}';
        IF key IN ('summary','content_notes','lessons') THEN
            normalized := system_internal.book_note_v1(normalized);
        ELSE normalized := nullif(system_internal.book_trim_v1(normalized), ''); END IF;
        ceiling := CASE key WHEN 'title' THEN 240 WHEN 'author' THEN 240 WHEN 'cover_url' THEN 2048
            WHEN 'summary' THEN 4000 WHEN 'content_notes' THEN 20000 ELSE 10000 END;
        IF (key = 'title' AND normalized IS NULL) OR char_length(normalized) > ceiling THEN
            RAISE EXCEPTION 'Invalid Book text limit' USING ERRCODE = '22023';
        END IF;
        IF key = 'cover_url' AND NOT system_internal.book_cover_valid_v1(normalized) THEN
            RAISE EXCEPTION 'Invalid Book cover URL' USING ERRCODE = '22023';
        END IF;
        result := result || jsonb_build_object(key, normalized);
    END LOOP;
    RETURN result;
END;
$function$;

CREATE TABLE public.books (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    title text NOT NULL,
    author text,
    cover_url text,
    status text NOT NULL DEFAULT 'want_to_read',
    summary text,
    content_notes text,
    lessons text,
    archived_at timestamptz,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_book_owner UNIQUE (id, user_id),
    CONSTRAINT ck_book_title CHECK (title = system_internal.book_trim_v1(title) AND title <> '' AND char_length(title) <= 240),
    CONSTRAINT ck_book_author CHECK (author IS NULL OR (author = system_internal.book_trim_v1(author) AND author <> '' AND char_length(author) <= 240)),
    CONSTRAINT ck_book_cover CHECK (cover_url IS NULL OR (cover_url = system_internal.book_trim_v1(cover_url) AND system_internal.book_cover_valid_v1(cover_url))),
    CONSTRAINT ck_book_status CHECK (status IN ('want_to_read','reading','finished')),
    CONSTRAINT ck_book_summary CHECK (summary IS NOT DISTINCT FROM system_internal.book_note_v1(summary) AND char_length(summary) <= 4000),
    CONSTRAINT ck_book_notes CHECK (content_notes IS NOT DISTINCT FROM system_internal.book_note_v1(content_notes) AND char_length(content_notes) <= 20000),
    CONSTRAINT ck_book_lessons CHECK (lessons IS NOT DISTINCT FROM system_internal.book_note_v1(lessons) AND char_length(lessons) <= 10000),
    CONSTRAINT ck_book_revision CHECK (revision >= 1),
    CONSTRAINT ck_book_times CHECK (isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at
        AND (archived_at IS NULL OR (isfinite(archived_at) AND archived_at >= created_at AND archived_at <= updated_at)))
);
CREATE INDEX ix_books_active ON public.books(user_id, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX ix_books_archived ON public.books(user_id, created_at DESC, id DESC) WHERE archived_at IS NOT NULL;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.books FROM PUBLIC, anon, authenticated, service_role, library_command_owner,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner, schedule_command_owner, goal_command_owner;
GRANT SELECT ON public.books TO authenticated, library_command_owner;
GRANT INSERT (id,user_id,title,author,cover_url,status,summary,content_notes,lessons) ON public.books TO library_command_owner;
GRANT UPDATE (title,author,cover_url,status,summary,content_notes,lessons,archived_at,revision,updated_at) ON public.books TO library_command_owner;
CREATE POLICY books_owner_select ON public.books FOR SELECT TO authenticated, library_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY books_command_insert ON public.books FOR INSERT TO library_command_owner
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY books_command_update ON public.books FOR UPDATE TO library_command_owner
    USING (user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK (user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY system_single_owner ON public.books AS RESTRICTIVE FOR ALL TO authenticated, library_command_owner
    USING ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_private.is_owner()) AND user_id = (SELECT system_internal.request_user_id()));

CREATE FUNCTION public.create_book_v1(p_book_id uuid, p_fields jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid; fields jsonb; row_value public.books; changed boolean;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN RAISE EXCEPTION 'SYSTEM owner authorization required' USING ERRCODE = '42501'; END IF;
    IF p_book_id IS NULL THEN RAISE EXCEPTION 'Invalid Book identity' USING ERRCODE = '22023'; END IF;
    fields := system_internal.book_fields_v1(p_fields, true);
    INSERT INTO public.books(id,user_id,title,author,cover_url,status,summary,content_notes,lessons)
        VALUES (p_book_id,actor,fields->>'title',fields->>'author',fields->>'cover_url',fields->>'status',
            fields->>'summary',fields->>'content_notes',fields->>'lessons') ON CONFLICT (id) DO NOTHING;
    changed := FOUND;
    SELECT * INTO row_value FROM public.books WHERE id=p_book_id AND user_id=actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Book unavailable' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('version',1,'book_id',row_value.id,'revision',row_value.revision::text,
        'changed',changed,'outcome',CASE WHEN changed THEN 'created' ELSE 'existing' END);
END;
$function$;

CREATE FUNCTION public.update_book_v1(p_book_id uuid, p_expected_revision bigint, p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid; b public.books; fields jsonb; merged jsonb; changed boolean;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN RAISE EXCEPTION 'SYSTEM owner authorization required' USING ERRCODE = '42501'; END IF;
    IF p_book_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
        RAISE EXCEPTION 'Invalid Book mutation' USING ERRCODE = '22023'; END IF;
    SELECT * INTO b FROM public.books WHERE id=p_book_id AND user_id=actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Book unavailable' USING ERRCODE = 'P0002'; END IF;
    IF b.revision <> p_expected_revision THEN RAISE EXCEPTION 'Stale Book revision' USING ERRCODE = '23514'; END IF;
    IF b.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Archived Book cannot be edited' USING ERRCODE = '23514'; END IF;
    fields := system_internal.book_fields_v1(p_changes, false);
    merged := jsonb_build_object('title',b.title,'author',b.author,'cover_url',b.cover_url,'status',b.status,
        'summary',b.summary,'content_notes',b.content_notes,'lessons',b.lessons);
    changed := merged IS DISTINCT FROM merged || fields;
    IF changed THEN
        IF b.revision = 9223372036854775807 THEN RAISE EXCEPTION 'Book revision exhausted' USING ERRCODE = '23514'; END IF;
        merged := merged || fields;
        UPDATE public.books SET title=merged->>'title',author=merged->>'author',cover_url=merged->>'cover_url',status=merged->>'status',
            summary=merged->>'summary',content_notes=merged->>'content_notes',lessons=merged->>'lessons',
            revision=b.revision+1,updated_at=clock_timestamp() WHERE id=b.id AND user_id=actor RETURNING * INTO b;
    END IF;
    RETURN jsonb_build_object('version',1,'book_id',b.id,'revision',b.revision::text,
        'changed',changed,'outcome',CASE WHEN changed THEN 'updated' ELSE 'unchanged' END);
END;
$function$;

CREATE FUNCTION public.set_book_archived_v1(p_book_id uuid, p_expected_revision bigint, p_archived boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid; b public.books; changed boolean; instant timestamptz;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN RAISE EXCEPTION 'SYSTEM owner authorization required' USING ERRCODE = '42501'; END IF;
    IF p_book_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 OR p_archived IS NULL THEN
        RAISE EXCEPTION 'Invalid Book mutation' USING ERRCODE = '22023'; END IF;
    SELECT * INTO b FROM public.books WHERE id=p_book_id AND user_id=actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Book unavailable' USING ERRCODE = 'P0002'; END IF;
    IF b.revision <> p_expected_revision THEN RAISE EXCEPTION 'Stale Book revision' USING ERRCODE = '23514'; END IF;
    changed := (b.archived_at IS NOT NULL) IS DISTINCT FROM p_archived;
    IF changed THEN
        IF b.revision = 9223372036854775807 THEN RAISE EXCEPTION 'Book revision exhausted' USING ERRCODE = '23514'; END IF;
        instant := clock_timestamp();
        UPDATE public.books SET archived_at=CASE WHEN p_archived THEN instant ELSE NULL END,
            revision=b.revision+1,updated_at=instant WHERE id=b.id AND user_id=actor RETURNING * INTO b;
    END IF;
    RETURN jsonb_build_object('version',1,'book_id',b.id,'revision',b.revision::text,
        'changed',changed,'outcome',CASE WHEN changed THEN 'updated' ELSE 'unchanged' END);
END;
$function$;

CREATE FUNCTION public.get_book_v1(p_book_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid; b public.books;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN RAISE EXCEPTION 'SYSTEM owner authorization required' USING ERRCODE = '42501'; END IF;
    IF p_book_id IS NULL THEN RAISE EXCEPTION 'Invalid Book identity' USING ERRCODE = '22023'; END IF;
    SELECT * INTO b FROM public.books WHERE id=p_book_id AND user_id=actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Book unavailable' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('version',1,'book',to_jsonb(b) || jsonb_build_object('revision',b.revision::text));
END;
$function$;

CREATE FUNCTION public.list_books_v1(p_scope text DEFAULT 'active', p_status text DEFAULT NULL,
    p_after_created_at timestamptz DEFAULT NULL, p_after_id uuid DEFAULT NULL, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid; item record; items jsonb := '[]'::jsonb; cursor_value jsonb; next_cursor jsonb; emitted integer := 0;
BEGIN
    PERFORM system_private.require_owner();
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN RAISE EXCEPTION 'SYSTEM owner authorization required' USING ERRCODE = '42501'; END IF;
    IF p_scope IS NULL OR p_scope NOT IN ('active','archived') OR
        (p_status IS NOT NULL AND p_status NOT IN ('want_to_read','reading','finished')) OR
        p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR
        ((p_after_created_at IS NULL) <> (p_after_id IS NULL)) OR
        (p_after_created_at IS NOT NULL AND NOT isfinite(p_after_created_at)) THEN
        RAISE EXCEPTION 'Invalid Book list inputs' USING ERRCODE = '22023'; END IF;
    FOR item IN SELECT id,title,author,cover_url,status,archived_at,revision::text,created_at,updated_at FROM public.books
        WHERE user_id=actor AND (archived_at IS NOT NULL) = (p_scope='archived')
        AND (p_status IS NULL OR status=p_status)
        AND (p_after_created_at IS NULL OR (created_at,id) < (p_after_created_at,p_after_id))
        ORDER BY created_at DESC,id DESC LIMIT p_limit+1 LOOP
        IF emitted = p_limit THEN next_cursor := cursor_value; EXIT; END IF;
        items := items || jsonb_build_array(to_jsonb(item));
        cursor_value := jsonb_build_object('created_at',item.created_at,'id',item.id);
        emitted := emitted+1;
    END LOOP;
    RETURN jsonb_build_object('version',1,'books',items,'next_cursor',next_cursor);
END;
$function$;

REVOKE ALL ON FUNCTION system_internal.book_trim_v1(text),system_internal.book_note_v1(text),
    system_internal.book_cover_valid_v1(text),system_internal.book_fields_v1(jsonb,boolean)
    FROM PUBLIC,anon,authenticated,service_role,library_command_owner,quest_command_owner,
    progression_command_owner,level_policy_assignment_owner,schedule_command_owner,goal_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.book_trim_v1(text),system_internal.book_note_v1(text),
    system_internal.book_cover_valid_v1(text),system_internal.book_fields_v1(jsonb,boolean) TO library_command_owner;

GRANT library_command_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO library_command_owner;
DO $routines$
DECLARE signature text;
BEGIN
    FOREACH signature IN ARRAY ARRAY['public.create_book_v1(uuid,jsonb)',
        'public.update_book_v1(uuid,bigint,jsonb)','public.set_book_archived_v1(uuid,bigint,boolean)',
        'public.get_book_v1(uuid)','public.list_books_v1(text,text,timestamptz,uuid,integer)'] LOOP
        IF signature NOT IN ('public.get_book_v1(uuid)','public.list_books_v1(text,text,timestamptz,uuid,integer)') THEN
            EXECUTE format('ALTER FUNCTION %s OWNER TO library_command_owner',signature);
        END IF;
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,library_command_owner,
            quest_command_owner,progression_command_owner,level_policy_assignment_owner,schedule_command_owner,goal_command_owner',signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',signature);
    END LOOP;
END;
$routines$;
REVOKE CREATE ON SCHEMA public FROM library_command_owner;
REVOKE library_command_owner FROM CURRENT_USER;
COMMENT ON TABLE public.books IS 'ADR-023: private books, plain-text learning notes, independent reading status and reversible archival; no hard-delete or command history.';
NOTIFY pgrst, 'reload schema';
COMMIT;
