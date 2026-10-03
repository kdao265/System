# Recurring Quest Archive/Delete V1

Approved scope: ADR-021, branch `feat/recurring-quest-archive-delete-v1`. Preserve exact state and freeze; no cancellation, EXP reversal, physical deletion, dependencies, commits, pushes or Cloud operations.

## Database contract

New migration: `20261003120000_recurring_quest_archive_delete_v1.sql`.

- `set_recurring_quest_archived_v1(p_command_id uuid, p_quest_id uuid, p_archived boolean, p_origin text) -> jsonb`
- `delete_recurring_quest_v1(p_command_id uuid, p_quest_id uuid, p_origin text) -> jsonb`
- `list_archived_recurring_quests_v1() -> table` (the existing recurring projection fields plus archived_at; separate from both existing list contracts).

Commands require SYSTEM owner identity, a durable UUID, valid origin and daily/weekly/monthly definition with its rule. The internal invoker helper executes under quest_command_owner, never browser privileges or BYPASSRLS. A receipt contains version, command_id, quest_id, operation, archived_at, deleted_at, event_id, changed and replay. Each accepted fresh archive/restore command, including a state no-op, records its receipt in a definition event. Replay matches exact subject, operation and origin before inspecting mutable retirement state. Conflicting reuse rejects.

Archive/restore change only quests.archived_at/updated_at and append a definition event. Delete requires archived_at and appends a final event before setting deleted_at/updated_at. All rule/occurrence fields and existing history remain unchanged. No historical credits must be reversed. A repeated delete with its original command returns its receipt; a new delete command against a tombstone rejects.

Shared owner advisory lock followed by the Quest row lock serializes commands with generation, completion, Reopen and Pause. Occurrence commands acquire their occurrence lock afterwards. Generation either inserts before archive and is retained, or runs after archive and skips it. Completion/Reopen either commits before archive and remains in history, or rejects without partial effects. Accepted completion aliases replay; a fresh alias on a retired recurring occurrence is rejected. One-off guards remain unchanged.

## Application and recovery

Active recurring cards retain Pause/Resume and add Archive. A dedicated archived-recurring panel offers Restore and Delete permanently. Confirmation explains permanent freezing, retained EXP/history and the need for any correction before deletion. No Edit action is introduced.

The account-level RecurringRetirementProvider uses `system.recurring-retirement.pending.v1:<userId>` and Web Lock `system.recurring-retirement`. It reuses the verified management lifecycle with an explicit storage namespace. Old `system.quest-management.pending.v1` data is untouched. Saved command identity/operation are persisted before dispatch; uncertain responses survive card disappearance, reload and cross-tab recovery. Retry rejection does not discard a potentially committed command. Offline dispatch is disabled; no reconnect replay occurs automatically.

## Compatibility and verification

Deploy migration before UI. No backfill is needed, and old active recurring/archived-one-off return shapes remain unchanged. Existing paused, ended/exhausted, future-materialized, completed and reopened rows are retained. Current tombstone RLS hides deleted definitions and child history from browser reads, while RLS-bound executors can recover historical receipts. No history browser is added.

Historical checkpoint suites run before this new migration. The disposable harness applies it after owner activation and the active-projection correction, preserving historical checksum expectations. The new SQL catalog and wire suites run only at the latest boundary. Tests never target the preserved Local project or Cloud.

Commands for validation: `git diff --check`, `npm run lint`, `npm run build`, `node --test tests/*.test.mjs`, `node --test supabase/tests/recurring-retirement-wire.mjs`, and Playwright specs `recurring-retirement.desktop`, `recurring-retirement.mobile`, existing recurring lifecycle, quest-management/quest-delete, Calendar and Goals. Record actual results below; an environment setup failure is not a passing SQL/browser test.

## Continuation review (2026-10-03)

Changes since the initial stopping point:

- Replaced the corrupted Vietnamese recovery aria-label with `questManage.recoveryTitle`; updated browser locators to scope the shared translated label by the pending Quest title.
- Moved the migration's existing temporary role/schema privileges before shared RPC replacement, selected `quest_command_owner` while replacing its functions, and paired temporary EXECUTE grants with revokes. The original ordering failed with `must be owner of function set_quest_recurrence_pause`. Every borrowed privilege is revoked before commit. The harness compares shared RPC OIDs, signatures, owners, ACLs, security modes, volatility and search paths before/after migration.
- Replaced the inaccessible `progression_internal.object_keys` call with built-in `jsonb_object_keys` and a sorted array. Replay originally failed with `42501 permission denied for function object_keys`; no helper privilege was widened.
- Expanded backend validation for authenticated archived-list RLS, both retirement states' historical replay/fresh-command rejection and rollback after archive plus delete in one transaction. Corrected the one-off fixture to supply its required schedule.
- Added a same-account default/recurring namespace isolation and account-deactivation test. Added browser account-change recovery coverage and phone screenshots. Corrected the new browser reward fixture to use the shared completion helper's expected reward.

### Semantic comparison of shared RPCs

Comparison baseline is the immediately preceding repository production definition: `20260928181000_create_recurring_quests.sql` for Pause, and `20260926120000_quest_completion_aliases.sql` plus the exact owner-entry guard injected by `20260928100000_activate_private_owner.sql` for Complete/Reopen. The prior one-off migration's event/tombstone triggers still apply unchanged. This comparison does not contact Cloud.

