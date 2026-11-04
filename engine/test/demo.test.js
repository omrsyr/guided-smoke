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
const { autoWalk } = require('./harness');

const DEMO = path.join(__dirname, '..', '..', 'examples', 'demo');
const server = require(path.join(DEMO, 'server'));

const playwright = (() => {
  try { return require(require.resolve('playwright-core', { paths: [store.runtimeDir()] })); } catch { return null; }
})();
const chosen = (() => { try { return browser.choose(process.env.GUIDED_SMOKE_BROWSER); } catch { return null; } })();
const skip = !playwright ? 'playwright-core is not installed (node engine/run.js setup)' : !chosen ? 'no Chrome or Edge' : false;

const signIn = {
  when: '#user',
  fill: async page => {
    await page.fill('#user', server.SIGN_IN.user);
    await page.fill('#password', server.SIGN_IN.password);
    await page.click('button[type=submit]');
  },
};
const readEvents = dir => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

function loadPlan(lang) {
  process.env.GUIDED_SMOKE_LANG = lang;
  const file = require.resolve(path.join(DEMO, 'steps.js'));
  delete require.cache[file];
  return require(file);
}

// In Turkish the harness moves on before typing into the box, as in a real walk: the API step must wait for the box.
for (const [lang, boxLate] of [['en', false], ['tr', true]]) {
  test(`the demo plan passes end to end (${lang}${boxLate ? ', box filled only when a step waits for it' : ''})`, { skip, timeout: 120000 }, async () => {
    const plan = loadPlan(lang);
    const app = await server.start({ lang });
    const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-demo-'));
    try {
      const { meta } = await autoWalk({
        playwright, plan, browser: chosen, base: app.url, lang, walkDir, signIn, boxLate,
        box: { email: server.API_ACCOUNT.email, password: server.API_ACCOUNT.password },
      });
      assert.strictEqual(meta.result, 'completed');
      const steps = readEvents(walkDir).filter(e => e.kind === 'step' || (e.kind === 'approve' && e.answer !== 'approved'));
      assert.strictEqual(steps.length, plan.steps.length);
      for (const e of steps) {
        assert.strictEqual(e.answer, 'pass', `${e.n}. ${e.title}`);
        if (e.auto) assert.ok(e.auto.ok, `${e.n}. ${e.title}: ${e.auto.text}`);
        assert.ok(!e.warnings, `${e.n}. ${e.title}: ${JSON.stringify(e.warnings)}`);
      }
      const recorded = fs.readdirSync(walkDir).filter(f => fs.statSync(path.join(walkDir, f)).isFile())
        .map(f => fs.readFileSync(path.join(walkDir, f), 'utf8')).join('\n');
      assert.ok(!recorded.includes(server.API_ACCOUNT.password) && !recorded.includes(server.API_ACCOUNT.email), 'box values stay out of the records');
    } finally {
      await app.close();
      fs.rmSync(walkDir, { recursive: true, force: true });
    }
  });
}

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
