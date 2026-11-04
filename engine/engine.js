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

// Runs in every page, before the page's own scripts. A modal <dialog> (showModal) makes everything outside it inert,
// the panel and the box included, and a walk could not be answered. While one is open they live inside the topmost
// modal dialog (the last open one in document order); when it closes or goes away they come back to the page. Moving
// a node keeps its handlers and what was typed into it. A dialog styled with a transform shifts them with it.
function installUiHost() {
  if (window.__guidedSmokeUi) return;
  const nodes = {};
  const place = () => {
    const modal = [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal')).pop();
    const host = modal || document.body;
    if (!host) return;
    for (const node of Object.values(nodes)) if (node.parentNode !== host) host.appendChild(node);
  };
  window.__guidedSmokeUi = {
    show(name, node) { nodes[name] = node; place(); },
    hide(name) { delete nodes[name]; },
  };
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; place(); });
  });
  const watch = () => observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
}

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
  (s.warnings || []).forEach(w => body.appendChild(el('div', w, { marginTop: '8px', fontWeight: '600', color: '#b35c00' })));
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
    btn.setAttribute('data-guided-smoke-answer', b.value);
    btn.onclick = () => {
      // ✔ on a failed automatic check takes a second click: a quick click must not pass over a red line unseen.
      if (b.confirm && !btn.hasAttribute('data-guided-smoke-confirm')) {
        btn.setAttribute('data-guided-smoke-confirm', '');
        btn.textContent = b.confirm;
        btn.style.background = '#fd7e14';
        return;
      }
      if (b.needsNote && note.style.display === 'none') {
        note.style.display = 'block';
        note.focus();
        btn.textContent = s.t.send;
        return;
      }
      clear();
      if (window.__guidedSmokeUi) window.__guidedSmokeUi.hide('panel');
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
  if (window.__guidedSmokeUi) window.__guidedSmokeUi.show('panel', box);
  else document.body.appendChild(box);
}

// Runs in the page. Draws the box where the user types values a step needs (an account, a secret); null removes it.
// The values stay in the page: the engine never reads them back, inPage() masks them in whatever it returns.
// While a step waits for the box (s.waiting) it is outlined in orange and shows a button that sends nothing: it only
// tells the engine the box is filled in.
function drawBox(s) {
  const old = document.getElementById('__guided_smoke_box');
  if (old) old.remove();
  if (!s) {
    if (window.__guidedSmokeUi) window.__guidedSmokeUi.hide('box');
    return;
  }
  const el = (tag, text, style) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (style) Object.assign(e.style, style);
    return e;
  };
  const box = el('div', null, {
    position: 'fixed', left: '16px', bottom: '16px', width: '340px', maxHeight: '75vh', overflow: 'auto',
    zIndex: '2147483646', background: '#fff', border: '1px solid #ced4da', borderLeft: '6px solid #0d6efd',
    borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.25)', font: '13px/1.4 "Segoe UI", system-ui, sans-serif',
    color: '#212529', padding: '10px 12px', textAlign: 'left',
  });
  box.id = '__guided_smoke_box';
  box.appendChild(el('div', s.title, { fontWeight: '600', fontSize: '14px', marginBottom: '4px' }));
  const inputs = {};
  const use = el('button', s.useLabel, {
    display: 'none', marginTop: '8px', background: '#198754', color: '#fff', border: '0', borderRadius: '6px',
    padding: '6px 10px', cursor: 'pointer', fontWeight: '600',
  });
  use.setAttribute('data-guided-smoke-use', '');
  s.fields.forEach(f => {
    const label = el('label', f.label, { display: 'block', fontSize: '12px', marginTop: '6px' });
    const input = el('input', null, {
      display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '2px', padding: '4px 6px',
      border: '1px solid #ced4da', borderRadius: '4px', font: 'inherit', color: '#212529', background: '#fff',
    });
    input.type = f.secret ? 'password' : f.type;
    input.autocomplete = f.secret ? 'new-password' : 'off';
    input.spellcheck = false;
    input.setAttribute('data-guided-smoke-field', f.name);
    input.onkeydown = e => { if (e.key === 'Enter' && use.style.display !== 'none') use.click(); };
    inputs[f.name] = input;
    label.appendChild(input);
    box.appendChild(label);
  });
  box.appendChild(use);
  box.appendChild(el('div', s.note, { fontSize: '11px', color: '#6c757d', marginTop: '6px' }));
  const out = el('pre', s.idle, {
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '30vh', overflow: 'auto', background: '#f8f9fa',
    border: '1px solid #e9ecef', borderRadius: '4px', padding: '6px', margin: '6px 0 0', font: '12px/1.4 Consolas, monospace',
  });
  out.setAttribute('data-guided-smoke-result', '');
  box.appendChild(out);
  use.onclick = () => {
    const empty = s.fields.filter(f => !f.optional && !inputs[f.name].value);
    s.fields.forEach(f => { inputs[f.name].style.borderColor = empty.includes(f) ? '#dc3545' : '#ced4da'; });
    if (empty.length) { out.textContent = s.emptyText + empty.map(f => f.label).join(', '); return; }
    window.__guidedSmokeBoxReady();
  };
  if (window.__guidedSmokeUi) window.__guidedSmokeUi.show('box', box);
  else document.body.appendChild(box);
  waiting(!!s.waiting);

  function waiting(on) {
    box.style.borderLeftColor = on ? '#fd7e14' : '#0d6efd';
    box.style.outline = on ? '3px solid #fd7e14' : '';
    use.style.display = on ? '' : 'none';
    const first = on && s.fields.find(f => !inputs[f.name].value);
    if (first) inputs[first.name].focus();
  }
  box.__guidedSmokeWaiting = waiting;
}

