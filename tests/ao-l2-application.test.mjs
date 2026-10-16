import './ao-l2/node-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { normalizeOpportunity, normalizeActivityCreate } from '../src/features/activities-opportunities/model.ts';
const { prepareOperation, dispatchCommand, availableActivityActions, canCorrectActivityStatus, unavailableAoAdapter } = await import('../src/features/activities-opportunities/application.ts');
const { createCommandSession } = await import('../src/features/activities-opportunities/command-session.ts');
const { blankDate, dateDraft, parseDateDraft } = await import('../src/features/activities-opportunities/temporal-input.ts');
const { filterSummaries, initialAoQuery } = await import('../src/features/activities-opportunities/read-contracts.ts');
const { DateValue } = await import('../src/features/activities-opportunities/ui/date-fields.tsx');
const { OpportunityForm, ActivityForm } = await import('../src/features/activities-opportunities/ui/core-form.tsx');
const { AoRecordBrowser } = await import('../src/features/activities-opportunities/ui/record-browser.tsx');
const { AoRecordDetail } = await import('../src/features/activities-opportunities/ui/record-detail.tsx');
const { AoLifecycleForm } = await import('../src/features/activities-opportunities/ui/lifecycle-form.tsx');
const { coreCopy } = await import('../src/features/activities-opportunities/ui/core-copy.ts');

const id = '11111111-1111-4111-8111-111111111111', command = '22222222-2222-4222-8222-222222222222';
const identity = { command_id: command, subject_id: id, expected_revision: null };
const now = Date.parse('2026-10-16T12:00:00Z');
const opportunity = (fields = {}, extra = {}) => ({ kind: 'opportunity', id, revision: '7', archived: false,
  fields: normalizeOpportunity({ title: 'Cơ hội 🧭', ...fields }, 'create').value, ...extra });
const activity = (intent = 'confirmed_started', fields = {}, extra = {}) => ({ kind: 'activity', id, revision: '7', archived: false,
  fields: normalizeActivityCreate({ title: 'Hoạt động', intent, ...fields }).value.fields, ...extra });
function prepare(operation) { return prepareOperation({ ...identity, expected_revision: 'current' in operation ? operation.current.revision : null }, operation, now); }
function receipt(prepared, extra = {}) {
  const i = prepared.command.identity, before = i.expected_revision ?? '0';
  return { version: 1, command_id: i.command_id, subject_kind: i.subject_kind, subject_id: i.subject_id,
    operation: i.operation, revision_before: before, revision_after: String(BigInt(before) + 1n), changed: true, replay: false, ...extra };
}

