'use strict';
// Probing (--probe): an experienced tester's boundary and wrong values, sent through one form field in one step. The
// plan lists every value with what it expects and where that expectation comes from; the engine sends the form once
// per value and sorts what happened: crashed, not sent (the browser or the screen kept it back), refused by the
// application, saved, or unclear. The user reads the table once. This file holds what needs no browser: the plan's
// spec checked, how a value and a row read, whether a row is what the plan expected, and what a walk keeps of it.

const { plural } = require('./errors');

const EXPECTS = ['saved', 'trimmed', 'rejected', 'blocked'];
const FROMS = ['code', 'catalog', 'assumed'];
const GOTS = ['crashed', 'blocked', 'rejected', 'saved', 'unclear'];
const ICON = { crashed: '💥', blocked: '🛑', rejected: '⛔', saved: '✔', unclear: '❔' };
const FROM_ICON = { code: '🔧', catalog: '📘', assumed: '❓' };
const MAX_VALUES = 50;
const MESSAGE_MAX = 120;      // the application's message as kept: it answers the plan's own test value
const TIMEOUT_MS = 5000;      // how long one try waits for something to happen
const AFTER_ERROR_MS = 1500;  // an error answer with nothing on the screen after this long: refused without a message
const RUN = 10;               // a character repeated this often reads as "x×n"
const LABEL_MAX = 48;

const isLocator = x => !!x && typeof x === 'object' && typeof x.evaluateAll === 'function' && typeof x.click === 'function';

/**
 * The plan's spec for ctx.probe(), checked: throws naming what is wrong. Returns { field, submit, saved, message,
 * reset, timeout, values: [{ value, expect, from, label }] }.
 */
function checkSpec(spec, t) {
  if (!spec || typeof spec !== 'object') throw new Error('probe needs { field, submit, saved, message, values }.');
  const known = ['field', 'submit', 'saved', 'message', 'reset', 'timeout', 'values'];
  const unknown = Object.keys(spec).filter(k => !known.includes(k));
  if (unknown.length) throw new Error(`probe: unknown setting ${unknown.join(', ')} (known: ${known.join(', ')}).`);
  if (!isLocator(spec.field)) throw new Error('probe: field must be a locator (page.locator(…)) of the input to fill.');
  if (!isLocator(spec.submit)) throw new Error('probe: submit must be a locator of the button that sends the form.');
  if (!isLocator(spec.saved) && typeof spec.saved !== 'function') {
    throw new Error('probe: saved must be a locator that shows only after a save (a success message), or a function ctx => true when saved.');
  }
  if (spec.message != null && !isLocator(spec.message)) throw new Error('probe: message must be a locator of where the application shows why it refused.');
  if (spec.reset != null && typeof spec.reset !== 'function') throw new Error('probe: reset must be a function ctx => {} that brings the form back.');
  const timeout = spec.timeout == null ? TIMEOUT_MS : spec.timeout;
  if (!Number.isInteger(timeout) || timeout < 500 || timeout > 60000) throw new Error('probe: timeout must be a whole number of milliseconds from 500 to 60000.');
  if (!Array.isArray(spec.values) || !spec.values.length) throw new Error('probe: values must be a non-empty array of { value, expect, from }.');
  if (spec.values.length > MAX_VALUES) throw new Error(`probe: at most ${MAX_VALUES} values in one step; split the field over two steps.`);
  const values = spec.values.map((v, i) => {
    const at = `probe: values[${i}]`;
    if (!v || typeof v !== 'object') throw new Error(`${at} must be { value, expect, from }.`);
    if (typeof v.value !== 'string') throw new Error(`${at}.value must be a string (what is typed into the field).`);
    if (!EXPECTS.includes(v.expect)) throw new Error(`${at}.expect must be one of: ${EXPECTS.join(', ')}.`);
    if (!FROMS.includes(v.from)) throw new Error(`${at}.from must be one of: ${FROMS.join(', ')} (where the expectation comes from).`);
    if (v.label != null && (typeof v.label !== 'string' || !v.label.trim())) throw new Error(`${at}.label must be a non-empty string.`);
    return { value: v.value, expect: v.expect, from: v.from, label: v.label ? oneLine(v.label, LABEL_MAX) : label(v.value, t) };
  });
  return { field: spec.field, submit: spec.submit, saved: spec.saved, message: spec.message || null, reset: spec.reset || null, timeout, values };
}

/** One line of at most `max` characters. */
function oneLine(text, max) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * How a value reads in the panel and the records: "(empty)", "(only spaces ×3)", runs of one character as "x×92",
 * line breaks as ⏎, leading and trailing spaces as ␣; long values cut, with their length.
 */
