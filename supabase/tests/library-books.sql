\set ON_ERROR_STOP on
-- LIB-AC-01..13: synthetic fixtures, including all test grants, roll back.
BEGIN;
GRANT authenticated, anon, library_command_owner TO CURRENT_USER;
CREATE SCHEMA library_test;
CREATE FUNCTION library_test.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Library behavior: %', label; END IF; END;
$$;
CREATE FUNCTION library_test.reject(statement text, state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = state THEN RETURN; END IF;
        RAISE EXCEPTION 'Library unexpected rejection for %: %', label, SQLSTATE;
    END;
    RAISE EXCEPTION 'Library expected rejection: %', label;
END;
$$;
GRANT USAGE ON SCHEMA library_test TO authenticated, anon, library_command_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA library_test TO authenticated, anon, library_command_owner;
DO $behavior$
DECLARE
    a uuid := '00000000-0000-4000-8000-00000000b001';
    b uuid := '00000000-0000-4000-8000-00000000b002';
    id uuid := '10000000-0000-4000-8000-00000000b001';
    foreign_id uuid := '10000000-0000-4000-8000-00000000b002';
    missing uuid := '10000000-0000-4000-8000-00000000b003';
    fields jsonb; ack jsonb; before_row jsonb; after_row jsonb; page jsonb; cur jsonb;
    ws text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
    item record; text_value text; s text; next_s text; rev bigint; count_rows integer := 0; ids uuid[] := '{}';
BEGIN
    INSERT INTO auth.users(id) VALUES(a),(b);
    DELETE FROM system_private.owner_configuration;
    INSERT INTO system_private.owner_configuration(user_id) VALUES(a);
    INSERT INTO public.books(id,user_id,title) VALUES(foreign_id,b,'Foreign synthetic book');
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
    SET LOCAL ROLE authenticated;
    fields := jsonb_build_object('title',ws||'Tiếng Việt 😀'||ws,'author',ws,'cover_url',ws,
        'summary',E' summary\r\nline\rnext ','content_notes',' notes ','lessons',ws);
    ack := public.create_book_v1(id,fields);
    PERFORM library_test.check(ack=jsonb_build_object('version',1,'book_id',id,'revision','1','changed',true,'outcome','created'), 'create acknowledgement');
    before_row := public.get_book_v1(id)->'book';
    PERFORM library_test.check(before_row->>'title'='Tiếng Việt 😀' AND before_row->>'user_id'=a::text
        AND before_row->>'status'='want_to_read' AND before_row->>'revision'='1'
        AND before_row->>'summary'=E' summary\nline\nnext ' AND before_row->>'content_notes'=' notes '
        AND before_row->>'author' IS NULL AND before_row->>'cover_url' IS NULL AND before_row->>'lessons' IS NULL
        AND before_row->>'archived_at' IS NULL AND before_row->>'created_at'=before_row->>'updated_at', 'canonical create/defaults/ownership/time');
    ack := public.create_book_v1(id,'{"title":"different payload"}');
    PERFORM library_test.check(ack->>'outcome'='existing' AND ack->>'changed'='false'
        AND public.get_book_v1(id)->'book'=before_row, 'duplicate create never overwrites');
    PERFORM library_test.check(public.update_book_v1(id,1,fields)->>'changed'='false'
        AND public.get_book_v1(id)->'book'=before_row, 'normalized no-op preserves entire row');
    PERFORM library_test.reject(format('SELECT public.create_book_v1(%L,NULL)',missing),'22023','null fields');
    PERFORM library_test.reject('SELECT public.create_book_v1(NULL,''{"title":"x"}'')','22023','null id');
    FOR fields IN SELECT value FROM jsonb_array_elements('[{},[],null,{"title":null},{"title":" "},{"title":1},{"title":"x","status":null},{"title":"x","status":"bad"},{"title":"x","summary":{}},{"title":"x","user_id":"forged"},{"title":"x","revision":"9"}]') LOOP
        PERFORM library_test.reject(format('SELECT public.create_book_v1(%L,%L)',missing,fields),'22023','invalid create fields');
    END LOOP;
    FOR fields IN SELECT value FROM jsonb_array_elements('[{},[],null,{"title":null},{"status":null},{"id":"forged"},{"updated_at":"2030-01-01"},{"archived_at":null}]') LOOP
        PERFORM library_test.reject(format('SELECT public.update_book_v1(%L,1,%L)',id,fields),'22023','invalid update fields');
    END LOOP;
    PERFORM library_test.reject(format('SELECT public.update_book_v1(%L,0,''{"title":"x"}'')',id),'22023','zero revision');
    PERFORM library_test.reject(format('SELECT public.set_book_archived_v1(%L,1,NULL)',id),'22023','null desired archive');
    -- PostgreSQL rejects unsupported text encoding before a command can store it.
    PERFORM library_test.reject($q$SELECT public.create_book_v1(gen_random_uuid(), '{"title":"\u0000"}'::jsonb)$q$,'22P05','NUL encoding');
    PERFORM library_test.reject($q$SELECT public.create_book_v1(gen_random_uuid(), '{"title":"\ud800"}'::jsonb)$q$,'22P02','lone surrogate');
    FOR item IN SELECT * FROM (VALUES ('title',240),('author',240),('summary',4000),('content_notes',20000),('lessons',10000)) caps(key,maximum) LOOP
        fields := jsonb_build_object('title','limit fixture',item.key,repeat('😀',item.maximum));
        PERFORM public.create_book_v1(gen_random_uuid(),fields);
        fields := jsonb_build_object('title','limit fixture',item.key,repeat('😀',item.maximum+1));
        PERFORM library_test.reject(format('SELECT public.create_book_v1(%L,%L)',missing,fields),'22023','codepoint maximum '||item.key);
    END LOOP;
    text_value := 'https://example.invalid/'||repeat('x',2048-length('https://example.invalid/'));
    PERFORM public.create_book_v1(gen_random_uuid(),jsonb_build_object('title','URL limit','cover_url',text_value));
    PERFORM library_test.reject(format('SELECT public.create_book_v1(%L,%L)',missing,jsonb_build_object('title','x','cover_url',text_value||'x')),'22023','URL maximum');
    -- Every status direction, same-status no-op, and patch-only updates preserve notes.
    FOREACH s IN ARRAY ARRAY['want_to_read','reading','finished'] LOOP
        SELECT (public.get_book_v1(id)#>>'{book,revision}')::bigint INTO rev;
        PERFORM public.update_book_v1(id,rev,jsonb_build_object('status',s));
        FOREACH next_s IN ARRAY ARRAY['want_to_read','reading','finished'] LOOP
            before_row := public.get_book_v1(id)->'book'; rev := (before_row->>'revision')::bigint;
            ack := public.update_book_v1(id,rev,jsonb_build_object('status',next_s));
            after_row := public.get_book_v1(id)->'book';
            PERFORM library_test.check(after_row->>'status'=next_s AND after_row->>'archived_at' IS NULL
                AND (after_row - ARRAY['status','revision','updated_at'])=(before_row - ARRAY['status','revision','updated_at'])
                AND (after_row->>'revision')::bigint=rev+CASE WHEN before_row->>'status'=next_s THEN 0 ELSE 1 END,'status transition');
            PERFORM public.update_book_v1(id,(after_row->>'revision')::bigint,jsonb_build_object('status',s));
        END LOOP;
    END LOOP;
    before_row := public.get_book_v1(id)->'book'; rev := (before_row->>'revision')::bigint;
    PERFORM public.update_book_v1(id,rev,'{"summary":null,"author":" Writer "}');
    after_row := public.get_book_v1(id)->'book';
    PERFORM library_test.check(after_row->>'summary' IS NULL AND after_row->>'author'='Writer'
        AND after_row->>'content_notes'=before_row->>'content_notes','explicit clearing/partial edit');
    PERFORM library_test.reject(format('SELECT public.update_book_v1(%L,%s,''{"author":"Writer"}'')',id,rev),'23514','stale equal edit');
    rev := rev+1; before_row := after_row;
    PERFORM public.set_book_archived_v1(id,rev,true);
    after_row := public.get_book_v1(id)->'book';
    PERFORM library_test.check(after_row->>'archived_at' IS NOT NULL
        AND (after_row-ARRAY['archived_at','revision','updated_at'])=(before_row-ARRAY['archived_at','revision','updated_at']), 'archive preserves content');
    PERFORM library_test.check(public.set_book_archived_v1(id,rev+1,true)->>'changed'='false'
        AND public.get_book_v1(id)->'book'=after_row,'archive no-op timestamp retained');
    PERFORM library_test.reject(format('SELECT public.set_book_archived_v1(%L,%s,true)',id,rev),'23514','stale archive before no-op');
    PERFORM library_test.reject(format('SELECT public.update_book_v1(%L,%s,''{"author":"Writer"}'')',id,rev+1),'23514','archived no-op edit');
    PERFORM library_test.check(public.create_book_v1(id,'{"title":"overwrite"}')->>'outcome'='existing'
        AND public.get_book_v1(id)->'book'=after_row,'create after edit/archive preserves row');
    PERFORM public.set_book_archived_v1(id,rev+1,false);
    before_row := public.get_book_v1(id)->'book';
    PERFORM library_test.check(before_row->>'archived_at' IS NULL
        AND (after_row-ARRAY['archived_at','revision','updated_at'])=(before_row-ARRAY['archived_at','revision','updated_at']), 'restore preserves content');
    PERFORM library_test.check(public.set_book_archived_v1(id,rev+2,false)->>'changed'='false'
        AND public.get_book_v1(id)->'book'=before_row,'restore no-op');
    PERFORM library_test.reject(format('SELECT public.set_book_archived_v1(%L,%s,true)',id,rev),'23514','late archive cannot reverse restore');
    -- Inaccessible and missing identities share the same error, including a PK collision.
    FOREACH foreign_id IN ARRAY ARRAY[foreign_id,missing] LOOP
        PERFORM library_test.reject(format('SELECT public.get_book_v1(%L)',foreign_id),'P0002','unavailable read');
        PERFORM library_test.reject(format('SELECT public.update_book_v1(%L,1,''{"title":"x"}'')',foreign_id),'P0002','unavailable edit');
        PERFORM library_test.reject(format('SELECT public.set_book_archived_v1(%L,1,true)',foreign_id),'P0002','unavailable archive');
    END LOOP;
    PERFORM library_test.reject('SELECT public.create_book_v1(''10000000-0000-4000-8000-00000000b002'',''{"title":"x"}'')','P0002','foreign create collision sanitized');
    -- Metadata-only keyset pages, including tied creation times and status filters.
    LOOP
        page := public.list_books_v1('active',NULL,(cur->>'created_at')::timestamptz,(cur->>'id')::uuid,2);
        FOR fields IN SELECT value FROM jsonb_array_elements(page->'books') LOOP
            PERFORM library_test.check(NOT fields ?| ARRAY['summary','content_notes','lessons','user_id']
                AND NOT (fields->>'id')::uuid=ANY(ids),'closed nonduplicated page');
            ids := array_append(ids,(fields->>'id')::uuid); count_rows := count_rows+1;
        END LOOP;
        cur := page->'next_cursor'; EXIT WHEN cur='null'::jsonb;
    END LOOP;
    PERFORM library_test.check(count_rows=(SELECT count(*) FROM public.books),'pages cover owner scope');
    FOREACH s IN ARRAY ARRAY['want_to_read','reading','finished'] LOOP
        page := public.list_books_v1('active',s);
        PERFORM library_test.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'books') x WHERE x->>'status'<>s),'status filter');
    END LOOP;
    PERFORM public.set_book_archived_v1(id,rev+2,true);
    page := public.list_books_v1('archived',before_row->>'status');
    PERFORM library_test.check(jsonb_array_length(page->'books')=1 AND page#>>'{books,0,id}'=id::text,'archived filtered list');
    FOREACH text_value IN ARRAY ARRAY[
        'SELECT public.list_books_v1(''bad'')','SELECT public.list_books_v1(NULL)',
        'SELECT public.list_books_v1(p_status=>''bad'')','SELECT public.list_books_v1(p_limit=>0)',
        'SELECT public.list_books_v1(p_limit=>101)','SELECT public.list_books_v1(p_limit=>NULL)',
        'SELECT public.list_books_v1(p_after_created_at=>now())',
        'SELECT public.list_books_v1(p_after_created_at=>''infinity'',p_after_id=>gen_random_uuid())'
    ] LOOP PERFORM library_test.reject(text_value,'22023','invalid list'); END LOOP;
    -- Exhaustion is a no-op-safe guard, not wraparound. Administrative fixture only.
    RESET ROLE;
    UPDATE public.books SET revision=9223372036854775807,archived_at=NULL WHERE books.id='10000000-0000-4000-8000-00000000b001';
    SET LOCAL ROLE authenticated;
    PERFORM library_test.check(public.update_book_v1(id,9223372036854775807,'{"author":"Writer"}')->>'changed'='false','max revision no-op');
    PERFORM library_test.reject(format('SELECT public.update_book_v1(%L,9223372036854775807,''{"title":"new"}'')',id),'23514','edit exhaustion');
    PERFORM library_test.reject(format('SELECT public.set_book_archived_v1(%L,9223372036854775807,true)',id),'23514','archive exhaustion');
    RESET ROLE;
END;
$behavior$;

-- Representative actual list/filter query plans under the RLS-bound owner. No
-- enable_seqscan override: indexes must be selected on realistic synthetic volume.
INSERT INTO public.books(id,user_id,title,status,created_at,updated_at,archived_at)
SELECT gen_random_uuid(),(SELECT user_id FROM system_private.owner_configuration),
    'Plan fixture',CASE WHEN n%3=0 THEN 'reading' ELSE 'want_to_read' END,
    now()-n*interval '1 second',now(),CASE WHEN n%2=0 THEN now() ELSE NULL END
FROM generate_series(1,4000) n;
ANALYZE public.books;
DO $plans$
DECLARE actor uuid := (SELECT user_id FROM system_private.owner_configuration);
    archived boolean; status_filter text; plan json; expected_index text;
BEGIN
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
    SET LOCAL ROLE authenticated;
    FOREACH archived IN ARRAY ARRAY[false,true] LOOP
        FOREACH status_filter IN ARRAY ARRAY[NULL::text,'reading'] LOOP
            EXECUTE format('EXPLAIN (ANALYZE, FORMAT JSON) SELECT id,title,author,cover_url,status,archived_at,revision::text,created_at,updated_at
                FROM public.books WHERE user_id=%L AND (archived_at IS NOT NULL)=%L
                AND (%L::text IS NULL OR status=%L)
                AND (created_at,id)<(''2100-01-01''::timestamptz,''ffffffff-ffff-ffff-ffff-ffffffffffff''::uuid)
                ORDER BY created_at DESC,id DESC LIMIT 51',actor,archived,status_filter,status_filter) INTO plan;
            expected_index := CASE WHEN archived THEN 'ix_books_archived' ELSE 'ix_books_active' END;
            PERFORM library_test.check(plan::text LIKE '%'||expected_index||'%', 'owner-leading filtered/cursor index '||expected_index);
        END LOOP;
    END LOOP;
    RESET ROLE;
END;
$plans$;
ROLLBACK;