test('title-only Opportunity defaults and metadata remain separate from lifecycle commands', () => {
  const p = prepare({ operation: 'create_opportunity_v1', fields: { title: '  Học bổng 🧭  ' } });
  assert.equal(p.outcome, 'ready'); assert.equal(p.command.request.fields.title, 'Học bổng 🧭');
  assert.equal(p.command.request.fields.tracking_stage, 'saved'); assert.deepEqual(p.warnings, []);
  for (const changes of [{ tracking_stage: 'closed' }, { selection_outcome: 'accepted' }, { selection_applicability: 'not_applicable' }]) {
    assert.equal(prepare({ operation: 'update_opportunity_v1', current: opportunity(), changes }).outcome, 'rejected');
  }
});
test('hard errors prevent dispatch: Unicode, required, closed Other, applicability and range', async () => {
  let calls = 0; const adapter = { available: true, send: async () => { calls++; } };
  for (const fields of [{ title: '' }, { title: '🧭'.repeat(241) }, { title: 'A\0B' },
    { title: 'A', tracking_stage: 'closed', closed_reason: 'other' },
    { title: 'A', selection_applicability: 'not_applicable', selection_outcome: 'accepted' },
    { title: 'A', program_start: { precision: 'year', year: 2027 }, program_end: { precision: 'year', year: 2026 } }]) {
    const result = await dispatchCommand(adapter, prepare({ operation: 'create_opportunity_v1', fields }));
    assert.equal(result.outcome, 'rejected'); assert(result.error.field);
  }
  assert.equal(calls, 0);
  assert.equal(prepare({ operation: 'create_opportunity_v1', fields: { title: '🧭'.repeat(240) } }).outcome, 'ready');
});
test('warnings are confirmable, preserve independent stage/outcome and never create Activities', async () => {
  const p = prepare({ operation: 'create_opportunity_v1', fields: { title: 'A', selection_outcome: 'accepted' } });
  assert.deepEqual(p.warnings, ['saved_accepted']);
  const calls = [], adapter = { available: true, send: async input => { calls.push(input); return { outcome: 'success', receipt: receipt(p) }; } };
  assert.equal((await dispatchCommand(adapter, p)).outcome, 'rejected'); assert.equal(calls.length, 0);
  assert.equal((await dispatchCommand(adapter, p, true)).outcome, 'success'); assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.operation, 'create_opportunity_v1');
  assert.equal(calls[0].request.fields.tracking_stage, 'saved');
});
test('unrelated metadata edits do not repeat existing unusual-combination warnings', () => {
  const current = opportunity({ selection_outcome: 'accepted' });
  const p = prepare({ operation: 'update_opportunity_v1', current, changes: { notes: 'New notes' } });
  assert.equal(p.outcome, 'ready'); assert.deepEqual(p.warnings, []);
});
test('stage reopening clears current closed fields explicitly; outcome may arrive after Closed', () => {
  const current = opportunity({ tracking_stage: 'closed', closed_reason: 'other', closed_note: 'A reason' });
  assert.equal(prepare({ operation: 'set_opportunity_stage_v1', current, stage: 'preparing', mode: 'advance', closed_reason: null, closed_note: null }).outcome, 'rejected');
  const p = prepare({ operation: 'set_opportunity_stage_v1', current, stage: 'preparing', mode: 'reopen', closed_reason: null, closed_note: null });
  assert.equal(p.outcome, 'ready'); assert.equal(p.command.request.closed_note, null);
  const outcome = prepare({ operation: 'record_opportunity_outcome_v1', current, outcome: 'accepted', applicability: 'applicable', decision_at: null, mode: 'new_decision' });
  assert.equal(outcome.outcome, 'ready'); assert.equal(current.fields.tracking_stage, 'closed');
});
test('Activity creation requires explicit intent and never sends generated dates or confirmation', () => {
  assert.equal(prepare({ operation: 'create_activity_v1', fields: { title: 'A' }, intent: '' }).outcome, 'rejected');
  for (const intent of ['confirmed_plan', 'confirmed_started', 'historical_completed', 'historical_ended_early']) {
    const p = prepare({ operation: 'create_activity_v1', fields: { title: 'A' }, intent });
    assert.equal(p.outcome, 'ready'); assert.equal(p.command.request.intent, intent);
    assert.equal(p.command.request.fields.actual_start, null); assert.equal(p.command.request.fields.actual_end, null);
    assert.equal('participation_confirmed_at' in p.command.request.fields, false); assert.equal('status' in p.command.request.fields, false);
  }
});
test('lifecycle transitions preserve dates, terminal correction validates dates atomically', () => {
  const current = activity('historical_completed', { actual_start: { precision: 'year', year: 2024 }, actual_end: { precision: 'year', year: 2025 } });
  assert.deepEqual(availableActivityActions('completed'), []);
  assert.equal(prepare({ operation: 'transition_activity_v1', current, action: 'resume' }).outcome, 'rejected');
  assert.equal(prepare({ operation: 'correct_activity_status_v1', current, target_status: 'upcoming', actual_start: current.fields.actual_start,
    actual_end: current.fields.actual_end, reason: 'Correction' }).outcome, 'rejected');
  const p = prepare({ operation: 'correct_activity_status_v1', current, target_status: 'upcoming', actual_start: { precision: 'unknown' }, actual_end: { precision: 'unknown' }, reason: 'Correction' });
  assert.equal(p.outcome, 'ready'); assert.equal(p.command.request.reason, 'Correction');
  const transition = prepare({ operation: 'transition_activity_v1', current: activity(), action: 'pause' });
  assert.deepEqual(transition.command.request, { action: 'pause' });
});
test('archived state, subject binding and stale local revision fail before dispatch', () => {
  assert.equal(prepare({ operation: 'update_activity_v1', current: activity('confirmed_plan', {}, { archived: true }), changes: { title: 'B' } }).reason, 'archived');
  const op = { operation: 'update_opportunity_v1', current: opportunity(), changes: { title: 'B' } };
  assert.equal(prepareOperation({ ...identity, expected_revision: '6' }, op, now).outcome, 'conflict');
  assert.equal(prepareOperation({ ...identity, subject_id: command, expected_revision: '7' }, op, now).outcome, 'conflict');
});
test('adapter result mapping distinguishes rejection, conflict, unavailable and uncertain writes', async () => {
  const p = prepare({ operation: 'create_opportunity_v1', fields: { title: 'A' } });
  assert.equal((await dispatchCommand(unavailableAoAdapter, p)).outcome, 'unavailable');
  for (const [raw, expected] of [
    [{ outcome: 'success', receipt: receipt(p) }, 'success'],
    [{ outcome: 'success', receipt: receipt(p, { command_id: id }) }, 'unknown'],
    [{ outcome: 'success', receipt: receipt(p, { revision_after: '9007199254740993' }) }, 'unknown'],
    [{ outcome: 'rejected', reason: 'forbidden', message: 'must not echo' }, 'rejected'],
    [{ outcome: 'rejected', reason: 'arbitrary-server-text' }, 'unknown'],
    [{ outcome: 'conflict' }, 'conflict'], [{ outcome: 'unavailable' }, 'unknown'], [null, 'unknown'],
  ]) {
    const result = await dispatchCommand({ available: true, send: async () => raw }, p);
    assert.equal(result.outcome, expected); assert.equal('message' in result, false);
  }
  assert.equal((await dispatchCommand({ available: true, send: async () => { throw Error('lost response'); } }, p)).outcome, 'unknown');
});
test('bigint revisions remain strings; valid replay is acknowledged without claiming current state', async () => {
  const current = opportunity({}, { revision: '9007199254740993' });
  const p = prepare({ operation: 'update_opportunity_v1', current, changes: { title: 'B' } });
  assert.equal(p.command.identity.expected_revision, '9007199254740993');
  const result = await dispatchCommand({ available: true, send: async () => ({ outcome: 'success', receipt: receipt(p, { replay: true }) }) }, p);
  assert.equal(result.receipt.revision_after, '9007199254740994'); assert.equal(result.receipt.replay, true);
});
test('session blocks double submit and preserves pending identity/payload after response loss', async () => {
  let finish, calls = 0;
  const adapter = { available: true, send: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const session = createCommandSession({ adapter, subjectId: id, revision: null, uuid: () => command, now: () => now });
  const fields = { title: 'Original' };
  const waiting = session.submit({ operation: 'create_opportunity_v1', fields });
  await session.submit({ operation: 'create_opportunity_v1', fields: { title: 'Duplicate' } });
  fields.title = 'Changed outside';
  finish(null); await waiting;
  assert.equal(calls, 1); assert.equal(session.snapshot().result.outcome, 'unknown'); assert.equal(session.snapshot().locked, true);
  session.edit(); await session.submit({ operation: 'create_opportunity_v1', fields });
  assert.equal(calls, 1); assert.equal(session.snapshot().preparation.command.request.fields.title, 'Original');
});
test('changing fields invalidates warning confirmation; confirmation dispatches exactly the reviewed intent', async () => {
  const calls = [];
  const session = createCommandSession({ adapter: { available: true, send: async p => { calls.push(p); return { outcome: 'rejected', reason: 'validation' }; } },
    subjectId: id, revision: null, uuid: () => command, now: () => now });
  await session.submit({ operation: 'create_opportunity_v1', fields: { title: 'A', selection_outcome: 'accepted' } });
  assert.equal(calls.length, 0); session.edit(); await session.confirm(); assert.equal(calls.length, 0);
  await session.submit({ operation: 'create_opportunity_v1', fields: { title: 'B', selection_outcome: 'accepted' } });
  await session.confirm(); assert.equal(calls.length, 1); assert.equal(calls[0].request.fields.title, 'B');
});
test('all date precisions round-trip source data; blank offset never becomes UTC zero', () => {
  for (const value of [{ precision: 'unknown' }, { precision: 'year', year: 2026 }, { precision: 'month', year: 2026, month: 2 },
    { precision: 'day', year: 2024, month: 2, day: 29 },
    { precision: 'day', year: 2026, month: 11, day: 1, source_time: '01:30', source_time_state: 'unresolved' },
    { precision: 'instant', source_date: '2026-11-01', source_time: '01:30', source_zone: 'America/New_York', source_offset_minutes: -240 }]) {
    assert.deepEqual(parseDateDraft(dateDraft(value), true, 'deadline').value, value);
  }
  const input = { ...blankDate(), mode: 'instant', year: '2026', month: '11', day: '1', time: '01:30' };
  assert.equal(parseDateDraft(input, true, 'deadline').ok, false);
  assert.equal(parseDateDraft({ ...input, offset: '-240', zone: 'America/New_York' }, true, 'deadline').ok, true);
  assert.equal(parseDateDraft({ ...input, offset: '-300', zone: 'America/New_York' }, true, 'deadline').ok, true);
  assert.equal(parseDateDraft({ ...input, month: '3', day: '8', time: '02:30', offset: '-300', zone: 'America/New_York' }, true, 'deadline').ok, false);
  assert.equal(parseDateDraft({ ...input, offset: '0' }, false, 'actual_start').ok, false);
});
test('date display distinguishes source and display zones and never counts down uncertain dates', () => {
  const value = { precision: 'instant', source_date: '2026-11-01', source_time: '01:30', source_zone: 'America/New_York', source_offset_minutes: -240 };
  const html = render(h(DateValue, { value, locale: 'en', localZone: 'Asia/Ho_Chi_Minh' }));
  assert.match(html, /America\/New_York/); assert.match(html, /Asia\/Ho_Chi_Minh/); assert.match(html, /-240/);
  for (const value of [{ precision: 'unknown' }, { precision: 'year', year: 2026 }, { precision: 'day', year: 2026, month: 1, day: 1, source_time: '12:00', source_time_state: 'unresolved' }]) {
    const text = render(h(DateValue, { value, locale: 'en', localZone: 'Asia/Ho_Chi_Minh' }));
    assert.match(text, /no exact countdown|No UTC instant or exact countdown/); assert.doesNotMatch(text, /Local display/);
  }
});
test('bilingual forms use semantic labels, codepoint validation and no preselected Activity intent', () => {
  assert.deepEqual(Object.keys(coreCopy.en), Object.keys(coreCopy.vi));
  for (const locale of ['en', 'vi']) {
    const html = render(h(ActivityForm, { locale, uuid: () => id }));
    assert.match(html, /<form/); assert.match(html, /<fieldset/); assert.match(html, /name="intent"/);
    assert.doesNotMatch(html, /checked=""/); assert.doesNotMatch(html, /maxlength=/i);
    const opportunityHtml = render(h(OpportunityForm, { locale, uuid: () => id }));
    assert.match(opportunityHtml, /name="tracking_stage"/); assert.match(opportunityHtml, /name="selection_outcome"/);
    assert.match(opportunityHtml, /name="application_deadline.precision"/);
    const archived = render(h(OpportunityForm, { locale, current: opportunity({}, { archived: true }) }));
    assert.match(archived, /fieldset disabled/);
  }
});
test('lists separate empty, unavailable, loading and errors; filters preserve Unicode and archive scope', () => {
  const items = [{ kind: 'opportunity', id, title: 'Học bổng', organization: 'Tổ chức', category: 'scholarship', archived: false, trackingStage: 'saved', selectionOutcome: 'unknown', applicability: 'not_applicable' }];
  assert.equal(filterSummaries(items, 'opportunity', { ...initialAoQuery, search: 'HỌC', category: 'scholarship' }).length, 1);
  assert.equal(filterSummaries(items, 'opportunity', { ...initialAoQuery, scope: 'archived' }).length, 0);
  for (const outcome of ['loading', 'unavailable', 'error', 'ready']) {
    const state = outcome === 'ready' ? { outcome, items: [], hasMore: false } : { outcome };
    const html = render(h(AoRecordBrowser, { kind: 'opportunity', locale: 'en', state }));
    assert.match(html, outcome === 'ready' ? /No matching records/ : outcome === 'unavailable' ? /cannot determine/ : outcome === 'loading' ? /Loading records/ : /could not be loaded/);
  }
  const html = render(h(AoRecordBrowser, { kind: 'opportunity', locale: 'en', state: { outcome: 'ready', items, hasMore: false } }));
  assert.match(html, /Selection outcome: Not applicable/);
});
test('detail renders plain text and safe resources; real routes cannot import isolated interactive harness', () => {
  const record = opportunity({ title: '<script>alert(1)</script>', selection_applicability: 'not_applicable' });
  const html = render(h(AoRecordDetail, { record, locale: 'en' }));
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/); assert.match(html, /Not applicable/);
  for (const file of ['route-page.tsx', 'page-context.ts', 'access-layout.tsx', 'presentation.tsx']) {
    const source = readFileSync(`src/features/activities-opportunities/ui/${file}`, 'utf8');
    assert.doesNotMatch(source, /core-form|lifecycle-form|record-browser|ao-l2\/harness|process\.env.*AO|searchParams\s*[.:=]/);
  }
});


