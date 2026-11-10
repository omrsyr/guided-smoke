'use strict';
// node --test engine/test/demo.test.js — the demo plan walked headless in the installed Chrome or Edge, in both panel
// languages, with a harness in the user's place. Skipped when playwright-core (node run.js setup) or a browser is missing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../store');
const browser = require('../browser');
const report = require('../report');
const { texts } = require('../i18n');
const network = require('../network');
const { autoWalk } = require('./harness');

const DEMO = path.join(__dirname, '..', '..', 'examples', 'demo');
const server = require(path.join(DEMO, 'server'));

const playwright = (() => {
  try { return require(require.resolve('playwright-core', { paths: [store.runtimeDir()] })); } catch { return null; }
})();
const chosen = (() => { try { return browser.choose(process.env.GUIDED_SMOKE_BROWSER); } catch { return null; } })();
const skip = !playwright ? 'playwright-core is not installed (node engine/run.js setup)' : !chosen ? 'no Chrome or Edge' : false;
const noVideo = skip || (!browser.videoReady(store.runtimeDir()) && 'ffmpeg is not installed (node engine/run.js setup --video)');
// CI sets GUIDED_SMOKE_REQUIRE_BROWSER: there a skipped browser test would hide a broken setup.
if (noVideo && process.env.GUIDED_SMOKE_REQUIRE_BROWSER) throw new Error(`Browser tests required but cannot run: ${noVideo}.`);

const signIn = {
  when: '#user',
  fill: async page => {
    await page.fill('#user', server.SIGN_IN.user);
    await page.fill('#password', server.SIGN_IN.password);
    await page.click('button[type=submit]');
  },
};
const readEvents = dir => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
// The panel's title and texts read in one go. Read one after another, the next step's panel can come in between while
// an --auto countdown runs, and its texts end up under this step's title.
const readPanel = page => page.evaluate(() => {
  const p = document.getElementById('__guided_smoke');
  if (!p) return null;
  const part = selector => (p.querySelector(selector) || {}).textContent || '';
  return { title: p.querySelectorAll(':scope > div')[1].textContent, errors: part('[data-guided-smoke-errors]'), all: p.textContent,
    counting: !!p.querySelector('[data-guided-smoke-countdown]') };
}).catch(() => null);

function loadPlan(lang, withNetwork = false) {
  process.env.GUIDED_SMOKE_LANG = lang;
  process.env.GUIDED_SMOKE_DEMO_NETWORK = withNetwork ? '1' : '';
  const file = require.resolve(path.join(DEMO, 'steps.js'));
  delete require.cache[file];
  return require(file);
}

