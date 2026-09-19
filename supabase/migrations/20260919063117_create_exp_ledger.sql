-- Player/EXP foundation. Authority: player-exp-database-schema.md and
-- quest-event-payload-v1.md. No public completion/reopen command is enabled.
BEGIN;

-- Never silently backfill pre-ledger accepted completion history.
LOCK TABLE public.quest_occurrences IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.quest_events IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
    IF EXISTS (SELECT 1 FROM public.quest_events WHERE event_type = 'completed')
        OR EXISTS (SELECT 1 FROM public.quest_occurrences WHERE status = 'completed') THEN
        RAISE EXCEPTION 'Existing completion history requires reviewed EXP reconciliation';
    END IF;
END;
$preflight$;

-- SYSTEM-owned JWT identity boundary; no managed-auth schema privilege needed.
CREATE SCHEMA system_internal;
REVOKE ALL ON SCHEMA system_internal FROM PUBLIC, anon, authenticated, service_role, quest_command_owner;
GRANT USAGE ON SCHEMA system_internal TO authenticated, quest_command_owner;
CREATE FUNCTION system_internal.request_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;
REVOKE ALL ON FUNCTION system_internal.request_user_id() FROM PUBLIC, anon, authenticated, service_role, quest_command_owner;
GRANT EXECUTE ON FUNCTION system_internal.request_user_id() TO authenticated, quest_command_owner;

-- Forward-only policy changes preserve roles, commands and owner predicates.
ALTER POLICY quests_owner_select ON public.quests USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY quests_command_insert ON public.quests WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY quests_command_update ON public.quests USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id())) WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY rules_owner_select ON public.quest_recurrence_rules USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY rules_command_insert ON public.quest_recurrence_rules WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY rules_command_update ON public.quest_recurrence_rules USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id())) WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY occurrences_owner_select ON public.quest_occurrences USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY occurrences_command_insert ON public.quest_occurrences WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY occurrences_command_update ON public.quest_occurrences USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id())) WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY events_owner_select ON public.quest_events USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY events_command_insert ON public.quest_events WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
ALTER POLICY profiles_quest_owner_select ON public.profiles USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));

CREATE SCHEMA exp_internal;
REVOKE ALL ON SCHEMA exp_internal FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA exp_internal TO quest_command_owner;

CREATE TABLE public.exp_ledger (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    reason text NOT NULL,
    amount bigint NOT NULL,
    reverses_entry_id uuid,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_exp_ledger PRIMARY KEY (id),
    CONSTRAINT uq_exp_ledger_owner UNIQUE (id, user_id),
    CONSTRAINT fk_exp_ledger_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_exp_ledger_reversal_owner FOREIGN KEY (reverses_entry_id, user_id)
        REFERENCES public.exp_ledger (id, user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT uq_exp_ledger_source UNIQUE (source_type, source_id, reason),
    CONSTRAINT ck_exp_ledger_kind CHECK (
        (source_type = 'quest_completion' AND reason = 'completion_reward'
            AND amount >= 0 AND reverses_entry_id IS NULL)
        OR (source_type = 'quest_completion_reversal' AND reason = 'completion_reward_reversal'
            AND amount <= 0 AND reverses_entry_id IS NOT NULL)
    ),
    CONSTRAINT ck_exp_ledger_not_self CHECK (reverses_entry_id <> id)
);
CREATE UNIQUE INDEX uq_exp_ledger_reversal ON public.exp_ledger (reverses_entry_id)
    WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX ix_exp_ledger_owner_history ON public.exp_ledger (user_id, recorded_at DESC, id);

ALTER TABLE public.exp_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exp_ledger FROM PUBLIC, anon, authenticated, service_role, quest_command_owner;
GRANT SELECT ON public.exp_ledger TO authenticated, quest_command_owner;
GRANT INSERT ON public.exp_ledger TO quest_command_owner;
CREATE POLICY exp_ledger_owner_select ON public.exp_ledger
    FOR SELECT TO authenticated, quest_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY exp_ledger_command_insert ON public.exp_ledger
    FOR INSERT TO quest_command_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL AND user_id = (SELECT system_internal.request_user_id()));

