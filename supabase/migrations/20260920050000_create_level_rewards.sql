-- Level/Reward foundation. Authority: level-reward-database-schema.md,
-- operator-authorization-v1.md and level-reward-event-payload-v1.md.
-- No public Quest completion/reopen command is enabled.
BEGIN;

CREATE ROLE progression_command_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE level_policy_assignment_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA progression_internal;
REVOKE ALL ON SCHEMA progression_internal FROM PUBLIC, anon, authenticated, service_role,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT USAGE ON SCHEMA progression_internal TO quest_command_owner, progression_command_owner,
    level_policy_assignment_owner;
GRANT USAGE ON SCHEMA public TO progression_command_owner, level_policy_assignment_owner;
GRANT USAGE ON SCHEMA system_internal TO progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION system_internal.request_user_id() TO progression_command_owner,
    level_policy_assignment_owner;

CREATE TABLE system_internal.operator_grants (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    capability text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT pk_operator_grants PRIMARY KEY (id),
    CONSTRAINT fk_operator_grants_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_operator_grants_capability CHECK (capability = 'level_policy_assign'),
    CONSTRAINT ck_operator_grants_revoke_order CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
CREATE UNIQUE INDEX uq_operator_grants_active
    ON system_internal.operator_grants (user_id, capability) WHERE revoked_at IS NULL;

ALTER TABLE system_internal.operator_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE system_internal.operator_grants FROM PUBLIC, anon, authenticated, service_role,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT SELECT ON TABLE system_internal.operator_grants TO level_policy_assignment_owner;
CREATE POLICY operator_grants_actor_select ON system_internal.operator_grants
    FOR SELECT TO level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));

CREATE FUNCTION system_internal.reject_operator_grant_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'Operator grants are immutable' USING ERRCODE = '55000';
END;
$function$;
CREATE FUNCTION system_internal.validate_operator_grant_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    NEW.granted_at := now();
    NEW.revoked_at := NULL;
    RETURN NEW;
END;
$function$;
CREATE FUNCTION system_internal.validate_operator_grant_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.capability IS DISTINCT FROM OLD.capability
        OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
        RAISE EXCEPTION 'Operator grant identity is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Operator grant identity is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'Operator grant identity is immutable' USING ERRCODE = '55000';
    END IF;
    NEW.revoked_at := now();
    RETURN NEW;
END;
$function$;
CREATE TRIGGER operator_grants_validate_insert BEFORE INSERT ON system_internal.operator_grants
    FOR EACH ROW EXECUTE FUNCTION system_internal.validate_operator_grant_insert();
CREATE TRIGGER operator_grants_validate_update BEFORE UPDATE ON system_internal.operator_grants
    FOR EACH ROW EXECUTE FUNCTION system_internal.validate_operator_grant_update();
CREATE TRIGGER operator_grants_reject_delete BEFORE DELETE ON system_internal.operator_grants
    FOR EACH ROW EXECUTE FUNCTION system_internal.reject_operator_grant_mutation();
CREATE TRIGGER operator_grants_reject_truncate BEFORE TRUNCATE ON system_internal.operator_grants
    FOR EACH STATEMENT EXECUTE FUNCTION system_internal.reject_operator_grant_mutation();

CREATE FUNCTION system_internal.has_capability(p_capability text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid;
BEGIN
    IF p_capability IS DISTINCT FROM 'level_policy_assign' THEN
        RETURN false;
    END IF;
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RETURN false;
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM system_internal.operator_grants g
        WHERE g.user_id = actor AND g.capability = p_capability AND g.revoked_at IS NULL
    );
END;
$function$;
REVOKE ALL ON FUNCTION system_internal.has_capability(text) FROM PUBLIC, anon, authenticated,
    service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION system_internal.has_capability(text) TO level_policy_assignment_owner;
REVOKE ALL ON FUNCTION system_internal.reject_operator_grant_mutation(),
    system_internal.validate_operator_grant_insert(), system_internal.validate_operator_grant_update()
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;

CREATE TABLE public.level_policies (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    policy_key text NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CONSTRAINT pk_level_policies PRIMARY KEY (id),
    CONSTRAINT uq_level_policies_key UNIQUE (policy_key),
    CONSTRAINT uq_level_policies_version UNIQUE (version),
    CONSTRAINT ck_level_policies_key CHECK (length(btrim(policy_key)) > 0),
    CONSTRAINT ck_level_policies_version CHECK (version > 0),
    CONSTRAINT ck_level_policies_name CHECK (length(btrim(name)) > 0),
    CONSTRAINT ck_level_policies_status CHECK (status IN ('draft', 'published')),
    CONSTRAINT ck_level_policies_published_at CHECK (
        (status = 'draft' AND published_at IS NULL)
        OR (status = 'published' AND published_at IS NOT NULL)
    )
);

CREATE TABLE public.level_thresholds (
    policy_id uuid NOT NULL,
    level integer NOT NULL,
    required_exp numeric NOT NULL,
    CONSTRAINT pk_level_thresholds PRIMARY KEY (policy_id, level),
    CONSTRAINT uq_level_thresholds_exp UNIQUE (policy_id, required_exp),
    CONSTRAINT fk_level_thresholds_policy FOREIGN KEY (policy_id)
        REFERENCES public.level_policies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_level_thresholds_level CHECK (level >= 0),
    CONSTRAINT ck_level_thresholds_exp CHECK (
        required_exp >= 0 AND required_exp = trunc(required_exp)
        AND required_exp = required_exp
        AND required_exp < 'Infinity'::numeric
    )
);

CREATE TABLE public.progression_policy_assignments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    assignment_sequence bigint NOT NULL,
    command_id uuid NOT NULL,
    evaluated_exp numeric NOT NULL,
    actor_user_id uuid NOT NULL,
    origin text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_progression_policy_assignments PRIMARY KEY (id),
    CONSTRAINT uq_progression_policy_assignments_owner UNIQUE (id, user_id),
    CONSTRAINT uq_progression_policy_assignments_owner_policy UNIQUE (id, user_id, policy_id),
    CONSTRAINT uq_progression_policy_assignments_sequence UNIQUE (user_id, assignment_sequence),
    CONSTRAINT uq_progression_policy_assignments_command UNIQUE (user_id, command_id),
    CONSTRAINT fk_progression_policy_assignments_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_progression_policy_assignments_actor FOREIGN KEY (actor_user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_progression_policy_assignments_policy FOREIGN KEY (policy_id)
        REFERENCES public.level_policies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_progression_policy_assignments_sequence CHECK (assignment_sequence > 0),
    CONSTRAINT ck_progression_policy_assignments_exp CHECK (
        evaluated_exp >= 0 AND evaluated_exp = trunc(evaluated_exp)
        AND evaluated_exp = evaluated_exp AND evaluated_exp < 'Infinity'::numeric
    ),
    CONSTRAINT ck_progression_policy_assignments_origin CHECK (origin IN (
        'web_ui', 'web_assistant', 'telegram', 'automation', 'mobile', 'internal'
    ))
);

