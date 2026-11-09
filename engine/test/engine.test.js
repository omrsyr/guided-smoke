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
const errors = require('../errors');
const network = require('../network');
const { texts } = require('../i18n');
const { isLocal, normalizeCheck, expectLabel, redact, poll, isFunctionExpression } = require('../engine');
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

test('the panel mentions the orange outline only when the step drew one', () => {
  const { texts, LANGUAGES } = require('../i18n');
  for (const lang of LANGUAGES) {
    const t = texts(lang);
    assert.strictEqual(expectLabel(t, true), t.expect);
    assert.strictEqual(expectLabel(t, false), t.expectPlain);
    assert.ok(t.expectPlain && t.expectPlain !== t.expect, `${lang}: a plain heading exists and differs`);
  }
});

test('checks may return a boolean, [ok, text] or [ok, okText, failText]', () => {
  assert.deepStrictEqual(normalizeCheck(true), { ok: true, text: '' });
  assert.deepStrictEqual(normalizeCheck([false, 'x']), { ok: false, text: 'x' });
  assert.deepStrictEqual(normalizeCheck([false, 'good', 'bad']), { ok: false, text: 'bad' });
  assert.deepStrictEqual(normalizeCheck({ ok: 1, text: 't' }), { ok: true, text: 't' });
});

test('values typed into the box are masked wherever they appear in a result', () => {
  const secrets = ['user@example.com', 'pa"ss word'];
  const out = redact({ ok: true, echo: 'Hello user@example.com', list: ['pa"ss word', 'x'], nested: { body: JSON.stringify({ p: 'pa"ss word' }) },
    url: '/q?p=' + encodeURIComponent('pa"ss word'), ['user@example.com']: 1, n: 7 }, secrets);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /user@example\.com|pa\\?"ss word|pa%22ss%20word/);
  assert.strictEqual(out.echo, 'Hello •••');
  assert.strictEqual(out.n, 7);
  assert.strictEqual(redact('id 42', ['42']), 'id 42', 'values shorter than 3 characters are not masked');
  assert.strictEqual(redact('abcd', []), 'abcd');
});

test('masking also covers form encoding, base64, Basic credentials, numbers and values that are not plain data', () => {
  const email = 'user@example.com';
  const password = 'pa ss!42';
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  class Holder { constructor() { this.token = password; } }
  const shared = { note: email };
  const looped = { name: 'loop' };
  looped.self = looped;
  const out = redact({
    form: 'p=' + new URLSearchParams({ v: password }).toString().slice(2),
    basic: 'Basic ' + b64(`${email}:${password}`),
    plain64: b64(password),
    error: new Error(`login failed for ${email}`),
    url: new URL('https://app.local/api?user=' + encodeURIComponent(email)),
    map: new Map([['who', email]]),
    holder: new Holder(),
    pin: 4242,
    a: shared, b: shared,
    looped,
  }, [email, password, '4242']);
  const text = JSON.stringify(out);
  for (const leak of [email, password, encodeURIComponent(email), 'pa+ss%2142', b64(password), b64(`${email}:${password}`)]) {
    assert.ok(!text.includes(leak), `${leak} leaked: ${text}`);
  }
  assert.deepStrictEqual(out.error, { name: 'Error', message: 'login failed for •••' });
  assert.strictEqual(out.pin, '•••');
  assert.deepStrictEqual(out.b, { note: '•••' }, 'a shared object is not a loop');
  assert.strictEqual(out.looped.self, '[circular]');
});

test('poll stops when the condition holds or the time is up and returns the last value', async () => {
  let n = 0;
  const waits = [];
  const fake = async ms => { waits.push(ms); };
  assert.strictEqual(await poll(async () => ++n, { until: v => v >= 3, interval: 50 }, fake), 3);
  assert.deepStrictEqual(waits, [50, 50]);
  n = 0;
  assert.strictEqual(await poll(async () => ++n, { until: () => false, timeout: 0 }, fake), 1);
});

test('inPage accepts arrow functions and function expressions, not methods', () => {
  assert.ok(isFunctionExpression(async ({ fields }) => fields));
  assert.ok(isFunctionExpression(function named() {}));
  assert.ok(isFunctionExpression('async x => x'));
  assert.ok(!isFunctionExpression({ async run() {} }.run));
});

test('plan warnings recorded on a step appear in the report', () => {
  const meta = { totalSteps: 1, titles: ['a'], lang: 'en', walkId: 'w-1', planId: 'w', readyAt: '2026-11-03T08:00:00Z',
    endedAt: '2026-11-03T08:00:10Z', measuredSeconds: 10, result: 'completed', browser: 'chrome', browserSource: 'requested', base: 'http://localhost' };
  const { markdown } = report.build(meta, [{ n: 1, title: 'a', answer: 'pass', warnings: ['⚠ 2 places match'] }], null);
  assert.match(markdown, /\| 1 \| a \| ✔ passed \|  \| ⚠ 2 places match \|/);
});

test('a pass over a failed automatic check is flagged in the summary, the note and the paste block', () => {
  const meta = { totalSteps: 2, titles: ['a', 'b'], lang: 'en', walkId: 'v-1', planId: 'v', readyAt: '2026-11-03T08:00:00Z',
    endedAt: '2026-11-03T08:00:10Z', measuredSeconds: 10, result: 'completed', browser: 'chrome', browserSource: 'requested', base: 'http://localhost' };
  const events = [{ n: 1, title: 'a', answer: 'pass', auto: { ok: false, text: 'Refused' }, againstCheck: true }, { n: 2, title: 'b', answer: 'pass' }];
  const { markdown, against, counts } = report.build(meta, events, null);
  assert.deepStrictEqual(against, [1]);
  assert.strictEqual(counts.pass, 2, 'it still counts as passed: the user has the last word');
  assert.match(markdown, /⚠ 1 passed although the automatic check failed: 1\./);
  assert.match(markdown, /\| 1 \| a \| ✔ passed \| ✖ Refused \| ⚠ ✔ given although the automatic check failed \|/);
  assert.match(markdown, /✔ a \(⚠ automatic check failed\)/);
  assert.match(markdown, /\n✔ b\n/);
});