// In Turkish the harness moves on before typing into the box, as in a real walk: the API step must wait for the box.
// In English the walk runs with --network; in Turkish without, as before.
for (const [lang, boxLate, withNetwork] of [['en', false, true], ['tr', true, false]]) {
  test(`the demo plan passes end to end (${lang}${boxLate ? ', box filled only when a step waits for it' : ''}${withNetwork ? ', --network' : ''})`, { skip, timeout: 120000 }, async () => {
    const plan = loadPlan(lang, withNetwork);
    const app = await server.start({ lang });
    const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
    const help = plan.steps[13].title;
    let helpPanel = null;
    try {
      const { meta } = await autoWalk({
        playwright, plan, browser: chosen, base: app.url, lang, walkDir, signIn, boxLate,
        box: { email: server.API_ACCOUNT.email, password: server.API_ACCOUNT.password },
        options: withNetwork ? { network: network.compileConfig() } : {},
        // The help page's slow call ends in that step only if the step waits for it, as a reading user does.
        onPanel: withNetwork ? async (page, { title }) => {
          if (title !== help || helpPanel) return;
          const block = '#__guided_smoke [data-guided-smoke-network]';
          await page.waitForFunction(b => /help\/stats/.test((document.querySelector(b) || {}).textContent || ''), block, { timeout: 8000 });
          helpPanel = await page.locator(block).textContent();
        } : undefined,
      });
      assert.strictEqual(meta.result, 'completed');
      const steps = readEvents(walkDir).filter(e => e.kind === 'step' || (e.kind === 'approve' && e.answer !== 'approved'));
      assert.strictEqual(steps.length, plan.steps.length);
      for (const e of steps) {
        assert.strictEqual(e.answer, 'pass', `${e.n}. ${e.title}`);
        if (e.auto) assert.ok(e.auto.ok, `${e.n}. ${e.title}: ${e.auto.text}`);
        assert.ok(!e.warnings, `${e.n}. ${e.title}: ${JSON.stringify(e.warnings)}`);
      }
      // Only the refused API sign-in (the box is open: no address) and the help page's failing tips call report errors;
      // the download, the sign-in and the favicon do not.
      const browserErrors = Object.fromEntries(steps.filter(e => e.browserErrors).map(e => [e.n, e.browserErrors]));
      assert.deepStrictEqual(Object.keys(browserErrors).map(Number), [12, 14], JSON.stringify(browserErrors));
      assert.deepStrictEqual(browserErrors[12].first, [{ kind: 'http', method: 'POST', url: '•••', status: 401, masked: true }]);
      const tips = browserErrors[14];
      assert.deepStrictEqual([tips.js, tips.console, tips.http, tips.failed], [1, 0, 1, 0], JSON.stringify(tips));
      assert.ok(tips.first.some(r => r.kind === 'http' && r.method === 'GET' && r.url === '/api/tips' && r.status === 500), JSON.stringify(tips));
      assert.ok(tips.first.some(r => r.kind === 'js' && r.name === 'Error' && /^\/app\.js:\d+$/.test(r.at)), JSON.stringify(tips));
      const recorded = fs.readdirSync(walkDir).filter(f => fs.statSync(path.join(walkDir, f)).isFile())
        .map(f => fs.readFileSync(path.join(walkDir, f), 'utf8')).join('\n');
      assert.ok(!recorded.includes(server.API_ACCOUNT.password) && !recorded.includes(server.API_ACCOUNT.email), 'box values stay out of the records');
      assert.ok(!recorded.includes(server.PROFILE_HASH), 'the leaked hash itself stays out of the records');

      if (!withNetwork) {
        assert.ok(!meta.network && steps.every(e => !e.network), 'without --network nothing about the network is recorded');
        return;
      }
      // Only the help page has findings: the profile call's password hash and the settings asked for three times.
      // Its slow statistics call is under the panel's threshold: the slowest call, a finding in the report only.
      assert.deepStrictEqual(steps.filter(e => network.findingTotal(e.network)).map(e => e.n), [14]);
      const r = steps[13].network;
      assert.deepStrictEqual([r.critical, r.warnings], [1, 2], JSON.stringify(r));
      const find = (kind, url) => r.findings.find(x => x.kind === kind && x.url === url);
      assert.deepStrictEqual(find('secret-field', '/api/profile').keys, ['$.passwordHash']);
      assert.strictEqual(find('repeated', '/api/settings').times, 3);
      assert.ok(find('slow', '/api/help/stats').ms >= server.STATS_MS - 100, JSON.stringify(r));
      assert.strictEqual(r.slowest.url, '/api/help/stats');
      const t = texts(lang);
      assert.ok(helpPanel.includes(network.findingLine(find('secret-field', '/api/profile'), t)), helpPanel);
      assert.ok(helpPanel.includes(network.findingLine(find('repeated', '/api/settings'), t)), helpPanel);
      assert.ok(!helpPanel.includes('/api/help/stats took'), 'a call under 3 × slowMs is not a panel line');
      // The box's API calls (steps 11 and 12) are counted and timed, never looked into.
      for (const n of [11, 12]) assert.ok(steps[n - 1].network.findings.every(x => x.url === '•••'), JSON.stringify(steps[n - 1].network));
      const site = meta.network.sites[new URL(app.url).origin];
      assert.ok(meta.network.local);
      assert.deepStrictEqual(Object.keys(site.missing).sort(), ['X-Content-Type-Options', 'X-Frame-Options'], JSON.stringify(site));
      assert.deepStrictEqual([site.noHttpOnly, site.revealing], [[], []]);
      const { markdown } = report.build(meta, readEvents(walkDir), null);
      assert.match(markdown, /🌐 Network findings in steps: 14\./);
      assert.match(markdown, /### Site — http:\/\/127\.0\.0\.1:\d+ \(expected on this machine/);
    } finally {
      await app.close();
      fs.rmSync(walkDir, { recursive: true, force: true });
    }
  });
}

test('--network: a critical finding holds --auto and a warning does not; the value box, the plan\'s ignore and a local error page are respected; no value reaches a record or the panel', { skip, timeout: 90000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const shown = {};
  const secret = { token: 'tok-secret-77', refresh: 'rt-secret-77', iban: 'TR330006100519786457841326', conn: 'conn-secret-77', box: 'box-secret-77', at: 'at-secret-77' };
  // Answers the application might give, faked in the browser: the demo server stays as it is.
  const fake = route => {
    const p = new URL(route.request().url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/fake/user') return json(200, { name: 'A', hasPassword: true, password: null, iban: secret.iban, sessions: [{ refreshToken: secret.refresh }] });
    if (p === '/api/fake/connect/token') return json(200, { access_token: secret.at, token_type: 'Bearer' });
    if (p === '/api/fake/stack') return json(500, { title: 'boom', exception: 'System.InvalidOperationException: boom\r\n   at Shop.Orders.Save() in C:\\src\\Orders.cs:line 42' });
    if (p === '/api/fake/conn') return route.fulfill({ status: 500, contentType: 'text/html', body: `<p>Login failed. Server=db01;Database=Shop;User Id=sa;Password=${secret.conn};</p>` });
    return json(200, {});
  };
  const get = urls => async ({ page }) => { await page.evaluate(list => Promise.all(list.map(u => fetch(u).then(r => r.text()))), urls); };
  const ok = async () => [true, 'ok'];
  const plan = {
    id: 'network', start: '/orders/1001', ready: '#order-card', login: '/login',
    // The fake error answers are browser errors too; left out here so that only the network decides about --auto.
    ignoreErrors: ['GET /api/fake/'],
    network: { ignore: ['/api/fake/noise'] },
    steps: [
      { title: 'Leaks', did: 'x', expect: ['x'], check: ok, run: async ctx => {
        await ctx.page.route('**/api/fake/**', fake);
        await get([`/api/fake/user?access_token=${secret.token}`, '/api/fake/connect/token'])(ctx);
      } },
      { title: 'Repeated', did: 'x', expect: ['x'], check: ok, run: get(['/api/settings', '/api/settings', '/api/settings']) },
      { title: 'Local error page', did: 'x', expect: ['x'], check: ok, run: get(['/api/fake/stack']) },
      { title: 'Connection string', did: 'x', expect: ['x'], check: ok, run: get(['/api/fake/conn']) },
      { title: 'Boxed', did: 'x', expect: ['x'], check: ok, run: async ({ secretBox, inPage }) => {
        await secretBox({ fields: [{ name: 'token', label: 'Token', secret: true }] });
        await inPage(async ({ fields }) => (await fetch(`/api/fake/user?access_token=${fields.token}`)).status);
        await secretBox(null);
      } },
      { title: 'Ignored', did: 'x', expect: ['x'], check: ok, run: get(['/api/fake/noise', '/api/fake/noise', '/api/fake/noise']) },
    ],
  };
  try {
    const { meta } = await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, letAuto: true, box: { token: secret.box },
      options: { auto: true, network: network.compileConfig(plan.network) },
      onPanel: async page => { const p = await readPanel(page); if (p) shown[p.title] = p.all; },
    });
    assert.strictEqual(meta.result, 'completed');
    const events = readEvents(walkDir);
    assert.deepStrictEqual(events.map(e => [e.title, e.answeredBy || 'user']),
      [['Leaks', 'user'], ['Repeated', 'auto'], ['Local error page', 'auto'], ['Connection string', 'user'], ['Boxed', 'auto'], ['Ignored', 'auto']]);
    const [leaks, repeated, local, conn, boxed, ignored] = events.map(e => e.network);
    const find = (r, kind) => r.findings.find(x => x.kind === kind);
    assert.deepStrictEqual(find(leaks, 'secret-param').params, ['access_token']);
    assert.deepStrictEqual(find(leaks, 'secret-field').keys, ['$.sessions[].refreshToken']);
    assert.deepStrictEqual(find(leaks, 'personal-field').keys, ['$.iban']);
    assert.ok(!leaks.findings.some(x => /connect\/token/.test(x.url)), 'a token endpoint hands tokens out');
    assert.match(shown.Leaks, /⛔ GET \/api\/fake\/user: secret in the address: access_token/);
    assert.deepStrictEqual([repeated.critical, repeated.warnings, find(repeated, 'repeated').times], [0, 1, 3]);
    assert.deepStrictEqual([local.critical, local.warnings, find(local, 'error-detail').env], [0, 0, true]);
    assert.doesNotMatch(shown['Local error page'], /stack trace/, 'what a local error page shows on purpose is not a panel line');
    assert.strictEqual(conn.critical, 1);
    assert.ok(boxed.findings.every(x => x.url === '•••') && !find(boxed, 'secret-param') && !find(boxed, 'secret-field'), JSON.stringify(boxed));
    assert.deepStrictEqual([ignored.ignored, ignored.findings], [3, []]);
    const recorded = fs.readdirSync(walkDir).filter(f => fs.statSync(path.join(walkDir, f)).isFile())
      .map(f => fs.readFileSync(path.join(walkDir, f), 'utf8')).join('\n');
    const panels = Object.values(shown).join('\n');
    for (const leak of [...Object.values(secret), 'db01', 'Orders.cs']) assert.ok(!recorded.includes(leak) && !panels.includes(leak), leak);
    assert.match(report.build(meta, events, null).markdown, /`⚠ GET \/api\/fake\/stack → 500: stack trace in the error response \(expected in this environment\)`/);
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('passing over a failed automatic check takes a second click and is flagged', { skip, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const clicks = [];
  const plan = {
    id: 'against', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [{ title: 'A check that fails', did: 'Nothing.', expect: ['Nothing.'], run: async () => {}, check: async () => [false, 'expected'] }],
  };
  try {
    const { meta, counts } = await autoWalk({ playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, clicks });
    const t = texts('en');
    assert.deepStrictEqual(clicks.filter(c => c.value === 'pass').map(c => c.text), [t.pass, t.passConfirm]);
    const events = readEvents(walkDir);
    assert.strictEqual(events[0].answer, 'pass');
    assert.strictEqual(events[0].againstCheck, true);
    assert.strictEqual(counts.against, 1);
    const { markdown, against } = report.build(meta, events, null);
    assert.deepStrictEqual(against, [1]);
    assert.match(markdown, /1 passed although the automatic check failed: 1\./);
    assert.match(markdown, /A check that fails \(⚠ automatic check failed\)/);
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('Stop while a step waits for the value box stops the walk at that step', { skip, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  let after = false;
  const plan = {
    id: 'box-stop', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [
      { title: 'Needs the box', did: 'Asked for the box.', expect: ['Nothing.'], run: async ({ secretBox, inPage }) => {
        await secretBox({ fields: [{ name: 'token', label: 'Token', secret: true }] });
        try { await inPage(async ({ fields }) => fields.token.length); } catch { /* a plan that swallows errors still stops */ }
      } },
      { title: 'Never reached', did: 'x', expect: ['x'], run: async () => { after = true; } },
    ],
  };
  try {
    const { meta } = await autoWalk({ playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, boxLate: true, stopOnWait: true });
    assert.strictEqual(meta.result, 'stopped');
    assert.deepStrictEqual(readEvents(walkDir).map(e => [e.n, e.answer]), [[1, 'stop']]);
    assert.ok(!after, 'the next step does not run');
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('the panel moves into an open modal <dialog> and back to the page when it closes', { skip, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const seen = {};
  const plan = {
    id: 'dialog', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [
      { title: 'Dialog open', did: 'x', expect: ['x'], run: async ({ page, mark }) => {
        await page.locator('#cancel').click();
        await mark(page.locator('#cancel-dialog .modal-content'));
      } },
      { title: 'After', did: 'x', expect: ['x'], run: async () => {} },
    ],
  };
  const parent = page => page.evaluate(() => document.getElementById('__guided_smoke').parentElement.tagName);
  try {
    const { meta } = await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn,
      onPanel: async (page, { title }) => {
        if (title !== 'Dialog open' || seen.inDialog) return;
        seen.inDialog = await parent(page);
        // The user closes the application's dialog while the panel waits: the panel must stay on screen and answerable.
        await page.evaluate(() => document.getElementById('cancel-dialog').close());
        await page.waitForTimeout(100);
        seen.afterClose = await parent(page);
      },
    });
    assert.strictEqual(meta.result, 'completed');
    assert.deepStrictEqual(seen, { inDialog: 'DIALOG', afterClose: 'BODY' });
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

// widen() reads playwright-core's internal selector chain. If an upgrade changes it, this test fails instead of the
// outline silently disappearing.
test('mark(locator.first()) outlines the visible match when the first one is a hidden twin', { skip, timeout: 60000 }, async () => {
  const { widen } = require('../engine');
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const plan = {
    id: 'widen', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [{
      title: 'Hidden twin', did: 'x', expect: ['x'],
      run: async ({ page, mark, state }) => {
        await page.evaluate(() => {
          const twin = document.createElement('h1');
          twin.textContent = 'screen-reader twin';
          twin.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
          document.body.prepend(twin);
        });
        state.widened = !!widen(page.locator('h1').first());
        state.marked = await mark(page.locator('h1').first());
      },
      check: async ({ page, state }) => {
        const outlined = await page.locator('[data-guided-smoke-mark]').allTextContents();
        return [state.widened && state.marked && outlined.length === 1 && outlined[0].trim() === 'Order 1001', JSON.stringify({ ...state, outlined })];
      },
    }],
  };
  try {
    await autoWalk({ playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn });
    const [e] = readEvents(walkDir);
    assert.ok(e.auto.ok, e.auto.text);
    assert.ok(!e.warnings, JSON.stringify(e.warnings));
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('after Stop in the box wait, a plan that catches the error can neither call the application nor use a helper', { skip, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const seen = {};
  const plan = {
    id: 'stop-guard', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [{ title: 'Swallows the stop', did: 'x', expect: ['x'], run: async ({ page, secretBox, inPage, goto }) => {
      await secretBox({ fields: [{ name: 'token', label: 'Token', secret: true }] });
      try { await inPage(async () => 1); } catch { /* an unwise plan carries on */ }
      seen.fetch = await page.evaluate(() => fetch('/api/login', { method: 'POST', body: '{}' }).then(r => r.status, () => 'blocked'));
      try { await goto('/jobs'); seen.goto = 'ran'; } catch { seen.goto = 'refused'; }
    } }],
  };
  try {
    const { meta } = await autoWalk({ playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, boxLate: true, stopOnWait: true });
    assert.strictEqual(meta.result, 'stopped');
    assert.deepStrictEqual(seen, { fetch: 'blocked', goto: 'refused' });
    assert.strictEqual(server.db.calls(), 0, 'no API call reached the application');
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('with nested modal dialogs the panel sits in the one on top, and its clicks never reach the page', { skip, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const seen = {};
  const plan = {
    id: 'nested', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [
      { title: 'Two dialogs', did: 'x', expect: ['x'], run: async ({ page }) => {
        await page.evaluate(() => {
          // In the markup "confirm" comes first, but it is opened second, from inside "edit": it is the one on top.
          for (const id of ['confirm', 'edit']) {
            const d = document.createElement('dialog');
            d.id = id;
            d.textContent = id;
            document.body.appendChild(d);
          }
          window.__pageClicks = 0;
          document.addEventListener('click', () => { window.__pageClicks++; });
          document.getElementById('edit').showModal();
          document.getElementById('confirm').showModal();
        });
      } },
      { title: 'After', did: 'x', expect: ['x'], run: async () => {}, check: async ({ page }) => {
        const clicks = await page.evaluate(() => window.__pageClicks);
        return [clicks === 0, `page saw ${clicks} clicks`];
      } },
    ],
  };
  try {
    const { meta } = await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn,
      onPanel: async (page, { title }) => {
        if (title === 'Two dialogs' && !seen.host) seen.host = await page.evaluate(() => document.getElementById('__guided_smoke').parentElement.id);
      },
    });
    assert.strictEqual(meta.result, 'completed');
    assert.strictEqual(seen.host, 'confirm');
    const events = readEvents(walkDir);
    assert.ok(events[1].auto.ok, events[1].auto.text);
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('a value box gone from the page is drawn again and waited for', { skip, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const plan = {
    id: 'box-gone', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [{ title: 'Box removed', did: 'x', expect: ['x'], run: async ({ page, secretBox, inPage, state }) => {
      await secretBox({ fields: [{ name: 'token', label: 'Token', secret: true }] });
      // What a client-side route change that wipes the page does, without the engine noticing.
      await page.evaluate(() => { window.__guidedSmokeUi.hide('box'); document.getElementById('__guided_smoke_box').remove(); });
      state.length = await inPage(async ({ fields }) => fields.token.length);
    }, check: async ({ state }) => [state.length === 5, `length ${state.length}`] }],
  };
  try {
    await autoWalk({ playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, boxLate: true, box: { token: 'abcde' } });
    const [e] = readEvents(walkDir);
    assert.ok(e.auto.ok, e.auto.text);
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('--auto passes only a step whose check passed, after a countdown the user can hold', { skip, timeout: 90000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  let held = false;
  const ok = async () => [true, 'ok'];
  const plan = {
    id: 'auto', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [
      { title: 'Goes on', did: 'x', expect: ['x'], run: async () => {}, check: ok },
      { title: 'Held', did: 'x', expect: ['x'], run: async () => {}, check: ok },
      { title: 'Failed', did: 'x', expect: ['x'], run: async () => {}, check: async () => [false, 'no'] },
      { title: 'No check', did: 'x', expect: ['x'], run: async () => {} },
    ],
  };
  try {
    const { counts } = await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, letAuto: true, options: { auto: true },
      onPanel: async (page, { title }) => {
        if (title === 'Held' && !held) { held = true; await page.locator('#__guided_smoke [data-guided-smoke-hold]').click(); }
      },
    });
    const by = readEvents(walkDir).map(e => [e.title, e.answer, e.answeredBy || 'user']);
    assert.deepStrictEqual(by, [['Goes on', 'pass', 'auto'], ['Held', 'pass', 'user'], ['Failed', 'pass', 'user'], ['No check', 'pass', 'user']]);
    assert.strictEqual(counts.auto, 1);
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('browser errors reach the panel as they arrive and hold --auto; the sign-in, ignoreErrors and the value box keep them out', { skip, timeout: 90000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const shown = {};
  const ok = async () => [true, 'ok'];
  const plan = {
    id: 'errors', start: '/orders/1001', ready: '#order-card', login: '/login',
    ignoreErrors: ['GET /known-noise → 404'],
    steps: [
      { title: 'Clean', did: 'x', expect: ['x'], run: async () => {}, check: ok },
      // Its call fails only once the panel is up and its countdown runs: the harness makes it then (see onPanel). A
      // timer in the page raced the countdown on a slow machine and could land in the next step.
      { title: 'Late', did: 'x', expect: ['x'], run: async () => {}, check: ok },
      { title: 'Ignored', did: 'x', expect: ['x'], run: async ({ page }) => { await page.evaluate(() => fetch('/known-noise?user=a@b.test')); }, check: ok },
      { title: 'Boxed', did: 'x', expect: ['x'], run: async ({ page, secretBox }) => {
        await secretBox({ fields: [{ name: 'token', label: 'Token' }] });
        await page.evaluate(() => { console.error('typed box-secret-42'); return fetch('/api/missing/box-secret-42'); });
        await secretBox(null);
      }, check: ok },
    ],
  };
  // Noise on the sign-in page is the user's own page, not the walk's.
  const noisySignIn = { when: '#user', fill: async page => { await page.evaluate(() => console.error('noise on the sign-in page')); await signIn.fill(page); } };
  let lateCall = null;
  try {
    const { counts } = await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn: noisySignIn, letAuto: true, options: { auto: true },
      onPanel: async page => {
        const p = await readPanel(page);
        if (!p) return;
        shown[p.title] = p.errors;
        if (p.title === 'Late' && p.counting && !lateCall) lateCall = page.evaluate(() => fetch('/api/tips').then(() => 'made')).catch(() => 'failed');
      },
    });
    assert.strictEqual(await lateCall, 'made', 'the late call was made while the countdown ran');
    const events = readEvents(walkDir);
    assert.deepStrictEqual(events.map(e => [e.title, e.answeredBy || 'user']), [['Clean', 'auto'], ['Late', 'user'], ['Ignored', 'auto'], ['Boxed', 'user']]);
    assert.strictEqual(events[0].browserErrors, undefined, JSON.stringify(events[0].browserErrors));
    assert.deepStrictEqual(events[1].browserErrors.first, [{ kind: 'http', method: 'GET', url: '/api/tips', status: 500 }]);
    assert.match(shown.Late, /In the browser: 1 failed request.*GET \/api\/tips → 500/);
    assert.deepStrictEqual(events[2].browserErrors, { js: 0, console: 0, http: 0, failed: 0, ignored: 1, first: [] });
    assert.match(shown.Ignored, /^1 left out by the plan \(ignoreErrors\)$/);
    assert.deepStrictEqual(events[3].browserErrors.first, [{ kind: 'console', masked: true }, { kind: 'http', method: 'GET', url: '•••', status: 404, masked: true }]);
    assert.strictEqual(counts.errorSteps, 2);
    const recorded = fs.readdirSync(walkDir).filter(f => fs.statSync(path.join(walkDir, f)).isFile())
      .map(f => fs.readFileSync(path.join(walkDir, f), 'utf8')).join('\n');
    for (const leak of ['box-secret-42', 'a@b.test', 'noise on the sign-in page']) {
      assert.ok(!recorded.includes(leak) && !Object.values(shown).join('\n').includes(leak), leak);
    }
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

test('--panel left,min: the panel starts minimized at the left, the box goes right, opening it carries over', { skip, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const seen = {};
  const plan = {
    id: 'panel', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [
      { title: 'First', did: 'x', expect: ['x'], run: async ({ secretBox }) => { await secretBox({ fields: [{ name: 'token', label: 'Token' }] }); } },
      { title: 'Second', did: 'x', expect: ['x'], run: async ({ secretBox }) => { await secretBox(null); } },
    ],
  };
  try {
    await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, options: { panel: { side: 'left', min: true } },
      onPanel: async (page, { title }) => {
        if (seen[title] || !['First', 'Second'].includes(title)) return;
        seen[title] = await page.evaluate(() => {
          const panel = document.getElementById('__guided_smoke');
          const box = document.getElementById('__guided_smoke_box');
          return { left: panel.style.left, minimized: !panel.querySelector('[data-guided-smoke-answer]').offsetParent,
            boxRight: box ? box.style.right : null };
        });
      },
    });
    assert.deepStrictEqual(seen, {
      First: { left: '16px', minimized: true, boxRight: '16px' },
      Second: { left: '16px', minimized: false, boxRight: null },
    });
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});

// Every file in a zip, inflated: enough of the format to look inside a Playwright trace.
function unzip(file) {
  const zlib = require('zlib');
  const buf = fs.readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const files = [];
  let p = buf.readUInt32LE(end + 16);
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const [nameLen, extraLen, commentLen] = [buf.readUInt16LE(p + 28), buf.readUInt16LE(p + 30), buf.readUInt16LE(p + 32)];
    const local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), data: method === 8 ? zlib.inflateRawSync(data) : data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// Chrome keeps downloads in the profile's history; with the earlier walk's download in it, Chrome 153 crashed (or hung
// headless) at the next download.
test('a kept profile downloads again in the next walk', { skip, timeout: 120000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-profile-'));
  const plan = {
    id: 'again', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [{
      title: 'Download', did: 'x', expect: ['x'],
      run: async ({ page, download, state }) => { state.file = await download(page.locator('#invoice')); },
      check: async ({ state }) => [state.file.size > 0, state.file.name],
    }],
  };
  try {
    for (const n of [1, 2]) {
      const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
      try {
        const { meta } = await autoWalk({ playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, profile });
        const [e] = readEvents(walkDir);
        assert.strictEqual(meta.result, 'completed', `walk ${n}: ${e.error || ''}`);
        assert.ok(e.auto.ok, `walk ${n}: ${e.auto.text}`);
      } finally {
        fs.rmSync(walkDir, { recursive: true, force: true });
      }
    }
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('--video links the recording when the browser crashes, and the walk stops cleanly', { skip: noVideo, timeout: 60000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  let crashed = false;
  const plan = {
    id: 'crash', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [
      { title: 'First', did: 'x', expect: ['x'], run: async () => {} },
      { title: 'Crash', did: 'x', expect: ['x'], run: async () => {} },
    ],
  };
  try {
    const { meta } = await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, options: { video: true },
      onPanel: async (page, { title }) => {
        if (title !== 'Crash' || crashed) return;
        crashed = true;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Browser.crash').catch(() => {});
      },
    });
    assert.ok(crashed, 'the browser was crashed');
    assert.strictEqual(meta.result, 'stopped');
    // Playwright keeps a crashed page's recording under its own name, still open until this process ends.
    assert.strictEqual(meta.videos.length, 1);
    assert.deepStrictEqual(fs.readdirSync(path.join(walkDir, 'video')), [path.basename(meta.videos[0])]);
  } finally {
    await app.close();
    try { fs.rmSync(walkDir, { recursive: true, force: true }); } catch { /* the recorder still holds the file */ }
  }
});

test('--video without ffmpeg stops before the browser opens and names setup --video', { skip: !playwright && 'playwright-core is not installed (node engine/run.js setup)' }, () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-ffmpeg-'));
  const walks = store.walksDir('guided-smoke-demo');
  const before = fs.existsSync(walks) ? fs.readdirSync(walks) : [];
  try {
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty };
    assert.strictEqual(require('child_process').spawnSync(process.execPath, ['-e',
      `process.exit(require(${JSON.stringify(require.resolve('../browser'))}).videoReady(${JSON.stringify(store.runtimeDir())}) ? 0 : 1)`],
    { env }).status, 1, 'no ffmpeg in an empty Playwright folder');
    const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'run.js'), 'demo', '--video'], { env, encoding: 'utf8' });
    assert.strictEqual(r.status, 3, r.stderr);
    assert.match(r.stderr, /setup --video/);
    assert.deepStrictEqual(fs.existsSync(walks) ? fs.readdirSync(walks) : [], before, 'no walk folder');
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('--trace leaves the value box out of every part, --video is saved, and the box shows dots while recording', { skip: noVideo, timeout: 90000 }, async () => {
  const app = await server.start({ lang: 'en' });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
  const seen = {};
  const typed = { email: 'box-user@example.test', password: 'box-secret-42' };
  const plan = {
    id: 'record', start: '/orders/1001', ready: '#order-card', login: '/login',
    steps: [
      { title: 'Before', did: 'x', expect: ['x'], run: async ({ page, mark }) => { await mark(page.locator('#order-card h1')); } },
      { title: 'Box', did: 'x', expect: ['x'], run: async ({ secretBox, inPage, state }) => {
        await secretBox({ fields: [{ name: 'email', label: 'E-mail', type: 'email' }, { name: 'password', label: 'Password', secret: true }] });
        state.http = await inPage(async ({ fields }) => (await fetch('/api/login', { method: 'POST', body: JSON.stringify(fields) })).status);
      }, check: async ({ state }) => [state.http === 401, `http ${state.http}`] },
      { title: 'After', did: 'x', expect: ['x'], run: async ({ page, secretBox, mark }) => {
        await secretBox(null);
        await mark(page.locator('#calls'));
      } },
    ],
  };
  try {
    const { meta } = await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang: 'en', walkDir, signIn, options: { trace: true, video: true },
      // Values that appear nowhere on the page (the demo's own account is printed on it): the API refuses them.
      box: typed,
      onPanel: async (page, { title }) => {
        if (title === 'Box' && !seen.dots) {
          seen.dots = await page.evaluate(() => getComputedStyle(document.querySelector('[data-guided-smoke-field="email"]')).webkitTextSecurity);
        }
      },
    });
    assert.strictEqual(meta.result, 'completed');
    assert.ok(readEvents(walkDir)[1].auto.ok, 'the API call went through');
    assert.strictEqual(seen.dots, 'disc');
    assert.deepStrictEqual(meta.traces, ['trace-1.zip', 'trace-2.zip']);
    for (const part of meta.traces) {
      const files = unzip(path.join(walkDir, part));
      assert.ok(files.some(f => f.name.endsWith('.trace')), `${part} is a trace`);
      const text = files.map(f => f.data.toString('latin1')).join('\n');
      for (const value of Object.values(typed)) assert.ok(!text.includes(value), `${part} holds ${value}`);
    }
    assert.deepStrictEqual(meta.videos, ['video/walk.webm']);
    assert.ok(fs.statSync(path.join(walkDir, 'video', 'walk.webm')).size > 1000);
    assert.deepStrictEqual(fs.readdirSync(path.join(walkDir, 'video')), ['walk.webm'], 'no leftover recording');
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
});
