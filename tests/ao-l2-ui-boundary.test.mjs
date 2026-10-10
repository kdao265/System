import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const p='src/features/activities-opportunities/ui/';
const read = path => readFileSync(path,'utf8');
const ui=read(p+'presentation.tsx'),copy=read(p+'ui-copy.ts');
const route=read(p+'route-page.tsx'),guard=read(p+'page-context.ts');
const header=read('src/components/app-header.tsx'),shell=read('src/components/system-shell.tsx');
const config=read('next.config.ts'),css=read('src/styles/activities-opportunities.css');
const proxy=read('src/proxy.ts'),authSmoke=read('tests/auth-smoke.mjs');
const slugs=['opportunities','activities'];
const modes=['page.tsx','new/page.tsx','[id]/page.tsx'];
test('six real Next App Router entry points use protected shared AO route',()=>{
  for(const slug of slugs) for(const mode of modes){
    const file=read(`src/app/${slug}/${mode}`);
    assert.match(file,/AoRoutePage/);
    assert.match(file,/dynamic = "force-dynamic"/);
    assert.match(file,/fetchCache = "force-no-store"/);
  }
});
test('guard enforces configured owner auth and onboarding before presentation',()=>{
  assert.match(guard,/getProfileContext\(\)/);
  assert.match(guard,/isOnboardingComplete\(profile\)/);
  assert.match(guard,/redirect\("\/onboarding"\)/);
  assert.match(route,/await aoPageContext\(\)/);
  assert.ok(route.indexOf('await aoPageContext()')<route.indexOf('<SystemShell'));
  assert.match(route,/ProfileError/);
  assert.match(route,/isUuid\(id\)/);
});
test('no AO transport, mutations, fake records or browser persistence',()=>{
  for(const [name,file] of Object.entries({ui,copy,route,guard})){
    assert.doesNotMatch(file, /\.rpc\(|@supabase\/supabase-js|localStorage|sessionStorage|fetch\(/,name);
    assert.doesNotMatch(file, /"use server"|"use client"|sampleRecord|mockData/,name);
  }
  assert.match(route,/records=\{\[\]\}/);
  assert.match(copy,/cannot determine whether any records exist/);
});
test('activity creation requires explicit intent, never preselects upcoming',()=>{
  assert.match(ui,/name="intent"/);
  assert.doesNotMatch(ui,/defaultChecked|checked=\{true\}/);
  assert.match(ui,/<fieldset disabled/);
  assert.match(copy,/confirmed participation plan/i);
});
test('opportunity tracking, outcome and applicability are distinct, bilingual',()=>{
  assert.match(ui,/trackingStage/);
  assert.match(ui,/selectionOutcome/);
  assert.match(ui,/applicability/);
  assert.match(copy,/stageLabels/);
  assert.match(copy,/outcomeLabels/);
  assert.match(copy,/activityStatusLabels/);
  assert.match(copy,/vi: \{/);
  assert.match(copy,/en: \{/);
});
test('one shared shell and accessible Growth destinations',()=>{
  assert.match(shell,/opportunities" \| "activities"/);
  assert.match(header,/system-nav-growth/);
  assert.match(header,/role="group"/);
  assert.match(header,/aria-current=\{current === key \? "page"/);
  for(const s of ['dashboard','calendar','goals','library'])assert.ok(header.includes(`key: "${s}"`));
});
test('AO responses opt out of route caching, existing SW rule retained',()=>{
  for(const slug of slugs){
    assert.match(config,new RegExp(`/${slug}/:path\\*`));
    assert.match(config,/private, no-store, max-age=0/);
  }
  assert.match(config,/"\/sw\.js"/);
  assert.match(read('src/app/globals.css'),/activities-opportunities\.css/);
});
test('route-local error/loading UI, clear preview-only accessible labels',()=>{
  for(const slug of slugs){
    assert.match(read(`src/app/${slug}/loading.tsx`),/role="status"/);
    assert.match(read(`src/app/${slug}/error.tsx`),/role="alert"/);
  }
  assert.match(ui,/aria-describedby="ao-create-pending"/);
  assert.match(ui,/name="tracking_stage"/);
  assert.match(ui,/name="selection_outcome"/);
  assert.match(css,/prefers-reduced-motion/);
});

test('AO routes use existing private session-refresh Proxy and preserve older matchers',()=>{
  for(const slug of [...slugs,'dashboard','calendar','goals','library']){
    assert.ok(proxy.includes(`"/${slug}/:path*"`), `Missing protected matcher: ${slug}`);
  }
  assert.match(proxy,/await supabase\.auth\.getClaims\(\)/);
  assert.match(proxy,/Cache-Control", "private, no-store"/);
  assert.match(proxy,/Pragma", "no-cache"/);
  assert.match(proxy,/Expires", "0"/);
});
test('disposable Auth integration covers every AO route and owner gate',()=>{
  assert.match(authSmoke,/const aoPaths = \[/);
  for(const slug of slugs) for(const suffix of ['', '/new', '/00000000-0000-4000-8000-000000000001']){
    assert.ok(authSmoke.includes(`"/${slug}${suffix}"`));
  }
  for(const gate of ['login','onboarding','owner']){
    assert.ok(authSmoke.includes(`await assertAoGate("${gate}")`));
  }
});
