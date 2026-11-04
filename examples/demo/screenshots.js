'use strict';
// Regenerates the README screenshots from the demo: node examples/demo/screenshots.js
// Walks the demo headless in English with the test harness in the user's place and saves the page, panel included, at
// two steps: docs/screenshot.png (an outlined result with its automatic check) and docs/screenshot-box.png (an API call
// through the value box). Both READMEs use the same English images.
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../../engine/store');
const browser = require('../../engine/browser');
const { autoWalk } = require('../../engine/test/harness');
const server = require('./server');

const OUT = path.join(__dirname, '..', '..', 'docs');
const SHOTS = { 2: 'screenshot', 11: 'screenshot-box' };

(async () => {
  const playwright = require(require.resolve('playwright-core', { paths: [store.runtimeDir()] }));
  const chosen = browser.choose(process.env.GUIDED_SMOKE_BROWSER);
  fs.mkdirSync(OUT, { recursive: true });
  const lang = 'en';
  process.env.GUIDED_SMOKE_LANG = lang;
  const plan = require('./steps');
  const app = await server.start({ lang });
  const walkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-shots-'));
  try {
    await autoWalk({
      playwright, plan, browser: chosen, base: app.url, lang, walkDir, viewport: { width: 1280, height: 760 },
      signIn: { when: '#user', fill: async page => {
        await page.fill('#user', server.SIGN_IN.user);
        await page.fill('#password', server.SIGN_IN.password);
        await page.click('button[type=submit]');
      } },
      box: { email: server.API_ACCOUNT.email, password: server.API_ACCOUNT.password },
      onPanel: async (page, { header }) => {
        const n = Number((/(\d+) \/ \d+/.exec(header) || [])[1]);
        if (!SHOTS[n]) return;
        await page.waitForTimeout(300);
        const file = path.join(OUT, `${SHOTS[n]}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      },
    });
  } finally {
    await app.close();
    fs.rmSync(walkDir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
