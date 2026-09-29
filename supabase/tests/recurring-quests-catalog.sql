\set ON_ERROR_STOP on
-- Catalog/security contract for the four recurring Quest routines and the two receipt
-- types created by 20260928181000_create_recurring_quests.sql.
BEGIN;

SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    p.prosecdef, p.proconfig, p.proacl, pg_get_userbyid(p.proowner)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN
    ('create_recurring_quest', 'materialize_quest_day', 'set_quest_recurrence_pause',
     'list_recurring_quests')
ORDER BY p.proname;

DO $catalog$
DECLARE
    item record;
    fn oid;
    owner_name text;
    config_text text;
    is_security_definer boolean;
    stable_flag boolean;
    role_name text;
    acl_text text[];
    actual_cols text[];
    expected_cols text[];
BEGIN
    CREATE TEMP TABLE recurring_contract (
        signature text PRIMARY KEY,
        proname text NOT NULL,
        secdef boolean NOT NULL,
        via_command_role boolean NOT NULL,
        want_stable boolean NOT NULL
    ) ON COMMIT DROP;
    INSERT INTO recurring_contract VALUES
        ('public.create_recurring_quest(uuid,jsonb,text)', 'create_recurring_quest',
            true, true, false),
        ('public.materialize_quest_day(date)', 'materialize_quest_day',
            true, true, false),
        ('public.set_quest_recurrence_pause(uuid,uuid,boolean,text)', 'set_quest_recurrence_pause',
            true, true, false),
        ('public.list_recurring_quests()', 'list_recurring_quests',
            false, false, true);

    FOR item IN SELECT * FROM recurring_contract ORDER BY signature LOOP
        fn := item.signature::regprocedure;
        IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = item.proname) <> 1 THEN
            RAISE EXCEPTION 'recurring routine overload mismatch: %', item.proname;
        END IF;
        SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig::text, (p.provolatile = 's')
            INTO owner_name, is_security_definer, config_text, stable_flag
            FROM pg_proc p WHERE p.oid = fn;
        IF owner_name IS DISTINCT FROM (CASE WHEN item.via_command_role
                THEN 'quest_command_owner' ELSE current_user END) THEN
            RAISE EXCEPTION 'recurring routine owner mismatch: % is %', item.signature, owner_name;
        END IF;
        IF is_security_definer IS DISTINCT FROM item.secdef
            OR config_text IS DISTINCT FROM '{search_path=pg_catalog}' THEN
            RAISE EXCEPTION 'recurring routine definer/search_path mismatch: %', item.signature;
        END IF;
        IF stable_flag IS DISTINCT FROM item.want_stable THEN
            RAISE EXCEPTION 'recurring routine volatility mismatch: %', item.signature;
        END IF;
        IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'authenticated missing EXECUTE: %', item.signature;
        END IF;
        FOREACH role_name IN ARRAY ARRAY['public', 'anon', 'service_role', 'quest_command_owner',
            'progression_command_owner', 'level_policy_assignment_owner'] LOOP
            IF has_function_privilege(role_name, fn, 'EXECUTE') THEN
                RAISE EXCEPTION 'unexpected EXECUTE on %: %', item.signature, role_name;
            END IF;
        END LOOP;
        SELECT p.proacl INTO acl_text FROM pg_proc p WHERE p.oid = fn;
        -- Ownership transfer drops the previous owner's entry, so a routine left with the
        -- migration role keeps its default owner grant in addition to the client grant.
        IF (SELECT array_agg(entry ORDER BY entry) FROM unnest(acl_text) AS entry)
            IS DISTINCT FROM (SELECT array_agg(entry ORDER BY entry) FROM unnest(
                CASE WHEN item.via_command_role THEN ARRAY['authenticated=X/quest_command_owner']
                ELSE ARRAY[owner_name || '=X/' || owner_name,
                            'authenticated=X/' || owner_name] END) AS entry) THEN
            RAISE EXCEPTION 'recurring routine ACL mismatch on %: %', item.signature, acl_text;
        END IF;
    END LOOP;

    -- Both receipt types exist with exactly the columns the client boundary reads.
    -- Like the frozen one-off receipt types they keep the default PUBLIC USAGE; the
    -- executable surface stays the four routines, not the composite types.
    FOREACH role_name IN ARRAY ARRAY['public.quest_recurring_receipt',
        'public.quest_recurrence_state_receipt'] LOOP
        IF to_regtype(role_name) IS NULL THEN
            RAISE EXCEPTION 'missing receipt type: %', role_name;
        END IF;
        SELECT array_agg(att.attname::text ORDER BY att.attname::text) INTO actual_cols
            FROM pg_attribute AS att
            WHERE att.attrelid = (SELECT t.typrelid FROM pg_type AS t
                WHERE t.oid = to_regtype(role_name)::oid)
              AND att.attnum > 0 AND NOT att.attisdropped;
        SELECT array_agg(expected::text ORDER BY expected::text) INTO expected_cols
            FROM unnest(CASE WHEN role_name = 'public.quest_recurring_receipt' THEN ARRAY[
                    'command_id', 'quest_id', 'recurrence_rule_id',
                    'definition_created_event_id', 'recurrence_changed_event_id',
                    'recurrence_mode', 'recurrence_type', 'anchor_date', 'end_date',
                    'weekdays', 'month_day', 'occurrence_limit', 'default_reward_exp',
                    'replay']
                ELSE ARRAY['command_id', 'quest_id', 'recurrence_rule_id',
                    'recurrence_mode', 'paused', 'stopped_at', 'state_event_id', 'replay']
                END) AS expected;
        IF actual_cols IS DISTINCT FROM expected_cols THEN
            RAISE EXCEPTION 'receipt type column mismatch on %: % <> %',
                role_name, actual_cols, expected_cols;
        END IF;
    END LOOP;

    -- Recurrence enters the read path through a sibling routine only: the frozen
    -- day projection stays byte-identical to the hash the activation migration pins.
    IF md5(replace((SELECT p.prosrc FROM pg_proc p
        WHERE p.oid = 'public.list_day_quest_occurrences(date)'::regprocedure), E'\r', ''))
        IS DISTINCT FROM '0e4ab233d7c67f63b95a9e3a79c5a6db' THEN
        RAISE EXCEPTION 'list_day_quest_occurrences source drifted from its pinned hash';
    END IF;

    -- The slot backstop that makes generation replay-safe already exists.
    IF (SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_recurring_slot'
          AND indexdef = 'CREATE UNIQUE INDEX uq_recurring_slot ON public.quest_occurrences USING btree (quest_id, source_slot_date) WHERE (recurrence_rule_id IS NOT NULL)')
        <> 1 THEN
        RAISE EXCEPTION 'uq_recurring_slot partial unique index missing or changed';
    END IF;
END;
$catalog$;

ROLLBACK;
