'use strict';
// doctor --base: what this machine's browser meets at an address before a walk: whether it answers and how fast, the
// certificate, a Windows sign-in, a sign-in page, the server. A headless browser with a throw-away profile meets it as
// the walk's browser would (its proxy, its certificate store, its Windows account); nothing is kept.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_LOGIN } = require('./engine');

const SETTLE_MS = 1500;
const SETTLE_MAX_MS = 8000;

const HINTS = {
  ERR_NAME_NOT_RESOLVED: 'the name does not resolve (a typo, DNS, or a VPN not connected)',
  ERR_CONNECTION_REFUSED: 'nothing listens there (the port, or the site is stopped)',
  ERR_CONNECTION_TIMED_OUT: 'no answer (a firewall, or a VPN not connected)',
  ERR_TIMED_OUT: 'no answer (a firewall, or a VPN not connected)',
  ERR_ADDRESS_UNREACHABLE: 'the address cannot be reached from this machine',
  ERR_INVALID_AUTH_CREDENTIALS: 'the site asks for a Windows sign-in the browser did not send',
};

/** One opening of the address: { status, ms, final, error, schemes, server }. */
async function open(playwright, browser, url, { trustAll = false, allowWindows = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-doctor-'));
  const context = await playwright.chromium.launchPersistentContext(dir, {
    channel: browser.channel, headless: true, ignoreHTTPSErrors: trustAll,
    args: allowWindows ? [`--auth-server-allowlist=${new URL(url).hostname}`] : [],
  });
  const schemes = new Set();
  let server = null;
  context.on('response', r => {
    if (r.request().resourceType() !== 'document') return;
    const h = r.headers();
    if (h.server) server = h.server;
    // Several WWW-Authenticate headers arrive joined by line breaks; only the scheme names are kept.
    if (r.status() === 401 && h['www-authenticate']) {
      for (const m of h['www-authenticate'].matchAll(/(?:^|[\n,]\s*)(Negotiate|NTLM|Kerberos|Basic|Bearer|Digest)\b/gi)) schemes.add(m[1]);
    }
  });
  const page = context.pages()[0] || await context.newPage();
  const started = Date.now();
  let out;
  try {
    const resp = await page.goto(url, { timeout: 20000, waitUntil: 'load' });
    out = { status: resp ? resp.status() : null, ms: Date.now() - started };
    // A single-page application sends the browser on to its sign-in page by script, after the load (often from a
    // timer, so the network can look quiet before it): the final address is read once it has stayed the same for
    // SETTLE_MS, waiting at most SETTLE_MAX_MS.
    let at = page.url();
    let since = Date.now();
    for (const end = Date.now() + SETTLE_MAX_MS; Date.now() < end && Date.now() - since < SETTLE_MS;) {
      await page.waitForTimeout(250);
      if (page.url() !== at) { at = page.url(); since = Date.now(); }
    }
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    out.final = page.url();
  } catch (e) {
    const m = /net::(ERR_[A-Z_]+)/.exec(String(e && e.message));
    out = { error: m ? m[1] : String((e && e.message) || e).split('\n')[0].slice(0, 160) };
  }
  if (out.ms == null) out.ms = Date.now() - started;
  await context.close().catch(() => {});
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the system's temp folder */ }
  return { ...out, schemes: [...schemes], server };
}

const answerText = r => (r.error ? `no answer: ${r.error}${HINTS[r.error] ? ` — ${HINTS[r.error]}` : ''}` : `${r.status} in ${r.ms} ms`);
const isWindows = r => r.error === 'ERR_INVALID_AUTH_CREDENTIALS' || r.schemes.some(s => /^(negotiate|ntlm|kerberos)$/i.test(s));

/**
 * What the browser meets at `base`: { answer, final, certificate, auth, signInPage, server, next, ok } as plain
 * sentences for the doctor's output; `ok` is false when the address gave no answer.
 */
async function checkSite({ playwright, browser, base }) {
  let r = await open(playwright, browser, base);
  let certificate = new URL(base).protocol === 'http:' ? 'none (http)' : 'trusted by this machine';
  if (r.error && /^ERR_(CERT_|SSL_|BAD_SSL)/.test(r.error)) {
    certificate = `not trusted by this machine (${r.error}); the walk accepts it anyway`;
    r = await open(playwright, browser, base, { trustAll: true });
  }
  const next = [];
  let auth = r.schemes.length ? `asks for ${r.schemes.join(', ')}` : 'none seen';
  if (isWindows(r)) {
    const names = r.schemes.filter(s => /^(negotiate|ntlm|kerberos)$/i.test(s)).join(', ') || 'Windows';
    if (!r.error && r.status < 400) {
      auth = `Windows (${names}): signs in by itself at this address`;
    } else {
      const allowed = await open(playwright, browser, base, { trustAll: true, allowWindows: true });
      if (!allowed.error && allowed.status < 400) {
        auth = `Windows (${names}): signs in with this machine's account once allowed`;
        next.push("add signIn: 'windows' to the environment (or the plan)");
        r = allowed;
      } else {
        auth = `Windows (${names}): refused even when allowed (${allowed.error || allowed.status})`;
        next.push("the server does not take this machine's account: check its Kerberos (SPN) or NTLM settings and the account's access");
      }
    }
  }
  const signInPage = !r.error && DEFAULT_LOGIN.test(new URL(r.final).pathname + new URL(r.final).search)
    ? 'the address leads to a sign-in page: the user signs in at the start of the walk' : null;
  if (r.error && !isWindows(r)) next.push('the walk cannot start here: fix the address or the network first');
  // The query of a sign-in address carries one-time values (state, nonce, a code challenge): only its presence is shown.
  const final = r.final ? (() => { const u = new URL(r.final); return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`; })() : null;
  return {
    answer: answerText(r), final, certificate, auth, signInPage, server: r.server || 'not named',
    next: next.length ? next.join('; ') : null, ok: !r.error,
  };
}

module.exports = { checkSite };
