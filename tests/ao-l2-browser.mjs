// Isolated React/browser validation: no Next server, Auth, Supabase, credentials,
// database, URL-controlled production feature flag or external network traffic.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.e2e/ao-l2');
await mkdir(path.join(output, 'screenshots'), { recursive: true });
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: root,
    entry: path.join(root, 'tests/ao-l2/harness.tsx'), output: { path: output, filename: 'harness.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(root, 'tests/ao-l2/transpile-loader.mjs') }] },
  });
  compiler.run((error, stats) => compiler.close(() => {
    if (error) reject(error); else if (stats.hasErrors()) reject(Error(stats.toString({ all: false, errors: true }))); else resolve();
  }));
});
const cssFile = path.join(root, 'src/app/globals.css');
const css = (await postcss([tailwind({ base: root })]).process(await readFile(cssFile, 'utf8'), { from: cssFile })).css;
await writeFile(path.join(output, 'styles.css'), css);
const bundle = await readFile(path.join(output, 'harness.js'));
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/harness.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
  else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AO isolated test harness</title><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/harness.js"></script></html>'); }
  else { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const evidence = { viewports: [], interactions: [], screenshots: [], consoleErrors: [] };
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => evidence.consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin); await page.locator('[name="title"]').waitFor();
  const screen = async value => { await page.locator('#screen').selectOption(value); };
  const calls = () => page.evaluate(() => window.aoHarness.calls);
  const clear = () => page.evaluate(() => { window.aoHarness.calls = []; });
  const save = () => page.locator('.ao-core button[type="submit"]').click();
  const awaitCalls = count => page.waitForFunction(n => window.aoHarness.calls.length === n, count);
  async function reset(value = 'opportunity', result = 'success') {
    await screen('archived'); await page.locator('#locale').selectOption('en'); await page.locator('#result').selectOption(result); await page.locator('#fixture-status').selectOption('completed'); await page.locator('#fixture-date').selectOption('null'); await screen(value); await clear();
  }

  await save(); assert.equal((await calls()).length, 0); assert.equal(await page.locator('[name="title"]').getAttribute('aria-invalid'), 'true');
  await page.locator('[name="title"]').fill('Học bổng 🧭'); await save(); await awaitCalls(1);
  await page.getByText('Command confirmed.', { exact: false }).waitFor();
  for (const key of ['application_deadline', 'program_start', 'program_end', 'applied_at', 'decision_at']) {
    assert.equal((await calls())[0].request.fields[key], null);
  }
  assert.equal((await calls())[0].request.fields.title, 'Học bổng 🧭'); evidence.interactions.push('Opportunity title validation + create receipt');

  await reset(); await page.locator('[name="title"]').fill('Accepted synthetic'); await page.locator('[name="selection_outcome"]').selectOption('accepted');
  await save(); assert.equal((await calls()).length, 0); await page.getByRole('button', { name: 'Confirm and save', exact: true }).click(); await awaitCalls(1);
  assert.equal((await calls())[0].request.fields.tracking_stage, 'saved'); evidence.interactions.push('Warning confirmation preserves Saved + Accepted');

  await reset(); await page.locator('[name="title"]').fill('Other reason'); await page.locator('[name="tracking_stage"]').selectOption('closed');
  await page.locator('[name="closed_reason"]').selectOption('other'); await save(); assert.equal((await calls()).length, 0);
  assert.equal(await page.locator('[name="closed_note"]').getAttribute('aria-invalid'), 'true');
  await page.locator('[name="closed_note"]').fill('Đã hoàn tất thủ tục'); await save(); await awaitCalls(1); evidence.interactions.push('Closed Other requires visible note');

  await reset('activity'); assert.equal(await page.locator('[name="intent"]:checked').count(), 0);
  await page.locator('[name="title"]').fill('Hoạt động lịch sử'); await save(); assert.equal((await calls()).length, 0);
  await page.locator('[value="historical_completed"]').check(); await save(); await awaitCalls(1);
  const imported = (await calls())[0]; assert.equal(imported.request.intent, 'historical_completed');
  for (const key of ['planned_start', 'planned_end', 'actual_start', 'actual_end']) assert.equal(imported.request.fields[key], null); assert.equal('participation_confirmed_at' in imported.request.fields, false);
  evidence.interactions.push('Explicit historical Activity intent; no fabricated dates/confirmation');

  await reset('opportunity', 'unknown'); await page.locator('[name="title"]').fill('Retained draft'); await save(); await awaitCalls(1);
  await page.getByText('The result is unknown.', { exact: false }).waitFor();
  assert.equal(await page.locator('[name="title"]').inputValue(), 'Retained draft'); assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
  evidence.interactions.push('Lost response retains draft and blocks duplicate writes');
  for (const result of ['conflict', 'unavailable', 'rejected']) {
    await reset('opportunity', result); await page.locator('[name="title"]').fill('Retained draft'); await save();
    await page.locator('.ao-command-feedback [role="alert"]').waitFor();
    assert.equal((await calls()).length, result === 'unavailable' ? 0 : 1);
    assert.equal(await page.locator('[name="title"]').inputValue(), 'Retained draft');
    assert.equal(await page.locator('button[type="submit"]').isDisabled(), result === 'conflict');
    evidence.interactions.push(`${result} result distinguishes dispatch and editing state`);
  }

  await reset('edit-opportunity'); await page.locator('[name="title"]').fill('Updated title'); await save(); await awaitCalls(1);
  const edit = (await calls())[0]; assert.equal(edit.identity.expected_revision, '7'); assert.equal(edit.identity.operation, 'update_opportunity_v1');
  assert.equal('selection_outcome' in edit.request.changes, false);
  for (const key of ['application_deadline', 'program_start', 'program_end', 'applied_at', 'decision_at']) assert.equal(Object.hasOwn(edit.request.changes, key), false);
  evidence.interactions.push('Metadata edit preserves revision and excludes lifecycle fields');
  evidence.interactions.push('Untouched null dates survive metadata edits without repeating Saved + Accepted warnings');

  await reset('activity-lifecycle'); await page.locator('[name="operation"]').selectOption('correction');
  await page.locator('[name="status"]').selectOption('upcoming'); await page.locator('[name="reason"]').fill('Correction from synthetic history');
  await save(); await awaitCalls(1); assert.equal((await calls())[0].identity.operation, 'correct_activity_status_v1');
  assert.equal(Object.hasOwn((await calls())[0].request, 'actual_start'), false); assert.equal(Object.hasOwn((await calls())[0].request, 'actual_end'), false); evidence.interactions.push('Separate terminal Correct Status command with atomic dates');

  await reset('opportunity-lifecycle'); await page.locator('[name="operation"]').selectOption('outcome');
  await page.locator('[name="selection_outcome"]').selectOption('accepted'); await save(); assert.equal((await calls()).length, 0);
  await page.locator('[name="selection_applicability"]').selectOption('applicable'); await save();
  await page.getByRole('button', { name: 'Confirm and save', exact: true }).click(); await awaitCalls(1);
  assert.equal((await calls())[0].identity.operation, 'record_opportunity_outcome_v1'); assert.equal(Object.hasOwn((await calls())[0].request, 'decision_at'), false); evidence.interactions.push('Outcome/applicability hard error and independent outcome command');


  for (const fixture of ['null', 'unknown', 'known']) {
    for (const kind of ['opportunity', 'activity']) {
      await reset('edit-' + kind); await page.locator('#fixture-date').selectOption(fixture);
      await page.locator('[name="title"]').fill('Metadata only'); await save(); await awaitCalls(1);
      const changes = (await calls())[0].request.changes;
      const keys = kind === 'opportunity' ? ['application_deadline', 'program_start', 'program_end', 'applied_at', 'decision_at'] : ['planned_start', 'planned_end', 'actual_start', 'actual_end'];
      for (const key of keys) assert.equal(Object.hasOwn(changes, key), false);
    }
  }
  evidence.interactions.push('F-02: both metadata editors omit untouched null, Unknown and known dates');

  for (const fixture of ['unknown', 'known']) {
    await reset('opportunity-lifecycle'); await page.locator('#fixture-date').selectOption(fixture);
    await page.locator('[name="operation"]').selectOption('outcome');
    await page.locator('[name="selection_outcome"]').selectOption('rejected'); await page.locator('[name="selection_applicability"]').selectOption('applicable');
    await save(); await awaitCalls(1); assert.equal(Object.hasOwn((await calls())[0].request, 'decision_at'), false);
    await reset('activity-lifecycle'); await page.locator('#fixture-date').selectOption(fixture);
    await page.locator('[name="operation"]').selectOption('correction'); await page.locator('[name="status"]').selectOption('ended_early');
    await save(); await awaitCalls(1);
    for (const key of ['actual_start', 'actual_end']) assert.equal(Object.hasOwn((await calls())[0].request, key), false);
  }
  evidence.interactions.push('F-02: outcome and terminal correction omit untouched Unknown and known dates');

  for (const status of ['upcoming', 'ongoing', 'paused', 'completed', 'ended_early', 'cancelled_before_start']) {
    await reset('activity-lifecycle'); await page.locator('#fixture-status').selectOption(status);
    const terminal = ['completed', 'ended_early', 'cancelled_before_start'].includes(status);
    assert.equal(await page.locator('[name="operation"] option[value="correction"]').count(), terminal ? 1 : 0);
    assert.equal(await page.locator('[name="operation"] option[value="transition"]').count(), terminal ? 0 : 1);
    if (terminal) {
      await page.locator('[name="operation"]').selectOption('correction');
      assert.deepEqual(await page.locator('[name="status"] option').evaluateAll(nodes => nodes.map(node => node.value)),
        ['upcoming', 'ongoing', 'paused', 'completed', 'ended_early', 'cancelled_before_start']);
    } else {
      await page.locator('[name="operation"]').selectOption('transition');
      await page.locator('[name="action"]').selectOption(status === 'upcoming' ? 'start' : status === 'ongoing' ? 'pause' : 'resume');
      await save(); await awaitCalls(1); assert.equal((await calls())[0].identity.operation, 'transition_activity_v1');
    }
  }
  evidence.interactions.push('F-01: terminal-only correction UI; all targets available; nonterminal ordinary transitions');

  await reset('activity-lifecycle'); await page.locator('#fixture-date').selectOption('known');
  await page.locator('[name="operation"]').selectOption('correction'); await page.locator('[name="status"]').selectOption('upcoming');
  await save(); assert.equal((await calls()).length, 0);
  await page.locator('[name="actual_start.precision"]').selectOption('unknown');
  await save(); assert.equal((await calls()).length, 0);
  await page.locator('[name="actual_end.precision"]').selectOption('unknown'); await save(); await awaitCalls(1);
  assert.deepEqual((await calls())[0].request.actual_start, { precision: 'unknown' });
  assert.deepEqual((await calls())[0].request.actual_end, { precision: 'unknown' });
  evidence.interactions.push('F-01/F-02: invalid retained/partially cleared dates never dispatch; deliberate Unknown clears atomically');

  await reset('activity-lifecycle'); await page.locator('[name="operation"]').selectOption('correction');
  await page.locator('[name="actual_start.precision"]').selectOption('day');
  for (const [key, value] of Object.entries({ year: '2025', month: '2', day: '30' })) await page.locator('[name="actual_start.' + key + '"]').fill(value);
  await save(); assert.equal((await calls()).length, 0);
  await page.locator('[name="actual_start.day"]').fill('28'); await save(); await awaitCalls(1);
  assert.deepEqual((await calls())[0].request.actual_start, { precision: 'day', year: 2025, month: 2, day: 28 });
  assert.equal(Object.hasOwn((await calls())[0].request, 'actual_end'), false);
  evidence.interactions.push('F-01/F-02: impossible date is atomic failure; corrected actual edit includes only edited date');

  for (const screenName of ['opportunity', 'activity', 'edit-opportunity', 'edit-activity', 'opportunity-lifecycle']) {
    await reset(screenName);
    const field = screenName === 'opportunity-lifecycle' ? 'decision_at' : screenName.includes('opportunity') ? 'program_start' : 'planned_start';
    if (screenName === 'opportunity-lifecycle') {
      await page.locator('[name="operation"]').selectOption('outcome');
      await page.locator('[name="selection_outcome"]').selectOption('rejected'); await page.locator('[name="selection_applicability"]').selectOption('applicable');
    } else {
      await page.locator('[name="title"]').fill('Explicit unknown');
      if (screenName === 'activity') await page.locator('[value="confirmed_plan"]').check();
    }
    assert.equal(await page.locator('[name="' + field + '.precision"]').inputValue(), 'unset');
    await page.locator('[name="' + field + '.precision"]').selectOption('unknown'); await save(); await awaitCalls(1);
    const request = (await calls())[0].request;
    assert.deepEqual((request.changes ?? request.fields ?? request)[field], { precision: 'unknown' });
  }
  evidence.interactions.push('F-02: deliberate Unknown from untouched null is explicit across create, metadata and outcome forms');

  await reset('edit-opportunity'); await page.locator('[name="program_start.precision"]').selectOption('year');
  await page.locator('[name="program_start.year"]').fill('2026'); await save(); await awaitCalls(1);
  assert.deepEqual((await calls())[0].request.changes.program_start, { precision: 'year', year: 2026 });
  assert.equal(Object.hasOwn((await calls())[0].request.changes, 'program_end'), false);
  evidence.interactions.push('F-02: actual metadata date edit sends that date and omits untouched peers');

  await reset('opportunity-list'); await page.getByRole('searchbox').fill('HỌC BỔNG'); assert.equal(await page.locator('.ao-view-list > li').count(), 1);
  await page.getByRole('searchbox').fill('no match'); await page.getByText('No matching records.', { exact: true }).waitFor();
  await page.getByRole('searchbox').fill(''); await page.getByLabel('Scope', { exact: true }).selectOption('archived');
  await page.getByText('Archived synthetic record', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Open record:/ }).click(); await page.getByRole('button', { name: 'Load next page' }).click();
  assert.equal(await page.evaluate(() => window.aoHarness.opened.length), 1); assert.equal(await page.evaluate(() => window.aoHarness.next), 1);
  evidence.interactions.push('Unicode search, empty state, archive filter, open and next-page callbacks');

  await reset(); await page.locator('[name="title"]').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'organization');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
  evidence.interactions.push('Keyboard tab order and visible focus');

  for (const locale of ['en', 'vi']) for (const width of [360, 390, 412, 820, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await page.locator('#locale').selectOption(locale);
    for (const value of ['opportunity', 'activity', 'edit-opportunity', 'edit-activity', 'opportunity-lifecycle', 'activity-lifecycle', 'opportunity-list', 'activity-list', 'opportunity-detail', 'activity-detail', 'archived']) {
      await screen(value);
      if (value === 'opportunity') {
        await page.locator('[name="title"]').fill('Tên cơ hội dài với tiếng Việt và Unicode 🧭 '.repeat(5));
        await page.locator('[name="application_deadline.precision"]').selectOption('instant');
      }
      if (value === 'activity-lifecycle') await page.locator('[name="operation"]').selectOption('correction');
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
        shortTargets: [...document.querySelectorAll('.ao-core button,.ao-core select,.ao-core input:not([type="radio"]),.ao-core textarea,.ao-intent label')]
          .filter(el => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).length,
        missingLabels: [...document.querySelectorAll('.ao-core input,.ao-core select,.ao-core textarea')]
          .filter(el => !el.labels?.length && !el.getAttribute('aria-label')).length,
      }));
      assert(geometry.document <= width, `${locale}/${width}/${value}: overflow ${JSON.stringify(geometry)}`);
      assert.equal(geometry.shortTargets, 0, `${locale}/${width}/${value}: targets under 44px`);
      assert.equal(geometry.missingLabels, 0, `${locale}/${width}/${value}: missing labels`);
      evidence.viewports.push({ locale, width, screen: value, ...geometry });
      if ([360, 1280].includes(width) && ['opportunity', 'activity', 'opportunity-list', 'opportunity-detail', 'activity-lifecycle'].includes(value)) {
        await page.evaluate(() => scrollTo(0, 0));
        const filename = `${locale}-${width}-${value}.png`;
        await page.screenshot({ path: path.join(output, 'screenshots', filename), fullPage: true }); evidence.screenshots.push(filename);
      }
    }
  }
  assert.deepEqual(evidence.consoleErrors, []);
  await writeFile(path.join(output, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`PASS: ${evidence.interactions.length} isolated interaction scenarios; ${evidence.viewports.length} viewport/locale/screen checks; ${evidence.screenshots.length} screenshots; no console errors.`);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
