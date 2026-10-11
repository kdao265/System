// REVIEW-ONLY integration entrypoint — DO NOT RUN without separate runtime approval.
// Reuses the SYSTEM disposable auth-environment harness, never caller-supplied DB URL.
// No changes to frozen migrations, historical suites or active Supabase databases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { startAuthEnvironment } from '../../tests/helpers/auth-environment.mjs';
import { exerciseAoWire } from './helpers/ao-wire.mjs';
import { exerciseAoL107 } from './helpers/ao-l1-07.mjs';
import { exerciseAoL107PhaseB } from './helpers/ao-l1-07-phase-b.mjs';
import { exerciseAoL107Hardening } from './helpers/ao-l1-07-hardening.mjs';
import { exerciseAoL108 } from './helpers/ao-l1-08-gap-closure.mjs';
import { exerciseAoL109 } from './helpers/ao-l1-09-final-acceptance.mjs';
import { exerciseAoL110 } from './helpers/ao-l1-10-p0-closure.mjs';
import { exerciseAoL111 } from './helpers/ao-l1-11-tabs.mjs';

assert.equal(process.env.AO_DISPOSABLE_QA_APPROVED, 'YES',
  'AO disposable runtime testing needs separate authorization');
// This runner has no external URL/password arguments. The harness constructs its
// own loopback gateway and tmpfs-only Docker network with synthetic identities.
const expectedSha256 = '0daadcb0c458d5a6ce558510535397624cb64ee0b9aea4bb267ee5389f1a33f5';
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
  console.log('PASS: AO disposable SQL/catalog/value/G-01/wire smoke');
  await exerciseAoL107(env, owner, outsider, anon);
  await exerciseAoL107PhaseB(env, owner, outsider, anon);
  await exerciseAoL107Hardening(env, owner, outsider, anon);
  await exerciseAoL108(env, owner);
  await exerciseAoL109(env, owner);
  await exerciseAoL110(env, owner);
  await exerciseAoL111(env, owner, outsider);
  console.log('PASS: L1-07 / L1-08 / L1-09 acceptance suites within tested scope; release migration gate remains CLOSED');
} finally {
  await env.close();
}