// Runs in the page. Switches the drawn box in or out of waiting without redrawing it, so what was typed stays.
function setBoxWaiting(on) {
  const box = document.getElementById('__guided_smoke_box');
  if (box && box.__guidedSmokeWaiting) box.__guidedSmokeWaiting(on);
}

// Runs in the page. Labels of the box's required fields that are still empty; none when there is no box.
function emptyFields(required) {
  const box = document.getElementById('__guided_smoke_box');
  if (!box) return [];
  return required.filter(f => {
    const input = box.querySelector(`[data-guided-smoke-field="${f.name}"]`);
    return !input || !input.value;
  }).map(f => f.label);
}

/**
 * Replaces every occurrence of the given values (as typed, JSON-escaped and URL-encoded) in the strings and keys of a
 * JSON-like value with "•••". Runs in the page before a result leaves it; values shorter than 3 characters are ignored.
 * A safety net for honest plans, not a guarantee: a plan is code and could transform a value before returning it.
 */
function redact(value, secrets) {
  const forms = [];
  for (const s of secrets || []) {
    if (typeof s !== 'string' || s.length < 3) continue;
    forms.push(s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s));
  }
  const list = [...new Set(forms)].sort((a, b) => b.length - a.length);
  const clean = v => {
    if (typeof v === 'string') return list.reduce((acc, x) => acc.split(x).join('•••'), v);
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[clean(k)] = clean(x);
      return o;
    }
    return v;
  };
  return clean(value);
}

