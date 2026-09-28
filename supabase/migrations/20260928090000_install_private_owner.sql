-- ADR-015 stage 1: configuration only. No existing policy/RPC changes here.
-- Activation lives OUTSIDE migrations until separately approved provisioning.
BEGIN;

CREATE ROLE system_owner_reader
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA system_private;
REVOKE ALL ON SCHEMA system_private FROM PUBLIC, anon, authenticated, service_role,
    quest_command_owner, progression_command_owner, level_policy_assignment_owner;

CREATE TABLE system_private.owner_configuration (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE system_private.owner_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON system_private.owner_configuration FROM PUBLIC, anon, authenticated,
    service_role, quest_command_owner, progression_command_owner, level_policy_assignment_owner;
GRANT SELECT ON system_private.owner_configuration TO system_owner_reader;
CREATE POLICY owner_configuration_reader ON system_private.owner_configuration
    FOR SELECT TO system_owner_reader USING (true);
GRANT USAGE ON SCHEMA system_private, system_internal TO system_owner_reader;
GRANT EXECUTE ON FUNCTION system_internal.request_user_id() TO system_owner_reader;

CREATE FUNCTION system_private.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM system_private.owner_configuration c
        WHERE c.singleton AND c.user_id = system_internal.request_user_id()
    );
$function$;
REVOKE ALL ON FUNCTION system_private.is_owner() FROM PUBLIC, anon, authenticated, service_role;
GRANT system_owner_reader TO CURRENT_USER;
GRANT CREATE ON SCHEMA system_private TO system_owner_reader;
ALTER FUNCTION system_private.is_owner() OWNER TO system_owner_reader;
REVOKE CREATE ON SCHEMA system_private FROM system_owner_reader;

CREATE FUNCTION system_private.require_owner() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
    IF NOT system_private.is_owner() THEN
        RAISE EXCEPTION 'SYSTEM owner authorization required' USING ERRCODE = '42501';
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION system_private.require_owner() FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA system_private TO authenticated, quest_command_owner,
    progression_command_owner, level_policy_assignment_owner;
GRANT EXECUTE ON FUNCTION system_private.is_owner(), system_private.require_owner()
    TO authenticated, quest_command_owner, progression_command_owner, level_policy_assignment_owner;

COMMENT ON TABLE system_private.owner_configuration IS
    'ADR-015: administrator-managed singleton. Empty means deny after stage 2 activation. No client write or bootstrap RPC. Must match SYSTEM_OWNER_USER_ID.';
COMMENT ON FUNCTION system_private.is_owner() IS
    'RLS-bound singleton reader: verified request identity only, no caller-supplied owner or metadata. Stage 1 alone does not activate existing-table restrictions.';
REVOKE system_owner_reader FROM CURRENT_USER;
COMMIT;
