-- Quest Engine V1: storage and authorization boundary only.
-- Authority: docs/02-architecture/quest-database-schema.md, sections 4-18.
-- Requires existing Supabase auth.users, auth.uid(), anon/authenticated roles,
-- gen_random_uuid(), and a migration executor permitted to create this role.
-- No command routines, scheduler, external domain tables or EXP ledger exist here.
-- Keep production writes disabled until the separately reviewed routines exist.

-- This role is deliberately NOT a table owner and has no client memberships.
-- Future SECURITY DEFINER commands must preserve request auth context, use a
-- fixed safe search_path, and be owned by this RLS-bound role, not postgres.
CREATE ROLE quest_command_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

-- Value-only constraint helper: canonical, one-based ISO weekdays, no nulls.
CREATE FUNCTION public.quest_valid_weekdays(days smallint[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(
        array_ndims(days) = 1
        AND array_lower(days, 1) = 1
        AND cardinality(days) BETWEEN 1 AND 7
        AND days = ARRAY(
            SELECT DISTINCT day
            FROM unnest(days) AS value(day)
            WHERE day BETWEEN 1 AND 7
            ORDER BY day
        ),
        false
    );
$function$;

REVOKE ALL ON FUNCTION public.quest_valid_weekdays(smallint[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quest_valid_weekdays(smallint[])
    TO quest_command_owner;

CREATE TABLE public.quests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    importance text NOT NULL DEFAULT 'side',
    priority text,
    default_difficulty smallint,
    default_estimated_duration_minutes integer,
    default_energy_cost smallint,
    default_focus_demand smallint,
    default_reward_exp integer,
    direct_goal_id uuid,
    project_id uuid,
    recurrence_mode text NOT NULL DEFAULT 'one_off',
    default_penalty_snapshot jsonb,
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    notes text,
    materialized_occurrence_count bigint NOT NULL DEFAULT 0,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_quest_owner UNIQUE (id, user_id),
    CONSTRAINT fk_quest_auth_owner FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_quest_title CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 120),
    CONSTRAINT ck_quest_description CHECK (char_length(description) <= 4000),
    CONSTRAINT ck_quest_importance CHECK (importance IN ('main', 'side')),
    CONSTRAINT ck_quest_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT ck_quest_difficulty CHECK (default_difficulty BETWEEN 1 AND 5),
    CONSTRAINT ck_quest_duration CHECK (default_estimated_duration_minutes > 0),
    CONSTRAINT ck_quest_energy CHECK (default_energy_cost BETWEEN 1 AND 5),
    CONSTRAINT ck_quest_focus CHECK (default_focus_demand BETWEEN 1 AND 5),
    CONSTRAINT ck_quest_reward CHECK (default_reward_exp >= 0),
    CONSTRAINT ck_quest_parent CHECK (direct_goal_id IS NULL OR project_id IS NULL),
    CONSTRAINT ck_quest_recurrence_mode CHECK (
        recurrence_mode IN ('one_off', 'daily', 'weekly', 'monthly', 'custom')
    ),
    -- Missing keys must fail rather than pass a CHECK as SQL NULL.
    -- CASE prevents numeric casts on nonnumeric JSON values.
    CONSTRAINT ck_quest_penalty_envelope CHECK (
        default_penalty_snapshot IS NULL OR COALESCE(
            jsonb_typeof(default_penalty_snapshot) = 'object'
            AND jsonb_typeof(default_penalty_snapshot -> 'applicable_rule_data') = 'object'
            AND CASE WHEN jsonb_typeof(default_penalty_snapshot -> 'schema_version') = 'number'
                THEN (default_penalty_snapshot ->> 'schema_version')::numeric > 0
                    AND (default_penalty_snapshot ->> 'schema_version')::numeric
                        = trunc((default_penalty_snapshot ->> 'schema_version')::numeric)
                ELSE false END,
            false
        )
    ),
    CONSTRAINT ck_quest_tags CHECK (
        CASE WHEN cardinality(tags) = 0 THEN true
             WHEN array_ndims(tags) = 1 THEN array_position(tags, NULL) IS NULL
             ELSE false END
    ),
    CONSTRAINT ck_quest_materialized_count CHECK (materialized_occurrence_count >= 0)
);

CREATE TABLE public.quest_recurrence_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quest_id uuid NOT NULL,
    user_id uuid NOT NULL,
    recurrence_type text NOT NULL,
    interval_count integer,
    weekdays smallint[],
    month_day smallint,
    anchor_date date NOT NULL,
    local_start_time time without time zone,
    end_date date,
    occurrence_limit integer,
    revision integer NOT NULL DEFAULT 1,
    stopped_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_rule_quest UNIQUE (quest_id),
    CONSTRAINT uq_rule_quest_owner UNIQUE (id, quest_id, user_id),
    CONSTRAINT fk_rule_quest_owner FOREIGN KEY (quest_id, user_id)
        REFERENCES public.quests (id, user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_rule_type CHECK (
        recurrence_type IN ('daily', 'selected_weekdays', 'monthly', 'every_n_days', 'every_n_weeks')
    ),
    CONSTRAINT ck_rule_interval CHECK (
        CASE WHEN recurrence_type IN ('every_n_days', 'every_n_weeks')
             THEN interval_count IS NOT NULL AND interval_count > 0
             ELSE interval_count IS NULL END
    ),
    CONSTRAINT ck_rule_weekdays CHECK (
        CASE WHEN recurrence_type = 'selected_weekdays'
             THEN public.quest_valid_weekdays(weekdays)
             ELSE weekdays IS NULL END
    ),
    CONSTRAINT ck_rule_month_day CHECK (
        CASE WHEN recurrence_type = 'monthly'
             THEN month_day IS NOT NULL AND month_day BETWEEN 1 AND 31
             ELSE month_day IS NULL END
    ),
    CONSTRAINT ck_rule_end_date CHECK (end_date >= anchor_date),
    CONSTRAINT ck_rule_occurrence_limit CHECK (occurrence_limit > 0),
    CONSTRAINT ck_rule_revision CHECK (revision > 0)
);

CREATE TABLE public.quest_occurrences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quest_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    scheduled_at timestamptz,
    deadline_at timestamptz,
    reported_completed_at timestamptz,
    recorded_completed_at timestamptz,
    failure_reason text,
    failure_notes text,
    recurrence_rule_id uuid,
    recurrence_revision integer,
    source_slot_date date,
    source_timezone text,
    reward_exp_snapshot integer,
    difficulty_snapshot smallint,
    estimated_duration_minutes_snapshot integer,
    energy_cost_snapshot smallint,
    focus_demand_snapshot smallint,
    direct_goal_id_snapshot uuid,
    project_id_snapshot uuid,
    penalty_snapshot jsonb,
    execution_cycle integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_occurrence_owner UNIQUE (id, user_id),
    CONSTRAINT uq_occurrence_quest_owner UNIQUE (id, quest_id, user_id),
    CONSTRAINT fk_occurrence_quest_owner FOREIGN KEY (quest_id, user_id)
        REFERENCES public.quests (id, user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_occurrence_rule_owner FOREIGN KEY (recurrence_rule_id, quest_id, user_id)
        REFERENCES public.quest_recurrence_rules (id, quest_id, user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_occurrence_status CHECK (
        status IN ('draft', 'scheduled', 'active', 'completed', 'failed', 'cancelled')
    ),
    CONSTRAINT ck_occurrence_schedule CHECK (
        status <> 'scheduled' OR scheduled_at IS NOT NULL OR deadline_at IS NOT NULL
    ),
    CONSTRAINT ck_occurrence_deadline CHECK (deadline_at >= scheduled_at),
    CONSTRAINT ck_occurrence_completion CHECK (
        (status = 'completed' AND recorded_completed_at IS NOT NULL AND reward_exp_snapshot IS NOT NULL)
        OR (status <> 'completed' AND recorded_completed_at IS NULL AND reported_completed_at IS NULL)
    ),
    CONSTRAINT ck_occurrence_failure_reason CHECK (
        failure_reason IN ('procrastinated', 'forgotten', 'overloaded', 'recovery_needed',
                           'emergency', 'no_longer_relevant', 'other')
    ),
    CONSTRAINT ck_occurrence_failed_reason CHECK (status <> 'failed' OR failure_reason IS NOT NULL),
    CONSTRAINT ck_occurrence_origin CHECK (
        (recurrence_rule_id IS NULL AND recurrence_revision IS NULL
            AND source_slot_date IS NULL AND source_timezone IS NULL)
        OR (recurrence_rule_id IS NOT NULL AND recurrence_revision IS NOT NULL
            AND source_slot_date IS NOT NULL AND source_timezone IS NOT NULL
            AND recurrence_revision > 0 AND source_timezone ~ '[^[:space:]]')
    ),
    CONSTRAINT ck_occurrence_reward CHECK (reward_exp_snapshot >= 0),
    CONSTRAINT ck_occurrence_difficulty CHECK (difficulty_snapshot BETWEEN 1 AND 5),
    CONSTRAINT ck_occurrence_duration CHECK (estimated_duration_minutes_snapshot > 0),
    CONSTRAINT ck_occurrence_energy CHECK (energy_cost_snapshot BETWEEN 1 AND 5),
    CONSTRAINT ck_occurrence_focus CHECK (focus_demand_snapshot BETWEEN 1 AND 5),
    CONSTRAINT ck_occurrence_parent CHECK (direct_goal_id_snapshot IS NULL OR project_id_snapshot IS NULL),
    CONSTRAINT ck_occurrence_penalty_envelope CHECK (
        penalty_snapshot IS NULL OR COALESCE(
            jsonb_typeof(penalty_snapshot) = 'object'
            AND jsonb_typeof(penalty_snapshot -> 'applicable_rule_data') = 'object'
            AND CASE WHEN jsonb_typeof(penalty_snapshot -> 'schema_version') = 'number'
                THEN (penalty_snapshot ->> 'schema_version')::numeric > 0
                    AND (penalty_snapshot ->> 'schema_version')::numeric
                        = trunc((penalty_snapshot ->> 'schema_version')::numeric)
                ELSE false END,
            false
        )
    ),
    CONSTRAINT ck_occurrence_cycle CHECK (execution_cycle > 0)
);

CREATE TABLE public.quest_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quest_id uuid NOT NULL,
    user_id uuid NOT NULL,
    occurrence_id uuid,
    event_type text NOT NULL,
    actor_kind text NOT NULL,
    actor_user_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    command_id uuid NOT NULL,
    execution_cycle integer,
    related_event_id uuid,
    payload_version smallint NOT NULL DEFAULT 1,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT uq_event_quest_owner UNIQUE (id, quest_id, user_id),
    CONSTRAINT fk_event_quest_owner FOREIGN KEY (quest_id, user_id)
        REFERENCES public.quests (id, user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_event_occurrence_owner FOREIGN KEY (occurrence_id, quest_id, user_id)
        REFERENCES public.quest_occurrences (id, quest_id, user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_event_related_owner FOREIGN KEY (related_event_id, quest_id, user_id)
        REFERENCES public.quest_events (id, quest_id, user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_event_type CHECK (
        event_type IN ('created', 'scheduled', 'activated', 'completed', 'completion_corrected',
            'failed', 'failure_reason_changed', 'penalty_waived', 'rescheduled', 'cancelled',
            'reopened', 'archived', 'recurrence_changed', 'recurrence_stopped', 'deferred',
            'occurrence_edited', 'definition_edited')
    ),
    CONSTRAINT ck_event_actor CHECK (
        (actor_kind = 'user' AND actor_user_id IS NOT NULL AND actor_user_id = user_id)
        OR (actor_kind = 'system' AND actor_user_id IS NULL)
    ),
    CONSTRAINT ck_event_cycle CHECK (
        (occurrence_id IS NULL AND execution_cycle IS NULL)
        OR (occurrence_id IS NOT NULL AND execution_cycle IS NOT NULL AND execution_cycle > 0)
    ),
    CONSTRAINT ck_event_subject CHECK (
        CASE
            WHEN event_type IN ('completed', 'failed', 'activated', 'scheduled', 'rescheduled',
                'deferred', 'reopened', 'completion_corrected', 'failure_reason_changed',
                'penalty_waived', 'occurrence_edited') THEN occurrence_id IS NOT NULL
            WHEN event_type IN ('archived', 'recurrence_changed', 'recurrence_stopped',
                'definition_edited') THEN occurrence_id IS NULL
            ELSE true
        END
    ),
    CONSTRAINT ck_event_not_self_related CHECK (related_event_id <> id),
    CONSTRAINT ck_event_payload_version CHECK (payload_version > 0),
    CONSTRAINT ck_event_payload CHECK (jsonb_typeof(payload) = 'object')
);

-- Semantic idempotency backstops; the command boundary must resolve retries
-- before minting an event, validate expected cycle, and reject conflicting intent.
CREATE UNIQUE INDEX uq_one_off_occurrence ON public.quest_occurrences (quest_id)
    WHERE recurrence_rule_id IS NULL;
CREATE UNIQUE INDEX uq_recurring_slot ON public.quest_occurrences (quest_id, source_slot_date)
    WHERE recurrence_rule_id IS NOT NULL;
CREATE UNIQUE INDEX uq_completed_cycle ON public.quest_events (occurrence_id, execution_cycle)
    WHERE event_type = 'completed';
CREATE UNIQUE INDEX uq_occurrence_command_effect
    ON public.quest_events (user_id, command_id, occurrence_id, event_type)
    WHERE occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX uq_definition_command_effect
    ON public.quest_events (user_id, command_id, quest_id, event_type)
    WHERE occurrence_id IS NULL;

-- Only the ten access-pattern indexes specified in section 15.
CREATE INDEX ix_quests_owner_active ON public.quests (user_id, updated_at DESC, id)
    WHERE archived_at IS NULL;
CREATE INDEX ix_quests_owner_all ON public.quests (user_id, id);
CREATE INDEX ix_occurrence_schedule ON public.quest_occurrences (user_id, scheduled_at, id)
    WHERE scheduled_at IS NOT NULL AND status IN ('draft', 'scheduled', 'active');
CREATE INDEX ix_occurrence_deadline ON public.quest_occurrences (user_id, deadline_at, id)
    WHERE deadline_at IS NOT NULL AND status IN ('draft', 'scheduled', 'active');
CREATE INDEX ix_occurrence_quest_history ON public.quest_occurrences (quest_id, created_at DESC, id);
CREATE INDEX ix_occurrence_rule ON public.quest_occurrences (recurrence_rule_id, quest_id, user_id)
    WHERE recurrence_rule_id IS NOT NULL;
CREATE INDEX ix_rules_owner_running ON public.quest_recurrence_rules (user_id, anchor_date, id)
    WHERE stopped_at IS NULL;
CREATE INDEX ix_events_quest_history ON public.quest_events (quest_id, occurred_at DESC, id);
CREATE INDEX ix_events_occurrence_history ON public.quest_events (occurrence_id, occurred_at DESC, id)
    WHERE occurrence_id IS NOT NULL;
CREATE INDEX ix_events_related ON public.quest_events (related_event_id, quest_id, user_id)
    WHERE related_event_id IS NOT NULL;

-- RLS is enabled before any client grants. Revoke Supabase default privileges
-- explicitly, including TRUNCATE/REFERENCES/TRIGGER, not just row mutations.
ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quest_recurrence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quest_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quest_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quests, public.quest_recurrence_rules,
    public.quest_occurrences, public.quest_events FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO authenticated, quest_command_owner;
GRANT USAGE ON SCHEMA auth TO quest_command_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO quest_command_owner;
GRANT SELECT ON TABLE public.quests, public.quest_recurrence_rules,
    public.quest_occurrences, public.quest_events TO authenticated, quest_command_owner;
GRANT INSERT, UPDATE ON TABLE public.quests, public.quest_recurrence_rules,
    public.quest_occurrences TO quest_command_owner;
GRANT INSERT ON TABLE public.quest_events TO quest_command_owner;

CREATE POLICY quests_owner_select ON public.quests
    FOR SELECT TO authenticated, quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY rules_owner_select ON public.quest_recurrence_rules
    FOR SELECT TO authenticated, quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY occurrences_owner_select ON public.quest_occurrences
    FOR SELECT TO authenticated, quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY events_owner_select ON public.quest_events
    FOR SELECT TO authenticated, quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));

CREATE POLICY quests_command_insert ON public.quests
    FOR INSERT TO quest_command_owner
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY rules_command_insert ON public.quest_recurrence_rules
    FOR INSERT TO quest_command_owner
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY occurrences_command_insert ON public.quest_occurrences
    FOR INSERT TO quest_command_owner
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY events_command_insert ON public.quest_events
    FOR INSERT TO quest_command_owner
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));

CREATE POLICY quests_command_update ON public.quests
    FOR UPDATE TO quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()))
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY rules_command_update ON public.quest_recurrence_rules
    FOR UPDATE TO quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()))
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));
CREATE POLICY occurrences_command_update ON public.quest_occurrences
    FOR UPDATE TO quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()))
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));

