'use strict';
// What the browser saw going wrong during a step that the screen does not show: uncaught script errors, console
// errors, HTTP error responses and requests that failed. Only what is safe to keep goes into the walk's records: the
// kind, the method, the path (no query, id-like parts masked), the status, the error's type and the script's place.
// Message texts are shown in the panel only. While the value box is open even that is masked.

const MASK = '•••';
const KEEP = 5;    // distinct entries kept per step in events.jsonl
const SHOW = 3;    // distinct lines shown per step in the panel
const KINDS = ['js', 'console', 'http', 'failed'];

// Chrome echoes every failed request as a console error that carries the full address (query included): the request
// itself is counted already, and the favicon's 404 only arrives this way.
const ECHO = /^Failed to load resource:/;
// A download, a page leaving and an AbortController all cancel requests on purpose.
const ABORTED = 'net::ERR_ABORTED';

/**
 * A part of a path that may carry personal data or a secret: an e-mail, an id of 6+ digits, a token or GUID (20+
 * characters that are not just words: "customer-contact-emails" and "ExternalLoginConfirmation" stay readable).
 */
function idLike(part) {
  let text = part;
  try { text = decodeURIComponent(part); } catch { /* kept as it is */ }
  return text.includes('@') || (text.match(/\d/g) || []).length >= 6
    || (text.length >= 20 && !/^[A-Za-z]+([-_.][A-Za-z]+)*$/.test(text));
}

/** An address as it may be shown and kept: path without query or fragment, id-like parts masked; host only for another origin. */
function safeUrl(raw, base) {
  let url;
  try { url = new URL(raw); } catch { return MASK; }
  if (!/^(https?|wss?):$/.test(url.protocol)) return `${url.protocol}…`;
  const pathname = url.pathname.split('/').map(p => (p && idLike(p) ? MASK : p)).join('/');
  let same = false;
  try { same = url.origin === new URL(base).origin; } catch { /* no base: show the host */ }
  return same ? pathname : `${url.host}${pathname}`;
}

