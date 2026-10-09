\set ON_ERROR_STOP on
-- ADR-023: exact additive schema, least privilege, RLS and configured-owner gates.
BEGIN;
CREATE FUNCTION pg_temp.lib_check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Library catalog: %', label; END IF; END;
$$;
DO $catalog$
DECLARE item record; p pg_proc; role_name text; col text; t regclass := 'public.books';
BEGIN
    PERFORM pg_temp.lib_check((SELECT array_agg(attname||':'||format_type(atttypid,atttypmod) ORDER BY attnum)
        FROM pg_attribute WHERE attrelid=t AND attnum>0 AND NOT attisdropped)=ARRAY[
        'id:uuid','user_id:uuid','title:text','author:text','cover_url:text','status:text','summary:text',
        'content_notes:text','lessons:text','archived_at:timestamp with time zone','revision:bigint',
        'created_at:timestamp with time zone','updated_at:timestamp with time zone'], 'exact columns');
    PERFORM pg_temp.lib_check((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
        WHERE attrelid=t AND attnum>0 AND attnotnull)=ARRAY['id','user_id','title','status','revision','created_at','updated_at'],'nullability');
    PERFORM pg_temp.lib_check((SELECT relrowsecurity AND relowner<>'library_command_owner'::regrole FROM pg_class WHERE oid=t),'RLS/nonownership');
    PERFORM pg_temp.lib_check((SELECT count(*)=4 FROM pg_policy WHERE polrelid=t),'exact policy inventory');
    PERFORM pg_temp.lib_check(EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=t AND polname='system_single_owner'
        AND NOT polpermissive AND polcmd='*' AND cardinality(polroles)=2
        AND polroles @> ARRAY['authenticated'::regrole::oid,'library_command_owner'::regrole::oid]
        AND pg_get_expr(polqual,polrelid) LIKE '%is_owner()%'
        AND pg_get_expr(polqual,polrelid) LIKE '%request_user_id()%'
        AND pg_get_expr(polwithcheck,polrelid) LIKE '%is_owner()%'
        AND pg_get_expr(polwithcheck,polrelid) LIKE '%request_user_id()%'),'restrictive configured owner with identity');
    PERFORM pg_temp.lib_check(EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=t AND polcmd='r' AND polpermissive
        AND polroles @> ARRAY['authenticated'::regrole::oid,'library_command_owner'::regrole::oid]
        AND pg_get_expr(polqual,polrelid) LIKE '%request_user_id()%'),'row owner SELECT');
    PERFORM pg_temp.lib_check(EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=t AND polcmd='a' AND polpermissive
        AND polroles=ARRAY['library_command_owner'::regrole::oid] AND pg_get_expr(polwithcheck,polrelid) LIKE '%request_user_id()%')
        AND EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=t AND polcmd='w' AND polpermissive
        AND polroles=ARRAY['library_command_owner'::regrole::oid] AND pg_get_expr(polqual,polrelid) LIKE '%request_user_id()%'
        AND pg_get_expr(polwithcheck,polrelid) LIKE '%request_user_id()%'),'executor INSERT and UPDATE policies');
    PERFORM pg_temp.lib_check((SELECT count(*)=1 FROM pg_constraint WHERE conrelid=t AND contype='f'
        AND confrelid='auth.users'::regclass AND confdeltype='r' AND confupdtype='r'),'restrict owner FK');
    PERFORM pg_temp.lib_check((SELECT count(*)=9 FROM pg_constraint WHERE conrelid=t AND contype='c'),'named row constraints');
    PERFORM pg_temp.lib_check((SELECT count(*)=4 FROM pg_index WHERE indrelid=t),'only PK, owner key, two scope indexes');
    PERFORM pg_temp.lib_check(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=t AND contype='u'
        AND pg_get_constraintdef(oid)='UNIQUE (id, user_id)'),'same-owner child key');
    FOR item IN SELECT * FROM (VALUES ('ix_books_active','(archived_at IS NULL)'),('ix_books_archived','(archived_at IS NOT NULL)')) x(name,predicate) LOOP
        PERFORM pg_temp.lib_check(EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=('public.'||item.name)::regclass
            AND pg_get_expr(indpred,indrelid)=item.predicate AND pg_get_indexdef(indexrelid) LIKE '%(user_id, created_at DESC, id DESC)%'),'scope index '||item.name);
    END LOOP;
    PERFORM pg_temp.lib_check(EXISTS(SELECT 1 FROM pg_roles WHERE rolname='library_command_owner'
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls),'restricted executor flags');
    PERFORM pg_temp.lib_check(has_function_privilege('library_command_owner','system_private.is_owner()','EXECUTE')
        AND has_function_privilege('library_command_owner','system_private.require_owner()','EXECUTE')
        AND has_function_privilege('library_command_owner','system_internal.request_user_id()','EXECUTE'),'necessary owner helpers');
    PERFORM pg_temp.lib_check(NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner='library_command_owner'::regrole),'executor owns no relations');
    -- Preserve managed role creator ADMIN-only grant; never leave runtime SET/INHERIT.
    PERFORM pg_temp.lib_check(NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='library_command_owner'::regrole
        OR (roleid='library_command_owner'::regrole AND NOT (member=current_user::regrole
        AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option))),'no runtime memberships');
    FOREACH role_name IN ARRAY ARRAY['public','anon','service_role','quest_command_owner','progression_command_owner','level_policy_assignment_owner','schedule_command_owner','goal_command_owner'] LOOP
        PERFORM pg_temp.lib_check(NOT has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            AND NOT has_any_column_privilege(role_name,t,'SELECT,INSERT,UPDATE,REFERENCES'),'ungranted table role '||role_name);
    END LOOP;
    PERFORM pg_temp.lib_check(has_table_privilege('authenticated',t,'SELECT') AND has_table_privilege('library_command_owner',t,'SELECT'),'intended reads');
    PERFORM pg_temp.lib_check(NOT has_table_privilege('authenticated',t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT has_any_column_privilege('authenticated',t,'INSERT,UPDATE,REFERENCES'),'no client writes');
    PERFORM pg_temp.lib_check(NOT has_table_privilege('library_command_owner',t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'no whole-table executor write grants');
    FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=t AND attnum>0 AND NOT attisdropped LOOP
        PERFORM pg_temp.lib_check(has_column_privilege('library_command_owner',t,col,'INSERT')=(col=ANY(ARRAY['id','user_id','title','author','cover_url','status','summary','content_notes','lessons'])),'INSERT column '||col);
        PERFORM pg_temp.lib_check(has_column_privilege('library_command_owner',t,col,'UPDATE')=(col=ANY(ARRAY['title','author','cover_url','status','summary','content_notes','lessons','archived_at','revision','updated_at'])),'UPDATE column '||col);
    END LOOP;
    FOREACH col IN ARRAY ARRAY['public','system_internal','system_private'] LOOP
        PERFORM pg_temp.lib_check(has_schema_privilege('library_command_owner',col,'USAGE') AND NOT has_schema_privilege('library_command_owner',col,'CREATE'),'schema privilege cleanup');
    END LOOP;
    FOR item IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','system_private','system_internal','exp_internal') AND c.relkind IN ('r','p','v','m') AND c.oid<>t LOOP
        PERFORM pg_temp.lib_check(NOT has_table_privilege('library_command_owner',item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            AND NOT has_any_column_privilege('library_command_owner',item.oid,'SELECT,INSERT,UPDATE,REFERENCES'),'no unrelated domain privileges');
    END LOOP;
    FOR item IN SELECT * FROM (VALUES ('public.create_book_v1(uuid,jsonb)',true),('public.update_book_v1(uuid,bigint,jsonb)',true),
        ('public.set_book_archived_v1(uuid,bigint,boolean)',true),('public.get_book_v1(uuid)',false),
        ('public.list_books_v1(text,text,timestamptz,uuid,integer)',false)) x(signature,definer) LOOP
        SELECT * INTO p FROM pg_proc WHERE oid=item.signature::regprocedure;
        PERFORM pg_temp.lib_check(p.prosecdef=item.definer AND (p.proowner='library_command_owner'::regrole)=item.definer
            AND p.prorettype='jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog']
            AND p.provolatile=CASE WHEN item.definer THEN 'v'::"char" ELSE 's'::"char" END,'RPC attributes '||item.signature);
        PERFORM pg_temp.lib_check(p.prosrc ~ 'BEGIN[[:space:]]+PERFORM system_private.require_owner\(\);'
            AND p.prosrc LIKE '%actor := system_internal.request_user_id();%' AND p.prosrc LIKE '%IF actor IS NULL%','entry guards');
        PERFORM pg_temp.lib_check(has_function_privilege('authenticated',p.oid,'EXECUTE'),'client RPC grant');
        PERFORM pg_temp.lib_check((SELECT count(*)=1 FROM pg_proc WHERE proname=p.proname AND pronamespace=p.pronamespace),'no overload');
        FOREACH role_name IN ARRAY ARRAY['public','anon','service_role','library_command_owner','quest_command_owner','progression_command_owner','level_policy_assignment_owner','schedule_command_owner','goal_command_owner'] LOOP
            PERFORM pg_temp.lib_check(NOT has_function_privilege(role_name,p.oid,'EXECUTE'),'no unexpected RPC execute '||role_name);
        END LOOP;
    END LOOP;
    FOR p IN SELECT * FROM pg_proc WHERE pronamespace='system_internal'::regnamespace AND proname LIKE 'book_%_v1' LOOP
        PERFORM pg_temp.lib_check(NOT p.prosecdef AND p.provolatile='i' AND p.proconfig=ARRAY['search_path=pg_catalog']
            AND has_function_privilege('library_command_owner',p.oid,'EXECUTE'),'pure private helper');
        FOREACH role_name IN ARRAY ARRAY['public','anon','authenticated','service_role','quest_command_owner','goal_command_owner','schedule_command_owner','progression_command_owner','level_policy_assignment_owner'] LOOP
            PERFORM pg_temp.lib_check(NOT has_function_privilege(role_name,p.oid,'EXECUTE'),'private helper denied');
        END LOOP;
    END LOOP;
    PERFORM pg_temp.lib_check(NOT has_function_privilege('library_command_owner','public.complete_quest_occurrence(uuid,uuid,integer,timestamptz,text)','EXECUTE')
        AND NOT has_function_privilege('library_command_owner','exp_internal.append_quest_event(uuid)','EXECUTE'),'no EXP/Quest execution');
END;
$catalog$;
-- Runtime role matrix follows catalog assertions so test-only memberships cannot
-- mask migration privilege cleanup. Every change rolls back.
GRANT authenticated, anon, library_command_owner TO CURRENT_USER;
CREATE FUNCTION pg_temp.lib_reject(statement text, state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE=state THEN RETURN; END IF;
        RAISE EXCEPTION 'Library role rejection had unexpected SQLSTATE %', SQLSTATE;
    END;
    RAISE EXCEPTION 'Library role statement was unexpectedly allowed';
END;
$$;
DO $roles$
DECLARE
    a uuid := '00000000-0000-4000-8000-00000000c001';
    b uuid := '00000000-0000-4000-8000-00000000c002';
    owned uuid := '10000000-0000-4000-8000-00000000c001';
    foreign_id uuid := '10000000-0000-4000-8000-00000000c002';
    affected integer;
BEGIN
    INSERT INTO auth.users(id) VALUES(a),(b);
    DELETE FROM system_private.owner_configuration;
    INSERT INTO system_private.owner_configuration(user_id) VALUES(a);
    INSERT INTO public.books(id,user_id,title) VALUES(owned,a,'Owned fixture'),(foreign_id,b,'Foreign fixture');
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
    SET LOCAL ROLE library_command_owner;
    PERFORM pg_temp.lib_check((SELECT count(*)=1 FROM public.books WHERE id IN (owned,foreign_id)),'executor row isolation');
    PERFORM pg_temp.lib_reject(format('INSERT INTO public.books(id,user_id,title) VALUES(gen_random_uuid(),%L,''forged'')',b),'42501');
    PERFORM pg_temp.lib_reject(format('UPDATE public.books SET user_id=%L WHERE id=%L',b,owned),'42501');
    PERFORM pg_temp.lib_reject(format('UPDATE public.books SET id=gen_random_uuid() WHERE id=%L',owned),'42501');
    PERFORM pg_temp.lib_reject(format('UPDATE public.books SET created_at=now() WHERE id=%L',owned),'42501');
    PERFORM pg_temp.lib_reject(format('DELETE FROM public.books WHERE id=%L',owned),'42501');
    PERFORM pg_temp.lib_reject('TRUNCATE public.books','42501');
    UPDATE public.books SET title='hidden write' WHERE id=foreign_id;
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.lib_check(affected=0,'executor foreign update invisible');
    -- Constraints hold even for the command role, independently of RPC validators.
    PERFORM pg_temp.lib_reject(format('UPDATE public.books SET title='' untrimmed '' WHERE id=%L',owned),'23514');
    PERFORM pg_temp.lib_reject(format('UPDATE public.books SET summary='' '' WHERE id=%L',owned),'23514');
    PERFORM pg_temp.lib_reject(format('UPDATE public.books SET cover_url='''' WHERE id=%L',owned),'23514');
    PERFORM pg_temp.lib_reject(format('UPDATE public.books SET revision=0 WHERE id=%L',owned),'23514');
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b)::text,true);
    SET LOCAL ROLE library_command_owner;
    PERFORM pg_temp.lib_check((SELECT count(*)=0 FROM public.books),'executor configured-owner restriction on its own rows');
    PERFORM pg_temp.lib_reject(format('INSERT INTO public.books(id,user_id,title) VALUES(gen_random_uuid(),%L,''nonowner'')',b),'42501');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.lib_check((SELECT count(*)=0 FROM public.books),'authenticated nonowner own rows invisible');
    PERFORM pg_temp.lib_reject('SELECT public.list_books_v1()','42501');
    RESET ROLE;
    DELETE FROM system_private.owner_configuration;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
    SET LOCAL ROLE library_command_owner;
    PERFORM pg_temp.lib_check((SELECT count(*)=0 FROM public.books),'executor missing configuration fails closed');
    PERFORM pg_temp.lib_reject(format('INSERT INTO public.books(id,user_id,title) VALUES(gen_random_uuid(),%L,''unconfigured'')',a),'42501');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.lib_check((SELECT count(*)=0 FROM public.books),'authenticated missing configuration fails closed');
    PERFORM pg_temp.lib_reject('SELECT public.list_books_v1()','42501');
    RESET ROLE;
    INSERT INTO system_private.owner_configuration(user_id) VALUES(a);
    PERFORM set_config('request.jwt.claims','{}',true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.lib_check((SELECT count(*)=0 FROM public.books),'missing request identity fails closed');
    PERFORM pg_temp.lib_reject('SELECT public.list_books_v1()','42501');
    RESET ROLE;
    SET LOCAL ROLE anon;
    PERFORM pg_temp.lib_reject('SELECT * FROM public.books','42501');
    PERFORM pg_temp.lib_reject('SELECT public.list_books_v1()','42501');
    RESET ROLE;
END;
$roles$;
ROLLBACK;