// Runs in the page (composed into one expression by inPage): reads the box, calls the plan's function, masks the box's
// values in its result or error, and shows the masked result in the box. Only the masked value leaves the page.
async function boxRun(fn, arg, o, mask) {
  const box = document.getElementById('__guided_smoke_box');
  const fields = {};
  if (box) box.querySelectorAll('[data-guided-smoke-field]').forEach(i => { fields[i.getAttribute('data-guided-smoke-field')] = i.value; });
  const secrets = Object.values(fields);
  const show = text => { const out = box && box.querySelector('[data-guided-smoke-result]'); if (out) out.textContent = text; };
  if (o.boxed && !box) return { error: o.noBox };
  const empty = o.required.filter(f => !fields[f.name]).map(f => f.label);
  if (empty.length) { const error = o.emptyText + empty.join(', '); show(error); return { error }; }
  try {
    const result = mask(await fn({ fields, arg }), secrets);
    if (box && result !== undefined) show(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return { result };
  } catch (e) {
    const error = mask(String((e && e.message) || e), secrets);
    show(error);
    return { error };
  }
}

// Runs in the page. Indexes of the elements a person can actually see: Playwright's own "visible" accepts
// screen-reader-only elements (1×1 px, clipped), which layouts often place before the real heading.
function seenIndices(elements) {
  const seen = [];
  elements.forEach((e, i) => {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return;
    if (/^rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)$/.test(s.clip) || s.clipPath === 'inset(50%)') return;
    seen.push(i);
  });
  return seen;
}

/** Calls fn until until(value) holds or the time is up, waiting `interval` ms between calls; returns the last value. */
async function poll(fn, { until = v => !!v, timeout = 30000, interval = 1000 } = {}, wait = ms => new Promise(r => setTimeout(r, ms))) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (until(value) || Date.now() + interval > deadline) return value;
    await wait(interval);
  }
}

