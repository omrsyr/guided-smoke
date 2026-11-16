'use strict';
// A suite: the plans of one folder walked one after another in one go, each as a walk of its own, and one report over
// them all.
//
//   <folder>/<name>.steps.js      a plan
//   <folder>/<name>/steps.js      a plan in a folder of its own, next to the files it requires
//
// Anything else there (a shared envs.js, helpers, deeper folders) is not a plan. The plans run in the order of those
// names, a number in a name counting as a number (2 before 10), so a prefix orders them: 01-sign-in, 02-orders.
//
// The suite's record (suite.json) says which plans it held, the walk each became and how that walk ended; the answers
// stay in the walks. report.md is built from that record and the walks' own.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const report = require('./report');

const ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const PLAN_FILE = /\.steps\.c?js$/i;

const LABELS = {
  en: {
    title: 'Smoke suite report', suite: 'Suite', planCount: ['{n} plan', '{n} plans'], env: 'Environment', date: 'Date',
    measured: 'Measured walk time', measuredNote: 'the walks added up; sign-in waits excluded; your own extra checking is not included',
    base: 'Address', app: 'Application version', with: 'Walked with', result: 'Result',
    results: { completed: 'completed', stopped: 'stopped by the user', running: 'still running or interrupted' },
    summary: 'Summary', walked: '{walked} of {total} plans walked', pass: 'passed', diff: 'different', skip: 'skipped', none: 'not run',
    stoppedIn: '■ Stopped by the user in {plan}.', stoppedAfter: '■ Stopped by the user after {plan}.', notWalked: '○ Not walked: {plans}.',
    errored: '⚠ Ended with an error: {plans}.',
    undoLeft: '⚠ Changes not put back: {plans}. They are still in place; see that walk\'s report.',
    plans: 'Plans', plan: 'Plan', walk: 'Walk', time: 'Time', notes: 'Notes',
    states: { completed: 'completed', stopped: 'stopped by the user', error: 'ended with an error', running: 'still running or interrupted', none: 'not walked' },
    noteAgainst: '⚠ passed over a failed check: {steps}', noteErrors: '⚠ browser errors in steps: {steps}',
    noteNetwork: '🌐 network findings in steps: {steps}', noteProbe: '🧪 probe rows different in steps: {steps}',
    noteUndo: '⚠ not put back (undo): steps {steps}', stepsOf: 'steps {steps}',
    different: 'Different (✖)', paste: 'To paste',
    pasteTitle: 'Smoke suite {name} ({date}, {walked}/{total} plans; guided-smoke {suite})',
    pasteTitleEnv: 'Smoke suite {name} on {env} ({date}, {walked}/{total} plans; guided-smoke {suite})',
  },
  tr: {
    title: 'Smoke suite raporu', suite: 'Suite', planCount: ['{n} plan', '{n} plan'], env: 'Ortam', date: 'Tarih',
    measured: 'Ölçülen koşu süresi', measuredNote: 'koşuların toplamı; giriş beklemeleri hariç; senin ek incelemen dahil değil',
    base: 'Adres', app: 'Uygulama sürümü', with: 'Bayraklar', result: 'Sonuç',
    results: { completed: 'tamamlandı', stopped: 'kullanıcı durdurdu', running: 'sürüyor ya da yarıda kesildi' },
    summary: 'Özet', walked: '{total} plandan {walked} tanesi koşuldu', pass: 'geçti', diff: 'farklı', skip: 'atlandı', none: 'koşulmadı',
    stoppedIn: '■ Kullanıcı {plan} planında durdurdu.', stoppedAfter: '■ Kullanıcı {plan} planından sonra durdurdu.', notWalked: '○ Koşulmayan planlar: {plans}.',
    errored: '⚠ Hatayla biten planlar: {plans}.',
    undoLeft: '⚠ Geri alınmayan değişiklikler: {plans}. Yerinde duruyorlar; o koşunun raporuna bak.',
    plans: 'Planlar', plan: 'Plan', walk: 'Koşu', time: 'Süre', notes: 'Notlar',
    states: { completed: 'tamamlandı', stopped: 'kullanıcı durdurdu', error: 'hatayla bitti', running: 'sürüyor ya da yarıda kesildi', none: 'koşulmadı' },
    noteAgainst: '⚠ otomatik kontrol ✖ iken ✔ alan adımlar: {steps}', noteErrors: '⚠ tarayıcı hatası olan adımlar: {steps}',
    noteNetwork: '🌐 ağ bulgusu olan adımlar: {steps}', noteProbe: '🧪 patlatmada farklı satırı olan adımlar: {steps}',
    noteUndo: '⚠ geri alınmayan adımlar: {steps}', stepsOf: 'adım {steps}',
    different: 'Farklı (✖)', paste: 'Yapıştırmak için',
    pasteTitle: 'Smoke suite {name} ({date}, {walked}/{total} plan; guided-smoke {suite})',
    pasteTitleEnv: 'Smoke suite {name}, {env} ortamı ({date}, {walked}/{total} plan; guided-smoke {suite})',
  },
};

