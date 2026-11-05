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
const STOPPED = 'The walk was stopped.';
const AUTO_SECONDS = 3;

const COLORS = { pass: '#198754', diff: '#dc3545', stop: '#6c757d', yes: '#198754', skip: '#fd7e14', info: '#0d6efd', warn: '#fd7e14' };

// Runs in every page, before the page's own scripts. A modal <dialog> (showModal) makes everything outside it inert,
// the panel and the box included, and a walk could not be answered. While one is open they live inside the modal
// dialog on top (the one opened last); when it closes or goes away they come back to the page. Moving a node keeps its
// handlers and what was typed into it. Inside a dialog styled with a transform they move and clip with it.
// Their events stop at their own edge, so the page's handlers (close on an outside click, focus traps) never see them.
function installUiHost() {
  if (window.__guidedSmokeUi) return;
  const nodes = {};
  const opened = [];
  const isModal = d => d.isConnected && d.open && d.matches(':modal');
  const topModal = () => {
    for (let i = opened.length - 1; i >= 0; i--) {
      if (isModal(opened[i])) return opened[i];
      opened.splice(i, 1);
    }
    // Opened before the watch began: document order is the best guess left.
    return [...document.querySelectorAll('dialog[open]')].filter(isModal).pop();
  };
  const place = () => {
    const host = topModal() || document.body;
    if (!host) return;
    for (const node of Object.values(nodes)) if (node.parentNode !== host) host.appendChild(node);
  };
  const OWN = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress',
    'input', 'focusin', 'focusout'];
  window.__guidedSmokeUi = {
    show(name, node) {
      OWN.forEach(type => node.addEventListener(type, e => e.stopPropagation()));
      nodes[name] = node;
      place();
    },
    hide(name) { delete nodes[name]; },
  };
  let queued = false;
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type !== 'attributes' || r.target.tagName !== 'DIALOG') continue;
      const i = opened.indexOf(r.target);
      if (i >= 0) opened.splice(i, 1);
      if (r.target.open) opened.push(r.target);
    }
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; place(); });
  });
  const watch = () => observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
}

