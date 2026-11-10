'use strict';
// --network: what the network did during a step, read the way F12's Network tab would be read for you. Per step: how
// many requests, how many bytes on the wire, the slowest call, and findings — calls that are slow, repeated or large,
// and secrets or personal data the application hands out where it should not. Per walk and site: security headers,
// headers that name the server, session cookie flags, text sent uncompressed.
//
// Headers and bodies are read in memory only, and only those of the application's own addresses (the host of the
// walk's address on any port, and the plan's network.origins). What is kept says what a finding is about: method,
// path (as errors.safeUrl shows it), status, time, size and the NAMES of fields, parameters, headers and cookies —
// never a value. A request sent while the value box is drawn is counted and timed; its address, headers and body are
// never looked at.

const { safeUrl, compileIgnore, plural, MASK, ABORTED } = require('./errors');
const { format } = require('./i18n');

const SLOW_MS = 1000;         // default: a call this slow is a finding (the plan's network.slowMs)
const PANEL_SLOW = 3;         // the panel shows a slow call from 3 × slowMs on; the report shows them all
const LARGE = 1024 * 1024;    // bytes on the wire
const UNCOMPRESSED = 10 * 1024;
const JSON_MAX = 1024 * 1024; // successful JSON bodies read for field names
const ERROR_MAX = 256 * 1024; // error bodies read for details
const REPEAT = 3;             // the same call this often in one step
const KEEP = 10;              // findings kept per step in events.jsonl
const SHOW = 3;               // finding lines in the panel
const NAMES = 5;              // field or parameter names kept per finding
const SETTLE_MS = 1000;       // how long a step's record waits for bodies still being read
const PROTOCOL_MS = 2000;     // a single read from the browser

const UNTIMED = new Set(['eventsource', 'websocket']);  // open on purpose for as long as the page is
const CALLS = new Set(['fetch', 'xhr']);
// Findings that a developer machine shows on purpose (the framework's error page): on a local walk they are listed
// as expected there and not counted.
const ENV_KINDS = new Set(['error-detail']);

// ---- what is looked for ----

const norm = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

