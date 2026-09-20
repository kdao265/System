\set ON_ERROR_STOP on
BEGIN;
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exp_ledger' ORDER BY ordinal_position;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.exp_ledger'::regclass ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='exp_ledger' ORDER BY indexname;
SELECT policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='exp_ledger';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='exp_ledger' ORDER BY grantee, privilege_type;
SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='exp_internal' OR (n.nspname='public' AND p.proname='get_current_exp');
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.exp_ledger'::regclass AND NOT tgisinternal;
DO $catalog$
DECLARE role_name text; privilege text; routine record; colnames text[];
BEGIN
    SELECT array_agg(attname::text ORDER BY attnum) INTO colnames FROM pg_attribute
        WHERE attrelid='public.exp_ledger'::regclass AND attnum>0 AND NOT attisdropped;
    IF colnames IS DISTINCT FROM ARRAY['id','user_id','source_type','source_id','reason','amount','reverses_entry_id','recorded_at'] THEN
        RAISE EXCEPTION 'Ledger columns mismatch';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.exp_ledger'::regclass) THEN RAISE EXCEPTION 'Missing RLS'; END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.exp_ledger'::regclass) <> 7
        OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.exp_ledger'::regclass AND contype='f' AND confdeltype='r' AND confupdtype='r') <> 2
        OR (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='exp_ledger') <> 5 THEN
        RAISE EXCEPTION 'Keys/checks/indexes mismatch';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='public.uq_exp_ledger_reversal'::regclass AND indisunique AND indpred IS NOT NULL)
        OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.exp_ledger'::regclass) <> 4
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.exp_ledger'::regclass AND NOT tgisinternal AND tgenabled='O') <> 3 THEN
        RAISE EXCEPTION 'Partial unique/policy/trigger mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname='quest_command_owner' AND (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls))
        OR (SELECT relowner=(SELECT oid FROM pg_roles WHERE rolname='quest_command_owner') FROM pg_class WHERE oid='public.exp_ledger'::regclass) THEN
        RAISE EXCEPTION 'Unsafe command role';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','authenticator','service_role'] LOOP
        IF pg_has_role(role_name,'quest_command_owner','MEMBER') THEN RAISE EXCEPTION 'Leaked role membership'; END IF;
        IF has_schema_privilege(role_name,'exp_internal','USAGE') OR has_schema_privilege(role_name,'exp_internal','CREATE') THEN
            RAISE EXCEPTION 'Leaked private schema access';
        END IF;
        FOR routine IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='exp_internal' LOOP
            IF has_function_privilege(role_name,routine.oid,'EXECUTE') THEN RAISE EXCEPTION 'Leaked private execution'; END IF;
        END LOOP;
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','quest_command_owner','service_role'] LOOP
        FOREACH privilege IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
            IF has_table_privilege(role_name,'public.exp_ledger',privilege) THEN RAISE EXCEPTION 'Unsafe ledger grant'; END IF;
        END LOOP;
        IF has_table_privilege(role_name,'public.exp_ledger','INSERT') IS DISTINCT FROM (role_name='quest_command_owner') THEN
            RAISE EXCEPTION 'INSERT boundary mismatch';
        END IF;
        IF has_table_privilege(role_name,'public.exp_ledger','SELECT') IS DISTINCT FROM (role_name IN ('authenticated','quest_command_owner')) THEN
            RAISE EXCEPTION 'SELECT boundary mismatch';
        END IF;
    END LOOP;
    IF has_schema_privilege('quest_command_owner','exp_internal','CREATE') THEN RAISE EXCEPTION 'Runtime schema CREATE'; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE (n.nspname='exp_internal' OR (n.nspname='public' AND p.proname='get_current_exp'))
            AND (p.prosecdef OR NOT ('search_path=pg_catalog'=ANY(p.proconfig)))) THEN
        RAISE EXCEPTION 'Routine security settings mismatch';
    END IF;
    IF (SELECT prorettype <> 'numeric'::regtype OR pronargs<>0 FROM pg_proc WHERE oid='public.get_current_exp()'::regprocedure) THEN
        RAISE EXCEPTION 'Aggregate signature mismatch';
    END IF;
    RAISE NOTICE 'Player/EXP catalog assertions passed';
END;
$catalog$;
ROLLBACK;
