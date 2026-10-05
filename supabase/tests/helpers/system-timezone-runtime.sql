-- Generator input only. This SQL is embedded in the self-contained migration.
CREATE FUNCTION system_internal.tzdb_rule_part_valid_v1(r jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
 DECLARE i integer; k text;
 BEGIN
 IF r IS NULL OR jsonb_typeof(r)<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(r)<>6 THEN RETURN false; END IF;
 k:=r->>0;
 FOR i IN 1..5 LOOP
  IF jsonb_typeof(r->i)<>'number' OR (r->>i)!~ '^-?[0-9]+$' OR (r->>i)::numeric NOT BETWEEN -604799 AND 604799 THEN RETURN false; END IF;
 END LOOP;
 RETURN coalesce(CASE k
  WHEN 'M' THEN (r->>1)::integer BETWEEN 1 AND 12 AND (r->>2)::integer BETWEEN 1 AND 5 AND (r->>3)::integer BETWEEN 0 AND 6 AND r->>4='0'
  WHEN 'J' THEN r->>1='0' AND r->>2='0' AND r->>3='0' AND (r->>4)::integer BETWEEN 1 AND 365
  WHEN 'D' THEN r->>1='0' AND r->>2='0' AND r->>3='0' AND (r->>4)::integer BETWEEN 0 AND 365
  ELSE false END,false);
 END $f$;
CREATE FUNCTION system_internal.tzdb_rule_valid_v1(r jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
 DECLARE i integer;
 BEGIN
 IF r IS NULL OR jsonb_typeof(r)<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(r)<>7 THEN RETURN false; END IF;
 IF r->>0='none' THEN RETURN r='["none",null,null,null,null,null,null]'::jsonb; END IF;
 IF coalesce(r->>0,'') NOT IN ('fixed','dst') OR jsonb_typeof(r->3)<>'boolean' THEN RETURN false; END IF;
 FOR i IN 1..CASE WHEN r->>0='dst' THEN 2 ELSE 1 END LOOP
  IF jsonb_typeof(r->i)<>'number' OR (r->>i)!~ '^-?[0-9]+$' OR (r->>i)::numeric NOT BETWEEN -89999 AND 93599 THEN RETURN false; END IF;
 END LOOP;
 IF r->>0='fixed' THEN RETURN r->2='null'::jsonb AND r->4='null'::jsonb AND r->5='null'::jsonb AND r->6='null'::jsonb; END IF;
 RETURN jsonb_typeof(r->4)='boolean' AND system_internal.tzdb_rule_part_valid_v1(r->5) AND system_internal.tzdb_rule_part_valid_v1(r->6);
 END $f$;
CREATE TABLE system_internal.tzdb_release_v1 (
 release_id text PRIMARY KEY, identity jsonb NOT NULL CHECK(jsonb_typeof(identity)='array' AND jsonb_array_length(identity)=8),
 tzdb_version text GENERATED ALWAYS AS (identity->>0) STORED,
 source_sha256 text GENERATED ALWAYS AS (identity->>1) STORED,
 generated_dataset_sha256 text GENERATED ALWAYS AS (identity->>2) STORED,
 generator_version text GENERATED ALWAYS AS (identity->>3) STORED,
 resolver_semantics_version text GENERATED ALWAYS AS (identity->>4) STORED,
 sealed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE system_internal.tzdb_active_v1 (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 release_id text NOT NULL REFERENCES system_internal.tzdb_release_v1(release_id)
);
CREATE TABLE system_internal.tzdb_zone_v1 (
 release_id text NOT NULL REFERENCES system_internal.tzdb_release_v1(release_id), zone_name text NOT NULL,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='array' AND jsonb_array_length(manifest)=9),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'), PRIMARY KEY(release_id,zone_name)
);
CREATE TABLE system_internal.tzdb_offset_v1 (
 release_id text NOT NULL,zone_name text NOT NULL,offset_seconds integer NOT NULL CHECK(offset_seconds BETWEEN -89999 AND 93599),
 PRIMARY KEY(release_id,zone_name,offset_seconds),
 FOREIGN KEY(release_id,zone_name) REFERENCES system_internal.tzdb_zone_v1(release_id,zone_name)
);
CREATE TABLE system_internal.tzdb_era_v1 (
 release_id text NOT NULL,zone_name text NOT NULL,utc_start timestamptz NOT NULL,utc_end timestamptz NOT NULL,
 offset_seconds integer NOT NULL,specified boolean NOT NULL,
 PRIMARY KEY(release_id,zone_name,utc_start), CHECK(utc_start<utc_end),
 FOREIGN KEY(release_id,zone_name,offset_seconds) REFERENCES system_internal.tzdb_offset_v1(release_id,zone_name,offset_seconds)
);
CREATE TABLE system_internal.tzdb_rule_v1 (
 release_id text NOT NULL,zone_name text NOT NULL,future_start timestamptz NOT NULL,rule jsonb NOT NULL,
 PRIMARY KEY(release_id,zone_name),
 FOREIGN KEY(release_id,zone_name) REFERENCES system_internal.tzdb_zone_v1(release_id,zone_name),
 CHECK(system_internal.tzdb_rule_valid_v1(rule))
);
CREATE TYPE system_internal.tzdb_context_v1 AS (
 release_id text,zone_name text,offsets integer[],future_start timestamptz,rule jsonb
);
CREATE TYPE system_internal.tzdb_state_v1 AS (offset_seconds integer,specified boolean);

CREATE FUNCTION system_internal.tzdb_hash_v1(p_value jsonb) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $f$
 SELECT encode(sha256(convert_to(replace(p_value::text,' ',''),'UTF8')),'hex') $f$;
CREATE FUNCTION system_internal.tzdb_bound_v1(p_value timestamptz) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN isfinite(p_value) THEN extract(epoch FROM p_value)::bigint::text ELSE p_value::text END $f$;
CREATE FUNCTION system_internal.tzdb_days_v1(y integer,m integer,d integer) RETURNS bigint
 LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $f$
 WITH a AS (SELECT (y-CASE WHEN m<=2 THEN 1 ELSE 0 END)::bigint AS yr),
 b AS (SELECT yr,floor(yr::numeric/400)::bigint AS era FROM a),
 c AS (SELECT era,yr-era*400 AS yo FROM b)
 SELECT era*146097+yo*365+yo/4-yo/100+(153*(m+CASE WHEN m>2 THEN -3 ELSE 9 END)+2)/5+d-1-719468 FROM c $f$;
CREATE FUNCTION system_internal.tzdb_rule_seconds_v1(r jsonb,y integer) RETURNS bigint
 LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $f$
 DECLARE k text:=r->>0; m integer:=(r->>1)::integer; w integer:=(r->>2)::integer;
 wd integer:=(r->>3)::integer; n integer:=(r->>4)::integer; sh integer:=(r->>5)::integer;
 base bigint; delta integer; len integer; leap boolean:=(y%4=0 AND y%100<>0) OR y%400=0;
 BEGIN
 IF jsonb_array_length(r)<>6 OR sh NOT BETWEEN -604799 AND 604799 OR k NOT IN ('M','J','D') THEN
  RAISE EXCEPTION 'Malformed timezone rule' USING ERRCODE='PZ002'; END IF;
 IF k='M' THEN
  IF m NOT BETWEEN 1 AND 12 OR w NOT BETWEEN 1 AND 5 OR wd NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'Malformed month rule' USING ERRCODE='PZ002'; END IF;
  base:=system_internal.tzdb_days_v1(y,m,1);
  delta:=mod(mod(wd-mod(base+4,7),7)+7,7)+(w-1)*7;
  len:=CASE WHEN m=2 THEN CASE WHEN leap THEN 29 ELSE 28 END ELSE (ARRAY[31,28,31,30,31,30,31,31,30,31,30,31])[m] END;
  IF delta>=len THEN delta:=delta-7; END IF;
  base:=base+delta;
 ELSIF k='J' THEN
  IF n NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Malformed Julian rule' USING ERRCODE='PZ002'; END IF;
  base:=system_internal.tzdb_days_v1(y,1,1)+n-1+CASE WHEN leap AND n>=60 THEN 1 ELSE 0 END;
 ELSE
  IF n NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'Malformed ordinal rule' USING ERRCODE='PZ002'; END IF;
  base:=system_internal.tzdb_days_v1(y,1,1)+n;
 END IF;
 RETURN base*86400+sh;
 END $f$;

CREATE FUNCTION system_internal.tzdb_future_v1(r jsonb,u timestamptz) RETURNS system_internal.tzdb_state_v1
 LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $f$
 DECLARE mode text:=r->>0; std integer:=(r->>1)::integer; dst integer:=(r->>2)::integer;
 year integer:=extract(year FROM u AT TIME ZONE INTERVAL '0')::integer; y integer;
 second numeric:=extract(epoch FROM u); a bigint; b bigint; latest bigint:=NULL;
 result system_internal.tzdb_state_v1;
 BEGIN
 IF mode='none' THEN RAISE EXCEPTION 'Future timezone data unavailable' USING ERRCODE='PZ002'; END IF;
 IF mode='fixed' THEN RETURN (std,(r->>3)::boolean)::system_internal.tzdb_state_v1; END IF;
 IF mode<>'dst' OR dst IS NULL THEN RAISE EXCEPTION 'Malformed future rule' USING ERRCODE='PZ002'; END IF;
 IF year<0 THEN year:=year+1; END IF; -- PostgreSQL BC -> astronomical year
 FOR y IN year-2..year+2 LOOP
  a:=system_internal.tzdb_rule_seconds_v1(r->5,y)-std;
  b:=system_internal.tzdb_rule_seconds_v1(r->6,y)-dst;
  IF b<=second AND (latest IS NULL OR b>latest) THEN latest:=b;result:=(std,(r->>3)::boolean); END IF;
  -- Start wins ties, including the POSIX all-year-DST representation.
  IF a<=second AND (latest IS NULL OR a>=latest) THEN latest:=a;result:=(dst,(r->>4)::boolean); END IF;
 END LOOP;
 IF latest IS NULL OR result.offset_seconds IS NULL OR result.specified IS NULL THEN RAISE EXCEPTION 'Incomplete future rule' USING ERRCODE='PZ002'; END IF;
 RETURN result;
 END $f$;

CREATE FUNCTION system_internal.tzdb_check_release_v1(p_release text) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE r system_internal.tzdb_release_v1; n bigint; eras bigint; offsets bigint; root text; src text; malformed boolean;
 BEGIN
 SELECT * INTO r FROM system_internal.tzdb_release_v1 WHERE release_id=p_release;
 IF NOT FOUND OR r.identity->>4 IS DISTINCT FROM 'system-tz-v1' OR r.identity->>3 IS DISTINCT FROM 'system-tz-generator-v1'
  OR r.release_id IS DISTINCT FROM 'system-tz-v1/'||system_internal.tzdb_hash_v1(r.identity) THEN
  RAISE EXCEPTION 'Timezone release identity invalid' USING ERRCODE='PZ002'; END IF;
 SELECT count(*),sum((manifest->>4)::integer),sum((manifest->>5)::integer),
  encode(sha256(convert_to(string_agg(zone_name||':'||manifest_sha256||E'\n','' ORDER BY zone_name COLLATE "C"),'UTF8')),'hex'),
  encode(sha256(convert_to(string_agg(zone_name||':'||(manifest->>1)||E'\n','' ORDER BY zone_name COLLATE "C"),'UTF8')),'hex'),
  bool_or(manifest_sha256 IS DISTINCT FROM system_internal.tzdb_hash_v1(manifest) OR manifest->>0 IS DISTINCT FROM zone_name)
 INTO n,eras,offsets,root,src,malformed FROM system_internal.tzdb_zone_v1 WHERE release_id=p_release;
 IF malformed IS DISTINCT FROM false OR root IS DISTINCT FROM r.identity->>2 OR src IS DISTINCT FROM r.identity->>1
  OR n IS DISTINCT FROM (r.identity->>5)::bigint OR eras IS DISTINCT FROM (r.identity->>6)::bigint OR offsets IS DISTINCT FROM (r.identity->>7)::bigint THEN
  RAISE EXCEPTION 'Timezone release manifest invalid' USING ERRCODE='PZ002'; END IF;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  RAISE EXCEPTION 'Malformed timezone release' USING ERRCODE='PZ002';
 END $f$;

CREATE FUNCTION system_internal.tzdb_active_release_v1() RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE value text; BEGIN
 SELECT a.release_id INTO value FROM system_internal.tzdb_active_v1 a JOIN system_internal.tzdb_release_v1 r USING(release_id) WHERE a.singleton AND r.sealed;
 IF value IS NULL THEN RAISE EXCEPTION 'Active timezone release unavailable' USING ERRCODE='PZ002'; END IF;
 PERFORM system_internal.tzdb_check_release_v1(value); RETURN value;
 END $f$;

-- Full per-zone integrity once per materialization batch, not once per endpoint.
CREATE FUNCTION system_internal.tzdb_context_v1(p_release text,p_zone text) RETURNS system_internal.tzdb_context_v1
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE z system_internal.tzdb_zone_v1; r system_internal.tzdb_rule_v1; result system_internal.tzdb_context_v1;
 n bigint; h text; invalid boolean; first_at timestamptz; last_at timestamptz; last_explicit timestamptz;
 state system_internal.tzdb_state_v1; e system_internal.tzdb_era_v1;
 BEGIN
 IF p_zone IS NULL THEN RAISE EXCEPTION 'Profile timezone is required' USING ERRCODE='PZ001'; END IF;
 -- A release reference that does not exist is dataset corruption, never an
 -- unsupported Profile zone. Without this the two conditions are indistinguishable
 -- and a corrupt registry is misreported to the caller as PZ003.
 IF NOT EXISTS(SELECT 1 FROM system_internal.tzdb_release_v1 WHERE release_id=p_release) THEN
  RAISE EXCEPTION 'Timezone release unavailable' USING ERRCODE='PZ002'; END IF;
 SELECT * INTO z FROM system_internal.tzdb_zone_v1 WHERE release_id=p_release AND zone_name=p_zone;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile timezone is unsupported by SYSTEM release' USING ERRCODE='PZ003'; END IF;
 IF z.manifest_sha256 IS DISTINCT FROM system_internal.tzdb_hash_v1(z.manifest) THEN RAISE EXCEPTION 'Timezone manifest corrupt' USING ERRCODE='PZ002'; END IF;
 SELECT array_agg(offset_seconds ORDER BY offset_seconds) INTO result.offsets FROM system_internal.tzdb_offset_v1 WHERE release_id=p_release AND zone_name=p_zone;
 IF cardinality(result.offsets) IS DISTINCT FROM (z.manifest->>5)::integer OR system_internal.tzdb_hash_v1(to_jsonb(result.offsets)) IS DISTINCT FROM z.manifest->>7 THEN
  RAISE EXCEPTION 'Timezone candidates corrupt' USING ERRCODE='PZ002'; END IF;
 SELECT count(*),min(utc_start),max(utc_end),
  encode(sha256(convert_to(string_agg(replace(jsonb_build_array(system_internal.tzdb_bound_v1(utc_start),system_internal.tzdb_bound_v1(utc_end),offset_seconds,specified)::text,' ','')||E'\n','' ORDER BY utc_start),'UTF8')),'hex'),
  bool_or(utc_start>=utc_end OR (previous_end IS NOT NULL AND previous_end<>utc_start))
 INTO n,first_at,last_at,h,invalid FROM (
  SELECT *,lag(utc_end) OVER(ORDER BY utc_start) previous_end FROM system_internal.tzdb_era_v1 WHERE release_id=p_release AND zone_name=p_zone
 ) v;
 IF n IS DISTINCT FROM (z.manifest->>4)::integer OR h IS DISTINCT FROM z.manifest->>6 OR invalid IS DISTINCT FROM false
  OR first_at IS DISTINCT FROM '-infinity'::timestamptz OR last_at IS DISTINCT FROM 'infinity'::timestamptz THEN
  RAISE EXCEPTION 'Timezone eras corrupt' USING ERRCODE='PZ002'; END IF;
 SELECT * INTO r FROM system_internal.tzdb_rule_v1 WHERE release_id=p_release AND zone_name=p_zone;
 IF NOT FOUND OR NOT system_internal.tzdb_rule_valid_v1(r.rule) OR system_internal.tzdb_hash_v1(r.rule) IS DISTINCT FROM z.manifest->>8 OR system_internal.tzdb_bound_v1(r.future_start) IS DISTINCT FROM z.manifest->>3 THEN
  RAISE EXCEPTION 'Timezone future rule corrupt' USING ERRCODE='PZ002'; END IF;
 IF z.manifest->>2 IS NOT NULL THEN last_explicit:=to_timestamp((z.manifest->>2)::bigint); END IF;
 IF (r.rule->>0='none' AND r.future_start<>'infinity') OR
  (r.rule->>0<>'none' AND r.future_start IS DISTINCT FROM coalesce(last_explicit,'-infinity'::timestamptz)) THEN
  RAISE EXCEPTION 'Impossible timezone activation' USING ERRCODE='PZ002'; END IF;
 IF r.rule->>0<>'none' THEN
  state:=system_internal.tzdb_future_v1(r.rule,coalesce(last_explicit,'2000-01-01Z'::timestamptz));
  IF state.offset_seconds<>ALL(result.offsets) THEN RAISE EXCEPTION 'Future offset missing from candidates' USING ERRCODE='PZ002'; END IF;
  IF last_explicit IS NOT NULL THEN
   SELECT * INTO e FROM system_internal.tzdb_era_v1 WHERE release_id=p_release AND zone_name=p_zone AND utc_start<=last_explicit AND utc_end>last_explicit;
   IF NOT FOUND OR (e.offset_seconds,e.specified) IS DISTINCT FROM (state.offset_seconds,state.specified) THEN RAISE EXCEPTION 'Inconsistent footer activation' USING ERRCODE='PZ002'; END IF;
  END IF;
 END IF;
 result.release_id:=p_release; result.zone_name:=p_zone;result.future_start:=r.future_start;result.rule:=r.rule; RETURN result;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  RAISE EXCEPTION 'Malformed timezone dataset' USING ERRCODE='PZ002';
 END $f$;

CREATE FUNCTION system_internal.tzdb_offset_at_v1(c system_internal.tzdb_context_v1,u timestamptz) RETURNS system_internal.tzdb_state_v1
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE result system_internal.tzdb_state_v1;
 BEGIN
 IF u IS NULL OR NOT isfinite(u) THEN RAISE EXCEPTION 'Invalid timezone instant' USING ERRCODE='22023'; END IF;
 IF u>=c.future_start THEN RETURN system_internal.tzdb_future_v1(c.rule,u); END IF;
 SELECT offset_seconds,specified INTO result FROM system_internal.tzdb_era_v1 WHERE release_id=c.release_id AND zone_name=c.zone_name
  AND utc_start<=u AND utc_end>u ORDER BY utc_start DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Required timezone era missing' USING ERRCODE='PZ002'; END IF;
 RETURN result;
 END $f$;

CREATE FUNCTION system_internal.tzdb_resolve_v1(c system_internal.tzdb_context_v1,p_local timestamp)
 RETURNS TABLE(classification text,instant timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE o integer; u timestamptz; state system_internal.tzdb_state_v1; hits timestamptz[]:='{}'; unknown boolean:=false;
 BEGIN
 IF p_local IS NULL OR NOT isfinite(p_local) OR p_local<timestamp '0001-01-01' OR p_local>=timestamp '10000-01-01' THEN
  RAISE EXCEPTION 'Unsupported recurring local date' USING ERRCODE='22023'; END IF;
 FOREACH o IN ARRAY c.offsets LOOP
  u:=(p_local AT TIME ZONE INTERVAL '0')-o*interval '1 second'; state:=system_internal.tzdb_offset_at_v1(c,u);
  IF NOT state.specified THEN unknown:=true;
  ELSIF state.offset_seconds=o AND NOT u=ANY(hits) THEN hits:=array_append(hits,u); END IF;
 END LOOP;
 IF unknown THEN RETURN QUERY SELECT 'unsupported_timezone_semantics'::text,NULL::timestamptz;
 ELSIF cardinality(hits)=0 THEN RETURN QUERY SELECT 'nonexistent_local_time'::text,NULL::timestamptz;
 ELSIF cardinality(hits)>1 THEN RETURN QUERY SELECT 'ambiguous_local_time'::text,NULL::timestamptz;
 ELSE RETURN QUERY SELECT 'unique'::text,hits[1]; END IF;
 END $f$;

CREATE FUNCTION system_internal.tzdb_immutable_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 DECLARE z text;
 BEGIN
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='tzdb_release_v1' THEN
   IF NEW.sealed THEN RAISE EXCEPTION 'Release must be validated before sealing' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME<>'tzdb_release_v1' AND EXISTS(SELECT 1 FROM system_internal.tzdb_release_v1 WHERE release_id=NEW.release_id AND sealed) THEN
   RAISE EXCEPTION 'Sealed timezone release is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='tzdb_release_v1' AND TG_OP='UPDATE' THEN
  IF NOT OLD.sealed AND NEW.sealed AND (OLD.release_id,OLD.identity,OLD.created_at) IS NOT DISTINCT FROM (NEW.release_id,NEW.identity,NEW.created_at) THEN
   PERFORM system_internal.tzdb_check_release_v1(NEW.release_id);
   FOR z IN SELECT zone_name FROM system_internal.tzdb_zone_v1 WHERE release_id=NEW.release_id LOOP
    PERFORM system_internal.tzdb_context_v1(NEW.release_id,z);
   END LOOP;
   RETURN NEW;
  END IF;
 END IF;
 RAISE EXCEPTION 'Timezone reference data is immutable' USING ERRCODE='23514';
 END $f$;

CREATE FUNCTION system_internal.tzdb_activate_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
 BEGIN
 IF NOT EXISTS(SELECT 1 FROM system_internal.tzdb_release_v1 WHERE release_id=NEW.release_id AND sealed) THEN
  RAISE EXCEPTION 'Unsealed timezone release cannot activate' USING ERRCODE='PZ002'; END IF;
 PERFORM system_internal.tzdb_check_release_v1(NEW.release_id); RETURN NEW;
 END $f$;
CREATE TRIGGER validate_active_release BEFORE INSERT OR UPDATE ON system_internal.tzdb_active_v1
 FOR EACH ROW EXECUTE FUNCTION system_internal.tzdb_activate_v1();

DO $security$
DECLARE t text; f regprocedure;
BEGIN
 FOREACH t IN ARRAY ARRAY['tzdb_release_v1','tzdb_active_v1','tzdb_zone_v1','tzdb_offset_v1','tzdb_era_v1','tzdb_rule_v1'] LOOP
  EXECUTE format('ALTER TABLE system_internal.%I OWNER TO %I',t,current_user);
  EXECUTE format('ALTER TABLE system_internal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON system_internal.%I FROM PUBLIC,anon,authenticated,service_role,quest_command_owner',t);
  IF t<>'tzdb_active_v1' THEN
   EXECUTE format('CREATE TRIGGER immutable_rows BEFORE INSERT OR UPDATE OR DELETE ON system_internal.%I FOR EACH ROW EXECUTE FUNCTION system_internal.tzdb_immutable_v1()',t);
   EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON system_internal.%I FOR EACH STATEMENT EXECUTE FUNCTION system_internal.tzdb_immutable_v1()',t);
  END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='system_internal'::regnamespace AND proname LIKE 'tzdb_%' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f,current_user);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,quest_command_owner',f);
 END LOOP;
END $security$;
GRANT EXECUTE ON FUNCTION system_internal.tzdb_active_release_v1(),system_internal.tzdb_context_v1(text,text),
 system_internal.tzdb_offset_at_v1(system_internal.tzdb_context_v1,timestamptz),system_internal.tzdb_resolve_v1(system_internal.tzdb_context_v1,timestamp)
 TO quest_command_owner;