// Field names whose value is a credential or a secret wherever it appears. Matched on the name in lower case without
// separators ("password_hash" → "passwordhash"), and only when the value is a non-empty string: a flag such as
// hasPassword: true, a null and a placeholder ("********") are not leaks.
const SECRET_FIELD = /(password|passwd|passphrase|passcode|pwd)(hash|salt|digest)?$|^securitystamp$|secret(key)?$|(api|private|signing|encryption|master)key$|connectionstring$|^connstr$|^(cardnumber|creditcardnumber|creditcard|cvv2?|cvc2?)$|recoverycodes?$/;
// Tokens: a leak anywhere except in the answer of a sign-in or token endpoint, which hands them out on purpose.
const TOKEN_FIELD = /^(access|refresh|id|auth|bearer|session|api|reset|confirmation|verification|recovery|otp|twofactor)?token$|^jwt$/;
const AUTH_PATH = /log-?in|sign-?in|token|oauth|connect|auth|session|refresh|antiforgery|csrf|xsrf/i;
// Personal data a screen may need, or may not: a warning for the person who sees the screen.
const PERSONAL_FIELD = /(iban|tckn|tckimlikno|tcno|kimlikno|nationalid|identitynumber|ssn|socialsecuritynumber|passportno|passportnumber)$/;
const CARD_FIELD = /^(cardnumber|creditcardnumber|creditcard)$/;
// A translation file maps keys such as "password" to the label the screen shows: its values are never secrets. Known
// by its folder (assets/i18n/tr.json, locales/en-US.json) or by a language code as its name outside an API path. A
// configuration file the page loads (assets/config.json) is still read.
const TRANSLATION_DIR = /\/(?:i18n|l10n|locales?|langs?|languages|translations?)\//i;
const LOCALE_FILE = /\/[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?\.json$/i;
const PLACEHOLDER = /^[\s*•●xX#.-]*$/;

// Query parameters that carry a secret: an address ends up in server logs, proxies and the browser's history.
const SECRET_PARAM = /^(token|accesstoken|refreshtoken|idtoken|authtoken|sessiontoken|jwt|bearer|password|passwd|pwd|secret|clientsecret|apikey|apisecret|privatekey|sessionid)$/;

// Two or more keys of an ADO.NET-style connection string, each with a value ended by ";", or a URI with a password.
const CONN_PART = /(?<=^|[;"'\s{,])(server|data source|initial catalog|database|user id|uid|password|pwd|integrated security|trusted_connection|username|host)\s*=\s*[^;"'\r\n]+;/gi;
const CONN_URI = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|rediss?|amqps?|sqlserver|mssql):\/\/[^\s:@/'"]+:[^\s@/'"]+@/i;
const STACK = [
  /\bat [\w$.`<>[\],]+\([^)\n]*\) in [^\n]+?:line \d+/,             // .NET with symbols
  /(?:^|\n|\\n)\s*at (?:[A-Z][\w`]*\.)+[\w<>`|]+\(/,                   // .NET
  /\bat [\w$.]+\([\w$-]+\.(?:java|kt|scala|groovy):\d+\)/,            // JVM
  /(?:^|\n|\\n)\s+at [^\n(]*\((?:file:|\/|[A-Za-z]:)[^\n)]*:\d+:\d+\)/, // Node.js
  /Traceback \(most recent call last\)/,                              // Python
  /Stack trace:(?:\s|\\n)*#0 /,                                       // PHP
  /An unhandled exception occurred while processing the request|Server Error in '[^']*' Application/, // ASP.NET error pages
  /"(?:stack|stackTrace|stack_trace)"\s*:\s*"[^"]{20}/,               // a JSON error carrying its stack
];
const SQL = /SqlException|Incorrect syntax near|Invalid (?:object|column) name '|\bORA-\d{5}\b|SQLSTATE\[|\bPG::|syntax error at or near|error in your SQL syntax|SQLite error|SQLITE_ERROR|Npgsql\.|(?:Microsoft|System)\.Data\.SqlClient|Violation of (?:PRIMARY|UNIQUE) KEY|conflicted with the (?:FOREIGN KEY|REFERENCE|CHECK) constraint|Cannot insert (?:the value NULL|duplicate key)/i;

const JSONISH = /^application\/(?:[\w.+-]+\+)?json\b/i;
const TEXTUAL = /^(?:text\/|application\/(?:(?:[\w.+-]+\+)?(?:json|xml)|javascript|ecmascript)\b|image\/svg\+xml)/i;

const SESSION_COOKIE = /sess|auth|token|identity|jwt|login|remember|(?:^|[._-])sid(?:$|[._-])|^\.aspnetcore\.cookies|jsessionid/i;
const CLIENT_COOKIE = /csrf|xsrf|antiforgery/i;   // read by the page's own script on purpose
const REVEALING = { 'x-powered-by': 'X-Powered-By', 'x-aspnet-version': 'X-AspNet-Version', 'x-aspnetmvc-version': 'X-AspNetMvc-Version', 'x-sourcefiles': 'X-SourceFiles' };

/** A key as it may be kept in a field path: a plain name, else "•••" (a dictionary keyed by e-mail or id). */
const pathPart = k => (/^[A-Za-z_$][\w$-]{0,39}$/.test(k) && !/\d{3}/.test(k) ? k : MASK);

function present(value, card) {
  if (typeof value === 'string') return !PLACEHOLDER.test(value);
  if (typeof value === 'number') return card;
  if (Array.isArray(value)) return value.some(x => typeof x === 'string' && !PLACEHOLDER.test(x));
  return false;
}

/**
 * Paths of the secret and personal fields of a parsed JSON body: "$.items[].passwordHash" (array items collapse into
 * "[]"). Only names are returned. `authPath`: the body answers a sign-in or token endpoint.
 */
function sensitiveFields(body, authPath = false) {
  const secret = new Set();
  const personal = new Set();
  let budget = 100000;
  const walk = (value, at, depth) => {
    if (!value || typeof value !== 'object' || depth > 32) return;
    if (Array.isArray(value)) {
      for (const x of value) { if (--budget < 0) return; walk(x, `${at}[]`, depth + 1); }
      return;
    }
    for (const [key, x] of Object.entries(value)) {
      if (--budget < 0) return;
      const n = norm(key);
      const here = `${at}.${pathPart(key)}`;
      // A number counts only where a number is the data itself: a card number, a national id.
      if (present(x, CARD_FIELD.test(n) || PERSONAL_FIELD.test(n))) {
        if (SECRET_FIELD.test(n) || (!authPath && TOKEN_FIELD.test(n))) secret.add(here);
        else if (PERSONAL_FIELD.test(n)) personal.add(here);
      }
      walk(x, here, depth + 1);
    }
  };
  walk(body, '$', 0);
  return { secret: [...secret], personal: [...personal] };
}

/** Names of the query parameters of an address that carry a secret (with a value). */
function secretParams(raw) {
  let url;
  try { url = new URL(raw); } catch { return []; }
  const names = new Set();
  for (const [k, v] of url.searchParams) if (v && SECRET_PARAM.test(norm(k))) names.add(k.slice(0, 40));
  return [...names];
}

/** Whether an address is a translation file (its field names are labels, not data). */
function translationFile(raw) {
  let p;
  try { p = new URL(raw).pathname; } catch { return false; }
  return TRANSLATION_DIR.test(p) || (LOCALE_FILE.test(p) && !/\/api\//i.test(p));
}

/** What an error response's body gives away: part of a connection string, a stack trace, a database error. */
function errorDetails(text) {
  const keys = new Set();
  for (const m of String(text).matchAll(CONN_PART)) keys.add(m[1].toLowerCase());
  return { conn: keys.size >= 2 || CONN_URI.test(text), stack: STACK.some(re => re.test(text)), sql: SQL.test(text) };
}

/** Security headers a page answer lacks. `h`: header names in lower case → values. */
function missingHeaders(h, https) {
  const csp = h['content-security-policy'] || '';
  const missing = [];
  if (!csp) missing.push('Content-Security-Policy');
  if (!/nosniff/i.test(h['x-content-type-options'] || '')) missing.push('X-Content-Type-Options');
  if (!h['x-frame-options'] && !/frame-ancestors/i.test(csp)) missing.push('X-Frame-Options');
  if (https && !h['strict-transport-security']) missing.push('Strict-Transport-Security');
  return missing;
}

/** Headers that name the server or framework and its version (names only). */
function revealingHeaders(h) {
  const out = /\d/.test(h.server || '') ? ['Server'] : [];
  for (const [name, label] of Object.entries(REVEALING)) if (h[name]) out.push(label);
  return out;
}

/** Session cookies set without HttpOnly, or over https without Secure (names only). */
function cookieFlags(setCookies, https) {
  const noHttpOnly = [];
  const noSecure = [];
  for (const raw of setCookies) {
    const [pair, ...attrs] = String(raw).split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!pair.slice(eq + 1).trim() || !SESSION_COOKIE.test(name)) continue;
    const a = attrs.map(x => x.trim().toLowerCase());
    if (a.some(x => x === 'max-age=0' || /^expires=.*\b19\d\d\b/.test(x))) continue;   // a cookie being deleted
    const label = name.slice(0, 60);
    if (!CLIENT_COOKIE.test(name) && !a.includes('httponly')) noHttpOnly.push(label);
    if (https && !a.includes('secure')) noSecure.push(label);
  }
  return { noHttpOnly, noSecure };
}

// ---- how it reads ----

/** "512 B", "240 KB", "1.2 MB" (t from i18n gives the decimal mark). */
function size(bytes, t) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', t.decimal)} MB`;
}

/** "340 ms", "3.4 s". */
function time(ms, t) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', t.decimal)} ${t.seconds}`;
}

const ICON = { critical: '⛔', warn: '⚠' };

/** A finding as one line: the panel's, the report's (t from i18n). */
function findingLine(f, t) {
  const call = `${f.method} ${f.url}`;
  const names = (f.keys || f.params || []).join(', ');
  let text;
  if (f.kind === 'secret-field') text = format(t.netSecretField, { call, names });
  else if (f.kind === 'personal-field') text = format(t.netPersonalField, { call, names });
  else if (f.kind === 'secret-param') text = format(t.netSecretParam, { call, names });
  else if (f.kind === 'conn-string') text = format(t.netConnString, { call, status: f.status });
  else if (f.kind === 'error-detail') text = format(t.netErrorDetail, { call, status: f.status, what: f.what.map(w => (w === 'sql' ? t.netSql : t.netStack)).join(', ') });
  else if (f.kind === 'slow') text = format(t.netSlow, { call, time: time(f.ms, t) }) + (f.status ? ` → ${f.status}` : f.reason ? ` ✕ ${f.reason}` : '');
  else if (f.kind === 'repeated') text = format(t.netRepeated, { call, times: f.times });
  else if (f.kind === 'large') text = format(t.netLarge, { call, size: size(f.bytes, t) });
  else text = `${f.kind} ${call}`;
  return `${ICON[f.level] || ICON.warn} ${text}${f.kind !== 'repeated' && f.times > 1 ? ` ×${f.times}` : ''}`;
}

/** Whether a finding counts (critical or warning); one a local walk expects is listed but not counted. */
const counted = f => !f.env;

// ---- the plan's settings ----

/** The plan's `network: { slowMs, origins, ignore }`, checked; throws with what is wrong. */
function compileConfig(c) {
  if (c == null) return { slowMs: SLOW_MS, origins: [], ignore: [] };
  if (typeof c !== 'object' || Array.isArray(c)) throw new Error('network must be an object: { slowMs, origins, ignore }.');
  const unknown = Object.keys(c).filter(k => !['slowMs', 'origins', 'ignore'].includes(k));
  if (unknown.length) throw new Error(`network: unknown setting ${unknown.join(', ')} (known: slowMs, origins, ignore).`);
  const slowMs = c.slowMs == null ? SLOW_MS : c.slowMs;
  if (!Number.isInteger(slowMs) || slowMs < 100 || slowMs > 600000) throw new Error('network.slowMs must be a whole number of milliseconds from 100 to 600000.');
  if (c.origins != null && !Array.isArray(c.origins)) throw new Error("network.origins must be an array of addresses, e.g. ['https://api.example.com'].");
  const origins = (c.origins || []).map((o, i) => {
    let u = null;
    try { u = new URL(o); } catch { /* reported below */ }
    if (!u || !/^https?:$/.test(u.protocol)) throw new Error(`network.origins[${i}] must be an http(s) address, e.g. 'https://api.example.com'.`);
    return u.origin;
  });
  return { slowMs, origins, ignore: compileIgnore(c.ignore, 'network.ignore') };
}

function originOf(raw) {
  try { return new URL(raw).origin; } catch { return null; }
}

function within(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(timer));
}

// ---- one walk ----

class Network {
  /**
   * @param {object} o
   * @param {string} o.base      the walk's address
   * @param {object} o.config    compileConfig(plan.network)
   * @param {boolean} o.local    the address is this machine
   * @param {Function} [o.onChange] called when a step's numbers or findings change (the panel redraws them)
   */
  constructor({ base, config, local, onChange }) {
    this.base = base;
    this.local = !!local;
    this.slowMs = config.slowMs;
    this.ignore = config.ignore;
    this.origins = [...new Set([originOf(base), ...config.origins].filter(Boolean))];
    try { this.host = new URL(base).hostname; } catch { this.host = null; }
    this.onChange = onChange || (() => {});
    this.sites = new Map();
    this.gen = 0;
    this.clear();
  }

  /** Forgets the step so far (the sign-in, a record taken). Reads still running for it are dropped. */
  clear() {
    this.gen++;
    this.pending = new Set();
    this.step = { requests: 0, bytes: 0, slowest: null, ignored: 0, unread: 0 };
    this.calls = new Map();
    this.found = new Map();
  }

  /**
   * Starts counting "the same call" again within the step. A probe sends a form once per value, and a call made once
   * per try is not a call repeated by the screen.
   */
  restartRepeats() {
    this.calls = new Map();
  }

  /** The application's own address: the walk's host on any port, or one of the plan's network.origins. */
  own(raw) {
    try {
      const u = new URL(raw);
      return u.hostname === this.host || this.origins.includes(u.origin);
    } catch { return false; }
  }

  /** The start of handling a request: null when it is not looked at (not http, left out by the plan). */
  open(request, masked) {
    const raw = request.url();
    if (!/^https?:/i.test(raw)) return null;
    const method = request.method();
    const url = safeUrl(raw, this.base);
    if (this.ignore.some(re => `${method} ${url}`.search(re) >= 0)) {
      this.step.ignored++;
      return null;
    }
    return { request, raw, method, url, masked: !!masked, own: this.own(raw), type: request.resourceType() };
  }

  /** A request answered (any status). `masked`: the value box was drawn when it was sent or is drawn now. */
  finished(request, masked) {
    const r = this.open(request, masked);
    if (!r) return;
    r.response = typeof request.existingResponse === 'function' ? request.existingResponse() : null;
    r.status = r.response ? r.response.status() : 0;
    const timing = request.timing();
    this.count(r, timing.responseEnd >= 0 ? timing.responseEnd : null);
    if (!r.masked) {
      const params = secretParams(r.raw);
      if (params.length) this.add({ kind: 'secret-param', level: 'critical', method: r.method, url: r.url, params: params.slice(0, NAMES) });
    }
    this.onChange();
    const gen = this.gen;
    const job = this.inspect(r, () => gen === this.gen).catch(() => {}).finally(() => { this.pending.delete(job); this.onChange(); });
    this.pending.add(job);
  }

  /** A request that got no answer. A cancelled one (a download, a page leaving) is not counted. */
  failed(request, masked) {
    const reason = (request.failure() || {}).errorText;
    if (!reason || reason === ABORTED) return;
    const r = this.open(request, masked);
    if (!r) return;
    const { startTime } = request.timing();
    r.reason = String(reason).slice(0, 80);
    this.count(r, startTime > 0 ? Math.max(0, Date.now() - startTime) : null);
    this.onChange();
  }

  count(r, ms) {
    const s = this.step;
    s.requests++;
    const url = r.masked ? MASK : r.url;
    if (ms != null && !UNTIMED.has(r.type)) {
      const rounded = Math.round(ms);
      if (!s.slowest || rounded > s.slowest.ms) s.slowest = { method: r.method, url, ms: rounded };
      if (rounded >= this.slowMs) {
        this.add({ kind: 'slow', level: 'warn', method: r.method, url, ms: rounded, status: r.status >= 400 ? r.status : undefined, reason: r.reason });
      }
    }
    if (!r.masked && r.own && CALLS.has(r.type)) {
      // The same call: method and path, query left out, plain numbers taken as ids (N+1 reads one record per call).
      const path = r.url.replace(/\/\d+(?=\/|$)/g, `/${MASK}`);
      const times = (this.calls.get(`${r.method} ${path}`) || 0) + 1;
      this.calls.set(`${r.method} ${path}`, times);
      if (times >= REPEAT) this.add({ kind: 'repeated', level: 'warn', method: r.method, url: path, times });
    }
  }

  /** What needs the browser again: the size, then for the application's own answers the headers and the body. */
  async inspect(r, live) {
    let bytes = 0;
    // The browser gives -1 for a size it does not know (a redirect, an answer from the cache): that is no size.
    try { bytes = Math.max(0, (await within(r.request.sizes(), PROTOCOL_MS)).responseBodySize || 0); } catch { /* the content-length below */ }
    if (!r.response || r.masked || !r.own) {
      if (live()) this.addBytes(r, bytes);
      return;
    }
    let pairs = null;
    try { pairs = await within(r.response.headersArray(), PROTOCOL_MS); } catch { /* the headers without cookies below */ }
    const h = {};
    const setCookies = [];
    for (const { name, value } of pairs || Object.entries(r.response.headers()).map(([name, value]) => ({ name, value }))) {
      const n = name.toLowerCase();
      if (n === 'set-cookie') setCookies.push(...String(value).split('\n'));
      else h[n] = h[n] ? `${h[n]}, ${value}` : value;
    }
    if (!bytes) bytes = Number(h['content-length']) || 0;
    if (!live()) return;
    this.addBytes(r, bytes);
    this.site(r, h, setCookies, bytes);

    const type = h['content-type'] || '';
    const length = Number(h['content-length']) || 0;
    const errorBody = r.status >= 400 && TEXTUAL.test(type) && length <= ERROR_MAX;
    const fieldBody = r.status >= 200 && r.status < 300 && JSONISH.test(type) && length <= JSON_MAX && !translationFile(r.raw);
    if (!errorBody && !fieldBody) return;
    let body;
    try { body = await within(r.response.body(), PROTOCOL_MS); } catch {
      if (live()) this.step.unread++;
      return;
    }
    if (!live() || body.length > (errorBody ? ERROR_MAX : JSON_MAX)) return;
    const text = body.toString('utf8');
    if (errorBody) {
      const d = errorDetails(text);
      if (d.conn) this.add({ kind: 'conn-string', level: 'critical', method: r.method, url: r.url, status: r.status });
      const what = [...(d.stack ? ['stack'] : []), ...(d.sql ? ['sql'] : [])];
      if (what.length) this.add({ kind: 'error-detail', level: 'warn', method: r.method, url: r.url, status: r.status, what });
      return;
    }
    let json;
    try { json = JSON.parse(text); } catch { return; }
    const f = sensitiveFields(json, AUTH_PATH.test(r.url));
    if (f.secret.length) this.add({ kind: 'secret-field', level: 'critical', method: r.method, url: r.url, keys: f.secret.slice(0, NAMES) });
    if (f.personal.length) this.add({ kind: 'personal-field', level: 'warn', method: r.method, url: r.url, keys: f.personal.slice(0, NAMES) });
  }

  addBytes(r, bytes) {
    this.step.bytes += bytes;
    if (bytes >= LARGE) this.add({ kind: 'large', level: 'warn', method: r.method, url: r.masked ? MASK : r.url, bytes });
  }

  /** The walk-wide findings of one of the application's addresses. */
  site(r, h, setCookies, bytes) {
    const origin = originOf(r.raw);
    const https = origin.startsWith('https:');
    if (!this.sites.has(origin)) {
      this.sites.set(origin, { pages: 0, missing: new Map(), revealing: new Set(), noHttpOnly: new Set(), noSecure: new Set(), uncompressed: { count: 0, largest: null } });
    }
    const s = this.sites.get(origin);
    // A page the browser shows; a redirect is never drawn, so its headers protect nothing.
    if (r.type === 'document' && r.status >= 200 && r.status < 300) {
      s.pages++;
      for (const name of missingHeaders(h, https)) s.missing.set(name, (s.missing.get(name) || 0) + 1);
    }
    revealingHeaders(h).forEach(name => s.revealing.add(name));
    const c = cookieFlags(setCookies, https);
    c.noHttpOnly.forEach(name => s.noHttpOnly.add(name));
    c.noSecure.forEach(name => s.noSecure.add(name));
    if (bytes >= UNCOMPRESSED && TEXTUAL.test(h['content-type'] || '') && !h['content-encoding']) {
      s.uncompressed.count++;
      if (!s.uncompressed.largest || bytes > s.uncompressed.largest.bytes) s.uncompressed.largest = { method: r.method, url: r.url, bytes };
    }
  }

  /** Adds a finding, or merges it into the same one of this step (same kind and call). */
  add(f) {
    for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
    if (this.local && ENV_KINDS.has(f.kind)) f.env = true;
    const key = `${f.kind} ${f.method} ${f.url}`;
    const old = this.found.get(key);
    if (!old) { this.found.set(key, f); return; }
    if (f.kind === 'repeated') { old.times = f.times; return; }
    old.times = (old.times || 1) + 1;
    for (const list of ['keys', 'params', 'what']) if (f[list]) old[list] = [...new Set([...old[list], ...f[list]])].slice(0, NAMES);
    if (f.ms > old.ms) old.ms = f.ms;
    if (f.bytes > old.bytes) old.bytes = f.bytes;
  }

  findings() {
    const rank = f => (f.env ? 2 : f.level === 'critical' ? 0 : 1);
    return [...this.found.values()].sort((a, b) => rank(a) - rank(b));
  }

  /** Critical findings of this step so far: they keep --auto from going on by itself. */
  critical() {
    return [...this.found.values()].filter(f => counted(f) && f.level === 'critical').length;
  }

  inPanel(f) {
    if (!counted(f)) return false;
    if (f.level === 'critical') return true;
    if (f.kind === 'slow') return f.ms >= this.slowMs * PANEL_SLOW;
    return ['repeated', 'personal-field', 'error-detail'].includes(f.kind);
  }

  /** What the panel shows (t from i18n); null before the step's first request. */
  view(t) {
    const s = this.step;
    if (!s.requests && !this.found.size) return null;
    const parts = [plural(s.requests, t.netRequests), size(s.bytes, t)];
    if (s.slowest) parts.push(format(t.netSlowest, { call: `${s.slowest.method} ${s.slowest.url}`, time: time(s.slowest.ms, t) }));
    const strong = this.findings().filter(f => this.inPanel(f));
    return {
      summary: `${t.netIn}${parts.join(' · ')}`,
      lines: strong.slice(0, SHOW).map(f => ({ text: findingLine(f, t), level: f.level })),
      more: strong.length > SHOW ? format(t.netMore, { n: strong.length - SHOW }) : '',
      critical: this.critical(),
    };
  }

  /** The step's record, or undefined when nothing was seen; waits up to a second for bodies still being read, then clears. */
  async take() {
    if (this.pending.size) {
      let timer;
      await Promise.race([Promise.allSettled([...this.pending]), new Promise(resolve => { timer = setTimeout(resolve, SETTLE_MS); })]);
      clearTimeout(timer);
    }
    const s = this.step;
    const all = this.findings();
    const unread = s.unread + this.pending.size;
    const out = s.requests || all.length || s.ignored ? {
      requests: s.requests, bytes: s.bytes, ...(s.slowest ? { slowest: s.slowest } : {}),
      critical: all.filter(f => counted(f) && f.level === 'critical').length,
      warnings: all.filter(f => counted(f) && f.level === 'warn').length,
      findings: all.slice(0, KEEP).map(f => ({ ...f })),
      ...(all.length > KEEP ? { more: all.length - KEEP } : {}),
      ...(s.ignored ? { ignored: s.ignored } : {}),
      ...(unread ? { unread } : {}),
    } : undefined;
    this.clear();
    return out;
  }

  /** The walk's settings and site findings, for walk.json. */
  summary() {
    const sites = {};
    for (const [origin, s] of this.sites) {
      sites[origin] = {
        pages: s.pages, missing: Object.fromEntries(s.missing), revealing: [...s.revealing],
        noHttpOnly: [...s.noHttpOnly], noSecure: [...s.noSecure],
        ...(s.uncompressed.count ? { uncompressed: s.uncompressed } : {}),
      };
    }
    return { local: this.local, slowMs: this.slowMs, origins: this.origins, sites };
  }
}

/** Counted findings of a step's record (0 without one). */
function findingTotal(record) {
  return record ? (record.critical || 0) + (record.warnings || 0) : 0;
}

module.exports = {
  Network, compileConfig, sensitiveFields, secretParams, errorDetails, missingHeaders, revealingHeaders, cookieFlags, translationFile,
  findingLine, findingTotal, size, time, SLOW_MS, PANEL_SLOW,
};