-- Strict JSON typing before conversion; missing/null values must fail closed.
CREATE FUNCTION exp_internal.uuid_value(value jsonb) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Invalid EXP UUID value' USING ERRCODE = '22023';
    END IF;
    RETURN (value #>> '{}')::uuid;
END;
$function$;

CREATE FUNCTION exp_internal.integer_value(value jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE result numeric;
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid EXP numeric value' USING ERRCODE = '22023';
    END IF;
    result := (value #>> '{}')::numeric;
    IF result <> trunc(result) THEN
        RAISE EXCEPTION 'Fractional EXP value' USING ERRCODE = '22023';
    END IF;
    RETURN result;
END;
$function$;

-- Also used for historical original-completion validation during reversal.
-- No comparison to today's mutable occurrence reward is made here.
CREATE FUNCTION exp_internal.validate_credit_envelope(
    event_row public.quest_events, receipt uuid, credit_amount bigint
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF event_row.event_type IS DISTINCT FROM 'completed'
        OR event_row.payload_version IS DISTINCT FROM 1
        OR jsonb_typeof(event_row.payload -> 'exp') IS DISTINCT FROM 'object'
        OR event_row.payload #> '{exp,source_type}' IS DISTINCT FROM '"quest_completion"'::jsonb
        OR event_row.payload #> '{exp,reason}' IS DISTINCT FROM '"completion_reward"'::jsonb
        OR exp_internal.uuid_value(event_row.payload #> '{exp,source_id}') IS DISTINCT FROM event_row.id
        OR exp_internal.uuid_value(event_row.payload #> '{exp,ledger_entry_id}') IS DISTINCT FROM receipt
        OR exp_internal.integer_value(event_row.payload #> '{exp,amount}') IS DISTINCT FROM credit_amount::numeric
        OR credit_amount IS NULL OR credit_amount < 0 OR credit_amount > 2147483647 THEN
        RAISE EXCEPTION 'Invalid completion EXP envelope' USING ERRCODE = '23514';
    END IF;
END;
$function$;

CREATE FUNCTION exp_internal.validate_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    source_event public.quest_events%ROWTYPE;
    original_event public.quest_events%ROWTYPE;
    occurrence public.quest_occurrences%ROWTYPE;
    original_credit public.exp_ledger%ROWTYPE;
BEGIN
    IF system_internal.request_user_id() IS NULL OR NEW.user_id IS DISTINCT FROM system_internal.request_user_id() THEN
        RAISE EXCEPTION 'Unauthorized EXP owner' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO source_event FROM public.quest_events
        WHERE id = NEW.source_id AND user_id = system_internal.request_user_id();
    IF NOT FOUND OR source_event.payload_version <> 1
        OR source_event.occurrence_id IS NULL THEN
        RAISE EXCEPTION 'Invalid EXP source' USING ERRCODE = '23514';
    END IF;
    -- Outer commands already hold these locks; reacquiring also protects direct
    -- command-role inserts. Preserve definition-before-occurrence ordering.
    PERFORM 1 FROM public.quests WHERE id = source_event.quest_id
        AND user_id = NEW.user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid EXP Quest' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO occurrence FROM public.quest_occurrences
        WHERE id = source_event.occurrence_id AND quest_id = source_event.quest_id
            AND user_id = NEW.user_id FOR UPDATE;
    IF NOT FOUND OR occurrence.execution_cycle IS DISTINCT FROM source_event.execution_cycle THEN
        RAISE EXCEPTION 'Invalid EXP occurrence/cycle' USING ERRCODE = '23514';
    END IF;

    IF NEW.source_type = 'quest_completion' AND NEW.reason = 'completion_reward'
        AND NEW.reverses_entry_id IS NULL THEN
        PERFORM exp_internal.validate_credit_envelope(source_event, NEW.id, NEW.amount);
        IF occurrence.status NOT IN ('draft', 'scheduled', 'active')
            OR occurrence.reward_exp_snapshot IS NULL
            OR NEW.amount IS DISTINCT FROM occurrence.reward_exp_snapshot::bigint THEN
            RAISE EXCEPTION 'Invalid completion state/snapshot' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.source_type = 'quest_completion_reversal'
        AND NEW.reason = 'completion_reward_reversal' AND NEW.reverses_entry_id IS NOT NULL THEN
        IF source_event.event_type <> 'completion_corrected'
            OR jsonb_typeof(source_event.payload -> 'correction') IS DISTINCT FROM 'object'
            OR source_event.payload #> '{correction,undo}' IS DISTINCT FROM 'true'::jsonb
            OR jsonb_typeof(source_event.payload -> 'exp') IS DISTINCT FROM 'object'
            OR source_event.payload #> '{exp,source_type}' IS DISTINCT FROM '"quest_completion_reversal"'::jsonb
            OR source_event.payload #> '{exp,reason}' IS DISTINCT FROM '"completion_reward_reversal"'::jsonb
            OR exp_internal.uuid_value(source_event.payload #> '{exp,source_id}') IS DISTINCT FROM source_event.id
            OR exp_internal.uuid_value(source_event.payload #> '{exp,reversal_entry_id}') IS DISTINCT FROM NEW.id
            OR exp_internal.uuid_value(source_event.payload #> '{exp,original_credit_entry_id}') IS DISTINCT FROM NEW.reverses_entry_id
            OR exp_internal.uuid_value(source_event.payload #> '{correction,original_completion_event_id}') IS DISTINCT FROM source_event.related_event_id
            OR exp_internal.integer_value(source_event.payload #> '{exp,amount}') IS DISTINCT FROM NEW.amount::numeric THEN
            RAISE EXCEPTION 'Invalid undo EXP envelope' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO original_credit FROM public.exp_ledger
            WHERE id = NEW.reverses_entry_id AND user_id = NEW.user_id;
        IF NOT FOUND OR original_credit.source_type <> 'quest_completion'
            OR original_credit.reason <> 'completion_reward'
            OR original_credit.reverses_entry_id IS NOT NULL
            OR NEW.id = NEW.reverses_entry_id
            OR NEW.amount::numeric IS DISTINCT FROM -original_credit.amount::numeric THEN
            RAISE EXCEPTION 'Invalid original credit/compensation' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO original_event FROM public.quest_events
            WHERE id = source_event.related_event_id AND id = original_credit.source_id
                AND user_id = NEW.user_id AND quest_id = source_event.quest_id
                AND occurrence_id = source_event.occurrence_id
                AND execution_cycle = source_event.execution_cycle;
        IF NOT FOUND OR occurrence.status <> 'completed' THEN
            RAISE EXCEPTION 'Invalid original completion' USING ERRCODE = '23514';
        END IF;
        PERFORM exp_internal.validate_credit_envelope(original_event, original_credit.id, original_credit.amount);
    ELSE
        RAISE EXCEPTION 'Invalid EXP row kind' USING ERRCODE = '23514';
    END IF;
    NEW.recorded_at := now();
    RETURN NEW;
END;
$function$;

CREATE FUNCTION exp_internal.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'EXP history is immutable' USING ERRCODE = '55000';
END;
$function$;
CREATE TRIGGER exp_ledger_validate_insert BEFORE INSERT ON public.exp_ledger
    FOR EACH ROW EXECUTE FUNCTION exp_internal.validate_insert();
CREATE TRIGGER exp_ledger_reject_mutation BEFORE UPDATE OR DELETE ON public.exp_ledger
    FOR EACH ROW EXECUTE FUNCTION exp_internal.reject_mutation();
CREATE TRIGGER exp_ledger_reject_truncate BEFORE TRUNCATE ON public.exp_ledger
    FOR EACH STATEMENT EXECUTE FUNCTION exp_internal.reject_mutation();

-- No amount/owner/receipt parameters. Values come from the canonical source.
-- Fresh append only: outer commands resolve accepted replay before invoking.
CREATE FUNCTION exp_internal.append_quest_event(event_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE event_row public.quest_events%ROWTYPE; receipt uuid;
BEGIN
    IF system_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO event_row FROM public.quest_events WHERE id = event_id AND user_id = system_internal.request_user_id();
    IF NOT FOUND OR event_row.event_type NOT IN ('completed', 'completion_corrected') THEN
        RAISE EXCEPTION 'Invalid EXP source' USING ERRCODE = '23514';
    END IF;
    IF event_row.event_type = 'completed' THEN
        receipt := exp_internal.uuid_value(event_row.payload #> '{exp,ledger_entry_id}');
        INSERT INTO public.exp_ledger (id, user_id, source_type, source_id, reason, amount)
            VALUES (receipt, system_internal.request_user_id(), 'quest_completion', event_id, 'completion_reward',
                exp_internal.integer_value(event_row.payload #> '{exp,amount}')::bigint);
    ELSE
        receipt := exp_internal.uuid_value(event_row.payload #> '{exp,reversal_entry_id}');
        INSERT INTO public.exp_ledger (id, user_id, source_type, source_id, reason, amount, reverses_entry_id)
            VALUES (receipt, system_internal.request_user_id(), 'quest_completion_reversal', event_id, 'completion_reward_reversal',
                exp_internal.integer_value(event_row.payload #> '{exp,amount}')::bigint,
                exp_internal.uuid_value(event_row.payload #> '{exp,original_credit_entry_id}'));
    END IF;
    RETURN receipt;
END;
$function$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA exp_internal FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA exp_internal TO quest_command_owner;

CREATE FUNCTION public.get_current_exp() RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF system_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT COALESCE(sum(amount), 0::numeric) FROM public.exp_ledger WHERE user_id = system_internal.request_user_id());
END;
$function$;
REVOKE ALL ON FUNCTION public.get_current_exp() FROM PUBLIC, anon, service_role, quest_command_owner;
GRANT EXECUTE ON FUNCTION public.get_current_exp() TO authenticated;
COMMENT ON TABLE public.exp_ledger IS
    'Append-only Quest EXP receipts. Source retention is owned by Quest. Completion/reopen require future atomic commands; no Level or balance cache.';
COMMENT ON FUNCTION public.get_current_exp() IS
    'Exact authenticated-owner numeric sum; transport as a decimal integer string without JavaScript Number coercion.';
COMMIT;