const ICON = { pass: '✔', diff: '✖', skip: '⏭', stop: '■', none: '○' };

/** The plans of a folder as { name, file }, in the order they are walked. */
function discover(folder) {
  const found = [];
  for (const d of fs.readdirSync(folder, { withFileTypes: true })) {
    if (d.isDirectory()) {
      const file = path.join(folder, d.name, 'steps.js');
      if (fs.existsSync(file)) found.push({ name: d.name, file });
    } else if (PLAN_FILE.test(d.name)) {
      found.push({ name: d.name.replace(PLAN_FILE, ''), file: path.join(folder, d.name) });
    }
  }
  return found.sort((a, b) => ORDER.compare(a.name, b.name));
}

/** A suite is named after its folder. */
function nameOf(folder) {
  return store.safeName(path.basename(path.resolve(folder))).toLowerCase();
}

const firstLine = e => String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300);

/**
 * Starts a suite's record in the data folder. `plans`: [{ name, planId, title }] in walking order. Returns the record
 * and `save`, which writes it down again after every change.
 */
function begin({ project, folder, env, lang, flags, plans, root }) {
  const name = nameOf(folder);
  const suiteId = store.nextSuiteId(project, name, root);
  const dir = store.suiteDir(project, suiteId, root);
  fs.mkdirSync(dir, { recursive: true });
  const suite = {
    suiteId, name, project, env: env || null, lang, with: flags || null, startedAt: new Date().toISOString(), endedAt: null,
    result: 'running', plans: plans.map(p => ({ name: p.name, planId: p.planId, title: p.title, walkId: null, result: null })),
  };
  const save = () => fs.writeFileSync(path.join(dir, 'suite.json'), JSON.stringify(suite, null, 2));
  save();
  return { suite, save, dir };
}

/**
 * Walks the suite's plans in order. `walkOne(plan, at)` walks one: `at` is { id, index, total, next } (next: the title
 * of the plan after it, or null) with `at.started(walkId)`, to be called once the walk has its id. It resolves to
 * { walkId, result, stopSuite } or throws (with `walkId` on the error when the walk had started).
 *
 * A walk the user stopped (■ Stop, the window closed, Stop on the screen between two plans) ends the suite: the plans
 * after it stay "not walked". A walk that ends with an error ends only itself; the next plan is walked.
 */
async function runAll({ suite, save, walkOne, onError = () => {} }) {
  const total = suite.plans.length;
  for (let i = 0; i < total; i++) {
    const p = suite.plans[i];
    const next = suite.plans[i + 1];
    const at = {
      id: suite.suiteId, index: i + 1, total, next: next ? next.title : null,
      started: walkId => { p.walkId = walkId; p.result = 'running'; save(); },
    };
    let stop = false;
    try {
      const r = await walkOne(p, at);
      p.walkId = r.walkId || p.walkId;
      p.result = r.result;
      stop = r.result === 'stopped' || !!r.stopSuite;
    } catch (e) {
      p.walkId = (e && e.walkId) || p.walkId;
      p.result = 'error';
      p.error = firstLine(e);
      onError(p, e);
    }
    save();
    if (stop) { suite.result = 'stopped'; break; }
  }
  if (suite.result !== 'stopped') suite.result = 'completed';
  suite.endedAt = new Date().toISOString();
  save();
  return suite;
}

