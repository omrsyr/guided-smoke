'use strict';
// node --test engine/test — no browser needed: ids, references, reports and the CLI's refusals.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-test-'));
process.env.GUIDED_SMOKE_HOME = home;
const store = require('../store');
const report = require('../report');
const { isLocal, normalizeCheck } = require('../engine');
const RUN = path.join(__dirname, '..', 'run.js');
const P = 'demo';

function plan(id) {
  fs.mkdirSync(store.planDir(P, id), { recursive: true });
  fs.writeFileSync(store.planFile(P, id), "module.exports = { steps: [{ title: 'a', run: async () => {} }] };");
}
function walk(id, meta = {}, events = []) {
  const dir = store.walkDir(P, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'walk.json'), JSON.stringify({ walkId: id, planId: id.replace(/-\d+$/, ''), totalSteps: 3,
    titles: ['one', 'two', 'three'], lang: 'en', startedAt: '2026-11-03T08:00:00Z', readyAt: '2026-11-03T08:01:00Z',
    endedAt: '2026-11-03T08:11:00Z', measuredSeconds: 600, result: 'completed', browser: 'chrome', browserSource: 'system default',
    base: 'https://localhost:5001', ...meta }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));
}
function cli(...args) {
  return spawnSync(process.execPath, [RUN, ...args, '--project', P], { env: { ...process.env, GUIDED_SMOKE_HOME: home }, encoding: 'utf8' });
}

plan('6655-machine-expiry');
plan('7001-orders');
plan('7001-invoices');
plan('login-flow');
walk('6655-machine-expiry-1', {}, [{ n: 1, title: 'one', answer: 'pass' }, { n: 2, title: 'two', answer: 'diff', note: 'wrong date' }, { n: 3, title: 'three', answer: 'pass' }]);
walk('6655-machine-expiry-2', {}, [{ n: 1, title: 'one', answer: 'skip', reason: 'filter' }, { n: 2, title: 'two', answer: 'pass' }, { n: 3, title: 'three', answer: 'skip', reason: 'filter' }]);

test('a work item number resolves to its only plan', () => {
  assert.deepStrictEqual(store.resolve(P, '6655'), { planId: '6655-machine-expiry', walkId: null });
});

test('work item and walk number resolve to that walk', () => {
  assert.deepStrictEqual(store.resolve(P, '6655-2'), { planId: '6655-machine-expiry', walkId: '6655-machine-expiry-2' });
});

test('the full plan id and the full walk id resolve', () => {
  assert.strictEqual(store.resolve(P, '6655-machine-expiry').planId, '6655-machine-expiry');
  assert.strictEqual(store.resolve(P, '6655-machine-expiry-1').walkId, '6655-machine-expiry-1');
  assert.strictEqual(store.resolve(P, 'login-flow').planId, 'login-flow');
});

test('several plans for one work item are refused, not guessed', () => {
  assert.throws(() => store.resolve(P, '7001'), e => e instanceof store.ResolveError && e.candidates.length === 2);
});

test('a missing walk or plan is refused with what exists', () => {
  assert.throws(() => store.resolve(P, '6655-9'), e => e instanceof store.ResolveError && e.candidates.includes('6655-machine-expiry-2'));
  assert.throws(() => store.resolve(P, '9999'), store.ResolveError);
});

test('walks are numbered after the highest existing one and never reused', () => {
  assert.strictEqual(store.nextWalkId(P, '6655-machine-expiry'), '6655-machine-expiry-3');
  assert.strictEqual(store.latestWalkId(P, '6655-machine-expiry'), '6655-machine-expiry-2');
  assert.strictEqual(store.nextWalkId(P, 'login-flow'), 'login-flow-1');
});

test('only loopback addresses count as local', () => {
  for (const u of ['https://localhost:5001','http://127.0.0.1:5000', 'http://[::1]:80', 'https://app.localhost']) assert.ok(isLocal(u), u);
  for (const u of ['https://erp.example.com', 'https://10.0.0.5', 'not a url']) assert.ok(!isLocal(u), u);
});

