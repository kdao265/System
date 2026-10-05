-- Read-only verification of the installed SYSTEM-owned release; no server file privileges.
BEGIN TRANSACTION READ ONLY;
SELECT system_internal.tzdb_active_release_v1() AS release_id;
SELECT system_internal.tzdb_context_v1(system_internal.tzdb_active_release_v1(),p.timezone)
FROM public.profiles p WHERE p.timezone IS NOT NULL;
ROLLBACK;
