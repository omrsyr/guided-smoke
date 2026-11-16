'use strict';
// Plays the user in a headless walk, for tests and the README screenshots: signs in, types into the value box and
// answers every panel with its first choice (✔ Correct, continue · ✔ Yes · Close), never with Stop. Not part of the
// skill's interface.

const { walk } = require('../engine');

/**
 * @param {object} o
 * @param {object} o.playwright  playwright-core
 * @param {object} o.plan        a loaded plan
 * @param {object} o.browser     from browser.choose()
 * @param {string} o.base, o.lang, o.walkDir
 * @param {object} [o.signIn]    { when: selector on the sign-in page, fill: async page => {} }
 * @param {object} [o.box]       values to type into the value box, by field name
 * @param {boolean} [o.boxLate]  type them only when a step waits for the box, as a user who moved on too early would
 * @param {Function} [o.onWait] async page => {} when a step waits for the box, before it is filled in
 * @param {boolean} [o.stopOnWait] press Stop instead when a step waits for the box
 * @param {object[]} [o.clicks]  receives { value, text } for every panel button clicked
 * @param {Function} [o.onPanel] async (page, { header, title }) => {} before each answer (with letAuto: on every tick
 *                               while a countdown runs)
 * @param {boolean} [o.letAuto]  leave a panel alone while its --auto countdown runs
 * @param {string} [o.stopAt]    press Stop on the panel with this title instead of answering it
 * @param {Array} [o.db]         answers for the engine's database tab, in order: the fields to type ({ server,
 *                               database, user, password }, any of them) then Connect, or 'skip' or 'stop'
 * @param {string[]} [o.dbErrors] receives the tab's error line as it was before each answer
 * @param {string[][]} [o.launched] receives the browser's command-line switches the walk asked for
 * @param {object} [o.options]   more walk options (auto, trace, video, panel)
 * @param {string} [o.profile]   a kept profile folder, as in a real walk (default: a throw-away one)
 * @param {string} [o.walkId], [o.project]  the walk's id and project, when a test keeps several walks (a suite)
 */
async function autoWalk(o) {
  let context = null;
  const playwright = {
    chromium: {
      launchPersistentContext: async (dir, options) => (o.launched && o.launched.push(options.args), context = await o.playwright.chromium.launchPersistentContext(dir, {
        ...options, headless: true, viewport: o.viewport || { width: 1280, height: 800 },
        args: options.args.filter(a => a !== '--start-maximized'),
      })),
    },
  };
  let busy = false;
  const dbAnswers = [...(o.db || [])];
  const timer = setInterval(async () => {
    const page = context && context.pages()[0];
    if (busy || !page) return;
    busy = true;
    try {
      for (const tab of dbAnswers.length ? context.pages() : []) {
        const form = tab.locator('#__guided_smoke_db[data-ready]');
        if (!(await form.count().catch(() => 0))) continue;
        if (o.dbErrors) o.dbErrors.push(await form.locator('[data-guided-smoke-db-error]').textContent());
        const next = dbAnswers.shift();
        if (typeof next === 'object') {
          for (const [name, value] of Object.entries(next)) await form.locator(`[data-guided-smoke-db="${name}"]`).fill(value);
        }
        await form.locator(`[data-guided-smoke-db-answer="${typeof next === 'object' ? 'connect' : next}"]`).click({ timeout: 2000 });
      }
      if (o.signIn && await page.locator(o.signIn.when).count()) await o.signIn.fill(page);
      const use = page.locator('#__guided_smoke_box [data-guided-smoke-use]');
      const waiting = await use.isVisible().catch(() => false);
      if (waiting && o.onWait) await o.onWait(page);
      if (!o.boxLate || waiting) {
        for (const [name, value] of Object.entries(o.box || {})) {
          const field = page.locator(`[data-guided-smoke-field="${name}"]`);
          if (await field.count() && !(await field.inputValue())) await field.fill(value);
        }
      }
      if (waiting && o.stopOnWait) await page.locator('#__guided_smoke [data-guided-smoke-answer="stop"]').click({ timeout: 2000 });
      else if (waiting) await use.click({ timeout: 2000 });
      const answer = page.locator('#__guided_smoke [data-guided-smoke-answer]:not([data-guided-smoke-answer="stop"])').first();
      const stopHere = !waiting && o.stopAt && await answer.count()
        && (await page.locator('#__guided_smoke > div').nth(1).textContent({ timeout: 1000 })) === o.stopAt;
      if (stopHere) {
        await page.locator('#__guided_smoke [data-guided-smoke-answer="stop"]').click({ timeout: 2000 });
      } else if (!waiting && await answer.count()) {
        if (o.onPanel) {
          const panel = page.locator('#__guided_smoke');
          await o.onPanel(page, { header: await panel.locator('span').first().textContent(), title: await panel.locator(':scope > div').nth(1).textContent() });
        }
        const counting = o.letAuto && await page.locator('#__guided_smoke [data-guided-smoke-countdown]').count();
        if (!counting) {
          // A minimized panel is opened first, as a user would.
          if (!(await answer.isVisible())) await page.locator('#__guided_smoke [data-guided-smoke-min]').click({ timeout: 2000 });
          if (o.clicks) o.clicks.push({ value: await answer.getAttribute('data-guided-smoke-answer'), text: await answer.textContent() });
          await answer.click({ timeout: 2000 });
        }
      }
    } catch { /* the page is navigating */ } finally {
      busy = false;
    }
  }, 150);
  try {
    return await walk({
      plan: o.plan, planId: o.plan.id || 'plan', walkId: o.walkId || `${o.plan.id || 'plan'}-1`, project: o.project || 'test', walkDir: o.walkDir,
      playwright, profile: o.profile || null,
      options: { browser: o.browser, base: o.base, pace: 'fast', allowed: null, fresh: !o.profile, lang: o.lang,
        locale: o.lang === 'tr' ? 'tr-TR' : 'en-US', screens: null, ...(o.options || {}) },
    });
  } finally {
    clearInterval(timer);
  }
}

module.exports = { autoWalk };