test('F-01: correction is terminal-only in application and rendered UI; invalid commands never dispatch', async () => {
  let calls = 0;
  const adapter = { available: true, send: async () => { calls++; return { outcome: 'rejected', reason: 'validation' }; } };
  const statuses = ['upcoming', 'ongoing', 'paused', 'completed', 'ended_early', 'cancelled_before_start'];
  for (const status of statuses) {
    const current = activity(); current.fields.status = status;
    const terminal = ['completed', 'ended_early', 'cancelled_before_start'].includes(status);
    assert.equal(canCorrectActivityStatus(status), terminal);
    for (const locale of ['en', 'vi']) {
      const html = render(h(AoLifecycleForm, { current, locale, uuid: () => command }));
      assert.equal(html.includes('value="correction"'), terminal);
      assert.equal(html.includes('value="transition"'), !terminal);
    }
    for (const target_status of statuses) {
      const p = prepare({ operation: 'correct_activity_status_v1', current, target_status, reason: null });
      assert.equal(p.outcome, terminal ? 'ready' : 'rejected');
      if (!terminal) {
        assert.equal(p.error.code, 'transition');
        await dispatchCommand(adapter, p);
      } else assert.deepEqual(p.command.request, { target_status, reason: null });
    }
  }
  assert.equal(calls, 0);
});