-- No event UPDATE policy/grant and no DELETE policy/grant on any table:
-- default-deny RLS covers these operations. Eligible trivial-draft deletion is
-- not exposed until a separately reviewed purge routine proves the section 14
-- history/dependency guard. It must receive narrowly scoped privileges/policies
-- then; owner equality alone must NEVER enable deletion of meaningful history.
-- No role membership is granted to anon, authenticated or authenticator.

COMMENT ON COLUMN public.quests.direct_goal_id IS
    'Deferred owner-safe RESTRICT FK: add in a later migration when Goal schema exists. Validate ownership before enabling nonnull associations.';
COMMENT ON COLUMN public.quests.project_id IS
    'Deferred owner-safe RESTRICT FK: add in a later migration when Project schema exists. Derive Project Goal externally.';
COMMENT ON COLUMN public.quest_occurrences.direct_goal_id_snapshot IS
    'Fixed attribution; deferred owner-safe RESTRICT FK when Goal schema exists. Never propagate definition edits.';
COMMENT ON COLUMN public.quest_occurrences.project_id_snapshot IS
    'Fixed attribution; deferred owner-safe RESTRICT FK when Project schema exists. Never propagate definition edits.';
COMMENT ON COLUMN public.quests.materialized_occurrence_count IS
    'Server-only cumulative actual materializations. Future command locks Quest, checks limit, inserts instance and increments exactly once in one transaction. Never reset/decrement on edits, skipped slots, retries or eligible instance purge.';
