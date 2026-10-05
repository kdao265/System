// Reproducibility check for the "-- BEGIN/END GENERATED TIMEZONE CATALOG V1" block.
//
// DEFAULT CONTRACT (verification only): this script NEVER modifies files. It
// composes the expected migration in memory, compares it with the checked-in
// migration, exits 0 on an exact match and exits nonzero with first-difference
// diagnostics otherwise.
//
// `node supabase/tests/verify-generated-migration.mjs --write` is the only mode
// that rewrites the migration. It requires the explicit flag and refuses to run
// without it, so no default invocation can ever alter a certified artifact.
import { readFileSync } from 'node:fs';
import { buildDataset, dataSql } from './helpers/system-timezone-dataset.mjs';

const args = process.argv.slice(2);
const unknown = args.filter((argument) => argument !== '--write');
if (unknown.length > 0) {
  console.error(`UNKNOWN ARGUMENT: ${unknown.join(' ')}\nUsage: node supabase/tests/verify-generated-migration.mjs [--write]`);
  process.exit(2);
}
const write = args.includes('--write');

const migrationUrl = new URL('../migrations/20261004120000_recurring_schedule_defaults_v1.sql', import.meta.url);
const migration = readFileSync(migrationUrl, 'utf8');
const runtime = readFileSync(new URL('./helpers/system-timezone-runtime.sql', import.meta.url), 'utf8').trimEnd();
const BEGIN = '-- BEGIN GENERATED TIMEZONE CATALOG V1';
const END = '-- END GENERATED TIMEZONE CATALOG V1';
const from = migration.indexOf(BEGIN);
const to = migration.indexOf(END);
if (from < 0 || to < 0) throw new Error('Generated catalog markers are missing');
const head = migration.slice(0, from + BEGIN.length);
const tail = migration.slice(to);
const header = '-- Generated offline from pinned TZif bytes; never hand edit.';
// Sealing and selecting the active release are the install steps that follow the
// generated rows. Both are re-checked by the sealing and activation triggers.
const install = d => `UPDATE system_internal.tzdb_release_v1 SET sealed=true WHERE release_id='${d.releaseId}';\nINSERT INTO system_internal.tzdb_active_v1 VALUES (true,'${d.releaseId}');\n`;
// Composition is purely in-memory; nothing below touches disk unless --write is set.
const dataset = buildDataset();
const generated = `${head}\n${header}\n${runtime}\n\n${dataSql(dataset)}${install(dataset)}${tail}`;

if (generated === migration) {
  console.log(`REPRODUCIBLE: ${migration.length} bytes match runtime template + pinned dataset (read-only verification; no file was modified)`);
} else {
  const a = migration.split('\n');
  const b = generated.split('\n');
  let line = 0;
  while (line < Math.max(a.length, b.length) && a[line] === b[line]) line++;
  console.log(`MISMATCH at line ${line + 1}\n  migration: ${JSON.stringify(a[line])}\n  generated: ${JSON.stringify(b[line])}`);
  console.log(`  migration bytes ${migration.length}, expected bytes ${generated.length}`);
  process.exitCode = 1;
}

// Explicit, opt-in regeneration only. Unreachable from the default verify path.
if (write) {
  if (generated === migration) {
    console.log('WRITE: the checked-in migration already matches; nothing to regenerate');
  } else {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(migrationUrl, generated);
    console.log(`REGENERATED (--write): ${generated.length} bytes written from runtime template + pinned dataset`);
  }
}