test('F-01: invalid correction dates reject atomically and preserve the snapshot without adapter calls', async () => {
  let calls = 0;
  const adapter = { available: true, send: async () => { calls++; } };
  const current = activity('historical_completed', { actual_start: { precision: 'year', year: 2024 }, actual_end: { precision: 'year', year: 2025 } });
  const original = structuredClone(current);
  for (const changes of [
    { target_status: 'upcoming' }, // omitted dates must still participate in state validation
    { target_status: 'completed', actual_start: { precision: 'year', year: 2026 } }, // merged end is earlier
    { target_status: 'ended_early', actual_start: { precision: 'day', year: 2025, month: 2, day: 30 }, actual_end: { precision: 'unknown' } },
    { target_status: 'cancelled_before_start', actual_start: { precision: 'unknown' } }, // unchanged known end contradicts target
  ]) {
    const p = prepare({ operation: 'correct_activity_status_v1', current, reason: null, ...changes });
    assert.equal(p.outcome, 'rejected');
    assert.equal((await dispatchCommand(adapter, p)).outcome, 'rejected');
    assert.deepEqual(current, original);
  }
  assert.equal(calls, 0);
});

test('F-02: null, explicit Unknown, omitted update dates and edited dates remain distinct', () => {
  assert.equal(dateDraft(null).mode, 'unset');
  assert.equal(parseDateDraft(dateDraft(null), false, 'actual_start').value, null);
  assert.deepEqual(parseDateDraft(dateDraft({ precision: 'unknown' }), false, 'actual_start').value, { precision: 'unknown' });
  for (const decision_at of [null, { precision: 'unknown' }, { precision: 'year', year: 2024 }]) {
    const current = opportunity({ decision_at });
    const op = { operation: 'record_opportunity_outcome_v1', current, outcome: 'rejected', applicability: 'applicable', mode: 'new_decision' };
    const omitted = prepare(op);
    assert.equal(omitted.outcome, 'ready'); assert.equal(Object.hasOwn(omitted.command.request, 'decision_at'), false);
    assert.deepEqual(prepare({ ...op, decision_at: { precision: 'unknown' } }).command.request.decision_at, { precision: 'unknown' });
    assert.equal(prepare({ ...op, decision_at: null }).command.request.decision_at, null);
    assert.deepEqual(current.fields.decision_at, decision_at);
  }
  const current = activity('historical_completed', { actual_start: { precision: 'year', year: 2024 }, actual_end: { precision: 'year', year: 2025 } });
  const op = { operation: 'correct_activity_status_v1', current, target_status: 'ended_early', reason: null };
  assert.deepEqual(prepare(op).command.request, { target_status: 'ended_early', reason: null });
  assert.deepEqual(prepare({ ...op, actual_end: { precision: 'year', year: 2026 } }).command.request,
    { target_status: 'ended_early', reason: null, actual_end: { precision: 'year', year: 2026 } });
  assert.equal(prepare({ ...op, target_status: 'upcoming' }).outcome, 'rejected');
  assert.equal(prepare({ ...op, target_status: 'upcoming', actual_start: { precision: 'unknown' }, actual_end: { precision: 'unknown' } }).outcome, 'ready');
});