CREATE TABLE public.level_milestones (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    level integer NOT NULL,
    policy_assignment_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    evaluated_exp numeric NOT NULL,
    cause_kind text NOT NULL,
    cause_ledger_entry_id uuid,
    actor_user_id uuid NOT NULL,
    origin text NOT NULL,
    reached_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_level_milestones PRIMARY KEY (id),
    CONSTRAINT uq_level_milestones_owner UNIQUE (id, user_id),
    CONSTRAINT uq_level_milestones_owner_level UNIQUE (id, user_id, level),
    CONSTRAINT uq_level_milestones_first_reach UNIQUE (user_id, level),
    CONSTRAINT fk_level_milestones_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_milestones_actor FOREIGN KEY (actor_user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_milestones_assignment FOREIGN KEY (policy_assignment_id, user_id, policy_id)
        REFERENCES public.progression_policy_assignments (id, user_id, policy_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_milestones_threshold FOREIGN KEY (policy_id, level)
        REFERENCES public.level_thresholds (policy_id, level) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_milestones_ledger FOREIGN KEY (cause_ledger_entry_id, user_id)
        REFERENCES public.exp_ledger (id, user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_level_milestones_level CHECK (level >= 0),
    CONSTRAINT ck_level_milestones_exp CHECK (
        evaluated_exp >= 0 AND evaluated_exp = trunc(evaluated_exp)
        AND evaluated_exp = evaluated_exp AND evaluated_exp < 'Infinity'::numeric
    ),
    CONSTRAINT ck_level_milestones_cause CHECK (
        (cause_kind = 'exp_credit' AND cause_ledger_entry_id IS NOT NULL)
        OR (cause_kind = 'policy_assignment' AND cause_ledger_entry_id IS NULL)
    ),
    CONSTRAINT ck_level_milestones_origin CHECK (origin IN (
        'web_ui', 'web_assistant', 'telegram', 'automation', 'mobile', 'internal'
    ))
);

CREATE TABLE public.level_reward_definitions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    required_level integer NOT NULL,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    estimated_cost numeric,
    currency_label text,
    revision bigint NOT NULL,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_level_reward_definitions PRIMARY KEY (id),
    CONSTRAINT uq_level_reward_definitions_owner UNIQUE (id, user_id),
    CONSTRAINT fk_level_reward_definitions_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_level_reward_definitions_level CHECK (required_level >= 0),
    CONSTRAINT ck_level_reward_definitions_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_level_reward_definitions_category CHECK (category IN (
        'treat', 'purchase', 'experience', 'custom'
    )),
    CONSTRAINT ck_level_reward_definitions_cost_pair CHECK (
        (estimated_cost IS NULL AND currency_label IS NULL)
        OR (
            estimated_cost IS NOT NULL AND currency_label IS NOT NULL
            AND length(btrim(currency_label)) > 0
            AND estimated_cost >= 0 AND estimated_cost = estimated_cost
            AND estimated_cost < 'Infinity'::numeric
        )
    ),
    CONSTRAINT ck_level_reward_definitions_revision CHECK (revision > 0)
);

CREATE TABLE public.level_reward_events (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    command_id uuid NOT NULL,
    event_type text NOT NULL,
    reward_id uuid NOT NULL,
    unlock_id uuid,
    definition_revision bigint,
    payload_version smallint NOT NULL,
    request jsonb NOT NULL,
    before jsonb,
    after jsonb,
    actor_user_id uuid NOT NULL,
    origin text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_level_reward_events PRIMARY KEY (id),
    CONSTRAINT uq_level_reward_events_owner UNIQUE (id, user_id),
    CONSTRAINT uq_level_reward_events_owner_reward UNIQUE (id, user_id, reward_id),
    CONSTRAINT uq_level_reward_events_command UNIQUE (user_id, command_id),
    CONSTRAINT fk_level_reward_events_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_reward_events_actor FOREIGN KEY (actor_user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_reward_events_definition FOREIGN KEY (reward_id, user_id)
        REFERENCES public.level_reward_definitions (id, user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_level_reward_events_type CHECK (event_type IN (
        'configured', 'updated', 'archived', 'redeemed'
    )),
    CONSTRAINT ck_level_reward_events_payload_version CHECK (payload_version = 1),
    CONSTRAINT ck_level_reward_events_origin CHECK (origin IN (
        'web_ui', 'web_assistant', 'telegram', 'automation', 'mobile', 'internal'
    )),
    CONSTRAINT ck_level_reward_events_shape CHECK (
        (event_type = 'configured' AND unlock_id IS NULL AND definition_revision IS NOT NULL
            AND before IS NULL AND after IS NOT NULL)
        OR (event_type = 'updated' AND unlock_id IS NULL AND definition_revision IS NOT NULL
            AND before IS NOT NULL AND after IS NOT NULL)
        OR (event_type = 'archived' AND unlock_id IS NULL AND definition_revision IS NOT NULL
            AND before IS NOT NULL AND after IS NOT NULL)
        OR (event_type = 'redeemed' AND unlock_id IS NOT NULL AND definition_revision IS NULL
            AND before IS NULL AND after IS NULL)
    ),
    CONSTRAINT ck_level_reward_events_revision CHECK (
        definition_revision IS NULL OR definition_revision > 0
    ),
    CONSTRAINT ck_level_reward_events_request CHECK (jsonb_typeof(request) = 'object'),
    CONSTRAINT ck_level_reward_events_actor CHECK (actor_user_id = user_id)
);
CREATE UNIQUE INDEX uq_level_reward_events_definition_revision
    ON public.level_reward_events (reward_id, definition_revision)
    WHERE definition_revision IS NOT NULL;
CREATE UNIQUE INDEX uq_level_reward_events_redemption
    ON public.level_reward_events (unlock_id) WHERE event_type = 'redeemed' AND unlock_id IS NOT NULL;

CREATE TABLE public.level_reward_unlocks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    reward_id uuid NOT NULL,
    milestone_id uuid NOT NULL,
    definition_event_id uuid NOT NULL,
    required_level integer NOT NULL,
    definition_revision bigint NOT NULL,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    estimated_cost numeric,
    currency_label text,
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_level_reward_unlocks PRIMARY KEY (id),
    CONSTRAINT uq_level_reward_unlocks_owner UNIQUE (id, user_id),
    CONSTRAINT uq_level_reward_unlocks_owner_reward UNIQUE (id, user_id, reward_id),
    CONSTRAINT uq_level_reward_unlocks_reward UNIQUE (reward_id),
    CONSTRAINT fk_level_reward_unlocks_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_reward_unlocks_definition FOREIGN KEY (reward_id, user_id)
        REFERENCES public.level_reward_definitions (id, user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_reward_unlocks_milestone FOREIGN KEY (milestone_id, user_id, required_level)
        REFERENCES public.level_milestones (id, user_id, level)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_level_reward_unlocks_event FOREIGN KEY (definition_event_id, user_id, reward_id)
        REFERENCES public.level_reward_events (id, user_id, reward_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_level_reward_unlocks_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_level_reward_unlocks_category CHECK (category IN (
        'treat', 'purchase', 'experience', 'custom'
    )),
    CONSTRAINT ck_level_reward_unlocks_cost_pair CHECK (
        (estimated_cost IS NULL AND currency_label IS NULL)
        OR (
            estimated_cost IS NOT NULL AND currency_label IS NOT NULL
            AND length(btrim(currency_label)) > 0
            AND estimated_cost >= 0 AND estimated_cost = estimated_cost
            AND estimated_cost < 'Infinity'::numeric
        )
    ),
    CONSTRAINT ck_level_reward_unlocks_revision CHECK (definition_revision > 0)
);

ALTER TABLE public.level_reward_events
    ADD CONSTRAINT fk_level_reward_events_unlock FOREIGN KEY (unlock_id, user_id, reward_id)
        REFERENCES public.level_reward_unlocks (id, user_id, reward_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX ix_level_reward_definitions_owner_list
    ON public.level_reward_definitions (user_id, archived_at, required_level, id);
CREATE INDEX ix_level_reward_unlocks_owner_history
    ON public.level_reward_unlocks (user_id, unlocked_at DESC, id);
CREATE INDEX ix_level_reward_events_owner_history
    ON public.level_reward_events (user_id, reward_id, recorded_at DESC, id);
CREATE INDEX ix_progression_policy_assignments_owner_latest
    ON public.progression_policy_assignments (user_id, assignment_sequence DESC);

DO $rls$
DECLARE rel text;
BEGIN
    FOREACH rel IN ARRAY ARRAY[
        'public.level_policies', 'public.level_thresholds', 'public.progression_policy_assignments',
        'public.level_milestones', 'public.level_reward_definitions', 'public.level_reward_unlocks',
        'public.level_reward_events'
    ] LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
        EXECUTE format(
            'REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner',
            rel
        );
    END LOOP;
END;
$rls$;

GRANT SELECT ON TABLE public.level_policies, public.level_thresholds
    TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT SELECT ON TABLE public.progression_policy_assignments
    TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT INSERT ON TABLE public.progression_policy_assignments TO level_policy_assignment_owner;
GRANT SELECT ON TABLE public.level_milestones
    TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT INSERT ON TABLE public.level_milestones
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT SELECT ON TABLE public.level_reward_definitions
    TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT INSERT, UPDATE ON TABLE public.level_reward_definitions TO progression_command_owner;
GRANT SELECT ON TABLE public.level_reward_unlocks
    TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT INSERT ON TABLE public.level_reward_unlocks
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT SELECT ON TABLE public.level_reward_events
    TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT INSERT ON TABLE public.level_reward_events TO progression_command_owner;
GRANT SELECT ON TABLE public.exp_ledger TO progression_command_owner, level_policy_assignment_owner;

CREATE POLICY level_policies_published_select ON public.level_policies
    FOR SELECT TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner
    USING (status = 'published' AND (SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY level_thresholds_published_select ON public.level_thresholds
    FOR SELECT TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.level_policies p
            WHERE p.id = policy_id AND p.status = 'published'
        ));
CREATE POLICY assignments_owner_select ON public.progression_policy_assignments
    FOR SELECT TO authenticated, quest_command_owner, progression_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY assignments_executor_select ON public.progression_policy_assignments
    FOR SELECT TO level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY assignments_executor_insert ON public.progression_policy_assignments
    FOR INSERT TO level_policy_assignment_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY milestones_owner_select ON public.level_milestones
    FOR SELECT TO authenticated, quest_command_owner, progression_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY milestones_executor_select ON public.level_milestones
    FOR SELECT TO level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY milestones_owner_insert ON public.level_milestones
    FOR INSERT TO quest_command_owner, progression_command_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY milestones_executor_insert ON public.level_milestones
    FOR INSERT TO level_policy_assignment_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY definitions_owner_select ON public.level_reward_definitions
    FOR SELECT TO authenticated, quest_command_owner, progression_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY definitions_executor_select ON public.level_reward_definitions
    FOR SELECT TO level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY definitions_command_insert ON public.level_reward_definitions
    FOR INSERT TO progression_command_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY definitions_command_update ON public.level_reward_definitions
    FOR UPDATE TO progression_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()))
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY unlocks_owner_select ON public.level_reward_unlocks
    FOR SELECT TO authenticated, quest_command_owner, progression_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY unlocks_executor_select ON public.level_reward_unlocks
    FOR SELECT TO level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY unlocks_owner_insert ON public.level_reward_unlocks
    FOR INSERT TO quest_command_owner, progression_command_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY unlocks_executor_insert ON public.level_reward_unlocks
    FOR INSERT TO level_policy_assignment_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL);
CREATE POLICY events_owner_select ON public.level_reward_events
    FOR SELECT TO authenticated, quest_command_owner, progression_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY events_executor_select ON public.level_reward_events
    FOR SELECT TO level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND event_type IN ('configured', 'updated', 'archived'));
CREATE POLICY events_command_insert ON public.level_reward_events
    FOR INSERT TO progression_command_owner
    WITH CHECK ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY exp_ledger_progression_select ON public.exp_ledger
    FOR SELECT TO progression_command_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL
        AND user_id = (SELECT system_internal.request_user_id()));
CREATE POLICY exp_ledger_assignment_select ON public.exp_ledger
    FOR SELECT TO level_policy_assignment_owner
    USING ((SELECT system_internal.request_user_id()) IS NOT NULL);

CREATE FUNCTION progression_internal.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'Progression history is immutable' USING ERRCODE = '55000';
END;
$function$;
CREATE FUNCTION progression_internal.reject_published_policy_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'published' THEN
            RAISE EXCEPTION 'Published level policies are immutable' USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'Published level policies are immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.status = 'published' AND OLD.status = 'draft' THEN
        NEW.published_at := now();
        RETURN NEW;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.policy_key IS DISTINCT FROM OLD.policy_key
        OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'Level policy identity is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE FUNCTION progression_internal.reject_published_threshold_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE policy_status text;
BEGIN
    SELECT status INTO policy_status FROM public.level_policies WHERE id = COALESCE(NEW.policy_id, OLD.policy_id);
    IF policy_status = 'published' THEN
        RAISE EXCEPTION 'Published level thresholds are immutable' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE FUNCTION progression_internal.normalize_definition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF NEW.description IS NOT NULL AND length(btrim(NEW.description)) = 0 THEN
        NEW.description := NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.revision IS DISTINCT FROM 1 OR NEW.archived_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid reward definition insert' USING ERRCODE = '23514';
        END IF;
        NEW.created_at := now();
        NEW.updated_at := now();
        RETURN NEW;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Reward definition identity is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Archived reward definitions are immutable' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.level_reward_unlocks u WHERE u.reward_id = OLD.id) THEN
        IF NEW.required_level IS DISTINCT FROM OLD.required_level
            OR NEW.title IS DISTINCT FROM OLD.title
            OR NEW.description IS DISTINCT FROM OLD.description
            OR NEW.category IS DISTINCT FROM OLD.category
            OR NEW.estimated_cost IS DISTINCT FROM OLD.estimated_cost
            OR NEW.currency_label IS DISTINCT FROM OLD.currency_label
            OR NEW.archived_at IS NULL
            OR NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
            RAISE EXCEPTION 'Unlocked reward content is frozen' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
            RAISE EXCEPTION 'Invalid reward definition revision' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

CREATE TRIGGER level_policies_guard_update BEFORE UPDATE ON public.level_policies
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_published_policy_mutation();
CREATE TRIGGER level_policies_guard_delete BEFORE DELETE ON public.level_policies
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_published_policy_mutation();
CREATE TRIGGER level_policies_reject_truncate BEFORE TRUNCATE ON public.level_policies
    FOR EACH STATEMENT EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER level_thresholds_guard_write BEFORE INSERT OR UPDATE OR DELETE ON public.level_thresholds
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_published_threshold_mutation();
CREATE TRIGGER level_thresholds_reject_truncate BEFORE TRUNCATE ON public.level_thresholds
    FOR EACH STATEMENT EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER assignments_reject_mutation BEFORE UPDATE OR DELETE ON public.progression_policy_assignments
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER assignments_reject_truncate BEFORE TRUNCATE ON public.progression_policy_assignments
    FOR EACH STATEMENT EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER milestones_reject_mutation BEFORE UPDATE OR DELETE ON public.level_milestones
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER milestones_reject_truncate BEFORE TRUNCATE ON public.level_milestones
    FOR EACH STATEMENT EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER unlocks_reject_mutation BEFORE UPDATE OR DELETE ON public.level_reward_unlocks
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER unlocks_reject_truncate BEFORE TRUNCATE ON public.level_reward_unlocks
    FOR EACH STATEMENT EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER events_reject_mutation BEFORE UPDATE OR DELETE ON public.level_reward_events
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER events_reject_truncate BEFORE TRUNCATE ON public.level_reward_events
    FOR EACH STATEMENT EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER definitions_normalize BEFORE INSERT OR UPDATE ON public.level_reward_definitions
    FOR EACH ROW EXECUTE FUNCTION progression_internal.normalize_definition();
CREATE TRIGGER definitions_reject_delete BEFORE DELETE ON public.level_reward_definitions
    FOR EACH ROW EXECUTE FUNCTION progression_internal.reject_history_mutation();
CREATE TRIGGER definitions_reject_truncate BEFORE TRUNCATE ON public.level_reward_definitions
    FOR EACH STATEMENT EXECUTE FUNCTION progression_internal.reject_history_mutation();

CREATE FUNCTION progression_internal.require_origin(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF value IS NULL OR value NOT IN ('web_ui', 'web_assistant', 'telegram', 'automation', 'mobile', 'internal') THEN
        RAISE EXCEPTION 'Invalid origin' USING ERRCODE = '22023';
    END IF;
    RETURN value;
END;
$function$;

CREATE FUNCTION progression_internal.lock_owner(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Invalid progression owner' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        hashtextextended('system.v1.progression.owner:' || p_user_id::text, 0)
    );
END;
$function$;

CREATE FUNCTION progression_internal.object_keys(value jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(ARRAY(SELECT jsonb_object_keys(value) ORDER BY 1), ARRAY[]::text[]);
$function$;

CREATE FUNCTION progression_internal.json_uuid(value jsonb) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Invalid reward UUID value' USING ERRCODE = '22023';
    END IF;
    RETURN (value #>> '{}')::uuid;
END;
$function$;

CREATE FUNCTION progression_internal.json_numeric(value jsonb, require_integer boolean) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE result numeric;
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid reward numeric value' USING ERRCODE = '22023';
    END IF;
    result := (value #>> '{}')::numeric;
    IF result <> result OR result >= 'Infinity'::numeric OR result <= '-Infinity'::numeric THEN
        RAISE EXCEPTION 'Nonfinite reward numeric value' USING ERRCODE = '22023';
    END IF;
    IF require_integer AND result <> trunc(result) THEN
        RAISE EXCEPTION 'Fractional reward integer value' USING ERRCODE = '22023';
    END IF;
    IF require_integer THEN
        result := trunc(result);
    END IF;
    RETURN result;
END;
$function$;

CREATE FUNCTION progression_internal.canonical_utc(value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$function$;

CREATE FUNCTION progression_internal.owner_exp(p_user_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(sum(amount), 0::numeric) FROM public.exp_ledger WHERE user_id = p_user_id;
$function$;

CREATE FUNCTION progression_internal.level_for_exp(p_policy_id uuid, p_exp numeric) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT t.level
    FROM public.level_thresholds t
    WHERE t.policy_id = p_policy_id AND t.required_exp <= p_exp
    ORDER BY t.level DESC
    LIMIT 1;
$function$;

CREATE FUNCTION progression_internal.latest_assignment(p_user_id uuid)
RETURNS public.progression_policy_assignments
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
    SELECT a.*
    FROM public.progression_policy_assignments a
    WHERE a.user_id = p_user_id
    ORDER BY a.assignment_sequence DESC
    LIMIT 1;
$function$;

CREATE FUNCTION progression_internal.require_policy_level(p_user_id uuid, p_level integer) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE assignment public.progression_policy_assignments;
BEGIN
    assignment := progression_internal.latest_assignment(p_user_id);
    IF assignment.id IS NULL THEN
        RAISE EXCEPTION 'Progression policy is not assigned' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.level_thresholds t
        WHERE t.policy_id = assignment.policy_id AND t.level = p_level
    ) THEN
        RAISE EXCEPTION 'Required Level is outside the assigned policy' USING ERRCODE = '23514';
    END IF;
END;
$function$;

CREATE FUNCTION progression_internal.parse_fields(value jsonb, allow_partial boolean)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    keys text[];
    allowed text[] := ARRAY['category', 'currency_label', 'description', 'estimated_cost', 'required_level', 'title'];
    key text;
    result jsonb := '{}'::jsonb;
    title text;
    description jsonb;
    category text;
    cost jsonb;
    label jsonb;
    level_num numeric;
    cost_num numeric;
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Invalid reward fields object' USING ERRCODE = '22023';
    END IF;
    keys := progression_internal.object_keys(value);
    IF allow_partial THEN
        FOREACH key IN ARRAY keys LOOP
            IF NOT key = ANY (allowed) THEN
                RAISE EXCEPTION 'Unknown reward field' USING ERRCODE = '22023';
            END IF;
        END LOOP;
    ELSIF keys IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'Invalid reward fields object' USING ERRCODE = '22023';
    END IF;

    IF NOT allow_partial OR value ? 'required_level' THEN
        level_num := progression_internal.json_numeric(value -> 'required_level', true);
        IF level_num < 0 OR level_num > 2147483647 THEN
            RAISE EXCEPTION 'Invalid required Level' USING ERRCODE = '22023';
        END IF;
        result := result || jsonb_build_object('required_level', to_jsonb(level_num));
    END IF;
    IF NOT allow_partial OR value ? 'title' THEN
        IF jsonb_typeof(value -> 'title') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Invalid reward title' USING ERRCODE = '22023';
        END IF;
        title := value ->> 'title';
        IF length(btrim(title)) = 0 THEN
            RAISE EXCEPTION 'Invalid reward title' USING ERRCODE = '22023';
        END IF;
        result := result || jsonb_build_object('title', to_jsonb(title));
    END IF;
    IF NOT allow_partial OR value ? 'description' THEN
        IF (value -> 'description') IS NULL OR jsonb_typeof(value -> 'description') = 'null' THEN
            result := result || '{"description":null}'::jsonb;
        ELSIF jsonb_typeof(value -> 'description') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Invalid reward description' USING ERRCODE = '22023';
        ELSIF length(btrim(value ->> 'description')) = 0 THEN
            result := result || '{"description":null}'::jsonb;
        ELSE
            result := result || jsonb_build_object('description', value -> 'description');
        END IF;
    END IF;
    IF NOT allow_partial OR value ? 'category' THEN
        IF jsonb_typeof(value -> 'category') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Invalid reward category' USING ERRCODE = '22023';
        END IF;
        category := value ->> 'category';
        IF category NOT IN ('treat', 'purchase', 'experience', 'custom') THEN
            RAISE EXCEPTION 'Invalid reward category' USING ERRCODE = '22023';
        END IF;
        result := result || jsonb_build_object('category', to_jsonb(category));
    END IF;
    IF value ? 'estimated_cost' THEN
        IF jsonb_typeof(value -> 'estimated_cost') = 'null' THEN
            result := result || '{"estimated_cost":null}'::jsonb;
        ELSE
            cost_num := progression_internal.json_numeric(value -> 'estimated_cost', false);
            IF cost_num < 0 THEN
                RAISE EXCEPTION 'Invalid reward cost pair' USING ERRCODE = '22023';
            END IF;
            result := result || jsonb_build_object('estimated_cost', to_jsonb(cost_num));
        END IF;
    END IF;
    IF value ? 'currency_label' THEN
        IF jsonb_typeof(value -> 'currency_label') = 'null' THEN
            result := result || '{"currency_label":null}'::jsonb;
        ELSIF jsonb_typeof(value -> 'currency_label') IS DISTINCT FROM 'string'
            OR length(btrim(value ->> 'currency_label')) = 0 THEN
            RAISE EXCEPTION 'Invalid reward cost pair' USING ERRCODE = '22023';
        ELSE
            result := result || jsonb_build_object('currency_label', value -> 'currency_label');
        END IF;
    END IF;
    IF NOT allow_partial THEN
        IF ((result -> 'estimated_cost') IS NULL OR jsonb_typeof(result -> 'estimated_cost') = 'null')
            <> ((result -> 'currency_label') IS NULL OR jsonb_typeof(result -> 'currency_label') = 'null') THEN
            RAISE EXCEPTION 'Invalid reward cost pair' USING ERRCODE = '22023';
        END IF;
    END IF;
    RETURN result;
END;
$function$;

CREATE FUNCTION progression_internal.definition_snapshot(
    d public.level_reward_definitions, p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    RETURN jsonb_build_object(
        'archived_at', CASE
            WHEN d.archived_at IS NULL THEN NULL
            ELSE to_jsonb(progression_internal.canonical_utc(d.archived_at))
        END,
        'category', to_jsonb(d.category),
        'currency_label', to_jsonb(d.currency_label),
        'description', to_jsonb(d.description),
        'estimated_cost', to_jsonb(d.estimated_cost),
        'required_level', to_jsonb(d.required_level),
        'revision', to_jsonb(d.revision),
        'reward_definition_id', to_jsonb(d.id),
        'title', to_jsonb(d.title),
        'user_id', to_jsonb(p_user_id)
    );
END;
$function$;

CREATE FUNCTION progression_internal.canonical_configure_request(request jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF jsonb_typeof(request) IS DISTINCT FROM 'object'
        OR progression_internal.object_keys(request) IS DISTINCT FROM ARRAY['fields', 'operation']
        OR request ->> 'operation' IS DISTINCT FROM 'configureLevelReward' THEN
        RAISE EXCEPTION 'Invalid configure request' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
        'fields', progression_internal.parse_fields(request -> 'fields', false),
        'operation', 'configureLevelReward'
    );
END;
$function$;

CREATE FUNCTION progression_internal.canonical_update_request(request jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE revision numeric;
BEGIN
    IF jsonb_typeof(request) IS DISTINCT FROM 'object'
        OR progression_internal.object_keys(request)
            IS DISTINCT FROM ARRAY['changes', 'expected_revision', 'operation', 'reward_definition_id']
        OR request ->> 'operation' IS DISTINCT FROM 'updateLevelReward' THEN
        RAISE EXCEPTION 'Invalid update request' USING ERRCODE = '22023';
    END IF;
    revision := progression_internal.json_numeric(request -> 'expected_revision', true);
    IF revision < 1 OR revision > 9223372036854775807 THEN
        RAISE EXCEPTION 'Invalid expected revision' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
        'changes', progression_internal.parse_fields(request -> 'changes', true),
        'expected_revision', to_jsonb(revision),
        'operation', 'updateLevelReward',
        'reward_definition_id', to_jsonb(progression_internal.json_uuid(request -> 'reward_definition_id'))
    );
END;
$function$;

CREATE FUNCTION progression_internal.canonical_archive_request(request jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE revision numeric;
BEGIN
    IF jsonb_typeof(request) IS DISTINCT FROM 'object'
        OR progression_internal.object_keys(request)
            IS DISTINCT FROM ARRAY['expected_revision', 'operation', 'reward_definition_id']
        OR request ->> 'operation' IS DISTINCT FROM 'cancelLevelReward' THEN
        RAISE EXCEPTION 'Invalid archive request' USING ERRCODE = '22023';
    END IF;
    revision := progression_internal.json_numeric(request -> 'expected_revision', true);
    IF revision < 1 OR revision > 9223372036854775807 THEN
        RAISE EXCEPTION 'Invalid expected revision' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
        'expected_revision', to_jsonb(revision),
        'operation', 'cancelLevelReward',
        'reward_definition_id', to_jsonb(progression_internal.json_uuid(request -> 'reward_definition_id'))
    );
END;
$function$;

CREATE FUNCTION progression_internal.canonical_redeem_request(request jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF jsonb_typeof(request) IS DISTINCT FROM 'object'
        OR progression_internal.object_keys(request) IS DISTINCT FROM ARRAY['operation', 'reward_unlock_id']
        OR request ->> 'operation' IS DISTINCT FROM 'redeemLevelReward' THEN
        RAISE EXCEPTION 'Invalid redeem request' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
        'operation', 'redeemLevelReward',
        'reward_unlock_id', to_jsonb(progression_internal.json_uuid(request -> 'reward_unlock_id'))
    );
END;
$function$;

CREATE FUNCTION progression_internal.json_same(left_value jsonb, right_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE key text;
BEGIN
    IF left_value IS NULL AND right_value IS NULL THEN
        RETURN true;
    END IF;
    IF left_value IS NULL OR right_value IS NULL
        OR jsonb_typeof(left_value) IS DISTINCT FROM jsonb_typeof(right_value) THEN
        RETURN false;
    END IF;
    IF jsonb_typeof(left_value) = 'number' THEN
        RETURN progression_internal.json_numeric(left_value, false)
            = progression_internal.json_numeric(right_value, false);
    END IF;
    IF jsonb_typeof(left_value) <> 'object' THEN
        RETURN left_value = right_value;
    END IF;
    IF progression_internal.object_keys(left_value) IS DISTINCT FROM progression_internal.object_keys(right_value) THEN
        RETURN false;
    END IF;
    FOREACH key IN ARRAY progression_internal.object_keys(left_value) LOOP
        IF NOT progression_internal.json_same(left_value -> key, right_value -> key) THEN
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$function$;

CREATE FUNCTION progression_internal.publish_level_policy(p_policy_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    min_level integer;
    max_level integer;
    threshold_count integer;
    baseline numeric;
BEGIN
    PERFORM 1 FROM public.level_policies WHERE id = p_policy_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown level policy' USING ERRCODE = 'P0002';
    END IF;
    SELECT min(level), max(level), count(*)::integer INTO min_level, max_level, threshold_count
        FROM public.level_thresholds WHERE policy_id = p_policy_id;
    SELECT required_exp INTO baseline FROM public.level_thresholds
        WHERE policy_id = p_policy_id AND level = min_level;
    IF min_level IS NULL OR threshold_count <> (max_level - min_level + 1)
        OR EXISTS (
            SELECT 1 FROM generate_series(min_level, max_level) s(level)
            WHERE NOT EXISTS (
                SELECT 1 FROM public.level_thresholds t
                WHERE t.policy_id = p_policy_id AND t.level = s.level
            )
        )
        OR EXISTS (
            SELECT 1 FROM public.level_thresholds a
            JOIN public.level_thresholds b ON b.policy_id = a.policy_id AND b.level = a.level + 1
            WHERE a.policy_id = p_policy_id AND b.required_exp <= a.required_exp
        )
        OR baseline IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'Invalid level policy publication' USING ERRCODE = '23514';
    END IF;
    UPDATE public.level_policies SET status = 'published' WHERE id = p_policy_id AND status = 'draft';
END;
$function$;

CREATE FUNCTION progression_internal.unlock_eligible(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    INSERT INTO public.level_reward_unlocks (
        user_id, reward_id, milestone_id, definition_event_id,
        required_level, definition_revision, title, description, category,
        estimated_cost, currency_label
    )
    SELECT d.user_id, d.id, m.id, e.id,
        d.required_level, d.revision, d.title, d.description, d.category,
        d.estimated_cost, d.currency_label
    FROM public.level_reward_definitions d
    JOIN public.level_milestones m
        ON m.user_id = d.user_id AND m.level = d.required_level
    JOIN public.level_reward_events e
        ON e.user_id = d.user_id AND e.reward_id = d.id
        AND e.definition_revision = d.revision
        AND e.event_type IN ('configured', 'updated')
    WHERE d.user_id = p_user_id
      AND d.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.level_reward_unlocks u WHERE u.reward_id = d.id
      );
END;
$function$;

CREATE FUNCTION progression_internal.recognize_progress(
    p_user_id uuid,
    p_cause_kind text,
    p_cause_ledger_entry_id uuid,
    p_actor_user_id uuid,
    p_origin text
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    v_exp numeric;
    v_level integer;
    v_assignment public.progression_policy_assignments;
    v_origin text;
BEGIN
    v_origin := progression_internal.require_origin(p_origin);
    IF p_user_id IS NULL OR p_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'Invalid progression recognition' USING ERRCODE = '22023';
    END IF;
    IF current_user = 'level_policy_assignment_owner' THEN
        IF p_actor_user_id IS DISTINCT FROM system_internal.request_user_id()
            OR NOT system_internal.has_capability('level_policy_assign') THEN
            RAISE EXCEPTION 'Unauthorized progression recognition' USING ERRCODE = '42501';
        END IF;
    ELSIF current_user IN ('quest_command_owner', 'progression_command_owner') THEN
        IF p_user_id IS DISTINCT FROM system_internal.request_user_id()
            OR p_actor_user_id IS DISTINCT FROM system_internal.request_user_id() THEN
            RAISE EXCEPTION 'Unauthorized progression recognition' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unauthorized progression recognition' USING ERRCODE = '42501';
    END IF;

    v_assignment := progression_internal.latest_assignment(p_user_id);
    IF v_assignment.id IS NULL THEN
        RAISE EXCEPTION 'Progression policy is not assigned' USING ERRCODE = 'P0001';
    END IF;
    v_exp := progression_internal.owner_exp(p_user_id);

    IF p_cause_kind = 'exp_credit' THEN
        IF p_cause_ledger_entry_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.exp_ledger e
            WHERE e.id = p_cause_ledger_entry_id AND e.user_id = p_user_id
                AND e.source_type = 'quest_completion' AND e.reason = 'completion_reward'
        ) THEN
            RAISE EXCEPTION 'Invalid EXP recognition source' USING ERRCODE = '23514';
        END IF;
    ELSIF p_cause_kind = 'policy_assignment' THEN
        IF p_cause_ledger_entry_id IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid assignment recognition source' USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid recognition cause' USING ERRCODE = '23514';
    END IF;

    v_level := progression_internal.level_for_exp(v_assignment.policy_id, v_exp);
    IF v_level IS NOT NULL THEN
        INSERT INTO public.level_milestones (
            user_id, level, policy_assignment_id, policy_id, evaluated_exp,
            cause_kind, cause_ledger_entry_id, actor_user_id, origin
        )
        SELECT p_user_id, t.level, v_assignment.id, v_assignment.policy_id, v_exp,
            p_cause_kind, p_cause_ledger_entry_id, p_actor_user_id, v_origin
        FROM public.level_thresholds t
        WHERE t.policy_id = v_assignment.policy_id
          AND t.level <= v_level
          AND NOT EXISTS (
              SELECT 1 FROM public.level_milestones m
              WHERE m.user_id = p_user_id AND m.level = t.level
          );
    END IF;
    PERFORM progression_internal.unlock_eligible(p_user_id);
END;
$function$;

CREATE FUNCTION progression_internal.recognize_after_exp(p_ledger_entry_id uuid, p_origin text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE entry public.exp_ledger;
    actor uuid;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO entry FROM public.exp_ledger
        WHERE id = p_ledger_entry_id AND user_id = actor;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid EXP recognition source' USING ERRCODE = '23514';
    END IF;
    IF entry.source_type = 'quest_completion_reversal' THEN
        RETURN;
    END IF;
    PERFORM progression_internal.recognize_progress(
        actor, 'exp_credit', entry.id, actor, p_origin
    );
END;
$function$;

CREATE FUNCTION progression_internal.apply_changes(
    d public.level_reward_definitions, changes jsonb
) RETURNS public.level_reward_definitions
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF changes ? 'required_level' THEN
        d.required_level := progression_internal.json_numeric(changes -> 'required_level', true)::integer;
    END IF;
    IF changes ? 'title' THEN
        d.title := changes ->> 'title';
    END IF;
    IF changes ? 'description' THEN
        IF jsonb_typeof(changes -> 'description') = 'null' THEN
            d.description := NULL;
        ELSE
            d.description := changes ->> 'description';
        END IF;
    END IF;
    IF changes ? 'category' THEN
        d.category := changes ->> 'category';
    END IF;
    IF changes ? 'estimated_cost' OR changes ? 'currency_label' THEN
        IF jsonb_typeof(changes -> 'estimated_cost') = 'null'
            OR jsonb_typeof(changes -> 'currency_label') = 'null' THEN
            d.estimated_cost := NULL;
            d.currency_label := NULL;
        ELSE
            IF changes ? 'estimated_cost' THEN
                d.estimated_cost := progression_internal.json_numeric(changes -> 'estimated_cost', false);
            END IF;
            IF changes ? 'currency_label' THEN
                d.currency_label := changes ->> 'currency_label';
            END IF;
        END IF;
    END IF;
    IF (d.estimated_cost IS NULL) <> (d.currency_label IS NULL)
        OR (d.currency_label IS NOT NULL AND length(btrim(d.currency_label)) = 0)
        OR (d.estimated_cost IS NOT NULL AND d.estimated_cost < 0) THEN
        RAISE EXCEPTION 'Invalid reward cost pair' USING ERRCODE = '22023';
    END IF;
    RETURN d;
END;
$function$;

CREATE TYPE public.progression_status AS (
    available boolean,
    current_exp numeric,
    current_level integer,
    highest_level integer,
    policy_id uuid,
    policy_key text,
    policy_version integer,
    current_level_required_exp numeric,
    next_level integer,
    next_level_required_exp numeric
);

CREATE TYPE public.level_reward_listing AS (
    reward_id uuid,
    required_level integer,
    title text,
    description text,
    category text,
    estimated_cost numeric,
    currency_label text,
    revision bigint,
    archived_at timestamptz,
    lifecycle text,
    unlock_id uuid,
    unlocked_at timestamptz,
    redemption_event_id uuid,
    redeemed_at timestamptz
);

CREATE TYPE public.level_reward_command_result AS (
    event_id uuid,
    reward_id uuid,
    unlock_id uuid,
    event_type text,
    definition_revision bigint,
    request jsonb,
    before_snapshot jsonb,
    after_snapshot jsonb,
    recorded_at timestamptz
);

CREATE FUNCTION public.get_progression_status() RETURNS public.progression_status
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    result public.progression_status;
    assignment public.progression_policy_assignments;
    policy public.level_policies;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    -- Owner-scoped reads only: this routine runs with the caller's RLS-bound privileges.
    result.current_exp := (SELECT COALESCE(sum(e.amount), 0::numeric)
        FROM public.exp_ledger e WHERE e.user_id = actor);
    result.available := false;
    SELECT a.* INTO assignment FROM public.progression_policy_assignments a
        WHERE a.user_id = actor
        ORDER BY a.assignment_sequence DESC
        LIMIT 1;
    IF assignment.id IS NULL THEN
        SELECT max(m.level) INTO result.highest_level
            FROM public.level_milestones m WHERE m.user_id = actor;
        RETURN result;
    END IF;
    SELECT p.* INTO policy FROM public.level_policies p
        WHERE p.id = assignment.policy_id AND p.status = 'published';
    IF NOT FOUND THEN
        RETURN result;
    END IF;
    result.available := true;
    result.policy_id := policy.id;
    result.policy_key := policy.policy_key;
    result.policy_version := policy.version;
    SELECT t.level INTO result.current_level FROM public.level_thresholds t
        WHERE t.policy_id = policy.id AND t.required_exp <= result.current_exp
        ORDER BY t.level DESC
        LIMIT 1;
    SELECT max(m.level) INTO result.highest_level
        FROM public.level_milestones m WHERE m.user_id = actor;
    IF result.current_level IS NOT NULL THEN
        SELECT t.required_exp INTO result.current_level_required_exp
        FROM public.level_thresholds t
        WHERE t.policy_id = policy.id AND t.level = result.current_level;
        SELECT t.level, t.required_exp INTO result.next_level, result.next_level_required_exp
        FROM public.level_thresholds t
        WHERE t.policy_id = policy.id AND t.level = result.current_level + 1;
    END IF;
    RETURN result;
END;
$function$;

CREATE FUNCTION public.list_level_rewards() RETURNS SETOF public.level_reward_listing
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT d.id, d.required_level, d.title, d.description, d.category, d.estimated_cost,
        d.currency_label, d.revision, d.archived_at,
        CASE
            WHEN u.id IS NULL THEN 'LOCKED'
            WHEN e.id IS NULL THEN 'UNLOCKED'
            ELSE 'REDEEMED'
        END,
        u.id, u.unlocked_at, e.id, e.recorded_at
    FROM public.level_reward_definitions d
    LEFT JOIN public.level_reward_unlocks u ON u.reward_id = d.id
    LEFT JOIN public.level_reward_events e ON e.unlock_id = u.id AND e.event_type = 'redeemed'
    WHERE d.user_id = actor
    ORDER BY d.required_level, d.id;
END;
$function$;

CREATE FUNCTION public.get_reward_history() RETURNS SETOF public.level_reward_events
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT e.* FROM public.level_reward_events e
    WHERE e.user_id = actor
    ORDER BY e.recorded_at, e.id;
END;
$function$;

CREATE FUNCTION public.assign_level_policy(
    target_user_id uuid, policy_id uuid, command_id uuid, origin text
) RETURNS public.progression_policy_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    receipt public.progression_policy_assignments;
    next_sequence bigint;
    evaluated numeric;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL OR target_user_id IS NULL OR policy_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    IF NOT system_internal.has_capability('level_policy_assign') THEN
        RAISE EXCEPTION 'Level policy assignment is not authorized' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.level_policies p WHERE p.id = policy_id AND p.status = 'published'
    ) THEN
        RAISE EXCEPTION 'Level policy is not published' USING ERRCODE = '23514';
    END IF;
    PERFORM progression_internal.lock_owner(target_user_id);
    IF NOT system_internal.has_capability('level_policy_assign') THEN
        RAISE EXCEPTION 'Level policy assignment is not authorized' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO receipt FROM public.progression_policy_assignments a
        WHERE a.user_id = assign_level_policy.target_user_id
            AND a.command_id = assign_level_policy.command_id;
    IF FOUND THEN
        IF receipt.policy_id IS DISTINCT FROM policy_id THEN
            RAISE EXCEPTION 'Conflicting level policy assignment command' USING ERRCODE = '23505';
        END IF;
        RETURN receipt;
    END IF;
    evaluated := progression_internal.owner_exp(target_user_id);
    SELECT COALESCE(max(a.assignment_sequence), 0) + 1 INTO next_sequence
        FROM public.progression_policy_assignments a WHERE a.user_id = target_user_id;
    INSERT INTO public.progression_policy_assignments (
        user_id, policy_id, assignment_sequence, command_id, evaluated_exp, actor_user_id, origin
    ) VALUES (
        target_user_id, policy_id, next_sequence, command_id, evaluated, actor, origin
    ) RETURNING * INTO receipt;
    PERFORM progression_internal.recognize_progress(
        target_user_id, 'policy_assignment', NULL, actor, origin
    );
    RETURN receipt;
END;
$function$;

CREATE FUNCTION public.configure_level_reward(command_id uuid, request jsonb, origin text)
RETURNS public.level_reward_command_result
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    canonical jsonb;
    fields jsonb;
    definition public.level_reward_definitions;
    event_row public.level_reward_events;
    result public.level_reward_command_result;
    unlock uuid;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    canonical := progression_internal.canonical_configure_request(request);
    PERFORM progression_internal.lock_owner(actor);
    SELECT * INTO event_row FROM public.level_reward_events e
        WHERE e.user_id = actor AND e.command_id = configure_level_reward.command_id;
    IF FOUND THEN
        IF event_row.event_type IS DISTINCT FROM 'configured'
            OR event_row.payload_version IS DISTINCT FROM 1
            OR NOT progression_internal.json_same(event_row.request, canonical) THEN
            RAISE EXCEPTION 'Conflicting reward command' USING ERRCODE = '23505';
        END IF;
        SELECT u.id INTO unlock FROM public.level_reward_unlocks u WHERE u.reward_id = event_row.reward_id;
        result := (event_row.id, event_row.reward_id, unlock, event_row.event_type,
            event_row.definition_revision, event_row.request, event_row.before, event_row.after,
            event_row.recorded_at);
        RETURN result;
    END IF;
    fields := canonical -> 'fields';
    PERFORM progression_internal.require_policy_level(
        actor, progression_internal.json_numeric(fields -> 'required_level', true)::integer
    );
    INSERT INTO public.level_reward_definitions (
        user_id, required_level, title, description, category, estimated_cost, currency_label, revision
    ) VALUES (
        actor,
        progression_internal.json_numeric(fields -> 'required_level', true)::integer,
        fields ->> 'title',
        CASE WHEN jsonb_typeof(fields -> 'description') = 'null' THEN NULL ELSE fields ->> 'description' END,
        fields ->> 'category',
        CASE WHEN jsonb_typeof(fields -> 'estimated_cost') = 'null' THEN NULL
            ELSE progression_internal.json_numeric(fields -> 'estimated_cost', false) END,
        CASE WHEN jsonb_typeof(fields -> 'currency_label') = 'null' THEN NULL ELSE fields ->> 'currency_label' END,
        1
    ) RETURNING * INTO definition;
    INSERT INTO public.level_reward_events (
        user_id, command_id, event_type, reward_id, definition_revision, payload_version,
        request, before, after, actor_user_id, origin
    ) VALUES (
        actor, command_id, 'configured', definition.id, 1, 1, canonical, NULL,
        progression_internal.definition_snapshot(definition, actor), actor, origin
    ) RETURNING * INTO event_row;
    PERFORM progression_internal.unlock_eligible(actor);
    SELECT u.id INTO unlock FROM public.level_reward_unlocks u WHERE u.reward_id = definition.id;
    result := (event_row.id, event_row.reward_id, unlock, event_row.event_type,
        event_row.definition_revision, event_row.request, event_row.before, event_row.after,
        event_row.recorded_at);
    RETURN result;
END;
$function$;

CREATE FUNCTION public.update_level_reward(command_id uuid, request jsonb, origin text)
RETURNS public.level_reward_command_result
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    canonical jsonb;
    definition public.level_reward_definitions;
    updated public.level_reward_definitions;
    event_row public.level_reward_events;
    result public.level_reward_command_result;
    unlock uuid;
    before_snap jsonb;
    expected bigint;
    target uuid;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    canonical := progression_internal.canonical_update_request(request);
    PERFORM progression_internal.lock_owner(actor);
    SELECT * INTO event_row FROM public.level_reward_events e
        WHERE e.user_id = actor AND e.command_id = update_level_reward.command_id;
    IF FOUND THEN
        IF event_row.event_type IS DISTINCT FROM 'updated'
            OR event_row.payload_version IS DISTINCT FROM 1
            OR NOT progression_internal.json_same(event_row.request, canonical) THEN
            RAISE EXCEPTION 'Conflicting reward command' USING ERRCODE = '23505';
        END IF;
        SELECT u.id INTO unlock FROM public.level_reward_unlocks u WHERE u.reward_id = event_row.reward_id;
        RETURN (event_row.id, event_row.reward_id, unlock, event_row.event_type,
            event_row.definition_revision, event_row.request, event_row.before, event_row.after,
            event_row.recorded_at);
    END IF;
    target := progression_internal.json_uuid(canonical -> 'reward_definition_id');
    expected := progression_internal.json_numeric(canonical -> 'expected_revision', true)::bigint;
    SELECT * INTO definition FROM public.level_reward_definitions
        WHERE id = target AND user_id = actor;
    IF NOT FOUND OR definition.revision IS DISTINCT FROM expected OR definition.archived_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.level_reward_unlocks u WHERE u.reward_id = definition.id) THEN
        RAISE EXCEPTION 'Reward definition cannot be updated' USING ERRCODE = '23514';
    END IF;
    before_snap := progression_internal.definition_snapshot(definition, actor);
    updated := progression_internal.apply_changes(definition, canonical -> 'changes');
    PERFORM progression_internal.require_policy_level(actor, updated.required_level);
    UPDATE public.level_reward_definitions SET
        required_level = updated.required_level,
        title = updated.title,
        description = updated.description,
        category = updated.category,
        estimated_cost = updated.estimated_cost,
        currency_label = updated.currency_label,
        revision = definition.revision + 1
    WHERE id = definition.id AND user_id = actor
    RETURNING * INTO updated;
    INSERT INTO public.level_reward_events (
        user_id, command_id, event_type, reward_id, definition_revision, payload_version,
        request, before, after, actor_user_id, origin
    ) VALUES (
        actor, command_id, 'updated', updated.id, updated.revision, 1, canonical, before_snap,
        progression_internal.definition_snapshot(updated, actor), actor, origin
    ) RETURNING * INTO event_row;
    PERFORM progression_internal.unlock_eligible(actor);
    SELECT u.id INTO unlock FROM public.level_reward_unlocks u WHERE u.reward_id = updated.id;
    RETURN (event_row.id, event_row.reward_id, unlock, event_row.event_type,
        event_row.definition_revision, event_row.request, event_row.before, event_row.after,
        event_row.recorded_at);
END;
$function$;

CREATE FUNCTION public.cancel_level_reward(command_id uuid, request jsonb, origin text)
RETURNS public.level_reward_command_result
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    canonical jsonb;
    definition public.level_reward_definitions;
    archived public.level_reward_definitions;
    event_row public.level_reward_events;
    unlock uuid;
    before_snap jsonb;
    expected bigint;
    target uuid;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    canonical := progression_internal.canonical_archive_request(request);
    PERFORM progression_internal.lock_owner(actor);
    SELECT * INTO event_row FROM public.level_reward_events e
        WHERE e.user_id = actor AND e.command_id = cancel_level_reward.command_id;
    IF FOUND THEN
        IF event_row.event_type IS DISTINCT FROM 'archived'
            OR event_row.payload_version IS DISTINCT FROM 1
            OR NOT progression_internal.json_same(event_row.request, canonical) THEN
            RAISE EXCEPTION 'Conflicting reward command' USING ERRCODE = '23505';
        END IF;
        SELECT u.id INTO unlock FROM public.level_reward_unlocks u WHERE u.reward_id = event_row.reward_id;
        RETURN (event_row.id, event_row.reward_id, unlock, event_row.event_type,
            event_row.definition_revision, event_row.request, event_row.before, event_row.after,
            event_row.recorded_at);
    END IF;
    target := progression_internal.json_uuid(canonical -> 'reward_definition_id');
    expected := progression_internal.json_numeric(canonical -> 'expected_revision', true)::bigint;
    SELECT * INTO definition FROM public.level_reward_definitions
        WHERE id = target AND user_id = actor;
    IF NOT FOUND OR definition.revision IS DISTINCT FROM expected OR definition.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Reward definition cannot be archived' USING ERRCODE = '23514';
    END IF;
    before_snap := progression_internal.definition_snapshot(definition, actor);
    UPDATE public.level_reward_definitions
        SET archived_at = now(), revision = definition.revision + 1
        WHERE id = definition.id AND user_id = actor
        RETURNING * INTO archived;
    INSERT INTO public.level_reward_events (
        user_id, command_id, event_type, reward_id, definition_revision, payload_version,
        request, before, after, actor_user_id, origin
    ) VALUES (
        actor, command_id, 'archived', archived.id, archived.revision, 1, canonical, before_snap,
        progression_internal.definition_snapshot(archived, actor), actor, origin
    ) RETURNING * INTO event_row;
    SELECT u.id INTO unlock FROM public.level_reward_unlocks u WHERE u.reward_id = archived.id;
    RETURN (event_row.id, event_row.reward_id, unlock, event_row.event_type,
        event_row.definition_revision, event_row.request, event_row.before, event_row.after,
        event_row.recorded_at);
END;
$function$;

CREATE FUNCTION public.redeem_level_reward(command_id uuid, request jsonb, origin text)
RETURNS public.level_reward_command_result
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
    actor uuid;
    canonical jsonb;
    unlock public.level_reward_unlocks;
    event_row public.level_reward_events;
    target uuid;
BEGIN
    actor := system_internal.request_user_id();
    IF actor IS NULL OR command_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    PERFORM progression_internal.require_origin(origin);
    canonical := progression_internal.canonical_redeem_request(request);
    PERFORM progression_internal.lock_owner(actor);
    SELECT * INTO event_row FROM public.level_reward_events e
        WHERE e.user_id = actor AND e.command_id = redeem_level_reward.command_id;
    IF FOUND THEN
        IF event_row.event_type IS DISTINCT FROM 'redeemed'
            OR event_row.payload_version IS DISTINCT FROM 1
            OR NOT progression_internal.json_same(event_row.request, canonical) THEN
            RAISE EXCEPTION 'Conflicting reward command' USING ERRCODE = '23505';
        END IF;
        RETURN (event_row.id, event_row.reward_id, event_row.unlock_id, event_row.event_type,
            event_row.definition_revision, event_row.request, event_row.before, event_row.after,
            event_row.recorded_at);
    END IF;
    target := progression_internal.json_uuid(canonical -> 'reward_unlock_id');
    SELECT * INTO event_row FROM public.level_reward_events
        WHERE user_id = actor AND unlock_id = target AND event_type = 'redeemed';
    IF FOUND THEN
        RETURN (event_row.id, event_row.reward_id, event_row.unlock_id, event_row.event_type,
            event_row.definition_revision, event_row.request, event_row.before, event_row.after,
            event_row.recorded_at);
    END IF;
    SELECT * INTO unlock FROM public.level_reward_unlocks WHERE id = target AND user_id = actor;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reward unlock not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.level_reward_events (
        user_id, command_id, event_type, reward_id, unlock_id, definition_revision, payload_version,
        request, before, after, actor_user_id, origin
    ) VALUES (
        actor, command_id, 'redeemed', unlock.reward_id, unlock.id, NULL, 1, canonical, NULL, NULL,
        actor, origin
    ) RETURNING * INTO event_row;
    RETURN (event_row.id, event_row.reward_id, event_row.unlock_id, event_row.event_type,
        event_row.definition_revision, event_row.request, event_row.before, event_row.after,
        event_row.recorded_at);
END;
$function$;

-- Temporary migration-executor membership/schema CREATE permits ownership
-- transfer; neither capability is retained or granted to browser roles.
GRANT progression_command_owner TO CURRENT_USER;
GRANT level_policy_assignment_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO progression_command_owner, level_policy_assignment_owner;
ALTER FUNCTION public.assign_level_policy(uuid, uuid, uuid, text) OWNER TO level_policy_assignment_owner;
ALTER FUNCTION public.configure_level_reward(uuid, jsonb, text) OWNER TO progression_command_owner;
ALTER FUNCTION public.update_level_reward(uuid, jsonb, text) OWNER TO progression_command_owner;
ALTER FUNCTION public.cancel_level_reward(uuid, jsonb, text) OWNER TO progression_command_owner;
ALTER FUNCTION public.redeem_level_reward(uuid, jsonb, text) OWNER TO progression_command_owner;
REVOKE CREATE ON SCHEMA public FROM progression_command_owner, level_policy_assignment_owner;

REVOKE ALL ON FUNCTION progression_internal.publish_level_policy(uuid) FROM PUBLIC, anon, authenticated,
    service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA progression_internal FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION progression_internal.lock_owner(uuid) TO quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.recognize_after_exp(uuid, text) TO quest_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.recognize_progress(uuid, text, uuid, uuid, text)
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.unlock_eligible(uuid)
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.level_for_exp(uuid, numeric)
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.owner_exp(uuid)
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.latest_assignment(uuid)
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.require_origin(text)
    TO quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.require_policy_level(uuid, integer)
    TO progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.parse_fields(jsonb, boolean) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.definition_snapshot(public.level_reward_definitions, uuid)
    TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.canonical_configure_request(jsonb) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.canonical_update_request(jsonb) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.canonical_archive_request(jsonb) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.canonical_redeem_request(jsonb) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.json_same(jsonb, jsonb) TO progression_command_owner,
    level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION progression_internal.json_uuid(jsonb) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.json_numeric(jsonb, boolean) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.object_keys(jsonb) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.canonical_utc(timestamptz) TO progression_command_owner;
GRANT EXECUTE ON FUNCTION progression_internal.apply_changes(public.level_reward_definitions, jsonb)
    TO progression_command_owner;

REVOKE ALL ON FUNCTION public.assign_level_policy(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, progression_command_owner;
GRANT EXECUTE ON FUNCTION public.assign_level_policy(uuid, uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.configure_level_reward(uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.configure_level_reward(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_level_reward(uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.update_level_reward(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_level_reward(uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.cancel_level_reward(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.redeem_level_reward(uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role, quest_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.redeem_level_reward(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_progression_status()
    FROM PUBLIC, anon, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.get_progression_status() TO authenticated;
REVOKE ALL ON FUNCTION public.list_level_rewards()
    FROM PUBLIC, anon, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.list_level_rewards() TO authenticated;
REVOKE ALL ON FUNCTION public.get_reward_history()
    FROM PUBLIC, anon, service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION public.get_reward_history() TO authenticated;

DO $seed$
DECLARE policy uuid;
BEGIN
    INSERT INTO public.level_policies (policy_key, version, name, status)
        VALUES ('level_policy_v1', 1, 'SYSTEM V1 Level policy', 'draft')
        RETURNING id INTO policy;
    INSERT INTO public.level_thresholds (policy_id, level, required_exp)
    SELECT policy, lvl, (100 * (lvl - 1) * (lvl - 1))::numeric
    FROM generate_series(1, 100) AS g(lvl);
    PERFORM progression_internal.publish_level_policy(policy);
    IF NOT EXISTS (
        SELECT 1 FROM public.level_policies p
        JOIN public.level_thresholds t ON t.policy_id = p.id
        WHERE p.policy_key = 'level_policy_v1' AND p.version = 1 AND p.status = 'published'
        GROUP BY p.id
        HAVING count(*) = 100
            AND min(t.required_exp) FILTER (WHERE t.level = 1) = 0
            AND max(t.required_exp) FILTER (WHERE t.level = 100) = 980100
            AND bool_and(t.required_exp = (100 * (t.level - 1) * (t.level - 1))::numeric)
    ) THEN
        RAISE EXCEPTION 'level_policy_v1 seed failed';
    END IF;
END;
$seed$;

COMMENT ON TABLE public.level_policies IS
    'Versioned Level policies. Published rows and thresholds are immutable. Runtime evaluation reads persisted thresholds only.';
COMMENT ON TABLE public.level_thresholds IS
    'Explicit cumulative EXP thresholds for a policy version. No runtime formula and no extrapolation beyond the published range.';
COMMENT ON TABLE public.progression_policy_assignments IS
    'Append-only owner policy enrollment. Latest assignment_sequence is authoritative; assignment recognizes current-state milestones atomically.';
COMMENT ON TABLE public.level_milestones IS
    'Immutable first-reached owner/Level history. EXP reversal never deletes these rows.';
COMMENT ON TABLE public.level_reward_definitions IS
    'Owner-configured lifetime rewards. Content freezes after unlock; archive is permanent.';
COMMENT ON TABLE public.level_reward_unlocks IS
    'Immutable entitlement snapshots. Definition edits never rewrite these rows.';
COMMENT ON TABLE public.level_reward_events IS
    'Reward command receipts for configured/updated/archived/redeemed V1 payloads. Redemption is manual and nonfinancial.';
COMMENT ON TABLE system_internal.operator_grants IS
    'Private SYSTEM operator capability state. Fresh deployments have zero grants.';
COMMENT ON FUNCTION public.assign_level_policy(uuid, uuid, uuid, text) IS
    'Capability-checked Level policy assignment with atomic target progression recognition.';
COMMENT ON FUNCTION public.get_progression_status() IS
    'Authenticated-owner derived EXP/Level/highest-Level read. Unavailable when no published policy is assigned.';

-- Command ACLs and comments belong to the executor roles; drop the temporary
-- migration membership so no executor capability is retained by the migration role.
REVOKE progression_command_owner FROM CURRENT_USER;
REVOKE level_policy_assignment_owner FROM CURRENT_USER;

COMMIT;
