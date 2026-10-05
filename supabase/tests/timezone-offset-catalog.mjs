// Deterministic offline generation. --write changes only the marked feature block.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {buildDataset,dataSql,quote} from './helpers/system-timezone-dataset.mjs';
const path=new URL('../migrations/20261004120000_recurring_schedule_defaults_v1.sql',import.meta.url);
const begin='-- BEGIN GENERATED TIMEZONE CATALOG V1',end='-- END GENERATED TIMEZONE CATALOG V1';
const d=buildDataset();
const runtime=readFileSync(new URL('./helpers/system-timezone-runtime.sql',import.meta.url),'utf8');
const block=begin+'\n-- Generated offline from pinned TZif bytes; never hand edit.\n'+runtime+'\n'+dataSql(d)+
 'UPDATE system_internal.tzdb_release_v1 SET sealed=true WHERE release_id='+quote(d.releaseId)+';\n'+
 'INSERT INTO system_internal.tzdb_active_v1 VALUES (true,'+quote(d.releaseId)+');\n'+end;
const before=readFileSync(path,'utf8');
assert(before.includes(begin)&&before.includes(end));
const after=before.slice(0,before.indexOf(begin))+block+before.slice(before.indexOf(end)+end.length);
if(process.argv.includes('--write'))writeFileSync(path,after);else assert.equal(before,after,'Timezone generated block differs; regenerate and review');
console.log(JSON.stringify({release_id:d.releaseId,source_sha256:d.sourceHash,generated_dataset_sha256:d.datasetHash,counts:d.counts,generated_bytes:Buffer.byteLength(block),migration_bytes:Buffer.byteLength(after)}));
