-- Implements docs/02-architecture/auth-profile-database-schema.md.
BEGIN;

-- Serialize Auth creation across trigger installation and existing-user backfill.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;

CREATE ROLE profile_provisioner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA profile_internal;
REVOKE ALL ON SCHEMA profile_internal FROM PUBLIC, anon, authenticated;

CREATE TABLE public.profiles (
    user_id uuid PRIMARY KEY,
    display_name text,
    timezone text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_profile_auth_user FOREIGN KEY (user_id)
        REFERENCES auth.users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_profile_display_name CHECK (
        display_name IS NULL OR display_name ~ '[^[:space:]]'
    ),
    CONSTRAINT ck_profile_timezone_shape CHECK (
        timezone IS NULL OR (
            timezone ~ '[^[:space:]]'
            AND timezone !~ '^[[:space:]]|[[:space:]]$'
        )
    )
);

CREATE FUNCTION profile_internal.validate_profile_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.user_id IS DISTINCT FROM OLD.user_id
            OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Profile identity and creation time are immutable'
                USING ERRCODE = '23514';
        END IF;
        NEW.updated_at := pg_catalog.now();
    END IF;

    NEW.display_name := NULLIF(
        pg_catalog.regexp_replace(NEW.display_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
        ''
    );

    IF NEW.timezone IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
        WHERE zone.name = NEW.timezone
            AND zone.name NOT LIKE 'posix/%'
            AND zone.name NOT LIKE 'right/%'
            AND zone.name <> 'localtime'
    ) THEN
        RAISE EXCEPTION 'Select a supported IANA timezone identifier'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION profile_internal.validate_profile_row()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_validate_row
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION profile_internal.validate_profile_row();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO authenticated, profile_provisioner;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (display_name, timezone) ON TABLE public.profiles TO authenticated;
GRANT INSERT (user_id) ON TABLE public.profiles TO profile_provisioner;

CREATE POLICY profiles_owner_select ON public.profiles
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));

CREATE POLICY profiles_owner_update ON public.profiles
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()))
    WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));

-- Signup has no required user session. Only the private Auth trigger may use
-- this RLS-bound role, deriving identity from NEW.id rather than caller input.
CREATE POLICY profiles_provision_insert ON public.profiles
    FOR INSERT TO profile_provisioner
    WITH CHECK (display_name IS NULL AND timezone IS NULL);

CREATE FUNCTION profile_internal.provision_auth_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    INSERT INTO public.profiles (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION profile_internal.provision_auth_profile()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER auth_user_provision_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION profile_internal.provision_auth_profile();

-- Temporary migration-executor membership/schema CREATE permits ownership
-- transfer; neither capability is retained or granted to browser roles.
GRANT profile_provisioner TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA profile_internal TO profile_provisioner;
ALTER FUNCTION profile_internal.provision_auth_profile() OWNER TO profile_provisioner;
REVOKE CREATE ON SCHEMA profile_internal FROM profile_provisioner;
REVOKE profile_provisioner FROM CURRENT_USER;

INSERT INTO public.profiles (user_id)
    SELECT auth_user.id FROM auth.users AS auth_user
    WHERE NOT EXISTS (
        SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = auth_user.id
    );

DO $verification$
BEGIN
    IF EXISTS (
        SELECT 1 FROM auth.users AS auth_user
        WHERE NOT EXISTS (
            SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = auth_user.id
        )
    ) THEN
        RAISE EXCEPTION 'Profile backfill did not cover every Auth user';
    END IF;
END;
$verification$;

-- The preceding Quest migration provides this non-login role. Only the Profile
-- side is changed: no Quest writes, recurrence routines or bypass privileges.
GRANT SELECT (user_id, timezone) ON TABLE public.profiles TO quest_command_owner;
CREATE POLICY profiles_quest_owner_select ON public.profiles
    FOR SELECT TO quest_command_owner
    USING ((SELECT auth.uid()) IS NOT NULL AND user_id = (SELECT auth.uid()));

COMMENT ON COLUMN public.profiles.timezone IS
    'Authoritative profile.timezone for future Quest recurrence. NULL blocks timezone-dependent operations; services must revalidate at use time. No default timezone is inferred.';
COMMENT ON CONSTRAINT fk_profile_auth_user ON public.profiles IS
    'Only Profile cascades on successful Auth hard deletion. Existing Quest RESTRICT references still block deletion of users with retained Quest definitions.';

COMMIT;