// Runs in the page. Draws the panel; every text goes in through textContent, never as HTML.
// s.side puts it at the bottom left or right; s.min starts it minimized; s.countdown (--auto) answers ✔ by itself when
// the time is up, unless the user presses any button first.
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
    position: 'fixed', ...(s.side === 'left' ? { left: '16px' } : { right: '16px' }), bottom: '16px', width: '460px', maxHeight: '75vh', overflow: 'auto',
    zIndex: '2147483647', background: '#fff', border: '1px solid #ced4da', borderLeft: `6px solid ${s.accent}`,
    borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.25)', font: '14px/1.5 "Segoe UI", system-ui, sans-serif',
    color: '#212529', padding: '12px 14px', textAlign: 'left',
  });
  box.id = '__guided_smoke';
  const head = el('div', null, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#6c757d' });
  head.appendChild(el('span', s.header));
  const min = el('button', s.t.minimize, { border: '1px solid #ced4da', background: '#f8f9fa', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', color: '#212529' });
  min.setAttribute('data-guided-smoke-min', '');
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
  let timer = null;
  let line = null;
  let hold = null;
  const stopCountdown = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (line) line.remove();
    if (hold) hold.remove();
  };
  if (s.countdown) {
    line = el('div', null, { marginTop: '8px', color: '#0d6efd', fontWeight: '600' });
    line.setAttribute('data-guided-smoke-countdown', '');
    body.appendChild(line);
  }
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
      stopCountdown();
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
  if (s.countdown) {
    hold = el('button', s.countdown.hold, { background: '#fff', color: '#0d6efd', border: '1px solid #0d6efd', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer' });
    hold.setAttribute('data-guided-smoke-hold', '');
    hold.onclick = stopCountdown;
    bar.appendChild(hold);
    let left = s.countdown.seconds;
    const tick = () => {
      if (left <= 0) {
        stopCountdown();
        clear();
        if (window.__guidedSmokeUi) window.__guidedSmokeUi.hide('panel');
        box.remove();
        window.__guidedSmokeAnswer('pass', '', 'auto');
        return;
      }
      line.textContent = s.countdown.text.replace('{s}', String(left));
      left--;
    };
    tick();
    timer = setInterval(tick, 1000);
  }
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
  const minimize = on => {
    body.style.display = on ? 'none' : '';
    min.textContent = on ? s.t.open : s.t.minimize;
  };
  minimize(!!s.min);
  // The choice carries over to the next panels of the walk.
  min.onclick = () => {
    const on = body.style.display !== 'none';
    minimize(on);
    if (window.__guidedSmokeMin) window.__guidedSmokeMin(on);
  };
  if (window.__guidedSmokeUi) window.__guidedSmokeUi.show('panel', box);
  else document.body.appendChild(box);
}

// Runs in the page. Draws the box where the user types values a step needs (an account, a secret); null removes it.
// The values stay in the page: the engine never reads them back, inPage() masks them in whatever it returns.
// While a step waits for the box (s.waiting) it is outlined in orange and shows a button that sends nothing: it only
// tells the engine the box is filled in. s.side is the corner opposite the panel; s.masked (a video or trace is being
// recorded) shows every field as dots, not only the secret ones.
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
    position: 'fixed', ...(s.side === 'right' ? { right: '16px' } : { left: '16px' }), bottom: '16px', width: '340px', maxHeight: '75vh', overflow: 'auto',
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
    if (s.masked) input.style.webkitTextSecurity = 'disc';
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
 * Replaces every occurrence of the given values in the strings, keys and numbers of a value with "•••": as typed,
 * JSON-escaped, URL-encoded, form-encoded and base64, and every pair as base64 "a:b" (Basic authentication). Anything
 * that is not plain data (an Error, a URL, a Map, a class instance) is turned into plain data first, so nothing
 * travels with contents that were not looked at. Runs in the page before a result leaves it; values shorter than
 * 3 characters are ignored. A safety net for honest plans, not a guarantee: a plan is code and could transform a value.
 */
function redact(value, secrets) {
  const base64 = s => { try { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); } catch { return null; } };
  const values = (secrets || []).filter(s => typeof s === 'string' && s.length >= 3);
  const forms = [];
  for (const s of values) {
    forms.push(s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s), new URLSearchParams({ v: s }).toString().slice(2), base64(s));
  }
  for (const a of values) for (const b of values) if (a !== b) forms.push(base64(`${a}:${b}`));
  const list = [...new Set(forms.filter(Boolean))].sort((a, b) => b.length - a.length);
  const open = new Set();
  const object = v => {
    if (Array.isArray(v)) return v.map(clean);
    if ([Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[clean(k)] = clean(x);
      return o;
    }
    if (v instanceof Error) return clean({ name: v.name, message: v.message });
    if (v instanceof Map || v instanceof Set) return clean([...v]);
    if (typeof v.toJSON === 'function') return clean(v.toJSON());
    return clean({ ...v });
  };
  const clean = v => {
    if (typeof v === 'string') return list.reduce((acc, x) => acc.split(x).join('•••'), v);
    if (typeof v === 'number' || typeof v === 'bigint') return values.includes(String(v)) ? '•••' : v;
    if (!v || typeof v !== 'object') return v;
    if (open.has(v)) return '[circular]';
    open.add(v);
    try { return object(v); } finally { open.delete(v); }
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

// Chrome keeps downloads in the profile's browsing history. With an earlier walk's download in it (a file Playwright
// has since deleted), Chrome 153 crashes, or hangs headless, at the next walk's download. A smoke profile needs no
// history; the sign-in is kept in Network/Cookies. A file that cannot be removed belongs to a browser still open on
// the profile, and the launch then reports that itself.
function dropHistory(profile) {
  for (const name of ['History', 'History-journal']) {
    try { fs.rmSync(path.join(profile, 'Default', name), { force: true }); } catch { /* profile in use */ }
  }
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
 *                                fresh, screens:'diff'|'all'|null, locale, lang, keepDownloads, auto, trace, video,
 *                                panel: { side:'left'|'right', min } }
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
  const videoDir = path.join(walkDir, 'video');
  const counts = { pass: 0, diff: 0, skip: 0, against: 0, auto: 0 };
  const side = options.panel && options.panel.side === 'left' ? 'left' : 'right';
  let panelMin = !!(options.panel && options.panel.min);

  const meta = {
    walkId, planId, project, title: plan.title || planId, workItem: options.workItem || plan.workItem || null,
    base, remote, browser: options.browser.name, browserSource: options.browser.source, lang: options.lang,
    locale: options.locale || null, pace: options.pace, fresh: !!options.fresh, screens: options.screens || null,
    filter: options.filterNote || null, skipWrites: !!options.skipWrites, allowRemoteWrites: !!options.allowRemoteWrites,
    auto: !!options.auto, trace: !!options.trace, video: !!options.video, traces: [], videos: [],
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
    if (event.answeredBy === 'auto') counts.auto++;
    console.log(`[${event.n}] ${event.answer}${event.reason ? ' (' + event.reason + ')' : ''}${event.note ? ' — ' + event.note : ''}`);
  };

  const profile = options.fresh ? fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-')) : o.profile;
  fs.mkdirSync(profile, { recursive: true });
  // A crashed browser's helper processes can hold the profile a moment longer.
  const removeProfile = () => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const dropFreshProfile = () => {
    if (!options.fresh) return;
    try { removeProfile(); } catch { /* a throw-away folder in the system's temp folder */ }
  };
  disablePasswordSaving(profile);
  dropHistory(profile);

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
    ...(options.video ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } } : {}),
  });

  await context.addInitScript(installUiHost);

  // --video: one recording per page, in the order the pages opened, saved under stable names. saveAs is asked for
  // before the browser closes, because Playwright refuses it afterwards; it resolves once the page has closed and the
  // file is complete.
  const videos = [];
  const keepVideo = p => { const v = p.video(); if (v) videos.push(v); };
  if (options.video) {
    context.pages().forEach(keepVideo);
    context.on('page', keepVideo);
  }
  const closeBrowser = async () => {
    const saving = videos.splice(0).map((v, i) => {
      const n = meta.videos.length + i;
      const name = n ? `walk-${n + 1}.webm` : 'walk.webm';
      return { v, name, saved: v.saveAs(path.join(videoDir, name)).then(() => true, () => false) };
    });
    await context.close().catch(() => {});
    for (const { v, name, saved } of saving) {
      const raw = await v.path().catch(() => null);
      if (await saved) {
        if (raw) try { fs.rmSync(raw, { force: true }); } catch { /* left beside the copy */ }
        meta.videos.push(`video/${name}`);
      } else if (raw && fs.existsSync(raw)) {
        // After a crash Playwright no longer hands the recording over, and its recorder keeps the file open until this
        // process ends; the walk links to that file under its own name.
        meta.videos.push(`video/${path.basename(raw)}`);
      }
    }
    if (options.video) saveMeta();
  };

  // --trace: recorded after the sign-in, in parts. A part ends when the value box appears and the next begins when the
  // plan removes the box, so what the user types there and what is sent with it are in no part. Each part is a tracing
  // session of its own: chunks of one session carry network bodies across the pause. A part still holds cookies and
  // page data.
  let tracing = false;
  const traceResume = async () => {
    if (!options.trace || !meta.readyAt || tracing || box || closed) return;
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false, title: `${walkId} · ${meta.traces.length + 1}` });
      tracing = true;
    } catch { /* the browser is gone */ }
  };
  const tracePause = async () => {
    if (!tracing) return;
    tracing = false;
    const name = `trace-${meta.traces.length + 1}.zip`;
    try {
      await context.tracing.stop({ path: path.join(walkDir, name) });
      meta.traces.push(name);
      saveMeta();
    } catch { /* the browser is gone */ }
  };

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

  await context.exposeFunction('__guidedSmokeAnswer', (a, note, by) => {
    if (pending) { const r = pending; pending = null; r({ a, note, by: by === 'auto' ? 'auto' : undefined }); }
  });
  await context.exposeFunction('__guidedSmokeMin', on => { panelMin = !!on; });
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
  // Every panel takes the walk's corner and the user's last minimize choice (--panel sets both at the start).
  const dressed = panel => ({ ...panel, side, min: panelMin });
  page.on('load', async () => {
    if (box) { try { await page.evaluate(drawBox, box); } catch { /* page still loading */ } }
    if (current) { try { await page.evaluate(drawPanel, dressed(current)); } catch { /* page still loading */ } }
  });

  const draw = async panel => {
    for (let i = 0; i < 5; i++) {
      try { await page.evaluate(drawPanel, dressed(panel)); return; } catch { await page.waitForTimeout(500).catch(() => {}); }
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
      await traceResume();
      return;
    }
    const fields = Array.isArray(spec.fields) ? spec.fields : [];
    const names = fields.map(f => f && f.name);
    if (!fields.length || fields.some(f => !f || !/^[A-Za-z_][\w-]*$/.test(String(f.name || '')) || !f.label) || new Set(names).size !== names.length) {
      throw new Error('secretBox needs fields: [{ name, label, secret?, optional? }] with unique names.');
    }
    await tracePause();
    box = {
      title: String(spec.title || t.boxTitle), note: t.boxNote, idle: t.boxIdle, useLabel: t.boxUse, emptyText: t.boxEmpty, waiting: false,
      side: side === 'left' ? 'right' : 'left', masked: !!(options.video || options.trace),
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
      // Stop means stop, even for a plan that catches the error and goes on: from here the page sends no request and
      // every helper refuses (see the guard after ctx).
      stopRequested = res;
      await context.route('**/*', route => route.abort()).catch(() => {});
      throw new Error(STOPPED);
    }
  };

  const inPage = async (fn, arg = null) => {
    if (typeof fn !== 'function' || !isFunctionExpression(fn.toString())) {
      throw new Error('inPage needs an arrow function or a function expression: inPage(async ({ fields, arg }) => { … }, arg).');
    }
    const o = {
      boxed: !!box, noBox: t.boxGone, emptyText: t.boxEmpty,
      required: box ? box.fields.filter(f => !f.optional).map(f => ({ name: f.name, label: f.label })) : [],
    };
    if (box) {
      // A navigation not yet redrawn after (the load handler runs a moment later) leaves no box: draw it again, empty,
      // and wait for it like any empty box.
      const present = await page.evaluate(() => !!document.getElementById('__guided_smoke_box')).catch(() => true);
      if (!present) await page.evaluate(drawBox, box).catch(() => {});
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
  for (const name of ['goto', 'mark', 'text', 'secretBox', 'inPage', 'poll', 'visible', 'count', 'submit', 'download', 'sleep']) {
    const helper = ctx[name];
    ctx[name] = async (...args) => {
      if (stopRequested) throw new Error(STOPPED);
      return helper(...args);
    };
  }

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
      await closeBrowser();
      dropFreshProfile();
      return { meta, counts, signedOut: false };
    }
    meta.readyAt = new Date().toISOString();
    saveMeta();
    await traceResume();

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

      // --auto: only a step whose automatic check passed without plan warnings goes on by itself, after a countdown.
      const countdown = options.auto && auto && auto.ok && !warnings.length
        ? { seconds: AUTO_SECONDS, text: t.autoIn, hold: t.autoHold } : undefined;
      const res = await ask(panelFor(n, s, {
        auto,
        warnings,
        countdown,
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
        warnings: warnings.length ? warnings : undefined, answeredBy: res.by, seconds: res.seconds, screenshot: lastShot || undefined });
      if (res.a === 'stop') { stopped = true; break; }
    }
    shotIndex = null;
    await tracePause();

    meta.endedAt = new Date().toISOString();
    meta.measuredSeconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.readyAt)) / 1000);
    meta.result = stopped ? 'stopped' : 'completed';
    saveMeta();

    // ---- closing screen ----
    const closing = closed ? { a: 'close' } : await ask({
      header: format(t.step, { n: total, total }), accent: COLORS.info, t, didLabel: t.did, expectLabel: t.outcome,
      title: t.doneTitle, did: t.doneDid, shot: false,
      expect: [format(t.doneSummary, counts), ...(counts.auto ? [format(t.doneAuto, counts)] : []),
        ...(counts.against ? [format(t.doneAgainst, counts)] : [])],
      buttons: [
        { label: t.close, value: 'close', color: COLORS.info },
        ...(options.fresh ? [] : [{ label: t.signOut, value: 'signout', color: COLORS.stop }]),
      ],
    }).catch(() => ({ a: 'close' }));
    await closeBrowser();
    if (closing.a === 'signout') removeProfile();
    else dropFreshProfile();
    return { meta, counts, signedOut: closing.a === 'signout' };
  } catch (e) {
    meta.endedAt = new Date().toISOString();
    if (meta.readyAt) meta.measuredSeconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.readyAt)) / 1000);
    meta.result = 'error';
    meta.error = firstLine(e);
    saveMeta();
    await tracePause();
    await closeBrowser();
    dropFreshProfile();
    throw e;
  }
}

module.exports = { walk, isLocal, normalizeCheck, expectLabel, drawPanel, drawBox, emptyFields, seenIndices, redact, poll, isFunctionExpression, widen, PACE };
