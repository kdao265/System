// REVIEW-ONLY integration entrypoint — DO NOT RUN without separate runtime approval.
// Reuses the SYSTEM disposable auth-environment harness, never caller-supplied DB URL.
// No changes to frozen migrations, historical suites or active Supabase databases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { startAuthEnvironment } from '../../tests/helpers/auth-environment.mjs';
import { exerciseAoWire } from './helpers/ao-wire.mjs';

assert.equal(process.env.AO_DISPOSABLE_QA_APPROVED, 'YES',
  'AO disposable runtime testing needs separate authorization');
// This runner has no external URL/password arguments. The harness constructs its
// own loopback gateway and tmpfs-only Docker network with synthetic identities.
const expectedSha256 = 'b03d59a69d320249509a926d5fa259f59eeff6e09133fed9c0feae19dc4d23eb';
const candidate = readFileSync(new URL('../../review/sql/REVIEW_ONLY_create_activities_opportunities_v1.sql', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(candidate).digest('hex'), expectedSha256,
  'Review candidate drifted; require a new review/approval before attempting runtime');
const blocker = `DO $ao_review_only$
BEGIN
    RAISE EXCEPTION 'BLOCKED: AO G-01 refinement review-only; SQL, ACL/RLS, RPC and timezone parity not verified'
       USING ERRCODE = '0A000';
END;
$ao_review_only$;`;
assert.equal(candidate.split(blocker).length, 2, 'Expected exactly one approved review guard');
// Strip blocker *only in memory* and *only* for the harness-owned disposable DB.
// The checked-in review SQL remains guarded and never enters migrations/.
const executableInMemory = candidate.replace(blocker, '-- removed in memory for disposable QA only');
assert(executableInMemory.startsWith('\u002d\u002d SYSTEM Activities & Opportunities V1'));

const env = await startAuthEnvironment({ buildApp: false, activateOwner: true, testMigrationHistory: true });
try {
  assert.match(env.url, /^http:\/\/127\.0\.0\.1:\d+$/,
    'Only harness-created gateway allowed');
  // startAuthEnvironment() has already installed and checkpoint-verified Library
  // *after* the frozen private-owner/recurring checkpoints.
  await env.sql(executableInMemory);
  for (const suite of ['ao-catalog.sql', 'ao-value-parity.sql', 'ao-g01-timezone.sql']) {
    const testSql = readFileSync(new URL(suite, import.meta.url), 'utf8');
    await env.sql(testSql);
    console.log(`PASS: disposable SQL ${suite}`);
  }
  const owner = createClient(env.url, env.key,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const outsider = createClient(env.url, env.key,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(env.url, env.key,
    { auth: { persistSession: false, autoRefreshToken: false } });
  assert(!(await owner.auth.signInWithPassword({ email: env.owner.email,
    password: env.owner.password })).error, 'Disposable owner login failed');
  assert(!(await outsider.auth.signInWithPassword({ email: env.other.email,
    password: env.other.password })).error, 'Disposable other-user login failed');
  await exerciseAoWire(env, owner, outsider, anon);
  console.log('PASS: AO disposable SQL/catalog/value/G-01/wire smoke (not full two-session QA)');
} finally {
  await env.close();
}