/**
 * report.md of a suite: a row per plan with its walk, what stopped it or went wrong, every ✖ with its note, and a block
 * to paste.
 * @param {object} suite    suite.json
 * @param {Function} walkOf walkId => { meta, events } (that walk's walk.json and events.jsonl), or null
 */
function build(suite, walkOf) {
  const lang = LABELS[suite.lang] ? suite.lang : 'en';
  const L = LABELS[lang];
  const { cell, oneLine, localTime, duration } = report;
  const rows = suite.plans.map(p => {
    const w = p.walkId ? walkOf(p.walkId) : null;
    // A plan's state: how its walk ended, "running" for one cut off, "none" for a plan never reached.
    const state = p.result || 'none';
    if (!w || !w.meta) return { p, state, r: null, diffs: [] };
    const r = report.build(w.meta, w.events, null);
    const diffs = [...report.finalStates(w.events).values()].filter(e => e.answer === 'diff').sort((a, b) => a.n - b.n);
    return { p, state, meta: w.meta, r, diffs };
  });
  const icon = row => ({ none: ICON.none, running: ICON.none, error: ICON.diff, stopped: ICON.stop })[row.state] || (row.r && row.r.counts.diff ? ICON.diff : ICON.pass);
  const counts = { pass: 0, diff: 0, skip: 0, none: 0 };
  let seconds = null;
  for (const row of rows.filter(x => x.r)) {
    for (const k of Object.keys(counts)) counts[k] += row.r.counts[k];
    if (row.meta.measuredSeconds != null) seconds = (seconds || 0) + row.meta.measuredSeconds;
  }
  const total = rows.length;
  const walked = rows.filter(x => x.p.walkId).length;
  const errors = rows.filter(x => x.state === 'error').map(x => x.p.planId);
  const notWalked = rows.filter(x => x.state === 'none').map(x => x.p.planId);
  const undoLeft = rows.filter(x => x.r && x.r.undoLeft.length);
  const distinct = values => [...new Set(values.filter(Boolean))];
  const start = localTime(suite.startedAt);
  const end = localTime(suite.endedAt);
  const lines = [];

  lines.push(`# ${L.title} — ${suite.suiteId}`, '');
  lines.push(`- **${L.suite}:** ${suite.name} — ${(total === 1 ? L.planCount[0] : L.planCount[1]).replace('{n}', total)}`);
  if (suite.env) lines.push(`- **${L.env}:** ${suite.env}`);
  lines.push(`- **${L.date}:** ${start.day} ${start.time}${end ? '–' + end.time : ''}`);
  lines.push(`- **${L.measured}:** ${duration(seconds, lang)} (${L.measuredNote})`);
  const bases = distinct(rows.map(x => x.meta && x.meta.base));
  if (bases.length) lines.push(`- **${L.base}:** ${bases.join(' · ')}`);
  const versions = distinct(rows.map(x => x.meta && x.meta.appVersion));
  if (versions.length) lines.push(`- **${L.app}:** ${versions.join(' · ')}`);
  if (suite.with) lines.push(`- **${L.with}:** \`${String(suite.with).replace(/`/g, "'")}\``);
  lines.push(`- **${L.result}:** ${L.results[suite.result] || suite.result}`);

  lines.push('', `## ${L.summary}`, '');
  lines.push(`${L.walked.replace('{walked}', walked).replace('{total}', total)} · ${ICON.pass} ${counts.pass} ${L.pass} · ${ICON.diff} ${counts.diff} ${L.diff} · ${ICON.skip} ${counts.skip} ${L.skip} · ${ICON.none} ${counts.none} ${L.none}`);
  if (suite.result === 'stopped') {
    const last = rows.filter(x => x.state !== 'none').pop();
    if (last) lines.push('', (last.state === 'stopped' ? L.stoppedIn : L.stoppedAfter).replace('{plan}', last.p.planId));
  }
  if (notWalked.length) lines.push('', L.notWalked.replace('{plans}', notWalked.join(', ')));
  if (errors.length) lines.push('', L.errored.replace('{plans}', errors.join(', ')));
  if (undoLeft.length) {
    lines.push('', L.undoLeft.replace('{plans}', undoLeft.map(x => `${x.p.planId} (${L.stepsOf.replace('{steps}', x.r.undoLeft.join(', '))})`).join(', ')));
  }

  lines.push('', `## ${L.plans}`, '');
  lines.push(`| # | ${L.plan} | ${L.walk} | ${L.result} | ${ICON.pass} | ${ICON.diff} | ${ICON.skip} | ${ICON.none} | ${L.time} | ${L.notes} |`);
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach((row, i) => {
    const { p, r } = row;
    const name = `${p.planId}${p.title && p.title !== p.planId ? ` — ${p.title}` : ''}`;
    // The walk's own report sits two folders up, under walks/.
    const walk = p.walkId ? `[${p.walkId}](../../walks/${p.walkId}/report.md)` : '—';
    const steps = list => list.join(', ');
    const notes = [
      p.error,
      r && r.against.length ? L.noteAgainst.replace('{steps}', steps(r.against)) : null,
      r && r.errorSteps.length ? L.noteErrors.replace('{steps}', steps(r.errorSteps)) : null,
      r && r.networkSteps.length ? L.noteNetwork.replace('{steps}', steps(r.networkSteps)) : null,
      r && r.probeSteps.length ? L.noteProbe.replace('{steps}', steps(r.probeSteps)) : null,
      r && r.undoLeft.length ? L.noteUndo.replace('{steps}', steps(r.undoLeft)) : null,
    ].filter(Boolean).join(' · ');
    const c = r ? r.counts : null;
    lines.push(`| ${i + 1} | ${cell(name)} | ${walk} | ${icon(row)} ${L.states[row.state] || row.state} | ${c ? c.pass : ''} | ${c ? c.diff : ''} | ${c ? c.skip : ''} | ${c ? c.none : ''} | ${row.meta ? duration(row.meta.measuredSeconds, lang) : ''} | ${cell(notes)} |`);
  });

  const different = rows.filter(x => x.diffs.length);
  if (different.length) {
    lines.push('', `## ${L.different}`, '');
    for (const row of different) {
      for (const e of row.diffs) lines.push(`- **${row.p.planId}** · ${e.n}. ${cell(e.title)}${e.note ? ` — ${cell(oneLine(e.note))}` : ''}`);
    }
  }

  lines.push('', `## ${L.paste}`, '', '```text');
  lines.push((suite.env ? L.pasteTitleEnv.replace('{env}', suite.env) : L.pasteTitle).replace('{name}', suite.name).replace('{date}', start.day)
    .replace('{walked}', walked).replace('{total}', total).replace('{suite}', suite.suiteId));
  for (const row of rows) {
    const { p, r } = row;
    const ran = r ? `${r.counts.pass}/${r.counts.pass + r.counts.diff}` : null;
    const how = row.state === 'completed' ? ran : [L.states[row.state] || row.state, ran].filter(Boolean).join(', ');
    lines.push(`${icon(row)} ${p.planId}: ${how}${p.walkId ? ` (${p.walkId})` : ''}${p.error ? ` — ${oneLine(p.error)}` : ''}`);
    for (const e of row.diffs) lines.push(`   ${ICON.diff} ${e.n}. ${e.title}${e.note ? ` — ${oneLine(e.note)}` : ''}`);
  }
  lines.push(`${L.measured}: ${duration(seconds, lang)}`);
  lines.push('```', '');

  return { markdown: lines.join('\n'), counts, walked, total, errors, notWalked, undoLeft: undoLeft.map(x => x.p.planId) };
}

/** Builds and writes a suite's report.md from its record and its walks' records. */
function writeReport(project, suiteId, root) {
  const dir = store.suiteDir(project, suiteId, root);
  const suite = store.readJson(path.join(dir, 'suite.json'));
  if (!suite) throw new Error(`Suite ${suiteId} has no suite.json.`);
  const r = build(suite, walkId => {
    const meta = store.readJson(path.join(store.walkDir(project, walkId, root), 'walk.json'));
    return meta ? { meta, events: store.readEvents(project, walkId, root) } : null;
  });
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, r.markdown);
  return { file, suite, ...r };
}

module.exports = { discover, nameOf, begin, runAll, build, writeReport };