/** A message for the panel: one line, addresses without their query, at most 160 characters. */
function cleanText(text) {
  const line = String(text || '').replace(/\b((?:https?|wss?):\/\/[^\s?#'"<>]+)[?#][^\s'"<>)]*/g, '$1?…').replace(/\s+/g, ' ').trim();
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/** "/app.js:12" from a script address and line; null without an address. */
function place(url, line, base) {
  if (!url) return null;
  return `${safeUrl(url, base)}${line ? `:${line}` : ''}`;
}

/** The first frame of a stack with an address in it, as a place. */
function stackPlace(stack, base) {
  const m = /\b((?:https?):\/\/[^\s()]+?):(\d+):\d+/.exec(String(stack || ''));
  return m ? place(m[1], Number(m[2]), base) : null;
}

// The four sources, from plain data (the engine passes what Playwright gives). Each returns an entry or null.
function fromConsole({ type, text, location }, base, masked) {
  if (type !== 'error' || ECHO.test(String(text || ''))) return null;
  return { kind: 'console', text: cleanText(text), at: location ? place(location.url, location.lineNumber, base) : null, masked };
}
function fromPageError(error, base, masked) {
  const e = error || {};
  return { kind: 'js', name: String(e.name || 'Error').slice(0, 60), text: cleanText(e.message), at: stackPlace(e.stack, base), masked };
}
function fromResponse({ method, url, status }, base, masked) {
  if (!(status >= 400)) return null;
  return { kind: 'http', method, url: safeUrl(url, base), status, masked };
}
function fromFailed({ method, url, errorText }, base, masked) {
  if (!errorText || errorText === ABORTED) return null;
  return { kind: 'failed', method, url: safeUrl(url, base), reason: String(errorText).slice(0, 80), masked };
}

/**
 * One line for an entry. `full` adds the message text (the panel, the box closed); without it the line holds only
 * what may be kept. A masked entry (value box open) never shows its address, place or text.
 */
function line(e, full) {
  const url = e.masked ? MASK : e.url;
  if (e.kind === 'http') return `${e.method} ${url} → ${e.status}`;
  if (e.kind === 'failed') return `${e.method} ${url} ✕ ${e.reason}`;
  const head = e.kind === 'js' ? e.name : 'console.error';
  if (e.masked) return full ? `${head}: ${MASK}` : head;
  const at = e.at ? ` (${e.at})` : '';
  return full && e.text ? `${head}: ${e.text}${at}` : `${head}${at}`;
}

/** The plan's ignoreErrors as regular expressions; a string is a pattern, case-insensitive. Throws on a bad entry. */
function compileIgnore(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error('ignoreErrors must be an array of regular expressions or pattern strings.');
  return list.map((p, i) => {
    if (p instanceof RegExp) return p;
    if (typeof p !== 'string' || !p) throw new Error(`ignoreErrors[${i}] must be a regular expression or a pattern string.`);
    try { return new RegExp(p, 'i'); } catch (e) { throw new Error(`ignoreErrors[${i}]: ${e.message}`); }
  });
}

const plural = (n, [one, many]) => (n === 1 ? one : many).replace('{n}', n);

/** "1 script error · 2 failed requests" in the panel's words (t from i18n); '' when there is nothing. */
function countsText(c, t) {
  const requests = (c.http || 0) + (c.failed || 0);
  return [[c.js, t.errJs], [c.console, t.errConsole], [requests, t.errRequests]]
    .filter(([n]) => n).map(([n, words]) => plural(n, words)).join(' · ');
}

function total(c) {
  return c ? KINDS.reduce((sum, k) => sum + (c[k] || 0), 0) : 0;
}

/** The errors of one step: counted, the first ones kept, the plan's known noise left out (but counted as ignored). */
class Bucket {
  constructor(ignore = []) {
    this.ignore = ignore;
    this.clear();
  }

  clear() {
    this.counts = { js: 0, console: 0, http: 0, failed: 0, ignored: 0 };
    this.kept = new Map();
    this.shown = new Map();
  }

  /** Adds an entry; false when it matched ignoreErrors. The match is against the panel's line with the box closed. */
  add(e) {
    const open = { ...e, masked: false };
    if (this.ignore.some(re => line(open, true).search(re) >= 0)) {
      this.counts.ignored++;
      return false;
    }
    this.counts[e.kind]++;
    const keep = line(e, false);
    if (this.kept.has(keep)) this.kept.get(keep).times++;
    else if (this.kept.size < KEEP) this.kept.set(keep, { entry: e, times: 1 });
    const show = line(e, true);
    if (this.shown.has(show)) this.shown.set(show, this.shown.get(show) + 1);
    else if (this.shown.size < SHOW) this.shown.set(show, 1);
    return true;
  }

  total() {
    return total(this.counts);
  }

  /** What the panel shows; t from i18n. */
  view(t) {
    const n = this.total();
    const listed = [...this.shown.values()].reduce((a, b) => a + b, 0);
    return {
      total: n,
      summary: n ? `⚠ ${t.errIn}${countsText(this.counts, t)}` : '',
      lines: [...this.shown].map(([text, times]) => (times > 1 ? `${text} ×${times}` : text)),
      more: n > listed ? t.errMore.replace('{n}', n - listed) : '',
      ignored: this.counts.ignored ? t.errIgnored.replace('{n}', this.counts.ignored) : '',
    };
  }

  /** The step's record (counts and the first entries, no texts), or undefined when nothing was seen; then clears. */
  take() {
    const c = this.counts;
    const out = this.total() || c.ignored ? {
      ...c,
      first: [...this.kept.values()].map(({ entry: e, times }) => {
        const r = { kind: e.kind };
        if (e.method) Object.assign(r, { method: e.method, url: e.masked ? MASK : e.url });
        if (e.status) r.status = e.status;
        if (e.reason) r.reason = e.reason;
        if (e.name) r.name = e.name;
        if (e.at && !e.masked) r.at = e.at;
        if (e.masked) r.masked = true;
        if (times > 1) r.times = times;
        return r;
      }),
    } : undefined;
    this.clear();
    return out;
  }
}

/** A kept entry (events.jsonl) as one line, for the report. */
function recordLine(r) {
  const l = line({ ...r, masked: false, url: r.url }, false);
  return r.times > 1 ? `${l} ×${r.times}` : l;
}

module.exports = { Bucket, fromConsole, fromPageError, fromResponse, fromFailed, compileIgnore, countsText, total, recordLine, safeUrl, cleanText, MASK };
