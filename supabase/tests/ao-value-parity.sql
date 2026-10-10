\set ON_ERROR_STOP on
-- Future disposable SQL value-only/negative corpus. No live database execution authorized.
BEGIN;
CREATE FUNCTION pg_temp.ao_require(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'AO parity: %', label; END IF; END $$;
DO $tests$
DECLARE leap jsonb := '{"precision":"day","year":2024,"month":2,"day":29}'::jsonb;
BEGIN
 PERFORM pg_temp.ao_require(system_internal.ao_partial_valid_v1(leap), 'leap-day valid');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_partial_valid_v1('{"precision":"day","year":2023,"month":2,"day":29}'::jsonb), 'non-leap rejected');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_partial_valid_v1('{"precision":"month","year":2026,"month":13}'::jsonb), 'month 13 rejected');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_partial_valid_v1('{"precision":"year","year":0}'::jsonb), 'year zero rejected');
 PERFORM pg_temp.ao_require(system_internal.ao_partial_valid_v1('{"precision":"year","year":9999}'::jsonb), 'year 9999 accepted');
 PERFORM pg_temp.ao_require(system_internal.ao_partial_valid_v1('{"precision":"unknown"}'::jsonb), 'unknown precision accepted');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_partial_valid_v1('{"year":2026}'::jsonb), 'missing precision rejected');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_partial_valid_v1('{"precision":"year","year":2026,"extra":1}'::jsonb), 'extra keys rejected');
 PERFORM pg_temp.ao_require(system_internal.ao_partial_order_v1('{"precision":"year","year":2026}', '{"precision":"year","year":2027}'), 'possible date order');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_partial_order_v1('{"precision":"year","year":2027}', '{"precision":"year","year":2026}'), 'certain reverse rejected');
 PERFORM pg_temp.ao_require(system_internal.ao_deadline_valid_v1('{"precision":"day","year":2026,"month":10,"day":10,"source_time":"09:30","source_time_state":"unresolved"}',NULL), 'source clock unresolved not converted');
 PERFORM pg_temp.ao_require(system_internal.ao_deadline_spec_valid_v1('{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":420}'::jsonb), 'G-01 instant structural shape supported');
 PERFORM pg_temp.ao_require(system_internal.ao_deadline_resolve_v1('{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":420}'::jsonb) = '2026-10-10 02:30+00'::timestamptz, 'G-01 offset-only UTC mapping');
 PERFORM pg_temp.ao_require(system_internal.ao_deadline_valid_v1('{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":420}'::jsonb,'2026-10-10 02:30+00'::timestamptz), 'G-01 derived UTC present');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_deadline_valid_v1('{"precision":"instant","source_date":"2026-10-10","source_time":"09:30","source_offset_minutes":420}'::jsonb,NULL), 'G-01 missing derived UTC rejected');
 PERFORM pg_temp.ao_require(system_internal.ao_https_v1('https://example.invalid/path?q=1'), 'HTTPS accepted');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_https_v1('http://example.invalid/path'), 'HTTP rejected');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_https_v1('https://name:secret@example.invalid/'), 'URL credentials rejected');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_https_v1('https://example.invalid/path with space'), 'URL whitespace rejected');
 PERFORM pg_temp.ao_require(system_internal.ao_resources_valid_v1('[]'::jsonb), 'empty resource list accepted');
 PERFORM pg_temp.ao_require(system_internal.ao_resources_valid_v1('[{"id":"11111111-1111-4111-8111-111111111111","label":"Tài liệu","url":"https://example.invalid/test"}]'::jsonb), 'resource list valid');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_resources_valid_v1('[{"id":"11111111-1111-4111-8111-111111111111","label":"a","url":"http://example.invalid"}]'::jsonb), 'invalid URL fails whole request');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_resources_valid_v1('[{"id":"11111111-1111-4111-8111-111111111111","label":"a","url":"https://example.invalid"},{"id":"11111111-1111-4111-8111-111111111111","label":"b","url":"https://example.invalid"}]'::jsonb), 'duplicate link identity rejected');
 -- R-01/R-02 SQL-facing long-text normalization contract; these are NOT runtime PASS until PostgreSQL execution.
 PERFORM pg_temp.ao_require(
   system_internal.ao_text_valid_v1(E'First\nSecond',2000,false,true),
   'R-01/R-02 LF multiline accepted');
 PERFORM pg_temp.ao_require(
   NOT system_internal.ao_text_valid_v1(E'First\r\nSecond',2000,false,true),
   'R-01/R-02 noncanonical CRLF rejected at root constraint boundary');
 PERFORM pg_temp.ao_require(
   system_internal.ao_fields_v1('opportunity',
     jsonb_build_object('title','Closed','tracking_stage','closed',
       'closed_reason','other','closed_note',E'First\r\nSecond'),true)->>'closed_note'=E'First\nSecond',
   'R-01 creation canonical LF');
 PERFORM pg_temp.ao_require(
   system_internal.ao_fields_v1('activity',
     jsonb_build_object('title','Activity','intent','confirmed_plan',
       'confirmation_note',E'First\r\nSecond'),true)->>'confirmation_note'=E'First\nSecond',
   'R-02 creation canonical LF');
 PERFORM pg_temp.ao_require(system_internal.ao_trim_v1(E' \tTên Việt 😀\n')='Tên Việt 😀', 'Unicode-aware trim');
 PERFORM pg_temp.ao_require(system_internal.ao_text_valid_v1('😀😀',2,true,false), 'Unicode code points, not bytes');
 PERFORM pg_temp.ao_require(NOT system_internal.ao_text_valid_v1('😀😀😀',2,true,false), 'Unicode limit reject');
 PERFORM pg_temp.ao_require(NULLIF('null'::jsonb,'null'::jsonb) IS NULL,
     'F-02 JSON null to SQL NULL normalization');
 PERFORM pg_temp.ao_require(system_internal.ao_partial_valid_v1(NULLIF('null'::jsonb,'null'::jsonb)),
     'F-02 clearing optional date validates as SQL NULL');
 RAISE NOTICE 'AO value-only parity PASS. G-01 end-to-end and TS/SQL tzdb parity remain separate QA gates.';
END;
$tests$;
ROLLBACK;
