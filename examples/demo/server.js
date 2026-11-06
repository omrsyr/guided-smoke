'use strict';
// The demo application for `node run.js demo`: a tiny orders site with a sign-in, one order with a due date, an invoice
// download, the application's own confirm dialog, a client API with an account of its own, a reminder job and a help
// page whose background call fails on purpose. It
// listens on 127.0.0.1 only, keeps everything in memory and forgets it when it stops. It exists for the demo plan.

const http = require('http');
const crypto = require('crypto');
const TEXTS = require('./texts');

const ORDER = 1001;
const SIGN_IN = { user: 'demo', password: 'demo' };
const API_ACCOUNT = { email: 'api@example.com', password: 'demo-api' };
const JOB = 'overdue-reminder';
const JOB_SECONDS = 3;

const pad = n => String(n).padStart(2, '0');
/** Today plus `offset` days as yyyy-mm-dd, in this machine's time zone (what a date input shows). */
function isoDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const clock = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let store = null;
function reset() {
  store = { due: null, status: 'open', reminders: 0, calls: [], job: { lastRun: null, running: false }, sessions: new Set(), tokens: new Set() };
}
reset();

const overdue = () => store.status === 'open' && !!store.due && store.due < isoDay(0);

/**
 * Stands in for the project's database tool: the plan's permitted steps change the demo's data through it, outside
 * the page, and get the number of changed rows back.
 */
const db = {
  setDueDays(order, days) {
    if (order !== ORDER) return 0;
    store.due = isoDay(days);
    return 1;
  },
  reminders: () => store.reminders,
  calls: () => store.calls.length,
};

const CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:#212529;background:#f3f4f6}
header{background:#1f2937;color:#fff;padding:10px 24px;display:flex;gap:20px;align-items:center}
header a{color:#d1d5db;text-decoration:none}header strong{margin-right:12px}
main{max-width:820px;margin:24px auto;padding:0 16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:16px}
h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:0 0 8px}
dl{display:grid;grid-template-columns:120px 1fr;gap:4px 12px;margin:8px 0}dt{color:#6b7280}dd{margin:0}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:13px;font-weight:600;background:#e5e7eb}
.badge-overdue{background:#fde68a;color:#78350f;margin-left:6px}
.alert{padding:10px 14px;border-radius:6px;margin-bottom:16px}.alert-success{background:#d1fae5;color:#065f46}
.alert-error{background:#fee2e2;color:#991b1b}
form.inline{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:12px 0}label{display:block;font-size:13px;color:#4b5563}
input{font:inherit;padding:5px 8px;border:1px solid #d1d5db;border-radius:4px}
button,.button{font:inherit;padding:6px 14px;border-radius:4px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
.secondary{background:#fff;color:#2563eb}.danger{background:#fff;color:#b91c1c;border-color:#b91c1c}
.actions{display:flex;gap:8px;margin-top:8px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:14px}
.note{color:#065f46;font-weight:600;margin:8px 0 0}.muted{color:#6b7280;font-size:13px}
#cancel-dialog{border:0;border-radius:8px;padding:0}#cancel-dialog::backdrop{background:rgba(0,0,0,.45)}
.modal-content{background:#fff;padding:20px 24px;min-width:320px}
.login{max-width:360px;margin:60px auto}.login input{width:100%;margin:2px 0 10px}
`;

const JS = `
const dialog = document.getElementById('cancel-dialog');
if (dialog) {
  document.getElementById('cancel').addEventListener('click', () => dialog.showModal());
  document.getElementById('cancel-no').addEventListener('click', () => dialog.close());
}
// The help page loads its tips in the background, and the demo fails that call on purpose: the screen shows nothing,
// the panel shows the failed request and the error it leaves.
const tips = document.querySelector('[data-tips]');
if (tips) {
  fetch(tips.dataset.tips).then(r => { if (!r.ok) throw new Error('Tips could not be loaded (HTTP ' + r.status + ')'); });
}
`;

function page(T, lang, title, body, nav = true) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)} · ${esc(T.app)}</title>`
    + '<link rel="stylesheet" href="/app.css"></head><body>'
    + (nav ? `<header><strong>${esc(T.app)}</strong><a href="/orders/${ORDER}">${esc(T.order)}</a><a href="/jobs">${esc(T.jobs)}</a>`
      + `<a href="/help/orders">${esc(T.help)}</a></header>` : '')
    + `<main>${body}</main><script src="/app.js"></script></body></html>`;
}

function orderPage(T, lang, query) {
  const alert = query.get('saved') ? `<div class="alert alert-success" role="status">${esc(T.saved)}</div>`
    : query.get('error') ? `<div class="alert alert-error" role="alert">${esc(T.pastDate)}</div>` : '';
  const status = store.status === 'open' ? T.open : T.cancelled;
  const calls = store.calls.length
    ? `<table><thead><tr><th>${esc(T.time)}</th><th>${esc(T.endpoint)}</th><th>${esc(T.machine)}</th><th>${esc(T.result)}</th></tr></thead><tbody>`
      + store.calls.map(c => `<tr><td>${c.at}</td><td>${esc(c.endpoint)}</td><td>${esc(c.machine)}</td><td>${esc(c.result)}</td></tr>`).join('')
      + '</tbody></table>'
    : `<p class="muted">${esc(T.noCalls)}</p>`;
  return page(T, lang, T.order, `${alert}
<section class="card" id="order-card">
  <h1>${esc(T.order)}</h1>
  <dl>
    <dt>${esc(T.customer)}</dt><dd>${esc(T.customerName)}</dd>
    <dt>${esc(T.dueDate)}</dt><dd id="due">${store.due ? esc(store.due) : '—'}</dd>
    <dt>${esc(T.status)}</dt><dd><span class="badge" id="status">${esc(status)}</span>${overdue() ? `<span class="badge badge-overdue">${esc(T.overdue)}</span>` : ''}</dd>
  </dl>
  ${store.reminders ? `<p class="note" id="reminder">✉ ${esc(T.reminder)}</p>` : ''}
  <form class="inline" id="due-form" method="post" action="/orders/${ORDER}">
    <div><label for="dueDate">${esc(T.dueDate)}</label><input type="date" id="dueDate" name="due" min="${isoDay(0)}" required></div>
    <button type="submit">${esc(T.save)}</button>
  </form>
  <div class="actions">
    <a class="button secondary" id="invoice" href="/orders/${ORDER}/invoice">${esc(T.download)}</a>
    ${store.status === 'open' ? `<button type="button" class="danger" id="cancel">${esc(T.cancel)}</button>` : ''}
  </div>
</section>
<section class="card" id="api-account"><h2>${esc(T.apiAccount)}</h2><p class="muted">${esc(T.apiHint)}</p></section>
<section class="card" id="calls"><h2>${esc(T.calls)}</h2>${calls}</section>
<dialog id="cancel-dialog"><div class="modal-content">
  <p>${esc(T.confirm)}</p>
  <div class="actions"><button type="button" class="secondary" id="cancel-no">${esc(T.no)}</button>
  <form method="post" action="/orders/${ORDER}/cancel"><button type="submit" class="danger">${esc(T.yes)}</button></form></div>
</div></dialog>`);
}

function jobsPage(T, lang) {
  const last = store.job.running ? T.running : store.job.lastRun || T.never;
  return page(T, lang, T.jobs, `<section class="card"><h1>${esc(T.jobs)}</h1>
<form method="post" action="/jobs/trigger">
  <table><thead><tr><th></th><th>${esc(T.job)}</th><th>${esc(T.description)}</th><th>${esc(T.schedule)}</th><th>${esc(T.lastRun)}</th></tr></thead>
  <tbody><tr id="job-${JOB}"><td><input type="checkbox" name="job" value="${JOB}" aria-label="${JOB}"></td><td>${JOB}</td>
  <td>${esc(T.jobDescription)}</td><td>0 8 * * *</td><td class="last-run">${esc(last)}</td></tr></tbody></table>
  <div class="actions"><button type="submit" id="trigger">${esc(T.trigger)}</button></div>
</form></section>`);
}

function runJob() {
  if (store.job.running) return;
  store.job.running = true;
  const current = store;
  setTimeout(() => {
    if (current !== store) return;
    if (overdue() && store.reminders === 0) store.reminders++;
    store.job.running = false;
    store.job.lastRun = clock();
  }, JOB_SECONDS * 1000);
}

// Resolves on end, on an aborted request and on an error alike: a broken request must not hold a handler forever.
function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { if (body.length < 10000) body += c; });
    req.on('end', () => resolve(body));
    req.on('close', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}

// A page of this application only: "/orders/1001", never "//host" (another origin) or a full address.
function safeNext(value) {
  return /^\/(?!\/)[\w/-]*$/.test(value || '') ? value : null;
}

function cookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

function handler(lang) {
  const T = TEXTS[lang] || TEXTS.en;
  // A request the handler cannot parse (an address like "//[") gets 400; it must not end the walk's process.
  return (req, res) => handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Security-Policy': "default-src 'self'; form-action 'self'", ...headers });
      res.end(body);
    };
    const html = body => send(200, 'text/html; charset=utf-8', body);
    const json = (status, body) => send(status, 'application/json', JSON.stringify(body));
    const redirect = to => send(303, 'text/plain', '', { Location: to });
    const signedIn = store.sessions.has(cookie(req, 'sid'));
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /app.css') return send(200, 'text/css', CSS);
    if (route === 'GET /app.js') return send(200, 'text/javascript', JS);

    if (route === 'POST /api/login') {
      let b = {};
      try { b = JSON.parse(await readBody(req)); } catch { /* empty */ }
      const ok = b.email === API_ACCOUNT.email && b.password === API_ACCOUNT.password;
      store.calls.unshift({ at: clock(), endpoint: 'login', machine: '—', result: ok ? 'SignedIn' : 'Refused' });
      if (!ok) return json(401, { message: 'Invalid e-mail or password.' });
      const token = crypto.randomBytes(16).toString('hex');
      store.tokens.add(token);
      return json(200, { token });
    }
    if (route === 'POST /api/check') {
      const token = (/^Bearer (\w+)$/.exec(req.headers.authorization || '') || [])[1];
      if (!store.tokens.has(token)) return json(401, { message: 'Sign in first.' });
      let b = {};
      try { b = JSON.parse(await readBody(req)); } catch { /* empty */ }
      const machine = String(b.machine || '').slice(0, 40);
      const status = /^SMOKE-[A-Z]$/.test(machine) ? 'Valid' : 'UnknownMachine';
      store.calls.unshift({ at: clock(), endpoint: 'check', machine, result: status });
      return json(200, { status });
    }

    if (url.pathname === '/login') {
      const form = req.method === 'POST' ? new URLSearchParams(await readBody(req)) : null;
      if (form && form.get('user') === SIGN_IN.user && form.get('password') === SIGN_IN.password) {
        const sid = crypto.randomBytes(16).toString('hex');
        store.sessions.add(sid);
        const next = safeNext(form.get('next')) || `/orders/${ORDER}`;
        return send(303, 'text/plain', '', { Location: next, 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Lax; Path=/` });
      }
      // A failed sign-in keeps where the user was going.
      const failed = !!form;
      const next = esc(safeNext(form ? form.get('next') : url.searchParams.get('next')) || '');
      return html(page(T, lang, T.signIn, `<section class="card login"><h1>${esc(T.signIn)}</h1>
${failed ? `<div class="alert alert-error" role="alert">${esc(T.wrongSignIn)}</div>` : ''}
<form method="post" action="/login"><input type="hidden" name="next" value="${next}">
<label for="user">${esc(T.user)}</label><input id="user" name="user" autocomplete="username">
<label for="password">${esc(T.password)}</label><input id="password" name="password" type="password" autocomplete="current-password">
<button type="submit">${esc(T.signIn)}</button></form><p class="muted">${esc(T.signInHint)}</p></section>`, false));
    }

    if (!signedIn) return redirect(`/login?next=${encodeURIComponent(url.pathname)}`);

    if (route === 'GET /') return redirect(`/orders/${ORDER}`);
    if (route === `GET /orders/${ORDER}`) return html(orderPage(T, lang, url.searchParams));
    if (route === `POST /orders/${ORDER}`) {
      const due = new URLSearchParams(await readBody(req)).get('due') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < isoDay(0)) return redirect(`/orders/${ORDER}?error=1`);
      store.due = due;
      return redirect(`/orders/${ORDER}?saved=1`);
    }
    if (route === `POST /orders/${ORDER}/cancel`) { store.status = 'cancelled'; return redirect(`/orders/${ORDER}`); }
    if (route === `GET /orders/${ORDER}/invoice`) {
      return send(200, 'text/plain; charset=utf-8', `Invoice for order ${ORDER}\nDemo Customer\nDue date: ${store.due || '-'}\n`,
        { 'Content-Disposition': `attachment; filename="invoice-${ORDER}.txt"` });
    }
    if (route === 'GET /jobs') return html(jobsPage(T, lang));
    if (route === 'POST /jobs/trigger') {
      const form = new URLSearchParams(await readBody(req));
      if (form.getAll('job').includes(JOB)) runJob();
      return redirect('/jobs');
    }
    if (route === 'GET /help/orders') {
      return html(page(T, lang, T.helpTitle, `<section class="card" data-tips="/api/tips"><h1>${esc(T.helpTitle)}</h1><p id="help-due">${esc(T.helpDue)}</p></section>`));
    }
    if (route === 'GET /api/tips') return json(500, { message: 'The demo fails this call on purpose.' });
    return send(404, 'text/plain', 'Not found');
  }
}

/** Starts the demo on a free port of 127.0.0.1 with fresh data; resolves to { url, close }. */
function start({ lang = 'en', port = 0 } = {}) {
  reset();
  const server = http.createServer(handler(lang));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(done => { server.close(() => done()); if (server.closeAllConnections) server.closeAllConnections(); }),
    }));
  });
}

module.exports = { start, db, isoDay, ORDER, JOB, SIGN_IN, API_ACCOUNT };