| RPC | Every behavioral difference |
| --- | --- |
| `set_quest_recurrence_pause(command_id uuid, quest_id uuid, paused boolean, origin text) -> quest_recurrence_state_receipt` | After existing historical replay resolution, reject identities already registered as completion aliases; reject any existing owner event identity not resolved by the Pause replay branch (`23505`); reject archived/deleted definitions (`23514`) before the already-matching-state no-op. Other validation, lock order, origin attribution, history payloads, state transitions and receipts remain identical. One-off requests still fail the existing recurring-definition check. |
| `complete_quest_occurrence(command_id uuid, occurrence_id uuid, expected_execution_cycle integer, reported_completed_at timestamptz, origin text) -> quest_completion_receipt` | After canonical/alias binding replay, reject a fresh identity on an archived/deleted recurring definition (`23514`), before cycle checks or new alias registration. This also rejects a new identity for an already completed recurring occurrence. One-off branches, EXP, event payloads, progression recognition and receipts are unchanged. |
| `reopen_quest_occurrence_v2(command_id uuid, occurrence_id uuid, expected_execution_cycle integer, origin text) -> quest_reopen_receipt` | After historical replay and conflicting identity rejection, reject fresh Reopen on archived/deleted recurring definitions (`23514`), before cycle/status checks or writes. One-off logic, correction/reopened events, original-credit reversal and progression handling are unchanged. |

No other function-body differences were found after accounting for the previously injected owner guard. Existing one-off archive/delete guards were not replaced or relaxed. The temporary replacement privileges leave the three existing function catalog contracts identical.

### Validation evidence

- Encoding: strict UTF-8 decoding and scans for replacement characters, common mojibake, C1 controls and letter/question-mark substitutions across all 25 modified/untracked task files. Only the reported damaged label required correction. Five remaining heuristic hits were valid TypeScript ternary syntax or URL query strings, not Vietnamese copy. Legitimate Vietnamese was preserved. HEAD equals the local `origin/main` reference; task changes are uncommitted.
- Authenticated archived-list RLS: PASS against real disposable Supabase Auth/PostgREST/PostgreSQL. Owner receives an archived recurring series, active/deleted IDs are absent, the other authenticated account receives `42501` from the RPC and sees no owner rows through quests/rules/occurrences/events. The catalog confirms STABLE SECURITY INVOKER. No RLS/security-model changes.
- Backend: `node --test supabase/tests/recurring-retirement-wire.mjs`: **6 passed, 0 failed, 0 skipped**. Includes catalog assertions, running and paused restore, zero/ended/exhausted series, exact full occurrence/rule snapshots, past/today/future slots, positive retained completion EXP and reopened history, no backfill/duplicates, command conflicts, retired fresh commands and historical replay, one-off/Goal boundaries, authorization, concurrent operations and rollback.
- Locking: owner advisory lock precedes Quest FOR UPDATE; occurrence commands then lock the occurrence. Four concurrent archive races cover generation, Complete, Reopen and Pause. Successful commands serialize before retirement and replay afterwards; losing fresh commands reject. Subsequent materialization cannot alter frozen snapshots. An intentional transaction failure after both archive and delete leaves neither marker nor receipt committed, and the rolled-back identity remains fresh.
- Historical migration checks: `node supabase/tests/private-owner-wire.mjs`: **23 historical SQL checkpoint suites and 12 database/security groups passed**. The new migration is excluded from the historical loop and applied only after owner activation and the active-projection correction. No old migration or checkpoint expectation changed.
- Node: `node --test tests/*.test.mjs`: **259 passed, 0 failed, 0 skipped** (previously 258; added namespace/account isolation).
- `npm run lint`: PASS; `npm run build`: PASS, including TypeScript. The ordinary build reports loading `.env.local`; authenticated/backend/browser validation targets only generated disposable environments, and browser fixtures build an isolated app copy with disposable configuration.
- `git diff --check`: PASS. Git emits LF-to-CRLF normalization warnings for tracked modified files; these are not encoding corruption. Playwright emits the existing `NO_COLOR` ignored because `FORCE_COLOR` is set warning.
- Focused browser run: initially 20/23 passed; two new retirement cases failed because the fixture awarded 17 EXP while the shared helper required 37, and one case exposed the conservative cross-tab recovery behavior described below. After correcting the fixture and making the test's cross-tab scope explicit, `npx playwright test recurring-retirement` passed **5/5**, including the newly added account-change case. All **24 unique focused cases** have now passed across the regression run and retirement rerun (19 existing regression cases plus 5 retirement cases). No tests skipped. Phone screenshots at 360/390/412 px were visually reviewed: titles wrap and Restore/Delete controls remain within the card. Full 38-test suite: running.

### Compatibility limitations and production risks

- Shared management recovery is deliberately conservative: removing a pending localStorage key is not evidence of server acceptance. Another open tab holding that pending identity can restore it after acknowledgement in the first tab. Reload/close the observing tab before the exact retry when this occurs. The browser test proves shared identity and blocked conflicting actions, then closes the observer before acknowledgement; it does not claim automatic cross-tab convergence. This inherited behavior was not changed for either one-off or recurring recovery.
- Historical Pause/Resume replay applies to recorded state-changing commands. The existing V1 already-matching-state no-op returns no event/accepted identity, so it cannot later be recovered as a durable historical receipt. That existing contract is preserved.
- Deploy the migration before its UI only after the usual separate production review/authorization. No Cloud validation or deployment was performed. Tombstone children remain hidden from browser reads under existing RLS even though rows and EXP/history are retained.
- All work remains uncommitted on the requested feature branch. No commit, push, db push/reset, preserved-stack/volume modification or Cloud operation was performed.
