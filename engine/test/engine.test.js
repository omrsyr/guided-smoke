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
