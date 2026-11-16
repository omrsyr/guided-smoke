'use strict';
// Runs one walk of a plan: the script performs each step in a visible browser, a panel on the page explains what was
// done and what the user should see, and nothing moves on until the user answers. Every answer is appended to
// events.jsonl at once, so an interrupted walk keeps what it has.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { texts, format } = require('./i18n');
const { Bucket, fromConsole, fromPageError, fromResponse, fromFailed, compileIgnore, total: errorTotal, ABORTED } = require('./errors');
const { Network, findingTotal } = require('./network');
const probing = require('./probe');
const { runSql } = require('./db');

const PACE = { slow: 400, normal: 200, fast: 60 };
const DEFAULT_LOGIN = /(login|signin|sign-in|giris|auth|account\/)/i;
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const STOPPED = 'The walk was stopped.';
const AUTO_SECONDS = 3;
// How long a plan's undo may take before it counts as failed: the walk must still end.
const UNDO_TIMEOUT_MS = 60 * 1000;
// The longest application version a walk keeps: a build number, not a page.
const APP_VERSION_MAX = 40;

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
// the time is up, unless the user presses any button first. s.errors is what the browser reported during the step,
// s.network (--network) what the network did; what arrives later is shown at once (updateErrors). A browser error or
// a critical network finding stops the countdown. s.table (a probe) is a table of tries, its differing rows in red, in
// a wider panel. s.passThrough (while a probe runs) lets clicks through the panel to the page, except on its buttons.
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
    position: 'fixed', ...(s.side === 'left' ? { left: '16px' } : { right: '16px' }), bottom: '16px', width: s.table ? '640px' : '460px',
    maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', maxHeight: s.table ? '88vh' : '75vh', overflow: 'auto', pointerEvents: s.passThrough ? 'none' : 'auto',
    zIndex: '2147483647', background: '#fff', border: '1px solid #ced4da', borderLeft: `6px solid ${s.accent}`,
    borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.25)', font: '14px/1.5 "Segoe UI", system-ui, sans-serif',
    color: '#212529', padding: '12px 14px', textAlign: 'left',
  });
  box.id = '__guided_smoke';
  const head = el('div', null, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#6c757d' });
  head.appendChild(el('span', s.header));
  const min = el('button', s.t.minimize, { border: '1px solid #ced4da', background: '#f8f9fa', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', color: '#212529', pointerEvents: 'auto' });
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
  if (s.table) {
    const table = el('table', null, { borderCollapse: 'collapse', width: '100%', marginTop: '8px', font: '12px/1.35 "Segoe UI", system-ui, sans-serif' });
    table.setAttribute('data-guided-smoke-probe', '');
    const head = el('tr');
    s.table.head.forEach(h => head.appendChild(el('th', h, { textAlign: 'left', padding: '3px 4px', borderBottom: '1px solid #ced4da', color: '#495057' })));
    table.appendChild(head);
    s.table.rows.forEach(r => {
      const tr = el('tr', null, r.bad ? { background: '#fdecee', color: '#b02a37', fontWeight: '600' } : null);
      if (r.bad) tr.setAttribute('data-guided-smoke-bad', '');
      // The number, a short value (a date) and the expectation stay on one line; a long value and the texts wrap.
      r.cells.forEach((c, i) => tr.appendChild(el('td', c, {
        padding: '3px 4px', borderBottom: '1px solid #e9ecef', verticalAlign: 'top',
        ...(i === 0 || i === 2 || (i === 1 && c.length <= 24) ? { whiteSpace: 'nowrap' } : { overflowWrap: 'anywhere' }),
        ...(i === 1 ? { fontFamily: 'Consolas, monospace' } : {}),
      })));
      table.appendChild(tr);
    });
    body.appendChild(table);
    [s.table.legend, ...(s.table.notes || [])].filter(Boolean).forEach(n => body.appendChild(el('div', n, { marginTop: '4px', fontSize: '12px', color: '#6c757d' })));
  }
  (s.warnings || []).forEach(w => body.appendChild(el('div', w, { marginTop: '8px', fontWeight: '600', color: '#b35c00' })));
  const errs = el('div');
  errs.setAttribute('data-guided-smoke-errors', '');
  body.appendChild(errs);
  const nets = el('div');
  nets.setAttribute('data-guided-smoke-network', '');
  body.appendChild(nets);
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
      background: b.color, color: '#fff', border: '0', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: '600', pointerEvents: 'auto',
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
  const showErrors = v => {
    errs.textContent = '';
    if (!v) return;
    if (v.total) {
      stopCountdown();
      errs.appendChild(el('div', v.summary, { marginTop: '8px', fontWeight: '600', color: '#b35c00' }));
      const list = el('div', null, { font: '12px/1.4 Consolas, monospace', color: '#495057', marginTop: '2px', wordBreak: 'break-word' });
      [...v.lines, ...(v.more ? [v.more] : [])].forEach(l => list.appendChild(el('div', l)));
      errs.appendChild(list);
    }
    if (v.ignored) errs.appendChild(el('div', v.ignored, { marginTop: v.total ? '2px' : '8px', fontSize: '12px', color: '#6c757d' }));
  };
  const showNetwork = v => {
    nets.textContent = '';
    if (!v) return;
    if (v.critical) stopCountdown();
    nets.appendChild(el('div', v.summary, { marginTop: '8px', fontWeight: '600', color: '#495057' }));
    if (!v.lines.length) return;
    const list = el('div', null, { font: '12px/1.4 Consolas, monospace', marginTop: '2px', wordBreak: 'break-word' });
    v.lines.forEach(l => list.appendChild(el('div', l.text, l.level === 'critical' ? { color: '#dc3545', fontWeight: '600' } : { color: '#b35c00' })));
    if (v.more) list.appendChild(el('div', v.more, { color: '#495057' }));
    nets.appendChild(list);
  };
  showErrors(s.errors);
  showNetwork(s.network);
  box.__guidedSmokeErrors = v => { showErrors(v.errors); showNetwork(v.network); };
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

// Runs in the engine's own tab (about:blank: no page of the application can reach it). Draws the database form: the
// server and the database as text when the plan gives them, as inputs when it leaves them out; the user's account as
// inputs (none with a Windows sign-in); and Connect, Continue without and Stop. What is typed goes to the engine only
// through this tab's own binding; the tab is closed once answered. s.error shows why the last try failed;
// window.__guidedSmokeDbError(text) shows a new one without redrawing, so what was typed stays. The form carries
// data-ready while its buttons can be pressed.
function drawDbForm(s) {
  document.title = s.title;
  document.body.textContent = '';
  const el = (tag, text, style) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (style) Object.assign(e.style, style);
    return e;
  };
  Object.assign(document.body.style, { margin: '0', background: '#f1f3f5', color: '#212529', font: '15px/1.5 "Segoe UI", system-ui, sans-serif' });
  const box = el('div', null, {
    maxWidth: '520px', margin: '48px auto', background: '#fff', border: '1px solid #ced4da', borderLeft: '6px solid #0d6efd',
    borderRadius: '8px', padding: '18px 20px', boxShadow: '0 8px 24px rgba(0,0,0,.15)',
  });
  box.id = '__guided_smoke_db';
  box.appendChild(el('div', s.title, { fontWeight: '600', fontSize: '18px', marginBottom: '6px' }));
  box.appendChild(el('div', s.intro));
  const given = [[s.serverLabel, s.server], [s.databaseLabel, s.database]].filter(([, v]) => v);
  if (given.length) {
    const facts = el('div', null, { margin: '12px 0 4px', padding: '8px 10px', background: '#f8f9fa', borderRadius: '6px', fontFamily: 'Consolas, monospace', fontSize: '13px' });
    given.forEach(([label, v]) => facts.appendChild(el('div', `${label}: ${v}`)));
    box.appendChild(facts);
  }
  const input = (label, name, secret) => {
    const l = el('label', label, { display: 'block', marginTop: '8px', fontSize: '13px' });
    const i = el('input', null, { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '2px', padding: '6px 8px', border: '1px solid #ced4da', borderRadius: '4px', font: 'inherit' });
    i.type = secret ? 'password' : 'text';
    i.autocomplete = secret ? 'new-password' : 'off';
    i.spellcheck = false;
    i.setAttribute('data-guided-smoke-db', name);
    l.appendChild(i);
    box.appendChild(l);
    return i;
  };
  const server = s.server ? null : input(s.serverLabel, 'server', false);
  const database = s.database ? null : input(s.databaseLabel, 'database', false);
  const user = s.windows ? null : input(s.userLabel, 'user', false);
  const password = s.windows ? null : input(s.passwordLabel, 'password', true);
  const fields = [server, database, user, password].filter(Boolean);
  const error = el('div', s.error || '', { marginTop: '10px', color: '#dc3545', fontWeight: '600', minHeight: '1.5em' });
  error.setAttribute('data-guided-smoke-db-error', '');
  box.appendChild(error);
  const bar = el('div', null, { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' });
  const buttons = [];
  const ready = on => {
    buttons.forEach(b => { b.disabled = !on; b.style.opacity = on ? '1' : '.6'; });
    if (on) box.setAttribute('data-ready', ''); else box.removeAttribute('data-ready');
  };
  const send = (action, values) => { ready(false); window.__guidedSmokeDb(action, values || {}); };
  [['connect', s.connect, '#198754'], ['skip', s.skip, '#fd7e14'], ['stop', s.stop, '#6c757d']].forEach(([action, label, color]) => {
    const b = el('button', label, { background: color, color: '#fff', border: '0', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', font: 'inherit', fontWeight: '600' });
    b.setAttribute('data-guided-smoke-db-answer', action);
    b.onclick = () => {
      if (action !== 'connect') { send(action); return; }
      if (fields.some(f => !f.value.trim())) { error.textContent = s.empty; return; }
      error.textContent = s.busy;
      error.style.color = '#0d6efd';
      const values = {};
      fields.forEach(f => { values[f.getAttribute('data-guided-smoke-db')] = f.value; });
      send('connect', values);
    };
    buttons.push(b);
    bar.appendChild(b);
  });
  fields.forEach(f => { f.onkeydown = e => { if (e.key === 'Enter') buttons[0].click(); }; });
  box.appendChild(bar);
  box.appendChild(el('div', s.note, { marginTop: '10px', fontSize: '12px', color: '#6c757d' }));
  document.body.appendChild(box);
  window.__guidedSmokeDbError = text => {
    error.textContent = text;
    error.style.color = '#dc3545';
    ready(true);
  };
  ready(true);
  if (fields.length) fields[0].focus();
}

// Runs in the page. Shows the step's browser errors and network view ({ errors, network }) in the drawn panel without
// redrawing it, so a note being typed stays.
function updateErrors(view) {
  const panel = document.getElementById('__guided_smoke');
  if (panel && panel.__guidedSmokeErrors) panel.__guidedSmokeErrors(view);
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

// Runs in the page. Takes the panel off the page (the box stays).
function removePanel() {
  if (window.__guidedSmokeUi) window.__guidedSmokeUi.hide('panel');
  const p = document.getElementById('__guided_smoke');
  if (p) p.remove();
}

// Runs in the page, on a probe's field, just before its form is sent. The browser fires "invalid" at every field it
// refuses to send: this field (its own message kept) or another one of the form. A page load forgets it.
function listenInvalid(field) {
  const seen = { self: null, other: false };
  window.__guidedSmokeInvalid = seen;
  if (window.__guidedSmokeInvalidOn) document.removeEventListener('invalid', window.__guidedSmokeInvalidOn, true);
  window.__guidedSmokeInvalidOn = e => {
    if (e.target === field) seen.self = field.validationMessage || ' ';
    else seen.other = true;
  };
  document.addEventListener('invalid', window.__guidedSmokeInvalidOn, true);
}

// Runs in every page and frame (--network): tells the engine when someone acted on the page — a click, a key press or
// typing, by the plan or the user — so that the same call sent once per action is not taken for the page repeating
// itself. Only the time travels; the engine's own panel and value box are left out.
function listenInput() {
  if (window.__guidedSmokeInputOn) return;
  window.__guidedSmokeInputOn = true;
  const ours = e => e.composedPath().some(n => n && typeof n.id === 'string' && n.id.startsWith('__guided_smoke'));
  const acted = e => {
    if (!e.isTrusted || ours(e) || typeof window.__guidedSmokeInput !== 'function') return;
    window.__guidedSmokeInput(Date.now()).catch(() => {});
  };
  for (const type of ['pointerdown', 'keydown', 'input']) window.addEventListener(type, acted, true);
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
// values in its result or error, and shows the masked result in the box. Only the masked value leaves the page. The
// plan's function also gets url(): a path of the application, as goto() reads it, for its own calls.
async function boxRun(fn, arg, o, mask, join) {
  const box = document.getElementById('__guided_smoke_box');
  const fields = {};
  if (box) box.querySelectorAll('[data-guided-smoke-field]').forEach(i => { fields[i.getAttribute('data-guided-smoke-field')] = i.value; });
  const secrets = Object.values(fields);
  const show = text => { const out = box && box.querySelector('[data-guided-smoke-result]'); if (out) out.textContent = text; };
  if (o.boxed && !box) return { error: o.noBox };
  const empty = o.required.filter(f => !fields[f.name]).map(f => f.label);
  if (empty.length) { const error = o.emptyText + empty.join(', '); show(error); return { error }; }
  try {
    const result = mask(await fn({ fields, arg, url: p => join(o.base, p, true) }), secrets);
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

/**
 * The address of a path of the application. Paths are relative to the application's root, which is `base` with its
 * own path: under an application path (https://test01/App, an IIS application), '/orders', 'orders' and '/' are
 * https://test01/App/orders and https://test01/App/. A full address (https://…, //host/…) is taken as it is. With
 * `pathOnly`, the path, query and fragment alone, for a call made from the page itself (its own origin, even after a
 * redirect from http to https). Runs in the page too (inPage's url()): it uses nothing but URL.
 */
function appUrl(base, p, pathOnly = false) {
  const s = String(p == null ? '' : p);
  if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(s)) return pathOnly ? s : new URL(s, base).toString();
  const root = new URL(base);
  const u = new URL(`${root.pathname.replace(/\/+$/, '')}/${s.replace(/^\/+/, '')}`, root.origin);
  return pathOnly ? u.pathname + u.search + u.hash : u.toString();
}

/**
 * What to say when the start page could not be opened because of a Windows sign-in (net::ERR_INVALID_AUTH_CREDENTIALS):
 * Chrome and Edge send the Windows account by themselves only to some addresses (localhost and a bare machine name,
 * not a full name such as test01.corp.example), and without it the page fails at once, with no dialog. null for any
 * other error.
 */
function signInError(message, { signIn, base, env }) {
  if (!/ERR_INVALID_AUTH_CREDENTIALS/.test(String(message))) return null;
  const host = (() => { try { return new URL(base).hostname; } catch { return base; } })();
  if (signIn === 'windows') {
    return `The Windows sign-in to ${host} failed although the browser was allowed to send it: the server does not accept this machine's account (Kerberos and its SPN, NTLM switched off) or the account has no access there. node run.js doctor --base ${base} shows what the browser meets.`;
  }
  return `${host} asks for a Windows sign-in, which the browser sends by itself only to addresses it is told to trust. Add signIn: 'windows' to ${env ? `envs.${env}` : 'the plan'} and walk again.`;
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
 *                                panel: { side:'left'|'right', min }, network: compileConfig(plan.network)|null, probe,
 *                                env: name|null, start, data, db, signIn } — from envs.pickEnv
 *                                (default: the plan's own);
 *                                suite: { id, index, total, next: the next plan's title|null } when the walk is one
 *                                plan of a suite
 * @returns {{ meta, counts, signedOut, stopSuite }} stopSuite: the user ended the suite on the closing screen
 */
async function walk(o) {
  const { plan, planId, walkId, project, walkDir, playwright, options } = o;
  // A walk that is one plan of a suite says so in every panel's header: "Plan 2/5 · Smoke 3 / 9".
  const suite = options.suite || null;
  const words = texts(options.lang);
  const t = suite ? { ...words, step: `${format(words.suitePlan, { i: suite.index, n: suite.total })} · ${words.step}` } : words;
  const steps = plan.steps;
  const total = steps.length;
  const base = options.base;
  const remote = !isLocal(base);
  const signIn = options.signIn || plan.signIn || null;
  const eventsFile = path.join(walkDir, 'events.jsonl');
  const metaFile = path.join(walkDir, 'walk.json');
  const screensDir = path.join(walkDir, 'screens');
  const downloadsDir = path.join(walkDir, 'downloads');
  const videoDir = path.join(walkDir, 'video');
  const counts = { pass: 0, diff: 0, skip: 0, against: 0, auto: 0, errorSteps: 0, networkSteps: 0, networkCritical: 0, probeSteps: 0, probeTries: 0, probeDiff: 0 };
  // What the browser reports during a step: collected from the previous answered step to this step's answer. The
  // network (--network) over the same window.
  const seen = new Bucket(compileIgnore(plan.ignoreErrors));
  let live = () => {};
  const net = options.network ? new Network({ base, config: options.network, local: !remote, onChange: () => live() }) : null;
  const side = options.panel && options.panel.side === 'left' ? 'left' : 'right';
  let panelMin = !!(options.panel && options.panel.min);

  const meta = {
    walkId, planId, project, title: plan.title || planId, workItem: options.workItem || plan.workItem || null,
    ...(suite ? { suite: { id: suite.id, index: suite.index, total: suite.total } } : {}),
    env: options.env || null, base, remote, signIn, browser: options.browser.name, browserSource: options.browser.source, lang: options.lang,
    locale: options.locale || null, pace: options.pace, fresh: !!options.fresh, screens: options.screens || null,
    filter: options.filterNote || null, skipWrites: !!options.skipWrites, allowRemoteWrites: !!options.allowRemoteWrites,
    auto: !!options.auto, trace: !!options.trace, video: !!options.video, probe: !!options.probe, traces: [], videos: [],
    totalSteps: total, titles: steps.map(s => s.title), startedAt: new Date().toISOString(), readyAt: null, endedAt: null,
    measuredSeconds: null, result: 'running', ...(net ? { network: net.summary() } : {}),
  };
  const saveMeta = () => {
    if (net) meta.network = net.summary();
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  };
  saveMeta();

  const append = event => fs.appendFileSync(eventsFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  const record = event => {
    append(event);
    if (event.answer === 'pass' || event.answer === 'diff') counts[event.answer]++;
    if (event.answer === 'skip') counts.skip++;
    if (event.againstCheck) counts.against++;
    if (event.answeredBy === 'auto') counts.auto++;
    const browserErrors = errorTotal(event.browserErrors);
    if (browserErrors) counts.errorSteps++;
    const network = findingTotal(event.network);
    if (network) counts.networkSteps++;
    if (event.network && event.network.critical) counts.networkCritical++;
    const probe = event.probe;
    if (probe && (event.answer === 'pass' || event.answer === 'diff')) {
      counts.probeSteps++;
      counts.probeTries += probe.tries;
      counts.probeDiff += probe.different;
    }
    console.log(`[${event.n}] ${event.answer}${event.reason ? ' (' + event.reason + ')' : ''}${event.note ? ' — ' + event.note.replace(/\s+/g, ' ').trim() : ''}${browserErrors ? ` · browser errors: ${browserErrors}` : ''}${network ? ` · network findings: ${network}${event.network.critical ? ` (critical: ${event.network.critical})` : ''}` : ''}${probe ? ` · probe: ${probe.tries - probe.different}/${probe.tries} as expected` : ''}`);
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
    // signIn: 'windows': the browser may send this machine's Windows account to the application's host, also under a
    // full name (test01.corp.example), which it otherwise refuses at once.
    args: ['--start-maximized', ...(options.locale ? [`--lang=${options.locale}`] : []),
      ...(signIn === 'windows' ? [`--auth-server-allowlist=${new URL(base).hostname}`] : [])],
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

  await context.exposeFunction('__guidedSmokeAnswer', async (a, note, by) => {
    // The countdown ran out just before an error or a critical network finding reached the panel: the step waits for
    // the user after all.
    if (by === 'auto' && current && current.errorsLive && (seen.total() || (net && net.critical()))) { await draw(current); return; }
    if (pending) { const r = pending; pending = null; r({ a, note, by: by === 'auto' ? 'auto' : undefined }); }
  });
  await context.exposeFunction('__guidedSmokeMin', on => { panelMin = !!on; });
  if (net) {
    await context.exposeFunction('__guidedSmokeInput', at => net.input(at));
    await context.addInitScript(listenInput);
  }
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
  // Every panel takes the walk's corner and the user's last minimize choice (--panel sets both at the start); a step's
  // panel also the browser errors and the network seen so far.
  const stepView = () => ({ errors: seen.view(t), network: net ? net.view(t) : null });
  const dressed = panel => ({ ...panel, side, min: panelMin, ...(panel.errorsLive ? stepView() : {}) });
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
    await page.evaluate(removePanel).catch(() => {});
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
      base, boxed: !!box, noBox: t.boxGone, emptyText: t.boxEmpty,
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
    const out = await page.evaluate(`(${boxRun})(${fn}, ${JSON.stringify(arg)}, ${JSON.stringify(o)}, ${redact}, ${appUrl})`);
    if (out && out.error) throw new Error(out.error);
    return out ? out.result : undefined;
  };

  // ---- probing (--probe): one field of a form, many values ----
  // A try runs from filling the field to the first outcome seen: an error answer of the application, the browser
  // refusing to send, "saved", the application's message, or nothing within the probe's timeout. While a try runs, the
  // listeners below give its own answers to `attempt`: an error status (4xx) belongs to the try, not to the step's
  // browser errors (a refused value is the point); a 5xx, a script error or a failed request makes the try "crashed"
  // and is a browser error of the step as well. Only the application's own pages and calls count.
  let attempt = null;
  let probeStop = null;
  const baseHost = (() => { try { return new URL(base).hostname; } catch { return null; } })();
  const ownCall = r => {
    try { return ['document', 'fetch', 'xhr'].includes(r.resourceType()) && new URL(r.url()).hostname === baseHost; } catch { return false; }
  };
  const seenText = async locator => {
    if (!locator) return '';
    try {
      const idx = await locator.evaluateAll(seenIndices);
      return idx.length ? squash(await locator.nth(idx[0]).textContent({ timeout: 1000 })) : '';
    } catch { return ''; }
  };
  const isSaved = async o => {
    try {
      if (typeof o.saved === 'function') return !!(await o.saved(ctx));
      return (await o.saved.evaluateAll(seenIndices)).length > 0;
    } catch { return false; }
  };
  const tryValue = async (o, v, n) => {
    attempt = { crash: null, status: null, statusAt: 0 };
    const op = { timeout: 5000 };
    let changed;
    const out = await (async () => {
      try {
        await o.field.fill(v.value, op);
      } catch (e) {
        // A date that is no day, text in a number field: the field itself does not take it.
        if (/Malformed value|Cannot type text into|cannot be filled/i.test(String(e && e.message))) return { got: 'blocked', why: 'refused' };
        throw e;
      }
      // A maxlength keeps only part of what was typed; the rest of the try is about what is left.
      const kept = await o.field.inputValue(op).catch(() => null);
      if (kept != null && kept !== v.value) changed = { typed: [...v.value].length, kept: [...kept].length };
      // What a user does on the way to the button; a check on leaving the field shows its message now.
      await o.field.evaluate(e => e.blur()).catch(() => {});
      if (await isSaved(o)) return { got: 'unclear', why: 'early' };
      const before = await seenText(o.message);
      if (!(await o.submit.isEnabled(op))) return { got: 'blocked', why: 'disabled', message: before };
      await o.field.evaluate(listenInvalid).catch(() => {});
      const sentAt = Date.now();
      await o.submit.click(op);
      for (;;) {
        if (probeStop || closed) return null;
        if (attempt.crash) return { got: 'crashed', ...attempt.crash };
        const invalid = await page.evaluate(() => window.__guidedSmokeInvalid || null).catch(() => null);
        if (invalid && invalid.self) return { got: 'blocked', why: 'validity', message: invalid.self.trim() };
        if (invalid && invalid.other) return { got: 'unclear', why: 'other' };
        if (await isSaved(o)) return { got: 'saved' };
        // A message already shown before sending counts once the application has had a moment to save instead.
        const message = await seenText(o.message);
        if (message && (message !== before || Date.now() - sentAt >= 1000)) return { got: 'rejected', message, status: attempt.status || undefined };
        // An error answer and nothing on the screen: refused without a word, once the screen has had a moment.
        const late = Date.now() - sentAt >= o.timeout;
        if (attempt.status && (late || Date.now() - attempt.statusAt >= probing.AFTER_ERROR_MS)) return { got: 'rejected', why: 'http', status: attempt.status };
        if (late) return { got: 'unclear', why: 'timeout', waited: Math.round(o.timeout / 1000) };
        await new Promise(r => setTimeout(r, 150));
      }
    })().catch(e => (probeStop || closed || stopRequested ? null : { got: 'unclear', why: 'error', message: firstLine(e) }));
    attempt = null;
    return out && probing.row(n, v, { ...out, changed });
  };
  const probe = async spec => {
    if (!currentStep || !currentStep.probe) throw new Error('probe() runs only in a step marked probe: true (such a step runs with --probe and asks first).');
    if (currentStep.probed) throw new Error('probe() runs once per step: give each field a step of its own.');
    if (box) throw new Error('probe() does not run while the value box is open: remove it first with secretBox(null).');
    const o = probing.checkSpec(spec, t);
    for (const [name, locator] of [['field', o.field], ['submit', o.submit]]) {
      await locator.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { throw new Error(`probe: the ${name} is not on the page.`); });
      const count = await locator.count();
      if (count !== 1) throw new Error(`probe: ${name} must match one element; it matches ${count}.`);
    }
    // Before every value but the first the form is brought back: by the plan's reset, else by opening again the
    // address the probe started on (not a reload: after a save that address may carry "saved").
    const startUrl = page.url();
    const reset = async () => {
      if (o.reset) return o.reset(ctx);
      await page.goto(startUrl);
      await page.waitForLoadState('load');
    };
    const rows = [];
    const panel = {
      header: format(t.step, { n: currentStep.n, total }), accent: COLORS.info, t, didLabel: t.did, expectLabel: t.probeLast,
      title: currentStep.title, did: '', expect: [t.probeNone], shot: false, passThrough: true,
      buttons: [{ label: t.stop, value: 'stop', color: COLORS.stop }],
    };
    probeStop = null;
    pending = res => { probeStop = res; };
    current = panel;
    try {
      for (let i = 0; i < o.values.length && !probeStop && !closed; i++) {
        const v = o.values[i];
        if (net) net.restartRepeats();
        if (i > 0) await reset();
        if (probeStop || closed) break;
        panel.did = format(t.probeTry, { i: i + 1, n: o.values.length, value: v.label });
        await draw(panel);
        const r = await tryValue(o, v, i + 1);
        if (!r) break;
        rows.push(r);
        panel.expect = [`${v.label}: ${probing.gotText(r, t)}`];
      }
    } finally {
      pending = null;
      current = null;
      await page.evaluate(removePanel).catch(() => {});
    }
    currentStep.probed = probing.verdict(rows);
    if (probeStop || closed) {
      // Stop during a probe: the try under way is dropped, the ones before it are kept.
      stopRequested = probeStop || { a: 'stop', note: 'browser closed' };
      await context.route('**/*', route => route.abort()).catch(() => {});
      throw new Error(STOPPED);
    }
    // What the plan's clean-up needs: the values the application saved, as sent.
    return { ...currentStep.probed, saved: rows.filter(r => r.got === 'saved').map(r => o.values[r.n - 1].value) };
  };

  // ---- what the browser reports that the screen does not show ----
  // Off during the sign-in (the user's own pages), after the last step and once Stop has cut the page off. A request
  // sent while the value box is drawn, and any message logged meanwhile, are kept without address or text.
  let watching = false;
  const boxRequests = new WeakSet();
  const looking = () => watching && !stopRequested && !closed;
  let liveQueued = false;
  live = () => {
    if (liveQueued) return;
    liveQueued = true;
    setTimeout(() => {
      liveQueued = false;
      if (current && current.errorsLive) page.evaluate(updateErrors, stepView()).catch(() => {});
    }, 100);
  };
  const saw = entry => {
    if (!entry || !looking()) return;
    seen.add(entry);
    live();
  };
  context.on('request', r => { if (box) boxRequests.add(r); });
  if (net) {
    context.on('requestfinished', r => { if (looking()) net.finished(r, !!box || boxRequests.has(r)); });
    context.on('requestfailed', r => { if (looking()) net.failed(r, !!box || boxRequests.has(r)); });
  }
  context.on('console', m => saw(fromConsole({ type: m.type(), text: m.text(), location: m.location() }, base, !!box)));
  context.on('weberror', w => {
    if (attempt && looking()) attempt.crash = attempt.crash || { why: 'js' };
    saw(fromPageError(w.error(), base, !!box));
  });
  context.on('response', r => {
    const status = r.status();
    if (status < 400) return;
    if (attempt && looking() && ownCall(r.request())) {
      if (status < 500) { attempt.status = status; attempt.statusAt = Date.now(); return; }
      attempt.crash = attempt.crash || { why: 'server', status };
    }
    saw(fromResponse({ method: r.request().method(), url: r.url(), status }, base, !!box || boxRequests.has(r.request())));
  });
  context.on('requestfailed', r => {
    const errorText = (r.failure() || {}).errorText;
    if (attempt && looking() && errorText && errorText !== ABORTED && ownCall(r)) attempt.crash = attempt.crash || { why: 'failed' };
    saw(fromFailed({ method: r.method(), url: r.url(), errorText }, base, !!box || boxRequests.has(r)));
  });
  // The step's network record: waits up to a second for bodies still being read.
  const takeNetwork = async () => (net ? net.take() : undefined);

  // ---- the test database: the engine's own tab before the sign-in, then sql() through sqlcmd ----
  // The account typed there lives only in `db` while the walk runs. sqlcmd's messages are never shown: a failure says
  // only its kind (the account, the database, the network, sqlcmd missing, a query).
  const dbConfig = options.db || plan.db || null;
  // `config` is the plan's db with what the tab asked for filled in (a server or database the plan left out).
  const db = { config: null, account: null, ready: false };
  if (dbConfig) meta.db = 'none';
  const sqlRun = async query => {
    if (!db.ready) throw new Error(dbConfig ? t.dbNone : t.dbNotSet);
    try {
      return await runSql({ db: db.config, account: db.account, query });
    } catch (e) {
      throw new Error(format(t.dbFailed, { why: t.dbKinds[e.kind] || t.dbKinds.query }));
    }
  };
  const tryDb = async (config, account) => {
    try { await runSql({ db: config, account, query: 'SELECT 1' }); return null; } catch (e) { return e.kind || 'query'; }
  };
  /**
   * Before the sign-in: connects, asking in the engine's own tab for the account and for a server or database the
   * plan left out; 'stop' when the user stops there.
   */
  const connectDb = async () => {
    if (!dbConfig) return null;
    const windows = (dbConfig.login || 'sql') === 'windows';
    const complete = !!(dbConfig.server && dbConfig.database);
    let failed = windows && complete ? await tryDb(dbConfig, null) : null;
    if (windows && complete && !failed) {
      db.config = dbConfig;
      db.ready = true;
      meta.db = 'windows';
      saveMeta();
      return null;
    }
    const tab = await context.newPage();
    const tabVideo = options.video ? tab.video() : null;
    let answer = null;
    const tabClosed = new Promise(resolve => tab.once('close', () => resolve({ a: 'skip' })));
    await tab.exposeFunction('__guidedSmokeDb', (a, values) => {
      if (answer) { const r = answer; answer = null; r({ a, values: values || {} }); }
    });
    await tab.evaluate(drawDbForm, {
      title: t.dbTitle, intro: windows ? t.dbIntroWindows : t.dbIntro, windows, serverLabel: t.dbServer, server: dbConfig.server || null,
      databaseLabel: t.dbDatabase, database: dbConfig.database || null, userLabel: t.dbUser, passwordLabel: t.dbPassword,
      connect: windows && complete ? t.dbRetry : t.dbConnect, skip: t.dbSkip, stop: t.stop, note: t.dbNote, busy: t.dbBusy, empty: t.dbEmpty,
      error: failed ? t.dbKinds[failed] : '',
    });
    let outcome = null;
    for (;;) {
      const res = await Promise.race([new Promise(resolve => { answer = resolve; }), tabClosed]);
      if (closed || res.a === 'stop') { outcome = 'stop'; break; }
      if (res.a !== 'connect') break;
      const v = res.values || {};
      const config = { ...dbConfig, server: dbConfig.server || String(v.server || '').trim(), database: dbConfig.database || String(v.database || '').trim() };
      const account = windows ? null : { user: String(v.user || ''), password: String(v.password || '') };
      failed = await tryDb(config, account);
      if (!failed) {
        db.config = config;
        db.account = account;
        db.ready = true;
        meta.db = windows ? 'windows' : 'sql';
        break;
      }
      await tab.evaluate(text => window.__guidedSmokeDbError(text), t.dbKinds[failed]).catch(() => {});
    }
    await tab.close().catch(() => {});
    // That tab's recording would show the account's name: it is not kept.
    if (tabVideo) {
      const i = videos.indexOf(tabVideo);
      if (i >= 0) videos.splice(i, 1);
      await tabVideo.delete().catch(() => {});
    }
    if (!closed) await page.bringToFront().catch(() => {});
    saveMeta();
    return outcome;
  };

  const ctx = {
    page, context, base, lang: options.lang, state: {}, walkDir,
    // The environment's test records (envs.<name>.data over the plan's data).
    data: options.data || { ...(plan.data || {}) },
    url: p => appUrl(base, p),
    goto: async p => { await page.goto(appUrl(base, p)); await page.waitForLoadState('load'); },
    mark,
    text,
    secretBox,
    inPage,
    probe,
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
    sql: query => sqlRun(query),
  };

  // ---- undo: what a permitted step changed, put back by the plan's own code ----
  // A step's undo is taken down when the user allows the step, before it runs: a step that fails half-way is undone
  // too, so an undo must do the right thing whatever the step got done. The plan may run one itself (undo(n)); the rest
  // run when the walk ends, after Stop, an error or the browser closing, last change first, without asking. An undo
  // works on the database or an API, never the page: the browser may be gone by then.
  const undos = [];
  const undone = [];
  const undoCtx = () => ({
    state: ctx.state, data: ctx.data, base, url: ctx.url, log: ctx.log, sql: sqlRun,
    poll: (fn, opts) => poll(fn, opts),
  });
  const runUndo = async (u, by, inStep) => {
    let timer = null;
    let error = null;
    try {
      await Promise.race([u.run(undoCtx()), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(format(t.undoTimeout, { s: UNDO_TIMEOUT_MS / 1000 }))), UNDO_TIMEOUT_MS);
      })]);
    } catch (e) {
      error = firstLine(e);
    } finally {
      clearTimeout(timer);
    }
    append({ n: u.n, title: u.title, kind: 'undo', answer: error ? 'failed' : 'done', by, inStep, what: u.what, error: error || undefined });
    console.log(`[${u.n}] undo ${error ? 'failed' : 'done'} (${by}${inStep ? ' ' + inStep : ''})${error ? ' — ' + error : ''}`);
    undone.push({ ...u, error });
    return error;
  };
  ctx.undo = async n => {
    const i = undos.findIndex(u => u.n === Number(n));
    if (i < 0) return false;
    const [u] = undos.splice(i, 1);
    const error = await runUndo(u, 'plan', currentStep ? currentStep.n : undefined);
    if (error) throw new Error(format(t.undoFailedPlan, { n: u.n, error }));
    return true;
  };
  const undoRest = async by => {
    while (undos.length) await runUndo(undos.pop(), by);
  };

  for (const name of ['goto', 'mark', 'text', 'secretBox', 'inPage', 'probe', 'poll', 'visible', 'count', 'submit', 'download', 'sleep', 'undo', 'sql']) {
    const helper = ctx[name];
    ctx[name] = async (...args) => {
      if (stopRequested) throw new Error(STOPPED);
      return helper(...args);
    };
  }

  let stopped = false;
  let currentStep = null;
  try {
    // The test database is asked for first, in a tab of its own: no page of the application is open yet.
    const dbStop = await connectDb();

    // ---- sign-in: always the user's; the script only waits until the browser leaves the sign-in pages ----
    const start = options.start || plan.start || '/';
    const login = options.login || plan.login;
    const loginRe = login ? new RegExp(login, 'i') : DEFAULT_LOGIN;
    const isReady = async () => plan.ready ? (await page.locator(plan.ready).count()) > 0 : !loginRe.test(page.url());
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    // Each opening of the start page forgets what came before it: what the sign-in pages reported is not the walk's,
    // what the start page reports after the sign-in belongs to step 1.
    watching = true;
    seen.clear();
    if (net) net.clear();
    if (!dbStop) {
      try {
        await ctx.goto(start);
      } catch (e) {
        const hint = signInError(e && e.message, { signIn, base, env: options.env });
        throw hint ? new Error(hint) : e;
      }
    }
    while (!dbStop && !closed && !(await isReady().catch(() => false))) {
      if (Date.now() > deadline) throw new Error('Sign-in was not completed within 15 minutes.');
      await draw({ header: format(t.step, { n: 0, total }), accent: COLORS.warn, t, didLabel: t.did, expectLabel: t.todo,
        title: t.loginTitle, did: t.loginDid, expect: t.loginExpect, buttons: [] });
      await page.waitForURL(u => !loginRe.test(u.toString()), { timeout: LOGIN_TIMEOUT_MS }).catch(() => {});
      if (closed) break;
      await page.waitForTimeout(1500).catch(() => {});
      seen.clear();
      if (net) net.clear();
      await ctx.goto(start).catch(() => {});
    }
    if (closed || dbStop) {
      // The window was closed, or Stop pressed in the database tab, before signing in: a stop, not an error.
      meta.endedAt = new Date().toISOString();
      meta.result = 'stopped';
      meta.error = dbStop ? 'stopped at the database form' : 'browser closed before sign-in';
      db.account = null;
      saveMeta();
      await closeBrowser();
      dropFreshProfile();
      return { meta, counts, signedOut: false };
    }
    meta.readyAt = new Date().toISOString();
    saveMeta();
    await traceResume();

    // The application's version, read once by the plan: the report and the paste block carry it, so a walk on a test
    // server says which build it walked. A plan that opens another page for it gets the start page back.
    if (typeof plan.appVersion === 'function') {
      const at = page.url();
      try {
        meta.appVersion = squash(String((await plan.appVersion(ctx)) ?? '')).slice(0, APP_VERSION_MAX) || null;
      } catch (e) {
        meta.appVersionError = firstLine(e).slice(0, 120);
      }
      if (!closed && page.url() !== at) await ctx.goto(start).catch(() => {});
      saveMeta();
    }

    // ---- steps ----
    let skipUntil = 0;
    for (let i = 0; i < total; i++) {
      const n = i + 1;
      const s = steps[i];
      if (n < skipUntil) { record({ n, title: s.title, answer: 'skip', reason: 'follows-skip' }); continue; }
      if (options.allowed && !options.allowed.has(n)) { record({ n, title: s.title, answer: 'skip', reason: 'filter' }); continue; }
      // A probe step runs only when asked for (--probe), and it always asks first: it may save what it sends.
      if (s.probe && !options.probe) { record({ n, title: s.title, answer: 'skip', reason: 'probe' }); continue; }
      // A step that needs the test database is skipped without one, as a declined permitted step is.
      if (s.db && !db.ready) {
        record({ n, title: s.title, answer: 'skip', reason: 'no-db' });
        if (s.skipTo) skipUntil = Number(s.skipTo);
        continue;
      }
      const approve = s.approve || (s.probe ? { what: t.probeWhat } : null);
      shotIndex = n;
      lastShot = null;
      markMissing = false;
      marked = false;
      warnings = [];

      if (approve) {
        const what = typeof approve === 'string' ? approve : approve.what;
        const reason = options.skipWrites ? 'skip-writes' : (remote && !options.allowRemoteWrites ? 'remote' : null);
        let decision = reason ? 'skip' : null;
        if (!decision) {
          const res = await ask(panelFor(n, s, {
            accent: COLORS.warn, title: `${t.approveTitle}: ${s.title}`, did: t.approveIntro, shot: false,
            expect: [what, ...(s.undo ? [format(t.undoLine, { what: s.undo.what })] : [])],
            expectLabel: t.change,
            buttons: [
              { label: approve.yes || t.approveYes, value: 'approved', color: COLORS.yes },
              { label: t.approveSkip, value: 'skip', color: COLORS.skip },
              { label: t.stop, value: 'stop', color: COLORS.stop },
            ],
          }));
          decision = res.a;
          if (decision === 'stop') { record({ n, title: s.title, kind: 'approve', answer: 'stop', seconds: res.seconds, browserErrors: seen.take(), network: await takeNetwork() }); stopped = true; break; }
          if (decision === 'approved') {
            record({ n, title: s.title, kind: 'approve', answer: 'approved', what, seconds: res.seconds });
            if (s.undo) {
              undos.push({ n, title: s.title, what: s.undo.what, run: s.undo.run });
              append({ n, title: s.title, kind: 'undo', answer: 'registered', what: s.undo.what });
            }
          }
        }
        if (decision !== 'approved') {
          record({ n, title: s.title, kind: 'approve', answer: 'skip', reason: reason || 'declined', what });
          if (s.skipTo) skipUntil = Number(s.skipTo);
          continue;
        }
      }

      currentStep = { n, title: s.title, probe: !!s.probe, probed: null };
      stopRequested = null;
      let runError = null;
      try { await s.run(ctx); } catch (e) { runError = e; }
      let auto = null;
      if (runError) auto = { ok: false, text: firstLine(runError) };
      else if (s.check && !stopRequested) {
        try { auto = normalizeCheck(await s.check(ctx), t); } catch (e) { auto = { ok: false, text: firstLine(e) }; }
      }
      // A probe is an automatic check of its own, next to the plan's.
      const probed = currentStep.probed;
      if (probed && !runError) {
        const p = probing.check(probed, t);
        auto = auto ? { ok: auto.ok && p.ok, text: [p.text, auto.text].filter(Boolean).join(' · ') } : p;
      }
      // Stop pressed while the step waited for the box: checked here too, in case the plan caught the error itself.
      if (stopRequested) {
        record({ n, title: s.title, kind: approve ? 'approve' : 'step', answer: 'stop', note: stopRequested.note || undefined, probe: probing.record(probed), browserErrors: seen.take(), network: await takeNetwork() });
        stopped = true;
        break;
      }
      if (options.screens === 'all') { try { lastShot = await takeShot(n); } catch { /* keep going */ } }

      // --auto: only a step whose automatic check passed without plan warnings, browser errors or critical network
      // findings goes on by itself, after a countdown. Network warnings do not hold it. A probe step never does: its
      // table is there to be read.
      const countdown = options.auto && !s.probe && auto && auto.ok && !warnings.length && !seen.total() && !(net && net.critical())
        ? { seconds: AUTO_SECONDS, text: t.autoIn, hold: t.autoHold } : undefined;
      const res = await ask(panelFor(n, s, {
        auto,
        table: probed ? probing.table(probed, t) : undefined,
        warnings,
        countdown,
        errorsLive: true,
        expectLabel: expectLabel(t, marked),
        buttons: [
          { label: t.pass, value: 'pass', color: COLORS.pass, confirm: auto && !auto.ok ? t.passConfirm : undefined },
          { label: t.diff, value: 'diff', color: COLORS.diff, needsNote: true },
          { label: t.stop, value: 'stop', color: COLORS.stop },
        ],
      }));
      if (res.a === 'diff' && options.screens === 'diff' && !lastShot) { try { lastShot = await takeShot(n); } catch { /* keep going */ } }
      record({ n, title: s.title, kind: approve ? 'approve' : 'step', answer: res.a, note: res.note || undefined,
        auto: auto || undefined, probe: probing.record(probed), againstCheck: (res.a === 'pass' && auto && !auto.ok) || undefined, error: runError ? firstLine(runError) : undefined, markMissing: markMissing || undefined,
        warnings: warnings.length ? warnings : undefined, answeredBy: res.by, seconds: res.seconds, screenshot: lastShot || undefined,
        browserErrors: seen.take(), network: await takeNetwork() });
      if (res.a === 'stop') { stopped = true; break; }
    }
    watching = false;
    shotIndex = null;
    await tracePause();

    meta.endedAt = new Date().toISOString();
    meta.measuredSeconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.readyAt)) / 1000);
    meta.result = stopped ? 'stopped' : 'completed';
    saveMeta();

    // ---- undo what is left, last change first ----
    if (undos.length) {
      if (!closed) {
        await draw({ header: format(t.step, { n: total, total }), accent: COLORS.info, t, didLabel: t.did, expectLabel: t.undoList,
          title: t.undoingTitle, did: t.undoingDid, expect: undos.slice().reverse().map(u => `${u.n}. ${u.what}`), shot: false, buttons: [] });
      }
      await undoRest(closed ? 'close' : stopped ? 'stop' : 'end');
    }
    db.account = null;
    const undoFailed = undone.filter(u => u.error);

    // ---- closing screen ----
    // In a suite with plans left it leads on to the next plan, or ends the suite here; the sign-out comes with the
    // last plan. A stopped walk ends the suite anyway and closes as a walk of its own does.
    const onward = !!(suite && suite.next && !stopped);
    const closing = closed ? { a: 'close' } : await ask({
      header: format(t.step, { n: total, total }), accent: COLORS.info, t, didLabel: t.did, expectLabel: t.outcome,
      title: onward ? format(t.suiteDoneTitle, { i: suite.index, n: suite.total }) : t.doneTitle,
      did: onward ? format(t.suiteDoneDid, { title: suite.next }) : t.doneDid, shot: false,
      expect: [format(t.doneSummary, counts), ...(counts.auto ? [format(t.doneAuto, counts)] : []),
        ...(counts.against ? [format(t.doneAgainst, counts)] : []), ...(counts.errorSteps ? [format(t.doneErrors, counts)] : []),
        ...(counts.networkCritical ? [format(t.doneNetworkCritical, counts)] : counts.networkSteps ? [format(t.doneNetwork, counts)] : []),
        ...(counts.probeTries ? [format(t.doneProbe, counts)] : []),
        ...(undone.length ? [format(t.doneUndo, { done: undone.length - undoFailed.length, total: undone.length })] : []),
        ...undoFailed.map(u => format(t.doneUndoFailed, u))],
      buttons: onward ? [
        { label: t.suiteNext, value: 'close', color: COLORS.info },
        { label: t.suiteStop, value: 'stop', color: COLORS.stop },
      ] : [
        { label: t.close, value: 'close', color: COLORS.info },
        ...(options.fresh ? [] : [{ label: t.signOut, value: 'signout', color: COLORS.stop }]),
      ],
    }).catch(() => ({ a: 'close' }));
    // Stop on that screen, or the window closed by then: the user is leaving, so no next plan opens a new window.
    const stopSuite = !!suite && (closed || closing.a === 'stop');
    await closeBrowser();
    if (closing.a === 'signout') removeProfile();
    else dropFreshProfile();
    return { meta, counts, signedOut: closing.a === 'signout', stopSuite };
  } catch (e) {
    meta.endedAt = new Date().toISOString();
    if (meta.readyAt) meta.measuredSeconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.readyAt)) / 1000);
    meta.result = 'error';
    meta.error = firstLine(e);
    saveMeta();
    // The test data comes first: put back what the allowed steps changed before anything else can fail.
    await undoRest('error');
    db.account = null;
    await tracePause();
    await closeBrowser();
    dropFreshProfile();
    throw e;
  }
}

module.exports = { walk, appUrl, isLocal, signInError, DEFAULT_LOGIN, normalizeCheck, expectLabel, drawPanel, drawBox, drawDbForm, emptyFields, seenIndices, redact, poll, isFunctionExpression, widen, PACE };
