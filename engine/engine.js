'use strict';
// Runs one walk of a plan: the script performs each step in a visible browser, a panel on the page explains what was
// done and what the user should see, and nothing moves on until the user answers. Every answer is appended to
// events.jsonl at once, so an interrupted walk keeps what it has.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { texts, format } = require('./i18n');

const PACE = { slow: 400, normal: 200, fast: 60 };
const DEFAULT_LOGIN = /(login|signin|sign-in|giris|auth|account\/)/i;
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

const COLORS = { pass: '#198754', diff: '#dc3545', stop: '#6c757d', yes: '#198754', skip: '#fd7e14', info: '#0d6efd', warn: '#fd7e14' };

// Runs in the page. Draws the panel; every text goes in through textContent, never as HTML.
function drawPanel(s) {
  const old = document.getElementById('__guided_smoke');
  if (old) old.remove();
  const el = (tag, text, style) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (style) Object.assign(e.style, style);
    return e;
  };
  const box = el('div', null, {
    position: 'fixed', right: '16px', bottom: '16px', width: '460px', maxHeight: '75vh', overflow: 'auto',
    zIndex: '2147483647', background: '#fff', border: '1px solid #ced4da', borderLeft: `6px solid ${s.accent}`,
    borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.25)', font: '14px/1.5 "Segoe UI", system-ui, sans-serif',
    color: '#212529', padding: '12px 14px', textAlign: 'left',
  });
  box.id = '__guided_smoke';
  const head = el('div', null, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#6c757d' });
  head.appendChild(el('span', s.header));
  const min = el('button', s.t.minimize, { border: '1px solid #ced4da', background: '#f8f9fa', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', color: '#212529' });
  head.appendChild(min);
  box.appendChild(head);
  box.appendChild(el('div', s.title, { fontWeight: '600', fontSize: '16px', margin: '4px 0 6px' }));
  const body = el('div');
  if (s.did) {
    body.appendChild(el('div', s.didLabel, { fontWeight: '600', marginTop: '4px' }));
    body.appendChild(el('div', s.did));
  }
  if (s.expect && s.expect.length) {
    body.appendChild(el('div', s.expectLabel, { fontWeight: '600', marginTop: '8px' }));
    const ul = el('ul', null, { margin: '4px 0 0 18px', padding: '0' });
    s.expect.forEach(t => ul.appendChild(el('li', t)));
    body.appendChild(ul);
  }
  if (s.auto) {
    body.appendChild(el('div', (s.auto.ok ? s.t.autoOk : s.t.autoFail) + s.auto.text,
      { marginTop: '8px', fontWeight: '600', color: s.auto.ok ? '#198754' : '#dc3545' }));
  }
  if (s.warn) body.appendChild(el('div', s.warn, { marginTop: '8px', fontWeight: '600', color: '#b35c00' }));
  const note = el('textarea', null, { display: 'none', width: '100%', marginTop: '8px', minHeight: '60px', boxSizing: 'border-box' });
  note.placeholder = s.t.notePlaceholder;
  body.appendChild(note);
  const bar = el('div', null, { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' });
  const clear = () => document.querySelectorAll('[data-guided-smoke-mark]').forEach(x => {
    x.style.outline = x.getAttribute('data-guided-smoke-mark');
    x.style.outlineOffset = '';
    x.removeAttribute('data-guided-smoke-mark');
  });
  (s.buttons || []).forEach(b => {
    const btn = el('button', b.label, {
      background: b.color, color: '#fff', border: '0', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: '600',
    });
    btn.onclick = () => {
      if (b.needsNote && note.style.display === 'none') {
        note.style.display = 'block';
        note.focus();
        btn.textContent = s.t.send;
        return;
      }
      clear();
      box.remove();
      window.__guidedSmokeAnswer(b.value, note.value || '');
    };
    bar.appendChild(btn);
  });
  if (s.shot) {
    const shot = el('button', s.t.shot, { background: '#fff', color: '#0d6efd', border: '1px solid #0d6efd', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer' });
    shot.onclick = async () => {
      shot.disabled = true;
      const saved = await window.__guidedSmokeShot();
      shot.textContent = saved ? s.t.shotSaved : s.t.shot;
      shot.disabled = !!saved;
    };
    bar.appendChild(shot);
  }
  body.appendChild(bar);
  box.appendChild(body);
  min.onclick = () => {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    min.textContent = hidden ? s.t.minimize : s.t.open;
  };
  document.body.appendChild(box);
}

// Runs in the page. Index of the first element a person can actually see: Playwright's own "visible" accepts
// screen-reader-only elements (1×1 px, clipped), which layouts often place before the real heading.
function firstSeenIndex(elements) {
  return elements.findIndex(e => {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    if (/^rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)$/.test(s.clip) || s.clipPath === 'inset(50%)') return false;
    return true;
  });
}

function isLocal(base) {
  try {
    const host = new URL(base).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch { return false; }
}

/** Turns "Chrome's password saving off" on for a profile before the browser opens it. */
function disablePasswordSaving(profile) {
  const file = path.join(profile, 'Default', 'Preferences');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new profile */ }
  prefs.credentials_enable_service = false;
  prefs.profile = { ...(prefs.profile || {}), password_manager_enabled: false, password_manager_leak_detection: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs));
}

function normalizeCheck(result, t) {
  if (result === true || result === false) return { ok: result, text: '' };
  if (Array.isArray(result)) {
    const ok = !!result[0];
    const text = result.length >= 3 ? (ok ? result[1] : result[2]) : result[1];
    return { ok, text: String(text ?? '') };
  }
  if (result && typeof result === 'object') return { ok: !!result.ok, text: String(result.text ?? '') };
  return { ok: !!result, text: '' };
}

function firstLine(error) {
  return String((error && error.message) || error).split('\n')[0].slice(0, 300);
}

/**
 * @param {object} o
 * @param {object} o.plan       the loaded steps module
 * @param {string} o.planId
 * @param {string} o.walkId
 * @param {string} o.project
 * @param {string} o.walkDir    created by the caller
 * @param {string} o.profile    browser profile folder (ignored with fresh)
 * @param {object} o.playwright playwright-core
 * @param {object} o.options    { browser, base, pace, allowed:Set|null, filterNote, skipWrites, allowRemoteWrites, workItem,
 *                                fresh, screens:'diff'|'all'|null, locale, lang, keepDownloads }
 */
async function walk(o) {
  const { plan, planId, walkId, project, walkDir, playwright, options } = o;
  const t = texts(options.lang);
  const steps = plan.steps;
  const total = steps.length;
  const base = options.base;
  const remote = !isLocal(base);
  const eventsFile = path.join(walkDir, 'events.jsonl');
  const metaFile = path.join(walkDir, 'walk.json');
  const screensDir = path.join(walkDir, 'screens');
  const downloadsDir = path.join(walkDir, 'downloads');
  const counts = { pass: 0, diff: 0, skip: 0 };

  const meta = {
    walkId, planId, project, title: plan.title || planId, workItem: options.workItem || plan.workItem || null,
    base, remote, browser: options.browser.name, browserSource: options.browser.source, lang: options.lang,
    locale: options.locale || null, pace: options.pace, fresh: !!options.fresh, screens: options.screens || null,
    filter: options.filterNote || null, skipWrites: !!options.skipWrites, allowRemoteWrites: !!options.allowRemoteWrites,
    totalSteps: total, titles: steps.map(s => s.title), startedAt: new Date().toISOString(), readyAt: null, endedAt: null,
    measuredSeconds: null, result: 'running',
  };
  const saveMeta = () => fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  saveMeta();

  const record = event => {
    fs.appendFileSync(eventsFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
    if (event.answer === 'pass' || event.answer === 'diff') counts[event.answer]++;
    if (event.answer === 'skip') counts.skip++;
    console.log(`[${event.n}] ${event.answer}${event.reason ? ' (' + event.reason + ')' : ''}${event.note ? ' — ' + event.note : ''}`);
  };

  const profile = options.fresh ? fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-')) : o.profile;
  fs.mkdirSync(profile, { recursive: true });
  disablePasswordSaving(profile);

  const context = await playwright.chromium.launchPersistentContext(profile, {
    channel: options.browser.channel,
    headless: false,
    slowMo: PACE[options.pace] ?? PACE.slow,
    ignoreHTTPSErrors: true,
    viewport: null,
    // `locale` alone changes the page's language; the browser's own texts (validation balloons, date input format)
    // follow its UI language, which only --lang sets.
    args: ['--start-maximized', ...(options.locale ? [`--lang=${options.locale}`] : [])],
    acceptDownloads: true,
    ...(options.locale ? { locale: options.locale } : {}),
  });

  let pending = null;
  let current = null;
  let shotIndex = null;
  let closed = false;
  const page = context.pages()[0] || await context.newPage();
  // Closing the browser mid-walk counts as Stop; nothing waits for a panel that can no longer be answered.
  const onClosed = () => {
    closed = true;
    if (pending) { const r = pending; pending = null; r({ a: 'stop', note: 'browser closed' }); }
  };
  context.on('close', onClosed);
  page.on('close', onClosed);

  const takeShot = async (n, suffix = '') => {
    fs.mkdirSync(screensDir, { recursive: true });
    const file = path.join(screensDir, `${String(n).padStart(2, '0')}${suffix}.png`);
    await page.evaluate(() => { const p = document.getElementById('__guided_smoke'); if (p) p.style.visibility = 'hidden'; }).catch(() => {});
    await page.screenshot({ path: file, fullPage: false });
    await page.evaluate(() => { const p = document.getElementById('__guided_smoke'); if (p) p.style.visibility = ''; }).catch(() => {});
    return path.relative(walkDir, file).split(path.sep).join('/');
  };

  await context.exposeFunction('__guidedSmokeAnswer', (a, note) => {
    if (pending) { const r = pending; pending = null; r({ a, note }); }
  });
  let lastShot = null;
  await context.exposeFunction('__guidedSmokeShot', async () => {
    if (shotIndex == null) return false;
    try { lastShot = await takeShot(shotIndex); return true; } catch { return false; }
  });

  // A navigation while a panel is open would wipe it; draw it again.
  page.on('load', async () => { if (current) { try { await page.evaluate(drawPanel, current); } catch { /* page still loading */ } } });

  const draw = async panel => {
    for (let i = 0; i < 5; i++) {
      try { await page.evaluate(drawPanel, panel); return; } catch { await page.waitForTimeout(500).catch(() => {}); }
    }
  };

  const panelFor = (n, s, extra = {}) => ({
    header: format(t.step, { n, total }), accent: COLORS.info, t,
    didLabel: t.did, expectLabel: t.expect, title: s.title, did: s.did, expect: s.expect || [], shot: true, ...extra,
  });

  const ask = async panel => {
    if (closed) return { a: 'stop', note: 'browser closed', seconds: 0 };
    current = panel;
    const answered = new Promise(resolve => { pending = resolve; });
    const shownAt = Date.now();
    await draw(panel);
    const res = await answered;
    current = null;
    return { ...res, seconds: Math.round((Date.now() - shownAt) / 1000) };
  };

  // Outlines the first match a person can see: layouts often hold hidden twins (screen-reader headings, templates)
  // earlier in the page. A tall element is brought in by its top edge, clear of a fixed header; a short one is centred.
  // When nothing seen matches within 3 s, the panel says so instead of silently showing no outline.
  let markMissing = false;
  const mark = async locator => {
    try {
      const deadline = Date.now() + 3000;
      let index = -1;
      while (index < 0 && Date.now() < deadline) {
        index = await locator.evaluateAll(firstSeenIndex).catch(() => -1);
        if (index < 0) await page.waitForTimeout(200);
      }
      if (index < 0) throw new Error('nothing to outline');
      const target = locator.nth(index);
      await target.evaluate(e => {
        const tall = e.getBoundingClientRect().height > window.innerHeight * 0.7;
        e.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' });
        if (tall) window.scrollBy(0, -96);
        if (!e.hasAttribute('data-guided-smoke-mark')) e.setAttribute('data-guided-smoke-mark', e.style.outline || '');
        e.style.outline = '4px solid #f59f00';
        e.style.outlineOffset = '3px';
      });
      return true;
    } catch {
      markMissing = true;
      return false;
    }
  };

  const ctx = {
    page, context, base, lang: options.lang, state: {}, walkDir,
    url: p => new URL(p, base).toString(),
    goto: async p => { await page.goto(new URL(p, base).toString()); await page.waitForLoadState('load'); },
    mark,
    text: async locator => ((await locator.first().textContent({ timeout: 5000 })) || '').replace(/\s+/g, ' ').trim(),
    visible: async locator => locator.first().isVisible(),
    count: async locator => locator.count(),
    submit: async locator => {
      await Promise.all([page.waitForEvent('load'), locator.first().click()]);
      await page.waitForLoadState('load');
    },
    download: async locator => {
      const [d] = await Promise.all([page.waitForEvent('download'), locator.first().click()]);
      fs.mkdirSync(downloadsDir, { recursive: true });
      const file = path.join(downloadsDir, d.suggestedFilename());
      await d.saveAs(file);
      const size = fs.statSync(file).size;
      if (!options.keepDownloads) fs.rmSync(file);
      return { name: d.suggestedFilename(), size };
    },
    sleep: ms => page.waitForTimeout(ms),
    log: message => console.log(String(message)),
  };

  let stopped = false;
  try {
    // ---- sign-in: always the user's; the script only waits until the browser leaves the sign-in pages ----
    const start = plan.start || '/';
    const loginRe = plan.login ? new RegExp(plan.login, 'i') : DEFAULT_LOGIN;
    const isReady = async () => plan.ready ? (await page.locator(plan.ready).count()) > 0 : !loginRe.test(page.url());
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    await ctx.goto(start);
    while (!(await isReady())) {
      if (Date.now() > deadline) throw new Error('Sign-in was not completed within 15 minutes.');
      await draw({ header: format(t.step, { n: 0, total }), accent: COLORS.warn, t, didLabel: t.did, expectLabel: t.expect,
        title: t.loginTitle, did: t.loginDid, expect: t.loginExpect, buttons: [] });
      await page.waitForURL(u => !loginRe.test(u.toString()), { timeout: LOGIN_TIMEOUT_MS }).catch(() => {});
      await page.waitForTimeout(1500);
      await ctx.goto(start);
    }
    meta.readyAt = new Date().toISOString();
    saveMeta();

    // ---- steps ----
    let skipUntil = 0;
    for (let i = 0; i < total; i++) {
      const n = i + 1;
      const s = steps[i];
      if (n < skipUntil) { record({ n, title: s.title, answer: 'skip', reason: 'follows-skip' }); continue; }
      if (options.allowed && !options.allowed.has(n)) { record({ n, title: s.title, answer: 'skip', reason: 'filter' }); continue; }
      shotIndex = n;
      lastShot = null;
      markMissing = false;

      if (s.approve) {
        const what = typeof s.approve === 'string' ? s.approve : s.approve.what;
        const reason = options.skipWrites ? 'skip-writes' : (remote && !options.allowRemoteWrites ? 'remote' : null);
        let decision = reason ? 'skip' : null;
        if (!decision) {
          const res = await ask(panelFor(n, s, {
            accent: COLORS.warn, title: `${t.approveTitle}: ${s.title}`, did: t.approveIntro, expect: [what], shot: false,
            buttons: [
              { label: (s.approve && s.approve.yes) || t.approveYes, value: 'approved', color: COLORS.yes },
              { label: t.approveSkip, value: 'skip', color: COLORS.skip },
              { label: t.stop, value: 'stop', color: COLORS.stop },
            ],
          }));
          decision = res.a;
          if (decision === 'stop') { record({ n, title: s.title, kind: 'approve', answer: 'stop', seconds: res.seconds }); stopped = true; break; }
          if (decision === 'approved') record({ n, title: s.title, kind: 'approve', answer: 'approved', what, seconds: res.seconds });
        }
        if (decision !== 'approved') {
          record({ n, title: s.title, kind: 'approve', answer: 'skip', reason: reason || 'declined', what });
          if (s.skipTo) skipUntil = Number(s.skipTo);
          continue;
        }
      }

      let runError = null;
      try { await s.run(ctx); } catch (e) { runError = e; }
      let auto = null;
      if (runError) auto = { ok: false, text: firstLine(runError) };
      else if (s.check) {
        try { auto = normalizeCheck(await s.check(ctx), t); } catch (e) { auto = { ok: false, text: firstLine(e) }; }
      }
      if (options.screens === 'all') { try { lastShot = await takeShot(n); } catch { /* keep going */ } }

      const res = await ask(panelFor(n, s, {
        auto,
        warn: markMissing ? t.markMissing : null,
        buttons: [
          { label: t.pass, value: 'pass', color: COLORS.pass },
          { label: t.diff, value: 'diff', color: COLORS.diff, needsNote: true },
          { label: t.stop, value: 'stop', color: COLORS.stop },
        ],
      }));
      if (res.a === 'diff' && options.screens === 'diff' && !lastShot) { try { lastShot = await takeShot(n); } catch { /* keep going */ } }
      record({ n, title: s.title, kind: s.approve ? 'approve' : 'step', answer: res.a, note: res.note || undefined,
        auto: auto || undefined, error: runError ? firstLine(runError) : undefined, markMissing: markMissing || undefined,
        seconds: res.seconds, screenshot: lastShot || undefined });
      if (res.a === 'stop') { stopped = true; break; }
    }
    shotIndex = null;

    meta.endedAt = new Date().toISOString();
    meta.measuredSeconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.readyAt)) / 1000);
    meta.result = stopped ? 'stopped' : 'completed';
    saveMeta();

    // ---- closing screen ----
    const closing = closed ? { a: 'close' } : await ask({
      header: format(t.step, { n: total, total }), accent: COLORS.info, t, didLabel: t.did, expectLabel: t.expect,
      title: t.doneTitle, did: t.doneDid, expect: [format(t.doneSummary, counts)], shot: false,
      buttons: [
        { label: t.close, value: 'close', color: COLORS.info },
        ...(options.fresh ? [] : [{ label: t.signOut, value: 'signout', color: COLORS.stop }]),
      ],
    }).catch(() => ({ a: 'close' }));
    await context.close().catch(() => {});
    if (options.fresh || closing.a === 'signout') fs.rmSync(profile, { recursive: true, force: true });
    return { meta, counts, signedOut: closing.a === 'signout' };
  } catch (e) {
    meta.endedAt = new Date().toISOString();
    if (meta.readyAt) meta.measuredSeconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.readyAt)) / 1000);
    meta.result = 'error';
    meta.error = firstLine(e);
    saveMeta();
    await context.close().catch(() => {});
    if (options.fresh) fs.rmSync(profile, { recursive: true, force: true });
    throw e;
  }
}

module.exports = { walk, isLocal, normalizeCheck, drawPanel, firstSeenIndex, PACE };