test('the report marks steps passed by --auto and links recordings with a warning', () => {
  const meta = { totalSteps: 2, titles: ['a', 'b'], lang: 'en', walkId: 'r-1', planId: 'r', readyAt: '2026-11-03T08:00:00Z',
    endedAt: '2026-11-03T08:00:10Z', measuredSeconds: 10, result: 'completed', browser: 'chrome', browserSource: 'requested',
    base: 'http://localhost', auto: true, traces: ['trace-1.zip', 'trace-2.zip'], videos: ['video/walk.webm'] };
  const { markdown } = report.build(meta, [{ n: 1, title: 'a', answer: 'pass', answeredBy: 'auto' }, { n: 2, title: 'b', answer: 'pass' }], null);
  assert.match(markdown, /\| 1 \| a \| ✔ passed \(by itself\) \|/);
  assert.match(markdown, /\| 2 \| b \| ✔ passed \|/);
  assert.match(markdown, /1 of the passed steps went on by themselves \(--auto\)\./);
  assert.match(markdown, /\n✔ a \(by itself\)\n✔ b\n/);
  assert.match(markdown, /Recordings:\*\* \[trace-1\.zip\]\(trace-1\.zip\) · \[trace-2\.zip\]\(trace-2\.zip\) · \[video\/walk\.webm\]\(video\/walk\.webm\) \(.*do not attach/);
});

test('browser errors keep only what is safe: no query, id-like parts masked, no message texts, nothing at all while the box is open', () => {
  const base = 'https://localhost:5001';
  assert.strictEqual(errors.safeUrl('https://localhost:5001/api/orders/1001?token=abc#x', base), '/api/orders/1001');
  assert.strictEqual(errors.safeUrl('https://localhost:5001/users/ali%40example.com/reset/eyJhbGciOiJIUzI1NiJ9abc', base), '/users/•••/reset/•••');
  assert.strictEqual(errors.safeUrl('https://localhost:5001/product/6f1c2e9a-0b7d-4c55-9a51-8d2b3c4e5f60/v/12345678', base), '/product/•••/v/•••');
  assert.strictEqual(errors.safeUrl('https://localhost:5001/api/customer-contact-emails/Account/ExternalLoginConfirmation', base), '/api/customer-contact-emails/Account/ExternalLoginConfirmation');
  assert.strictEqual(errors.safeUrl('https://cdn.example.com/lib.js?v=3', base), 'cdn.example.com/lib.js');
  assert.strictEqual(errors.safeUrl('data:image/png;base64,AAAA', base), 'data:…');
  assert.strictEqual(errors.cleanText('Fetch API cannot load https://x.test/a?token=abc. Refused'), 'Fetch API cannot load https://x.test/a?… Refused');

  // Chrome's echo of a failed request and a cancelled request are not errors of their own.
  assert.strictEqual(errors.fromConsole({ type: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)' }, base, false), null);
  assert.strictEqual(errors.fromConsole({ type: 'warning', text: 'a warning' }, base, false), null);
  assert.strictEqual(errors.fromFailed({ method: 'GET', url: `${base}/file`, errorText: 'net::ERR_ABORTED' }, base, false), null);
  assert.strictEqual(errors.fromResponse({ method: 'GET', url: `${base}/`, status: 302 }, base, false), null);

  const t = texts('en');
  const b = new errors.Bucket();
  b.add(errors.fromConsole({ type: 'error', text: 'Saving failed for ali@example.com', location: { url: `${base}/js/app.js?v=2`, lineNumber: 12 } }, base, false));
  b.add(errors.fromPageError({ name: 'TypeError', message: 'x is undefined', stack: `TypeError: x is undefined\n    at f (${base}/js/app.js:40:7)` }, base, false));
  for (let i = 0; i < 2; i++) b.add(errors.fromResponse({ method: 'GET', url: `${base}/api/tips?q=1`, status: 500 }, base, false));
  b.add(errors.fromFailed({ method: 'POST', url: 'https://telemetry.example.com/e', errorText: 'net::ERR_NAME_NOT_RESOLVED' }, base, false));
  b.add(errors.fromConsole({ type: 'error', text: 'login failed for box-secret-42' }, base, true));
  b.add(errors.fromResponse({ method: 'POST', url: `${base}/api/users/box-secret-42`, status: 401 }, base, true));
  const view = b.view(t);
  assert.strictEqual(view.summary, '⚠ In the browser: 1 script error · 2 console errors · 4 failed requests');
  assert.deepStrictEqual(view.lines, ['console.error: Saving failed for ali@example.com (/js/app.js:12)', 'TypeError: x is undefined (/js/app.js:40)', 'GET /api/tips → 500 ×2']);
  assert.strictEqual(view.more, '… and 3 more');
  const kept = b.take();
  assert.deepStrictEqual({ ...kept, first: undefined }, { js: 1, console: 2, http: 3, failed: 1, ignored: 0, first: undefined });
  assert.deepStrictEqual(kept.first, [
    { kind: 'console', at: '/js/app.js:12' },
    { kind: 'js', name: 'TypeError', at: '/js/app.js:40' },
    { kind: 'http', method: 'GET', url: '/api/tips', status: 500, times: 2 },
    { kind: 'failed', method: 'POST', url: 'telemetry.example.com/e', reason: 'net::ERR_NAME_NOT_RESOLVED' },
    { kind: 'console', masked: true },
  ]);
  const text = JSON.stringify(kept);
  for (const leak of ['ali@example.com', 'box-secret-42', 'Saving failed', 'x is undefined', '?q=']) assert.ok(!text.includes(leak), leak);
  assert.strictEqual(b.take(), undefined, 'take() clears the bucket');
});

test('ignoreErrors leaves known noise out of the counts but says how much; bad patterns are refused', () => {
  const base = 'https://localhost:5001';
  const b = new errors.Bucket(errors.compileIgnore(['GET /hub/negotiate → 404', /telemetry/]));
  // Matched against the panel's line with the box closed, so a masked request can still be recognised.
  assert.strictEqual(b.add(errors.fromResponse({ method: 'GET', url: `${base}/hub/negotiate?id=1`, status: 404 }, base, true)), false);
  assert.strictEqual(b.add(errors.fromFailed({ method: 'POST', url: 'https://telemetry.example.com/e', errorText: 'net::ERR_FAILED' }, base, false)), false);
  assert.strictEqual(b.add(errors.fromResponse({ method: 'GET', url: `${base}/hub/other`, status: 404 }, base, false)), true);
  assert.strictEqual(b.view(texts('tr')).ignored, '2 tanesi planda yok sayıldı (ignoreErrors)');
  assert.deepStrictEqual(b.take(), { js: 0, console: 0, http: 1, failed: 0, ignored: 2, first: [{ kind: 'http', method: 'GET', url: '/hub/other', status: 404 }] });
  for (const bad of ['(', '', 7]) assert.throws(() => errors.compileIgnore([bad]), /ignoreErrors\[0\]/);
  assert.throws(() => errors.compileIgnore('GET'), /array/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-ignore-'));
  const file = path.join(dir, 'noisy.steps.js');
  fs.writeFileSync(file, "module.exports = { ignoreErrors: ['('], steps: [{ title: 'a', run: async () => {} }] };");
  try {
    const r = cli('run', file);
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /ignoreErrors\[0\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the report shows browser errors in the summary, the note column, a section of their own and the paste block', () => {
  const meta = { totalSteps: 3, titles: ['a', 'b', 'c'], lang: 'en', walkId: 'e-1', planId: 'e', readyAt: '2026-11-03T08:00:00Z',
    endedAt: '2026-11-03T08:00:10Z', measuredSeconds: 10, result: 'completed', browser: 'chrome', browserSource: 'requested', base: 'http://localhost' };
  const events = [
    { n: 1, title: 'a', answer: 'pass', browserErrors: { js: 1, console: 0, http: 7, failed: 0, ignored: 1, first: [
      { kind: 'js', name: 'Error', at: '/app.js:3' }, { kind: 'http', method: 'GET', url: '/api/tips', status: 500, times: 2 },
      { kind: 'http', method: 'POST', url: '•••', status: 401, masked: true }] } },
    { n: 2, title: 'b', answer: 'pass', browserErrors: { js: 0, console: 0, http: 0, failed: 0, ignored: 2, first: [] } },
    { n: 3, title: 'c', answer: 'diff', note: 'wrong' },
  ];
  const { markdown, errorSteps } = report.build(meta, events, null);
  assert.deepStrictEqual(errorSteps, [1], 'a step with only ignored errors has none');
  assert.match(markdown, /⚠ Steps where the browser reported errors: 1\./);
  assert.match(markdown, /\| 1 \| a \| ✔ passed \|  \| ⚠ In the browser: 1 script error · 7 failed requests \|/);
  assert.match(markdown, /\| 2 \| b \| ✔ passed \|  \|  \|/);
  assert.match(markdown, /## Browser errors\n\n.*no query.*\n\n- 1\. a: `Error \(\/app\.js:3\)` · `GET \/api\/tips → 500 ×2` · `POST ••• → 401` · `\+4 more`\n\n3 more matched the plan's ignoreErrors/);
  assert.match(markdown, /\n✔ a \(⚠ 8 browser errors\)\n✔ b\n✖ c — wrong\n/);
  const old = report.build(meta, events.map(({ browserErrors, ...e }) => e), null).markdown;
  assert.doesNotMatch(old, /Browser errors|In the browser|browser error/, 'a walk recorded before 1.2 reads as before');
});

// A request as Playwright hands it to the engine, for the network tests: an answer with headers and a body, or a failure.
function fakeRequest({ method = 'GET', url, type = 'fetch', status = 200, ms = 40, headers = {}, cookies = [], body = '', bytes, failure }) {
  const h = { 'content-type': 'application/json; charset=utf-8', ...headers };
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const response = failure ? null : {
    status: () => status,
    headers: () => h,
    headersArray: async () => [...Object.entries(h).map(([name, value]) => ({ name, value })), ...cookies.map(value => ({ name: 'Set-Cookie', value }))],
    body: async () => raw,
  };
  return {
    method: () => method, url: () => url, resourceType: () => type,
    timing: () => ({ startTime: Date.now() - ms, responseEnd: failure ? -1 : ms }),
    existingResponse: () => response,
    sizes: async () => ({ responseBodySize: bytes ?? raw.length }),
    failure: () => (failure ? { errorText: failure } : null),
  };
}

test('network findings keep names, never values: fields, query parameters and error bodies', () => {
  const f = network.sensitiveFields({
    items: [{ name: 'A', passwordHash: 'h-1', hasPassword: true, password: null, pin: '1', iban: 'TR33 0006 1005 1978 6457 8413 26', tckn: 12345678901 }],
    'ali@example.com': { password: 'x1' }, masked: { password: '********', secret: '' }, card: { cardNumber: 4111111111111111 },
    nextPageToken: 'cursor', csrfToken: 'for-the-page', accessToken: 'a', recoveryCodes: ['c1', 'c2'], user_secret: 's',
  });
  assert.deepStrictEqual(f.secret, ['$.items[].passwordHash', '$.•••.password', '$.card.cardNumber', '$.accessToken', '$.recoveryCodes', '$.user_secret']);
  assert.deepStrictEqual(f.personal, ['$.items[].iban', '$.items[].tckn']);
  assert.deepStrictEqual(network.sensitiveFields({ access_token: 'a', refresh_token: 'r', password: 'p' }, true).secret, ['$.password'], 'a token endpoint hands tokens out');

  assert.deepStrictEqual(network.secretParams('https://x.test/a?access_token=1&page=2&apiKey=k&key=AIza&sig=s&code=c&sid=9&token='), ['access_token', 'apiKey']);

  const d = network.errorDetails;
  assert.deepStrictEqual(d('<h1>An unhandled exception occurred while processing the request.</h1>'), { conn: false, stack: true, sql: false });
  assert.ok(d('{"exception":"System.Exception: boom\\r\\n   at Shop.Orders.Save()"}').stack, 'a .NET stack inside JSON');
  assert.ok(d('System.Exception: boom\n   at Shop.Orders.Save(Order o) in C:\\src\\Orders.cs:line 42').stack);
  assert.ok(d('Error: x\n    at handler (/srv/app/routes.js:12:5)').stack, 'Node.js');
  assert.ok(d('at com.shop.Orders.save(Orders.java:42)').stack, 'JVM');
  assert.ok(d('Traceback (most recent call last):\n  File "a.py"').stack, 'Python');
  assert.ok(d("Microsoft.Data.SqlClient.SqlException: Incorrect syntax near 'FROM'.").sql);
  assert.ok(d('ORA-00942: table or view does not exist').sql);
  assert.ok(d('Login failed. Server=db01;Database=Shop;User Id=sa;Password=p;').conn);
  assert.ok(d('cannot reach mongodb://app:pa55@db.internal/shop').conn);
  for (const quiet of ['Validation failed at line 3.', 'Please try again at 10:00.', 'password=1&user=2', 'The Password= field is required;']) {
    assert.deepStrictEqual(d(quiet), { conn: false, stack: false, sql: false }, quiet);
  }

  assert.deepStrictEqual(network.missingHeaders({ 'content-security-policy': "frame-ancestors 'none'" }, true), ['X-Content-Type-Options', 'Strict-Transport-Security']);
  assert.deepStrictEqual(network.revealingHeaders({ server: 'Kestrel', 'x-powered-by': 'ASP.NET' }), ['X-Powered-By'], 'a server without a version is not counted');
  assert.deepStrictEqual(network.cookieFlags(['.AspNetCore.Cookies=v; path=/', 'XSRF-TOKEN=v; secure', 'theme=dark', 'sid=; expires=Thu, 01 Jan 1970 00:00:00 GMT'], true),
    { noHttpOnly: ['.AspNetCore.Cookies'], noSecure: ['.AspNetCore.Cookies'] });

  const en = texts('en');
  const tr = texts('tr');
  assert.deepStrictEqual([network.size(512, en), network.size(245760, en), network.size(1258291, en), network.size(1258291, tr)], ['512 B', '240 KB', '1.2 MB', '1,2 MB']);
  assert.deepStrictEqual([network.time(340, en), network.time(3400, en), network.time(3400, tr)], ['340 ms', '3.4 s', '3,4 sn']);
});

test('a step\'s network record: counts, bytes, the slowest call and findings; nothing looked into while the box is open, the plan\'s ignore, only the application\'s own bodies', async () => {
  const base = 'https://localhost:5001';
  const net = new network.Network({ base, config: network.compileConfig({ slowMs: 500, ignore: ['GET /hub/'] }), local: true });
  // The application's API on another port of the same host is the application's own.
  net.finished(fakeRequest({ url: 'https://localhost:7001/api/users?page=2', body: { items: [{ name: 'A', passwordHash: 'pw-hash-secret', iban: 'TR330006100519786457841326' }] } }), false);
  net.finished(fakeRequest({ url: `${base}/api/report?access_token=tok-secret-1`, ms: 1800, body: { ok: true } }), false);
  for (let i = 1; i <= 3; i++) net.finished(fakeRequest({ url: `${base}/api/customers/${i}` }), false);
  net.finished(fakeRequest({ url: `${base}/api/export`, bytes: 2.5 * 1024 * 1024, body: {} }), false);
  net.finished(fakeRequest({ url: `${base}/api/auth/token`, body: { access_token: 'at-secret', refresh_token: 'rt-secret' } }), false);
  net.finished(fakeRequest({ url: 'https://cdn.example.test/lib.json', body: { password: 'third-party-secret' } }), false);
  net.finished(fakeRequest({ method: 'POST', url: `${base}/api/login?password=box-query-secret`, ms: 900, body: { token: 'box-token-secret' } }), true);
  net.finished(fakeRequest({ url: `${base}/hub/negotiate?id=1` }), false);
  net.finished(fakeRequest({ url: `${base}/api/fail`, status: 500, headers: { 'content-type': 'text/html' }, body: '<pre>System.InvalidOperationException: boom\n   at Shop.Orders.Save(Order o) in C:\\src\\Orders.cs:line 42</pre>' }), false);
  net.finished(fakeRequest({ url: `${base}/api/db`, status: 500, headers: { 'content-type': 'application/problem+json' }, body: { detail: 'Login failed. Server=db01;Database=Shop;User Id=sa;Password=conn-secret;' } }), false);
  net.failed(fakeRequest({ url: `${base}/api/slow`, failure: 'net::ERR_TIMED_OUT', ms: 4000 }), false);
  net.failed(fakeRequest({ url: `${base}/file.pdf`, failure: 'net::ERR_ABORTED' }), false);

  await new Promise(resolve => setTimeout(resolve, 50));
  const view = net.view(texts('en'));
  assert.match(view.summary, /^🌐 Network: 12 requests · 2\.\d MB · slowest GET \/api\/slow 4\.0 s$/);
  assert.strictEqual(view.critical, 3);
  assert.deepStrictEqual(view.lines.map(l => l.level), ['critical', 'critical', 'critical']);
  assert.strictEqual(view.more, '… and 4 more', 'personal data, repeated and two slow calls; not the large one, the box\'s or the expected error page');

  const r = await net.take();
  const find = (kind, url) => r.findings.find(f => f.kind === kind && f.url === url);
  assert.deepStrictEqual({ requests: r.requests, critical: r.critical, warnings: r.warnings, ignored: r.ignored }, { requests: 12, critical: 3, warnings: 6, ignored: 1 });
  assert.deepStrictEqual(find('secret-field', 'localhost:7001/api/users').keys, ['$.items[].passwordHash']);
  assert.deepStrictEqual(find('personal-field', 'localhost:7001/api/users').keys, ['$.items[].iban']);
  assert.deepStrictEqual(find('secret-param', '/api/report').params, ['access_token']);
  assert.strictEqual(find('slow', '/api/report').ms, 1800);
  assert.strictEqual(find('repeated', '/api/customers/•••').times, 3);
  assert.strictEqual(find('large', '/api/export').bytes, 2621440);
  assert.deepStrictEqual(find('error-detail', '/api/fail'), { kind: 'error-detail', level: 'warn', method: 'GET', url: '/api/fail', status: 500, what: ['stack'], env: true });
  assert.ok(find('conn-string', '/api/db'));
  assert.strictEqual(find('slow', '/api/slow').reason, 'net::ERR_TIMED_OUT');
  assert.deepStrictEqual(find('slow', '•••'), { kind: 'slow', level: 'warn', method: 'POST', url: '•••', ms: 900 }, 'the box\'s request: timed, nothing else');
  assert.ok(!r.findings.some(f => /auth\/token|cdn\.example/.test(f.url)), 'a token endpoint and another site\'s body are not findings');
  const text = JSON.stringify(r);
  for (const leak of ['pw-hash-secret', 'TR330006100519786457841326', 'tok-secret-1', 'at-secret', 'rt-secret', 'third-party-secret', 'box-query-secret',
    'box-token-secret', 'api/login', 'conn-secret', 'db01', 'Orders.cs', 'page=2', 'hub/negotiate']) assert.ok(!text.includes(leak), leak);
  assert.strictEqual(await net.take(), undefined, 'take() clears the step');

  // A body still being read when the step is taken belongs to no step.
  net.finished(fakeRequest({ url: `${base}/api/late`, body: { password: 'late-secret' } }), false);
  net.clear();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.strictEqual(await net.take(), undefined);
});

test('a translation file\'s labels are not secret fields; a configuration file the page loads still is', async () => {
  for (const [url, yes] of [['http://localhost:4200/assets/i18n/tr.json', true], ['https://app.test/locales/en-US.json', true], ['https://app.test/static/tr_TR.json', true],
    ['https://app.test/translations/orders.json', true], ['https://app.test/assets/config.json', false], ['https://app.test/api/me.json', false], ['https://app.test/api/users', false]]) {
    assert.strictEqual(network.translationFile(url), yes, url);
  }
  const base = 'http://localhost:4200';
  const net = new network.Network({ base, config: network.compileConfig(), local: true });
  net.finished(fakeRequest({ url: `${base}/assets/i18n/tr.json`, body: { common: { password: 'Parola' }, license: { online: { customerPassword: 'Müşteri parolası' } } } }), false);
  net.finished(fakeRequest({ url: `${base}/assets/config.json`, body: { apiKey: 'shipped-key' } }), false);
  const r = await net.take();
  assert.deepStrictEqual(r.findings.map(f => [f.kind, f.url, f.keys]), [['secret-field', '/assets/config.json', ['$.apiKey']]]);
});

test('network site findings: missing security headers per page, headers that name the server, session cookie flags, uncompressed text', async () => {
  const net = new network.Network({ base: 'https://app.example.test', config: network.compileConfig(), local: false });
  net.finished(fakeRequest({ url: 'https://app.example.test/', type: 'document', body: `<html>${'x'.repeat(12000)}</html>`,
    headers: { 'content-type': 'text/html', server: 'Microsoft-IIS/10.0', 'x-powered-by': 'ASP.NET', 'content-security-policy': "default-src 'self'" },
    cookies: ['.AspNetCore.Cookies=cookie-secret-1; path=/; samesite=lax', 'XSRF-TOKEN=cookie-secret-2; path=/; secure', 'theme=dark', 'sid=; expires=Thu, 01 Jan 1970 00:00:00 GMT'] }), false);
  net.finished(fakeRequest({ url: 'https://app.example.test/login', type: 'document', status: 302, headers: { 'content-type': 'text/html' } }), false);
  net.finished(fakeRequest({ url: 'https://app.example.test/orders', type: 'document', body: '<html></html>',
    headers: { 'content-type': 'text/html', 'content-encoding': 'br', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'strict-transport-security': 'max-age=1', 'content-security-policy': "default-src 'self'" } }), false);
  await net.take();
  const summary = net.summary();
  assert.strictEqual(summary.local, false);
  assert.deepStrictEqual(summary.sites['https://app.example.test'], {
    pages: 2, missing: { 'X-Content-Type-Options': 1, 'X-Frame-Options': 1, 'Strict-Transport-Security': 1 }, revealing: ['Server', 'X-Powered-By'],
    noHttpOnly: ['.AspNetCore.Cookies'], noSecure: ['.AspNetCore.Cookies'], uncompressed: { count: 1, largest: { method: 'GET', url: '/', bytes: 12013 } },
  });
  assert.ok(!JSON.stringify(summary).includes('cookie-secret') && !JSON.stringify(summary).includes('IIS/10'), 'names only');
});

test('a plan\'s network settings are checked before a browser opens', () => {
  assert.deepStrictEqual(network.compileConfig(undefined), { slowMs: 1000, origins: [], ignore: [] });
  assert.deepStrictEqual(network.compileConfig({ slowMs: 2000, origins: ['https://api.example.test/v1'] }).origins, ['https://api.example.test']);
  for (const [bad, message] of [['x', /must be an object/], [[], /must be an object/], [{ slowMs: 5 }, /slowMs/], [{ slowMs: 1.5 }, /slowMs/],
    [{ origins: 'x' }, /origins must be an array/], [{ origins: ['ftp://x'] }, /origins\[0\]/], [{ ignore: ['('] }, /network\.ignore\[0\]/], [{ bogus: 1 }, /unknown setting bogus/]]) {
    assert.throws(() => network.compileConfig(bad), message, JSON.stringify(bad));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-network-'));
  const file = path.join(dir, 'slow.steps.js');
  fs.writeFileSync(file, "module.exports = { network: { slowMs: 'fast' }, steps: [{ title: 'a', run: async () => {} }] };");
  try {
    const r = cli('run', file);
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /network\.slowMs/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(cli('run', '6655', '--network').stderr, /No address/, '--network passes on to the next check');
});

test('the report shows network findings in the summary, the note column, a section with the site, and the paste block', () => {
  const meta = { totalSteps: 3, titles: ['a', 'b', 'c'], lang: 'en', walkId: 'n-1', planId: 'n', readyAt: '2026-11-09T08:00:00Z',
    endedAt: '2026-11-09T08:00:10Z', measuredSeconds: 10, result: 'completed', browser: 'chrome', browserSource: 'requested', base: 'http://localhost',
    network: { local: true, slowMs: 1000, origins: ['http://localhost'], sites: { 'http://localhost': { pages: 3, missing: { 'X-Frame-Options': 3 },
      revealing: ['X-Powered-By'], noHttpOnly: ['sid'], noSecure: [], uncompressed: { count: 2, largest: { method: 'GET', url: '/app.js', bytes: 245760 } } } } } };
  const events = [
    { n: 1, title: 'a', answer: 'pass', network: { requests: 14, bytes: 1258291, slowest: { method: 'GET', url: '/api/customers', ms: 3400 }, critical: 1, warnings: 1, findings: [
      { kind: 'secret-field', level: 'critical', method: 'GET', url: '/api/customers/•••', keys: ['$.items[].passwordHash'] },
      { kind: 'repeated', level: 'warn', method: 'GET', url: '/api/tips', times: 3 },
      { kind: 'error-detail', level: 'warn', method: 'GET', url: '/api/fail', status: 500, what: ['stack', 'sql'], env: true }] } },
    { n: 2, title: 'b', answer: 'pass', network: { requests: 2, bytes: 900, slowest: { method: 'GET', url: '/x', ms: 12 }, critical: 0, warnings: 0, findings: [], ignored: 4 } },
    { n: 3, title: 'c', answer: 'diff', note: 'wrong' },
  ];
  const { markdown, networkSteps } = report.build(meta, events, null);
  assert.deepStrictEqual(networkSteps, [1]);
  assert.match(markdown, /⛔ Critical network findings in steps: 1\.\n\n🌐 Network findings in steps: 1\. See "Network"\./);
  assert.match(markdown, /\| 1 \| a \| ✔ passed \|  \| 🌐 ⛔ 2 network findings \|/);
  assert.match(markdown, /## Network\n\n.*never a value or a body.*\n\n\| # \| Step \| Requests \| Size \| Slowest \| Findings \|/);
  assert.match(markdown, /\| 1 \| a \| 14 \| 1\.2 MB \| GET \/api\/customers 3\.4 s \| ⛔ secret field · ⚠ repeated ×3 \|\n\| 2 \| b \| 2 \| 900 B \| GET \/x 12 ms \|  \|/);
  assert.match(markdown, /- 1\. a: `⛔ GET \/api\/customers\/•••: secret field in the response: \$\.items\[\]\.passwordHash` · `⚠ GET \/api\/tips 3 times in this step` · `⚠ GET \/api\/fail → 500: stack trace, database error in the error response \(expected in this environment\)`/);
  assert.match(markdown, /4 requests matched the plan's network\.ignore/);
  assert.match(markdown, /### Site — http:\/\/localhost \(expected on this machine; check on the test or production server\)\n\n- Missing security headers: X-Frame-Options \(or CSP frame-ancestors\) \(3\/3 pages\)\n- Headers that name the server or its version: X-Powered-By\n- Session cookies without HttpOnly: sid\n- Text responses sent uncompressed: 2 \(largest GET \/app\.js, 240 KB\)/);
  assert.match(markdown, /\n✔ a \(🌐 ⛔ 2 network findings\)\n✔ b\n/);
  const tr = report.build({ ...meta, lang: 'tr' }, events, null).markdown;
  assert.match(tr, /🌐 Ağ bulgusu olan adımlar: 1\./);
  assert.match(tr, /\| 1 \| a \| 14 \| 1,2 MB \| GET \/api\/customers 3,4 sn \| ⛔ hassas alan · ⚠ tekrar ×3 \|/);
  const clean = report.build(meta, events.map(e => ({ ...e, network: e.network && { ...e.network, critical: 0, warnings: 0, findings: [] } })), null).markdown;
  assert.match(clean, /🌐 Network: no findings\./);
  const { network: _, ...before } = meta;
  assert.doesNotMatch(report.build(before, events.map(({ network: n, ...e }) => e), null).markdown, /Network|🌐/, 'a walk without --network reads as before');
});

test('a tracker key such as PROJ-123 resolves like a work item number; a clash with a walk is refused, not guessed', () => {
  plan('proj-123-login');
  walk('proj-123-login-1');
  plan('abc');
  walk('abc-7');
  plan('abc-7-orders');
  assert.deepStrictEqual(store.resolve(P, 'PROJ-123'), { planId: 'proj-123-login', walkId: null });
  assert.deepStrictEqual(store.resolve(P, 'PROJ-123-1'), { planId: 'proj-123-login', walkId: 'proj-123-login-1' });
  assert.throws(() => store.resolve(P, 'ABC-7'), e => e instanceof store.ResolveError && /both walk 7 of plan abc and work item ABC-7/.test(e.message)
    && e.candidates.includes('abc-7') && e.candidates.includes('abc-7-orders'));
  assert.strictEqual(store.resolve(P, 'abc-7-orders').planId, 'abc-7-orders');
  assert.throws(() => store.resolve(P, 'abc-8'), /Walk abc-8 does not exist/, 'a plain plan\'s missing walk stays a missing walk');
  const meta = store.readJson(path.join(store.walkDir(P, 'proj-123-login-1'), 'walk.json'));
  assert.match(report.build({ ...meta, workItem: 'PROJ-123' }, [], null).markdown, /Work item:\*\* PROJ-123\n/, 'no "#" before a key');
});

test('--panel takes left or right and/or min, nothing else', () => {
  for (const bad of ['up', 'left,right', 'min,max', ',']) assert.strictEqual(cli('run', '6655', '--panel', bad).status, 2, bad);
  assert.strictEqual(cli('run', '6655', '--panel').status, 2, 'a value is required');
  assert.strictEqual(cli('demo', '--panel', 'up').status, 2);
  assert.match(cli('run', '6655', '--panel', 'left,min').stderr, /No address/, 'a good value passes on to the next check');
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

test('the comparison follows a step by its title when the plan gained, lost or moved steps', () => {
  const meta = (walkId, titles, lang = 'en') => ({ walkId, planId: 'p', totalSteps: titles.length, titles, lang, readyAt: '2026-11-09T08:00:00Z',
    endedAt: '2026-11-09T08:01:00Z', measuredSeconds: 60, result: 'completed', browser: 'chrome', browserSource: 'requested', base: 'http://localhost' });
  const events = (titles, answers) => titles.map((title, i) => ({ n: i + 1, title, answer: answers[i] }));
  const section = md => md.split(/## Compared with[^\n]*\n\n/)[1].split('\n\n')[0];
  const before = ['Open', 'Save', 'Save', 'Delete', 'Help'];
  const prev = { meta: meta('p-1', before), events: events(before, ['pass', 'diff', 'pass', 'pass', 'pass']) };
  // Two steps added in front and in the middle, "Delete" removed, the second "Save" still the second one.
  const after = ['Sign-in note', 'Open', 'Save', 'Export', 'Save', 'Help'];
  const { markdown } = report.build(meta('p-2', after), events(after, ['pass', 'pass', 'pass', 'pass', 'diff', 'pass']), prev);
  assert.strictEqual(section(markdown), [
    '- 1. Sign-in note: new step → ✔',
    '- 3. Save: ✖ → ✔ (was step 2)',
    '- 4. Export: new step → ✔',
    '- 5. Save: ✔ → ✖ (was step 3)',
    '- Delete: no longer in the plan (was step 4)',
  ].join('\n'));
  // The same plan in the other language shares no title: with as many steps, steps are matched by number.
  const tr = ['Aç', 'Kaydet', 'Kaydet', 'Sil', 'Yardım'];
  const translated = report.build(meta('p-3', tr, 'tr'), events(tr, ['pass', 'pass', 'pass', 'pass', 'pass']), prev).markdown;
  assert.strictEqual(translated.split(/## Önceki koşuyla fark[^\n]*\n\n/)[1].split('\n\n')[0], '- 2. Kaydet: ✖ → ✔');
});

test('each step is compared with the walk in which it was last answered: a walk stopped early or a partial re-run adds no noise', () => {
  const titles = ['Prepare', 'Open', 'Save', 'Undo'];
  const meta = walkId => ({ walkId, planId: 'p', totalSteps: 4, titles, lang: 'en', readyAt: '2026-11-09T08:00:00Z', endedAt: '2026-11-09T08:01:00Z',
    measuredSeconds: 60, result: 'completed', browser: 'chrome', browserSource: 'requested', base: 'http://localhost' });
  const walk = (walkId, answers) => ({ meta: meta(walkId), events: answers.map((answer, i) => answer && ({ n: i + 1, title: titles[i], answer, ...(answer === 'skip' ? { reason: 'filter' } : {}) })).filter(Boolean) });
  const section = md => md.split(/## Compared with /)[1].split('\n\n## ')[0];
  const full = walk('p-6', ['pass', 'pass', 'diff', 'pass']);
  const stopped = walk('p-7', ['stop']);
  const now = walk('p-8', ['pass', 'pass', 'pass', 'pass']);
  // Walk 7 was stopped at its first step: every step is compared with walk 6.
  assert.strictEqual(section(report.build(now.meta, now.events, [stopped, full]).markdown), '(p-6)\n\n- 3. Save: ✖ → ✔');
  // A --retry-failed walk ran only "Save"; "Open" was last answered in walk 6. Two walks compared with: each line says which.
  const retry = walk('p-7', ['skip', 'skip', 'pass', 'skip']);
  const again = walk('p-8', ['pass', 'diff', 'diff', 'pass']);
  assert.strictEqual(section(report.build(again.meta, again.events, [retry, full]).markdown), '(p-7, p-6)\n\n- 2. Open: ✔ → ✖ · p-6\n- 3. Save: ✔ → ✖ · p-7');
  // Nothing changed since the step was last answered.
  assert.strictEqual(section(report.build(full.meta, full.events, [stopped, walk('p-5', ['pass', 'pass', 'diff', 'pass'])]).markdown), '(p-5)\n\nNo change in results.');
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

test('the demo refuses a plan, an address and bad values before a browser opens', () => {
  assert.strictEqual(cli('demo', '6655').status, 2);
  assert.strictEqual(cli('demo', '--base', 'https://example.com').status, 2);
  assert.strictEqual(cli('demo', '--lang', 'de').status, 2);
  assert.strictEqual(cli('demo', '--pace', 'warp').status, 2);
  assert.match(cli('help').stdout, /run\.js demo/);
});

test('the CLI reports and lists without a browser', () => {
  const r = cli('report', '6655');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(store.walkDir(P, '6655-machine-expiry-2'), 'report.md')));
  const l = cli('list');
  assert.strictEqual(l.status, 0, l.stderr);
  assert.match(l.stdout, /6655-machine-expiry-2/);
});

test('run links a plan file instead of copying it and does not replace another plan without --force', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-file-'));
  fs.writeFileSync(path.join(dir, 'texts.js'), "module.exports = { title: 'from a sibling file' };");
  const file = path.join(dir, 'linked.steps.js');
  fs.writeFileSync(file, "const T = require('./texts'); module.exports = { steps: [{ title: T.title, run: async () => {} }] };");
  // No address anywhere: the walk is refused before a browser opens, after the plan is linked.
  const r = cli('run', file);
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /No address/);
  const stored = store.planFile(P, 'linked');
  assert.strictEqual(require(stored).steps[0].title, 'from a sibling file', 'the relative require still resolves');
  assert.ok(fs.readFileSync(stored, 'utf8').includes(JSON.stringify(file)));

  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-file-')), 'linked.steps.js');
  fs.writeFileSync(other, "module.exports = { steps: [{ title: 'other', run: async () => {} }] };");
  const refused = cli('run', other);
  assert.strictEqual(refused.status, 2);
  assert.match(refused.stderr, /already exists.*--force/);
  assert.ok(fs.readFileSync(stored, 'utf8').includes(JSON.stringify(file)), 'the first link is kept');
  assert.match(cli('run', other, '--force').stderr, /No address/);
  assert.ok(fs.readFileSync(stored, 'utf8').includes(JSON.stringify(other)));

  // A copy of the same file, as an earlier version stored it, is the same plan: it becomes a link without --force.
  fs.writeFileSync(stored, fs.readFileSync(file, 'utf8'));
  assert.match(cli('run', file).stderr, /No address/);
  assert.ok(fs.readFileSync(stored, 'utf8').includes(JSON.stringify(file)));
  if (process.platform === 'win32') {
    const otherCase = file[0] === file[0].toUpperCase() ? file[0].toLowerCase() + file.slice(1) : file[0].toUpperCase() + file.slice(1);
    assert.match(cli('run', otherCase).stderr, /No address/, 'a drive letter in another case names the same file');
  }
});

test('demo --project does not replace a plan of that project named "demo"', () => {
  const project = 'with-own-demo';
  fs.mkdirSync(store.planDir(project, 'demo'), { recursive: true });
  const own = "module.exports = { steps: [{ title: 'mine', run: async () => {} }] };";
  fs.writeFileSync(store.planFile(project, 'demo'), own);
  const r = spawnSync(process.execPath, [RUN, 'demo', '--project', project], { env: { ...process.env, GUIDED_SMOKE_HOME: home }, encoding: 'utf8' });
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /already has a plan named "demo"/);
  assert.strictEqual(fs.readFileSync(store.planFile(project, 'demo'), 'utf8'), own);
});

test('the demo server answers a broken request with 400, keeps sign-in targets on its own pages and after a typo', async () => {
  const http = require('http');
  const net = require('net');
  const server = require('../../examples/demo/server');
  const app = await server.start({ lang: 'en' });
  const { port } = new URL(app.url);
  const raw = line => new Promise(resolve => {
    const s = net.connect(Number(port), '127.0.0.1', () => s.write(`${line}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let data = '';
    s.on('data', c => { data += c; });
    s.on('end', () => resolve(data));
    s.on('error', () => resolve(data));
  });
  const post = (p, body) => new Promise((resolve, reject) => {
    const req = http.request(`${app.url}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    assert.match(await raw('GET //[ HTTP/1.1'), /^HTTP\/1\.1 400/);
    assert.match(await raw('GET /login HTTP/1.1'), /^HTTP\/1\.1 200/, 'the server is still up');
    const okBody = `user=${server.SIGN_IN.user}&password=${server.SIGN_IN.password}`;
    assert.strictEqual((await post('/login', `${okBody}&next=${encodeURIComponent('//evil')}`)).location, `/orders/${server.ORDER}`);
    assert.strictEqual((await post('/login', `${okBody}&next=${encodeURIComponent('/jobs')}`)).location, '/jobs');
    const typo = await post('/login', `user=demo&password=wrong&next=${encodeURIComponent('/jobs')}`);
    assert.match(typo.body, /name="next" value="\/jobs"/);
  } finally {
    await app.close();
  }
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

// The repository is also a Claude Code plugin and its own marketplace. A plugin.json version that lags behind keeps
// users on the old copy (claude plugin update sees nothing new), so the three version strings move together.
test('the plugin manifest, the marketplace entry and the version strings agree', () => {
  const root = path.join(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  const skillVersion = /^\s+version: "([^"]+)"$/m.exec(read('SKILL.md'))[1];
  const runVersion = /^const VERSION = '([^']+)';$/m.exec(read('engine/run.js'))[1];
  assert.strictEqual(plugin.version, skillVersion, 'plugin.json and SKILL.md');
  assert.strictEqual(plugin.version, runVersion, 'plugin.json and run.js');
  assert.strictEqual(plugin.name, 'guided-smoke');
  assert.ok(!plugin.skills && fs.existsSync(path.join(root, 'SKILL.md')), 'SKILL.md at the plugin root loads as the one skill');
  assert.deepStrictEqual(market.plugins.map(p => [p.name, p.source]), [['guided-smoke', './']]);
  assert.strictEqual(market.name, 'omrsyr');
  assert.ok(market.owner && market.owner.name, 'marketplace owner');
  assert.ok(!fs.existsSync(path.join(root, 'CLAUDE.md')), 'a CLAUDE.md at the plugin root is never loaded and only draws a warning');
});

// Windows tools keep writing CRLF; .gitattributes normalizes commits, and this catches a working copy before one.
test('the repository\'s text files use LF line endings', () => {
  const root = path.join(__dirname, '..', '..');
  const crlf = [];
  const scan = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (!/\.(png|jpg|webm|zip)$/.test(entry.name) && fs.readFileSync(file).includes('\r')) crlf.push(path.relative(root, file));
    }
  };
  scan(root);
  assert.deepStrictEqual(crlf, []);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