function label(value, t) {
  const chars = [...value];
  if (!chars.length) return t.probeEmpty;
  if (/^\s+$/.test(value)) return t.probeSpaces.replace('{n}', chars.length);
  let out = '';
  let short = false;
  for (let i = 0; i < chars.length;) {
    let j = i;
    while (j < chars.length && chars[j] === chars[i]) j++;
    const c = chars[i] === '\n' ? '⏎' : chars[i] === '\t' ? '⇥' : chars[i];
    // A value that is one run says its length already ("x×10000").
    if (j - i >= RUN) { out += `${c}×${j - i}`; short = i > 0 || j < chars.length; } else out += c.repeat(j - i);
    i = j;
  }
  out = out.replace(/^ +/, s => '␣'.repeat(s.length)).replace(/ +$/, s => '␣'.repeat(s.length)).replace(/\r/g, '');
  const cut = [...out];
  if (cut.length > LABEL_MAX) { out = `${cut.slice(0, LABEL_MAX - 1).join('')}…`; short = true; }
  return short ? `${out} (${chars.length})` : out;
}

/** Whether a row is what the plan expected. "rejected" takes the browser's refusal too; crashed and unclear never match. */
function matches(expect, row) {
  if (expect === 'saved') return row.got === 'saved' && !row.changed;
  if (expect === 'trimmed') return row.got === 'saved' && !!row.changed;
  if (expect === 'rejected') return row.got === 'rejected' || row.got === 'blocked';
  if (expect === 'blocked') return row.got === 'blocked';
  return false;
}

/** A finished try as kept: what was expected, what happened and why; the message cut to 120 characters. */
function row(n, v, out) {
  const r = { n, value: v.label, expect: v.expect, from: v.from, got: out.got };
  if (out.why) r.why = out.why;
  if (out.status) r.status = out.status;
  if (out.waited) r.waited = out.waited;
  if (out.message) r.message = oneLine(out.message, MESSAGE_MAX);
  if (out.changed) r.changed = out.changed;
  r.ok = matches(v.expect, r);
  return r;
}

/** The step's result: every row, how many differ. */
function verdict(rows) {
  const different = rows.filter(r => !r.ok).map(r => r.n);
  return { tries: rows.length, different: different.length, differentRows: different, rows };
}

/** What happened in a try, in words: "⛔ refused", "✔ saved ✂ 5/8", "🛑 not sent (browser check)". */
function gotText(r, t) {
  const why = r.why && t.probeWhy[r.why] != null ? t.probeWhy[r.why].replace('{status}', r.status || '').replace('{s}', r.waited || '') : '';
  const changed = r.changed ? ` ${t.probeChanged.replace('{kept}', r.changed.kept).replace('{typed}', r.changed.typed)}` : '';
  const status = r.status && r.why !== 'http' && r.why !== 'server' ? ` · HTTP ${r.status}` : '';
  return `${ICON[r.got] || ''} ${t.probeGot[r.got] || r.got}${changed}${why ? ` (${why})` : ''}${status}`.trim();
}

function expectText(r, t) {
  return `${t.probeExpect[r.expect] || r.expect} ${FROM_ICON[r.from] || ''}`.trim();
}

/** The table the panel and the report show: [#, value, expected, got, message] per row, the rows that differ marked. */
function table(result, t) {
  return {
    head: t.probeHead,
    legend: t.probeLegend,
    rows: result.rows.map(r => ({ bad: !r.ok, cells: [String(r.n), r.value, expectText(r, t), gotText(r, t), r.message || ''] })),
    notes: notes(result, t),
  };
}

/** The table's footnotes: rows never sent did not test the server; an assumed expectation that differs is doubted first. */
function notes(result, t) {
  const out = [];
  if (result.rows.some(r => r.got === 'blocked')) out.push(t.probeNoteBlocked);
  if (result.rows.some(r => !r.ok && r.from === 'assumed')) out.push(t.probeNoteAssumed);
  return out;
}

/** The automatic check a probe gives: all as expected, or which rows differ. */
function check(result, t) {
  const ok = result.different === 0;
  return {
    ok,
    text: ok ? plural(result.tries, t.probeAllOk)
      : t.probeSomeDiff.replace('{d}', result.different).replace('{n}', result.tries).replace('{rows}', result.differentRows.join(', ')),
  };
}

/** A step's record for events.jsonl: the counts and the rows (labels, never the full values). */
function record(result) {
  return result ? { tries: result.tries, different: result.different, rows: result.rows.map(r => ({ ...r })) } : undefined;
}

module.exports = {
  checkSpec, label, matches, row, verdict, gotText, expectText, table, notes, check, record, oneLine,
  ICON, FROM_ICON, EXPECTS, FROMS, GOTS, MAX_VALUES, MESSAGE_MAX, TIMEOUT_MS, AFTER_ERROR_MS,
};
