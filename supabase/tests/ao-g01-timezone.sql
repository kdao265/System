\set ON_ERROR_STOP on
-- FUTURE DISPOSABLE-ONLY QA. NEVER RUN AGAINST EXISTING LOCAL/CLOUD DATABASE.
-- This script is intentionally NOT executed under the current permission.
-- Requires an authorized integration candidate with the review-only abort removed
-- only in a throwaway environment and the AO G-01 functions installed.
BEGIN;
CREATE FUNCTION pg_temp.ao_assert_g01(ok boolean, reason text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'AO G-01: %', reason;
    END IF;
END;
$$;
DO $test$
DECLARE
    v jsonb; resolved timestamptz; utc_before timestamptz;
BEGIN
    -- Year/day shapes, unresolved clock, and UTC-null invariants.
    PERFORM pg_temp.ao_assert_g01(system_internal.ao_deadline_spec_valid_v1(
      '{"precision":"day","year":2026,"month":10,"day":10,"source_time":"09:30","source_time_state":"unresolved"}'::jsonb),
      'unresolved local clock valid');
    PERFORM pg_temp.ao_assert_g01(system_internal.ao_deadline_resolve_v1(
      '{"precision":"day","year":2026,"month":10,"day":10,"source_time":"09:30","source_time_state":"unresolved"}'::jsonb) IS NULL,
      'unresolved local clock does not yield UTC');
    PERFORM pg_temp.ao_assert_g01(NOT system_internal.ao_deadline_spec_valid_v1(
      '{"precision":"instant","source_date":"2026-02-29","source_time":"09:30","source_offset_minutes":420}'::jsonb),
      'invalid Gregorian day rejected');
    PERFORM pg_temp.ao_assert_g01(NOT system_internal.ao_deadline_spec_valid_v1(
      '{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":841}'::jsonb),
      'offset upper bound');
    PERFORM pg_temp.ao_assert_g01(NOT system_internal.ao_deadline_spec_valid_v1(
      '{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":420,"unexpected":"x"}'::jsonb),
      'extra keys rejected');
    PERFORM pg_temp.ao_assert_g01(NOT system_internal.ao_deadline_spec_valid_v1(
      '{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":"420"}'::jsonb),
      'string offset rejected');
    -- Offset-only is precise, even without IANA zone: 2026-10-10 09:30+07 = 02:30Z.
    v := '{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":420}'::jsonb;
    resolved := system_internal.ao_deadline_resolve_v1(v);
    PERFORM pg_temp.ao_assert_g01(resolved = '2026-10-10 02:30+00'::timestamptz,
      'offset-only maps to unique UTC instant');
    PERFORM pg_temp.ao_assert_g01(system_internal.ao_deadline_valid_v1(v,resolved),
      'shape plus stored UTC is structurally consistent');
    PERFORM pg_temp.ao_assert_g01(NOT system_internal.ao_deadline_valid_v1(v,NULL),
      'precise instant may not store null UTC');
    -- US spring-forward 2026-03-08: local 02:30 is a nonexistent wall time.
    BEGIN
        PERFORM system_internal.ao_deadline_resolve_v1(
          '{"precision":"instant","source_date":"2026-03-08","source_time":"02:30","source_offset_minutes":-300,"source_zone":"America/New_York"}'::jsonb);
        RAISE EXCEPTION 'DST spring gap falsely accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    -- US fall-back 2026-11-01 01:30 occurs twice: explicit offset chooses the instant.
    resolved := system_internal.ao_deadline_resolve_v1(
      '{"precision":"instant","source_date":"2026-11-01","source_time":"01:30","source_offset_minutes":-240,"source_zone":"America/New_York"}'::jsonb);
    PERFORM pg_temp.ao_assert_g01(resolved = '2026-11-01 05:30+00'::timestamptz,
      'fold before clock rollback');
    resolved := system_internal.ao_deadline_resolve_v1(
      '{"precision":"instant","source_date":"2026-11-01","source_time":"01:30","source_offset_minutes":-300,"source_zone":"America/New_York"}'::jsonb);
    PERFORM pg_temp.ao_assert_g01(resolved = '2026-11-01 06:30+00'::timestamptz,
      'fold after clock rollback');
    BEGIN
        PERFORM system_internal.ao_deadline_resolve_v1(
          '{"precision":"instant","source_date":"2026-11-01","source_time":"01:30","source_offset_minutes":-360,"source_zone":"America/New_York"}'::jsonb);
        RAISE EXCEPTION 'wrong offset falsely accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    -- R-08: valid source years can still resolve outside the approved UTC range.
    BEGIN
        PERFORM system_internal.ao_deadline_resolve_v1(
          '{"precision":"instant","source_date":"0001-01-01","source_time":"00:00","source_offset_minutes":840}'::jsonb);
        RAISE EXCEPTION 'UTC underflow falsely accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    BEGIN
        PERFORM system_internal.ao_deadline_resolve_v1(
          '{"precision":"instant","source_date":"9999-12-31","source_time":"23:59","source_offset_minutes":-840}'::jsonb);
        RAISE EXCEPTION 'UTC overflow falsely accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    PERFORM pg_temp.ao_assert_g01(system_internal.ao_deadline_resolve_v1(
      '{"precision":"instant","source_date":"0001-01-01","source_time":"14:00","source_offset_minutes":840}'::jsonb)
      = '0001-01-01 00:00+00'::timestamptz, 'first UTC minute allowed');
    PERFORM pg_temp.ao_assert_g01(system_internal.ao_deadline_resolve_v1(
      '{"precision":"instant","source_date":"9999-12-31","source_time":"09:59","source_offset_minutes":-840}'::jsonb)
      = '9999-12-31 23:59+00'::timestamptz, 'last UTC minute allowed');
    -- DB checkpoint: status update does not automatically reinterpret prior UTC.
    -- Integration suite must add a real owner-authenticated Opportunity and prove
    -- that unrelated UPDATE preserves deadline_at_utc and history snapshots.
    RAISE NOTICE 'AO G-01 function corpus PASS (runtime-only; owner/trigger integration remains separate)';
END;
$test$;
ROLLBACK;