test('the default browser locale is the system one, normalised', () => {
  const { systemLocale } = require('../i18n');
  assert.strictEqual(systemLocale('tr-TR'), 'tr-TR');
  assert.strictEqual(systemLocale('en_us'), 'en-US');
  assert.strictEqual(systemLocale('de'), 'de');
  assert.strictEqual(systemLocale('zh-Hans-CN'), 'zh');
  assert.strictEqual(systemLocale(''), null);
});

test('checks may return a boolean, [ok, text] or [ok, okText, failText]', () => {
  assert.deepStrictEqual(normalizeCheck(true), { ok: true, text: '' });
  assert.deepStrictEqual(normalizeCheck([false, 'x']), { ok: false, text: 'x' });
  assert.deepStrictEqual(normalizeCheck([false, 'good', 'bad']), { ok: false, text: 'bad' });
  assert.deepStrictEqual(normalizeCheck({ ok: 1, text: 't' }), { ok: true, text: 't' });
});

test('the report counts final answers, compares with the previous walk and carries a paste block', () => {
  const meta1 = store.readJson(path.join(store.walkDir(P, '6655-machine-expiry-1'), 'walk.json'));
  const meta2 = { ...meta1, walkId: '6655-machine-expiry-2', workItem: '6655' };
  const prev = { meta: meta1, events: store.readEvents(P, '6655-machine-expiry-1') };
  const { markdown, counts } = report.build(meta2, store.readEvents(P, '6655-machine-expiry-2'), prev);
  assert.deepStrictEqual(counts, { pass: 1, diff: 0, skip: 2, none: 0 });
  assert.match(markdown, /2\. two: ✖ → ✔/);
  assert.match(markdown, /Work item:\*\* #6655/);
  assert.match(markdown, /Measured walk time: 10 min/);
  assert.doesNotMatch(markdown.split('To paste')[1], /three/, 'filtered steps stay out of the paste block');
});

test('a stopped walk shows the remaining steps as not run', () => {
  const meta = { totalSteps: 3, titles: ['a', 'b', 'c'], lang: 'tr', walkId: 'x-1', planId: 'x', readyAt: '2026-11-03T08:00:00Z',
    endedAt: '2026-11-03T08:00:40Z', measuredSeconds: 40, result: 'stopped', browser: 'edge', browserSource: 'fallback', base: 'https://localhost' };
  const { markdown, counts } = report.build(meta, [{ n: 1, title: 'a', answer: 'pass' }, { n: 2, title: 'b', answer: 'stop' }], null);
  assert.deepStrictEqual(counts, { pass: 1, diff: 0, skip: 0, none: 2 });
  assert.match(markdown, /kullanıcı durdurdu/);
  assert.match(markdown, /40 sn/);
});

test('the CLI refuses unknown flags, bad values and mixed filters', () => {
  assert.strictEqual(cli('run', '6655', '--bogus').status, 2);
  assert.strictEqual(cli('run', '6655', '--pace', 'warp').status, 2);
  assert.strictEqual(cli('run', '6655', '--screens', 'off').status, 2);
  assert.strictEqual(cli('run', '6655', '--from', '2', '--only', '1').status, 2);
  assert.strictEqual(cli('run', '7001').status, 4);
  assert.strictEqual(cli('frobnicate').status, 2);
});

test('the CLI reports and lists without a browser', () => {
  const r = cli('report', '6655');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(store.walkDir(P, '6655-machine-expiry-2'), 'report.md')));
  const l = cli('list');
  assert.strictEqual(l.status, 0, l.stderr);
  assert.match(l.stdout, /6655-machine-expiry-2/);
});

test('init creates a plan from the template and refuses ids that read as walks', () => {
  const r = cli('init', '8000-new-screen', '--title', 'New screen', '--work-item', '8000');
  assert.strictEqual(r.status, 0, r.stderr);
  const body = fs.readFileSync(store.planFile(P, '8000-new-screen'), 'utf8');
  assert.match(body, /title: "New screen"/);
  assert.match(body, /workItem: "8000"/);
  assert.strictEqual(cli('init', 'login-flow-2').status, 2);
  assert.strictEqual(cli('init', '8000-new-screen').status, 2, 'existing plan needs --force');
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