/** inPage takes an arrow function or a function expression; a method's source (`run() {}`) is not an expression. */
function isFunctionExpression(source) {
  return /^(async\s+)?(function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(String(source).trim());
}

/**
 * The same locator without a trailing .first()/.nth(): a plan often narrows to the first match, which is exactly the
 * hidden twin. Relies on playwright-core keeping the selector chain on the locator (pinned version); null otherwise.
 */
function widen(locator) {
  try {
    const selector = locator && locator._selector;
    if (typeof selector !== 'string' || !/ >> nth=-?\d+$/.test(selector) || !locator._frame) return null;
    return locator._frame.locator(selector.replace(/ >> nth=-?\d+$/, ''));
  } catch { return null; }
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

// The heading above `expect`: it mentions the orange outline only when the step drew one. A step that checks the
// database or waits for a job has nothing on screen to outline.
function expectLabel(t, marked) {
  return marked ? t.expect : t.expectPlain;
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
  const counts = { pass: 0, diff: 0, skip: 0, against: 0 };

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
    if (event.againstCheck) counts.against++;
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

  await context.addInitScript(installUiHost);

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

  // The panel and the value box stay out of screenshots.
  const ownUi = visibility => page.evaluate(v => ['__guided_smoke', '__guided_smoke_box'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.visibility = v;
  }), visibility).catch(() => {});
  const takeShot = async (n, suffix = '') => {
    fs.mkdirSync(screensDir, { recursive: true });
    const file = path.join(screensDir, `${String(n).padStart(2, '0')}${suffix}.png`);
    await ownUi('hidden');
    await page.screenshot({ path: file, fullPage: false });
    await ownUi('');
    return path.relative(walkDir, file).split(path.sep).join('/');
  };

  await context.exposeFunction('__guidedSmokeAnswer', (a, note) => {
    if (pending) { const r = pending; pending = null; r({ a, note }); }
  });
  // The value box's button: the user has filled it in. Nothing travels with the call.
  let boxReady = null;
  await context.exposeFunction('__guidedSmokeBoxReady', () => {
    if (boxReady) { const r = boxReady; boxReady = null; r({ a: 'box' }); }
  });
  let lastShot = null;
  await context.exposeFunction('__guidedSmokeShot', async () => {
    if (shotIndex == null) return false;
    try { lastShot = await takeShot(shotIndex); return true; } catch { return false; }
  });

  // A navigation wipes the panel and the value box; draw them again. The box comes back empty: its values are gone.
  let box = null;
  page.on('load', async () => {
    if (box) { try { await page.evaluate(drawBox, box); } catch { /* page still loading */ } }
    if (current) { try { await page.evaluate(drawPanel, current); } catch { /* page still loading */ } }
  });

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

  // Plan doubts found while a step runs (nothing to outline, several matches); shown in its panel and recorded.
  // `marked` says whether the step outlined anything, so the panel only points at an orange outline that exists.
  let markMissing = false;
  let marked = false;
  let warnings = [];
  const warn = text => { if (!warnings.includes(text)) warnings.push(text); };

  // Outlines the first match a person can see: layouts often hold hidden twins (screen-reader headings, templates)
  // earlier in the page. A tall element is brought in by its top edge, clear of a fixed header; a short one is centred.
  // When nothing seen matches within 3 s, the panel says so instead of silently showing no outline; when several do,
  // it says that only the first is outlined.
  const mark = async locator => {
    try {
      const deadline = Date.now() + 3000;
      const wide = widen(locator);
      let target = null;
      while (!target && Date.now() < deadline) {
        for (const candidate of wide ? [locator, wide] : [locator]) {
          const seen = await candidate.evaluateAll(seenIndices).catch(() => []);
          if (seen.length) {
            target = candidate.nth(seen[0]);
            if (seen.length > 1) warn(format(t.manyMark, { count: seen.length }));
            break;
          }
        }
        if (!target) await page.waitForTimeout(200);
      }
      if (!target) throw new Error('nothing to outline');
      await target.evaluate(e => {
        const tall = e.getBoundingClientRect().height > window.innerHeight * 0.7;
        e.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' });
        if (tall) window.scrollBy(0, -96);
        if (!e.hasAttribute('data-guided-smoke-mark')) e.setAttribute('data-guided-smoke-mark', e.style.outline || '');
        e.style.outline = '4px solid #f59f00';
        e.style.outlineOffset = '3px';
      });
      marked = true;
      return true;
    } catch {
      markMissing = true;
      warn(t.markMissing);
      return false;
    }
  };

  // Text of the first match a person can see (the one mark() would outline), else of the first match. Several seen
  // matches with different texts make an automatic check unreliable: the panel says so.
  const squash = s => (s || '').replace(/\s+/g, ' ').trim();
  const text = async locator => {
    await locator.first().waitFor({ state: 'attached', timeout: 5000 });
    const seen = await locator.evaluateAll(seenIndices).catch(() => []);
    if (seen.length > 1) {
      const all = await locator.evaluateAll((els, idx) => idx.map(i => els[i].textContent), seen).catch(() => []);
      const distinct = new Set(all.map(squash));
      if (distinct.size > 1) warn(format(t.manyText, { count: seen.length }));
    }
    return squash(await (seen.length ? locator.nth(seen[0]) : locator.first()).textContent({ timeout: 5000 }));
  };

  const secretBox = async spec => {
    if (spec == null || spec === false) {
      box = null;
      await page.evaluate(drawBox, null).catch(() => {});
      return;
    }
    const fields = Array.isArray(spec.fields) ? spec.fields : [];
    const names = fields.map(f => f && f.name);
    if (!fields.length || fields.some(f => !f || !/^[A-Za-z_][\w-]*$/.test(String(f.name || '')) || !f.label) || new Set(names).size !== names.length) {
      throw new Error('secretBox needs fields: [{ name, label, secret?, optional? }] with unique names.');
    }
    box = {
      title: String(spec.title || t.boxTitle), note: t.boxNote, idle: t.boxIdle, useLabel: t.boxUse, emptyText: t.boxEmpty, waiting: false,
      fields: fields.map(f => ({ name: f.name, label: String(f.label), secret: !!f.secret, type: f.type === 'email' ? 'email' : 'text', optional: !!f.optional })),
    };
    await page.evaluate(drawBox, box);
  };

  // A step that needs the box while it is still empty waits for the user instead of failing: the user may have moved
  // on before typing, or a page load emptied the box. The panel then offers only Stop; the box's button goes on.
  let stopRequested = null;
  const waitForBox = async empty => {
    const panel = {
      header: format(t.step, { n: currentStep.n, total }), accent: COLORS.warn, t, didLabel: t.did, expectLabel: t.todo,
      title: currentStep.title, did: t.boxWaitDid, expect: [format(t.boxWaitTodo, { fields: empty.join(', '), use: t.boxUse })],
      shot: false, buttons: [{ label: t.stop, value: 'stop', color: COLORS.stop }],
    };
    const answered = new Promise(resolve => { pending = resolve; boxReady = resolve; });
    current = panel;
    box.waiting = true;
    await page.evaluate(setBoxWaiting, true).catch(() => {});
    await draw(panel);
    const res = closed ? { a: 'stop', note: 'browser closed' } : await answered;
    pending = null;
    boxReady = null;
    current = null;
    if (box) box.waiting = false;
    await page.evaluate(() => {
      if (window.__guidedSmokeUi) window.__guidedSmokeUi.hide('panel');
      const p = document.getElementById('__guided_smoke');
      if (p) p.remove();
    }).catch(() => {});
    await page.evaluate(setBoxWaiting, false).catch(() => {});
    if (res.a === 'stop') {
      stopRequested = res;
      throw new Error('stopped while waiting for the value box');
    }
  };

  const inPage = async (fn, arg = null) => {
    if (typeof fn !== 'function' || !isFunctionExpression(fn.toString())) {
      throw new Error('inPage needs an arrow function or a function expression: inPage(async ({ fields, arg }) => { … }, arg).');
    }
    if (stopRequested) throw new Error('stopped while waiting for the value box');
    const o = {
      boxed: !!box, noBox: t.boxGone, emptyText: t.boxEmpty,
      required: box ? box.fields.filter(f => !f.optional).map(f => ({ name: f.name, label: f.label })) : [],
    };
    if (box) {
      for (let empty = await page.evaluate(emptyFields, o.required); empty.length; empty = await page.evaluate(emptyFields, o.required)) {
        await waitForBox(empty);
      }
    }
    // One expression, not a function plus argument: the plan's function travels as source and runs inside the page.
    const out = await page.evaluate(`(${boxRun})(${fn}, ${JSON.stringify(arg)}, ${JSON.stringify(o)}, ${redact})`);
    if (out && out.error) throw new Error(out.error);
    return out ? out.result : undefined;
  };

  const ctx = {
    page, context, base, lang: options.lang, state: {}, walkDir,
    url: p => new URL(p, base).toString(),
    goto: async p => { await page.goto(new URL(p, base).toString()); await page.waitForLoadState('load'); },
    mark,
    text,
    secretBox,
    inPage,
    poll: (fn, opts) => poll(fn, opts, async ms => {
      if (closed) throw new Error('browser closed');
      await new Promise(r => setTimeout(r, ms));
    }),
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
  let currentStep = null;
  try {
    // ---- sign-in: always the user's; the script only waits until the browser leaves the sign-in pages ----
    const start = plan.start || '/';
    const loginRe = plan.login ? new RegExp(plan.login, 'i') : DEFAULT_LOGIN;
    const isReady = async () => plan.ready ? (await page.locator(plan.ready).count()) > 0 : !loginRe.test(page.url());
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    await ctx.goto(start);
    while (!closed && !(await isReady().catch(() => false))) {
      if (Date.now() > deadline) throw new Error('Sign-in was not completed within 15 minutes.');
      await draw({ header: format(t.step, { n: 0, total }), accent: COLORS.warn, t, didLabel: t.did, expectLabel: t.todo,
        title: t.loginTitle, did: t.loginDid, expect: t.loginExpect, buttons: [] });
      await page.waitForURL(u => !loginRe.test(u.toString()), { timeout: LOGIN_TIMEOUT_MS }).catch(() => {});
      if (closed) break;
      await page.waitForTimeout(1500).catch(() => {});
      await ctx.goto(start).catch(() => {});
    }
    if (closed) {
      // The window was closed before signing in: a stop, not an error.
      meta.endedAt = new Date().toISOString();
      meta.result = 'stopped';
      meta.error = 'browser closed before sign-in';
      saveMeta();
      if (options.fresh) fs.rmSync(profile, { recursive: true, force: true });
      return { meta, counts, signedOut: false };
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
      marked = false;
      warnings = [];

      if (s.approve) {
        const what = typeof s.approve === 'string' ? s.approve : s.approve.what;
        const reason = options.skipWrites ? 'skip-writes' : (remote && !options.allowRemoteWrites ? 'remote' : null);
        let decision = reason ? 'skip' : null;
        if (!decision) {
          const res = await ask(panelFor(n, s, {
            accent: COLORS.warn, title: `${t.approveTitle}: ${s.title}`, did: t.approveIntro, expect: [what], shot: false,
            expectLabel: t.change,
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

      currentStep = { n, title: s.title };
      stopRequested = null;
      let runError = null;
      try { await s.run(ctx); } catch (e) { runError = e; }
      let auto = null;
      if (runError) auto = { ok: false, text: firstLine(runError) };
      else if (s.check && !stopRequested) {
        try { auto = normalizeCheck(await s.check(ctx), t); } catch (e) { auto = { ok: false, text: firstLine(e) }; }
      }
      // Stop pressed while the step waited for the box: checked here too, in case the plan caught the error itself.
      if (stopRequested) {
        record({ n, title: s.title, kind: s.approve ? 'approve' : 'step', answer: 'stop', note: stopRequested.note || undefined });
        stopped = true;
        break;
      }
      if (options.screens === 'all') { try { lastShot = await takeShot(n); } catch { /* keep going */ } }

      const res = await ask(panelFor(n, s, {
        auto,
        warnings,
        expectLabel: expectLabel(t, marked),
        buttons: [
          { label: t.pass, value: 'pass', color: COLORS.pass, confirm: auto && !auto.ok ? t.passConfirm : undefined },
          { label: t.diff, value: 'diff', color: COLORS.diff, needsNote: true },
          { label: t.stop, value: 'stop', color: COLORS.stop },
        ],
      }));
      if (res.a === 'diff' && options.screens === 'diff' && !lastShot) { try { lastShot = await takeShot(n); } catch { /* keep going */ } }
      record({ n, title: s.title, kind: s.approve ? 'approve' : 'step', answer: res.a, note: res.note || undefined,
        auto: auto || undefined, againstCheck: (res.a === 'pass' && auto && !auto.ok) || undefined, error: runError ? firstLine(runError) : undefined, markMissing: markMissing || undefined,
        warnings: warnings.length ? warnings : undefined, seconds: res.seconds, screenshot: lastShot || undefined });
      if (res.a === 'stop') { stopped = true; break; }
    }
    shotIndex = null;

    meta.endedAt = new Date().toISOString();
    meta.measuredSeconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.readyAt)) / 1000);
    meta.result = stopped ? 'stopped' : 'completed';
    saveMeta();

    // ---- closing screen ----
    const closing = closed ? { a: 'close' } : await ask({
      header: format(t.step, { n: total, total }), accent: COLORS.info, t, didLabel: t.did, expectLabel: t.outcome,
      title: t.doneTitle, did: t.doneDid, shot: false,
      expect: [format(t.doneSummary, counts), ...(counts.against ? [format(t.doneAgainst, counts)] : [])],
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

module.exports = { walk, isLocal, normalizeCheck, expectLabel, drawPanel, drawBox, emptyFields, seenIndices, redact, poll, isFunctionExpression, widen, PACE };