COMMENT ON COLUMN public.quest_occurrences.source_timezone IS
    'Validated Profile-owned profile.timezone captured by future materialization. Missing/invalid zone blocks recurrence; no guessed default. Existing instants and original slot remain fixed.';
COMMENT ON COLUMN public.quest_events.id IS
    'For completed events, stable Player source_id with source_type=quest_completion, reason=completion_reward, amount=reward_exp_snapshot. Production completion/reversal remains disabled until Player ledger integration.';
COMMENT ON TABLE public.quest_events IS
    'Append-only through the command role. Event payload contracts, immutable historical facts, target kinds/cycles and any trivial-draft purge require reviewed command routines; no such routines are exposed here.';
COMMENT ON TABLE public.quest_occurrences IS
    'Storage only. Future commands own transitions, immutable identity/origin, snapshots, expected-cycle checks, authoritative timestamps and atomic history. Integer inputs must reject fractions before PostgreSQL coercion.';
COMMENT ON TABLE public.quests IS
    'Storage only. Future commands maintain updated_at and immutable id/owner/created_at, lock Quest before children and enforce full history-aware archive eligibility. Archive preserves events and never reverses EXP automatically.';
COMMENT ON TABLE public.quest_recurrence_rules IS
    'Storage only. Future commands validate mode coherence and profile.timezone, retain revision history, and stop materialization at end_date/actual count/stop/archive. No recurrence generator exists here.';
