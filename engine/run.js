#!/usr/bin/env node
'use strict';
// guided-smoke engine CLI. Claude calls this; the canonical user-facing forms are described in SKILL.md.
//
//   node run.js setup [--video]                        install playwright-core into the data folder (once); --video adds ffmpeg
//   node run.js doctor                                 data folder, project, browser, runtime
//   node run.js init <plan-id> [--title T] [--work-item N] [--force]
//   node run.js run <plan|walk|work-item|file.js> [flags] [--force]
//   node run.js demo [flags]                           walk the demo plan against the built-in demo application
//   node run.js list
//   node run.js report <plan|walk|work-item>
//   node run.js reset-login [--browser chrome|edge]
//   node run.js paths
// Common: --project <name> (default: git repository folder name), --json where it makes sense.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');
const browser = require('./browser');
const report = require('./report');
const { pickLanguage, systemLocale, LANGUAGES } = require('./i18n');
const { compileIgnore } = require('./errors');

const PLAYWRIGHT_VERSION = '1.63.0';
// The floor of that playwright-core: below it, loading it ends the process with its own message.
const MIN_NODE = 20;
const VERSION = '1.1.0';

const EXIT = { ok: 0, error: 1, usage: 2, runtime: 3, resolve: 4 };

const FLAGS = {
  common: { project: 'value', json: 'bool', help: 'bool' },
  setup: { video: 'bool' },
  doctor: { browser: 'value' },
  paths: {},
  init: { title: 'value', 'work-item': 'value', force: 'bool' },
  run: {
    browser: 'value', base: 'value', pace: 'value', from: 'value', only: 'value', 'retry-failed': 'bool',
    'skip-writes': 'bool', 'allow-remote-writes': 'bool', 'work-item': 'value', fresh: 'bool', screens: 'value',
    locale: 'value', lang: 'value', 'keep-downloads': 'bool', force: 'bool', auto: 'bool', trace: 'bool', video: 'bool',
    panel: 'value',
  },
  demo: {
    browser: 'value', pace: 'value', from: 'value', only: 'value', 'retry-failed': 'bool', 'skip-writes': 'bool',
    fresh: 'bool', screens: 'value', locale: 'value', lang: 'value', 'keep-downloads': 'bool', auto: 'bool', trace: 'bool',
    video: 'bool', panel: 'value',
  },
  list: {},
  report: {},
  'reset-login': { browser: 'value' },
};

class UsageError extends Error {}

function parse(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === 'help') return { command: 'help', positional: [], flags: {} };
  if (!FLAGS[command] || command === 'common') throw new UsageError(`Unknown command "${command}".`);
  const allowed = { ...FLAGS.common, ...FLAGS[command] };
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (!(name in allowed)) throw new UsageError(`Unknown flag --${name} for "${command}".`);
    if (name in flags) throw new UsageError(`--${name} is given twice.`);
    if (allowed[name] === 'bool') { flags[name] = true; continue; }
    const value = inline !== undefined ? inline : rest[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value.`);
    flags[name] = value;
  }
  return { command, positional, flags };
}

function out(flags, data, text) {
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else console.log(text);
}

function loadPlaywright() {
  const dir = store.runtimeDir();
  try {
    return require(require.resolve('playwright-core', { paths: [dir] }));
  } catch {
    const e = new Error(`playwright-core is not installed in ${dir}. Run: node run.js setup`);
    e.exit = EXIT.runtime;
    throw e;
  }
}

function setup(flags) {
  const dir = store.runtimeDir();
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'guided-smoke-runtime', private: true }, null, 2));
  }
  // One fixed command line: npm is a .cmd on Windows and needs a shell; nothing user-supplied goes into it.
  const r = spawnSync(`npm install playwright-core@${PLAYWRIGHT_VERSION} --no-audit --no-fund`, { cwd: dir, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw Object.assign(new Error('npm install failed.'), { exit: EXIT.runtime });
  console.log(`playwright-core ${PLAYWRIGHT_VERSION} installed in ${dir}`);
  if (!flags.video) return;
  if (!browser.installFfmpeg(dir)) throw Object.assign(new Error('Installing ffmpeg failed.'), { exit: EXIT.runtime });
  console.log(`ffmpeg for --video installed in ${browser.ffmpegFolder(dir)}`);
}

// A plan kept elsewhere (a file given to run, the demo) is linked into the project's plans by a one-line pointer, not
// copied: its own relative requires keep working and there is one copy to edit.
const POINTER = /^module\.exports = require\(("(?:[^"\\]|\\.)*")\);\s*$/;
function pointerTo(file) {
  return `module.exports = require(${JSON.stringify(file)});\n`;
}

// Windows paths differ in case only between shells (C:\ and c:\); they name the same file.
function samePath(a, b) {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** Whether a stored plan already is this file: a link to it, or a copy of it left by an earlier version. */
function samePlan(stored, file) {
  if (!fs.existsSync(stored)) return true;
  const text = fs.readFileSync(stored, 'utf8');
  const m = POINTER.exec(text);
  return m ? samePath(JSON.parse(m[1]), file) : text === fs.readFileSync(file, 'utf8');
}

/** The file a stored plan really is: the target of a pointer, else the plan file itself. */
function planSource(planPath) {
  const m = POINTER.exec(fs.readFileSync(planPath, 'utf8'));
  if (!m) return planPath;
  const target = JSON.parse(m[1]);
  if (!fs.existsSync(target)) throw new UsageError(`${planPath} points at ${target}, which no longer exists. Run the file from its new place (run <file.js> --force).`);
  return target;
}

function loadPlan(file) {
  delete require.cache[require.resolve(file)];
  const plan = require(file);
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new UsageError(`${file}: "steps" must be a non-empty array.`);
  plan.steps.forEach((s, i) => {
    if (!s || !s.title) throw new UsageError(`${file}: step ${i + 1} has no title.`);
    if (typeof s.run !== 'function') throw new UsageError(`${file}: step ${i + 1} ("${s.title}") has no run function.`);
    if (s.check && typeof s.check !== 'function') throw new UsageError(`${file}: step ${i + 1} check must be a function.`);
    if (s.skipTo && !s.approve) throw new UsageError(`${file}: step ${i + 1} uses skipTo without approve.`);
  });
  try { compileIgnore(plan.ignoreErrors); } catch (e) { throw new UsageError(`${file}: ${e.message}`); }
  return plan;
}

/** --panel left|right and/or min, comma-separated: "left", "min", "left,min". Default: right, open. */
function parsePanel(value) {
  const panel = { side: 'right', min: false };
  if (value == null) return panel;
  const parts = String(value).toLowerCase().split(',').map(p => p.trim()).filter(Boolean);
  const sides = parts.filter(p => p === 'left' || p === 'right');
  if (!parts.length || sides.length > 1 || parts.some(p => !['left', 'right', 'min'].includes(p))) {
    throw new UsageError('--panel takes left or right and/or min, e.g. --panel left,min.');
  }
  if (sides.length) panel.side = sides[0];
  panel.min = parts.includes('min');
  return panel;
}

function parseNumbers(value, total, flag) {
  const set = new Set();
  for (const part of String(value).split(',')) {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!range) throw new UsageError(`--${flag}: "${part}" is not a step number or range.`);
    const a = Number(range[1]);
    const b = range[2] ? Number(range[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
      if (n < 1 || n > total) throw new UsageError(`--${flag}: step ${n} does not exist (1–${total}).`);
      set.add(n);
    }
  }
  return set;
}

function walkSummary(project, walkId) {
  const meta = store.readJson(path.join(store.walkDir(project, walkId), 'walk.json'), null);
  if (!meta) return null;
  const c = report.counts(meta, report.finalStates(store.readEvents(project, walkId)));
  return { walkId, result: meta.result, startedAt: meta.startedAt, measuredSeconds: meta.measuredSeconds, ...c };
}

function writeReport(project, planId, walkId) {
  const dir = store.walkDir(project, walkId);
  const meta = store.readJson(path.join(dir, 'walk.json'));
  if (!meta) throw new Error(`Walk ${walkId} has no walk.json.`);
  const nums = store.walkNumbers(project, planId);
  const n = Number(walkId.slice(planId.length + 1));
  const prevN = nums.filter(x => x < n).pop();
  let prev = null;
  if (prevN) {
    const prevId = `${planId}-${prevN}`;
    const prevMeta = store.readJson(path.join(store.walkDir(project, prevId), 'walk.json'));
    if (prevMeta) prev = { meta: prevMeta, events: store.readEvents(project, prevId) };
  }
  const { markdown, counts, against, errorSteps } = report.build(meta, store.readEvents(project, walkId), prev);
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, markdown);
  return { file, markdown, counts, against, errorSteps, meta };
}

async function main() {
  const { command, positional, flags } = parse(process.argv.slice(2));
  if (command === 'help' || flags.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return EXIT.ok;
  }
  if (Number(process.versions.node.split('.')[0]) < MIN_NODE) {
    console.error(`guided-smoke needs Node.js ${MIN_NODE} or newer; this is ${process.version}. Install a current LTS (22 or 24) and run again.`);
    return EXIT.runtime;
  }
  const project = flags.project ? store.safeName(flags.project) : store.detectProject();

  if (command === 'setup') { setup(flags); return EXIT.ok; }

  if (command === 'paths') {
    const root = store.dataRoot();
    out({ json: true }, { version: VERSION, root, project, plans: store.plansDir(project), walks: store.walksDir(project), runtime: store.runtimeDir() }, '');
    return EXIT.ok;
  }

  if (command === 'doctor') {
    let runtime = 'missing';
    try { loadPlaywright(); runtime = `playwright-core ${PLAYWRIGHT_VERSION}`; } catch { /* reported below */ }
    let chosen = null;
    let browserError = null;
    try { chosen = browser.choose(flags.browser); } catch (e) { browserError = e.message; }
    const data = {
      version: VERSION, node: process.version, platform: process.platform, root: store.dataRoot(), project, runtime,
      locale: systemLocale(),
      systemDefault: browser.systemDefault(), chrome: browser.installed('chrome'), edge: browser.installed('edge'),
      browser: chosen, browserError,
      video: runtime !== 'missing' && browser.videoReady(store.runtimeDir()) ? 'ready' : 'missing (node run.js setup --video)',
    };
    out(flags, data, Object.entries(data).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
    return runtime === 'missing' ? EXIT.runtime : EXIT.ok;
  }

  if (command === 'init') {
    const planId = String(positional[0] || '').toLowerCase();
    if (!store.PLAN_ID.test(planId)) throw new UsageError('init needs a plan id: lower-case letters, digits, "-", "." or "_" (e.g. 6655-machine-expiry).');
    if (/-\d+$/.test(planId) && store.listPlans(project).includes(planId.replace(/-\d+$/, ''))) {
      throw new UsageError(`"${planId}" would read as a walk of an existing plan; choose another id.`);
    }
    const file = store.planFile(project, planId);
    if (fs.existsSync(file) && !flags.force) throw new UsageError(`${file} exists; use --force to overwrite.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let template = fs.readFileSync(path.join(__dirname, '..', 'examples', 'template.steps.js'), 'utf8');
    template = template.replace("title: 'TITLE'", `title: ${JSON.stringify(flags.title || planId)}`)
      .replace("workItem: null", `workItem: ${flags['work-item'] ? JSON.stringify(String(flags['work-item'])) : 'null'}`);
    fs.writeFileSync(file, template);
    out(flags, { planId, file }, file);
    return EXIT.ok;
  }

  if (command === 'list') {
    const plans = store.listPlans(project).map(planId => ({
      planId, walks: store.walkNumbers(project, planId).map(n => walkSummary(project, `${planId}-${n}`)).filter(Boolean),
    }));
    const text = plans.length === 0 ? `No plans for project "${project}" (${store.plansDir(project)}).` : plans.map(p => [
      p.planId,
      ...(p.walks.length ? p.walks.map(w => `  ${w.walkId}  ${(w.startedAt || '').slice(0, 16).replace('T', ' ')}  ${w.result}  ✔${w.pass} ✖${w.diff} ⏭${w.skip} ○${w.none}`) : ['  (no walks yet)']),
    ].join('\n')).join('\n');
    out(flags, { project, plans }, text);
    return EXIT.ok;
  }

  if (command === 'report') {
    const ref = positional[0];
    const { planId, walkId } = store.resolve(project, ref);
    const target = walkId || store.latestWalkId(project, planId);
    if (!target) throw Object.assign(new Error(`Plan ${planId} has no walks yet.`), { exit: EXIT.resolve });
    const r = writeReport(project, planId, target);
    out(flags, { walkId: target, file: r.file, counts: r.counts }, `${r.markdown}\n\n(${r.file})`);
    return EXIT.ok;
  }

  if (command === 'reset-login') {
    const names = flags.browser ? [browser.choose(flags.browser).name] : Object.keys(browser.CHANNELS);
    const removed = [];
    for (const name of names) {
      const dir = store.profileDir(project, name);
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
    }
    out(flags, { removed }, removed.length ? `Removed:\n${removed.join('\n')}` : 'No saved sign-in for this project.');
    return EXIT.ok;
  }

  if (command === 'demo') {
    if (positional.length) throw new UsageError('demo takes no plan: it walks the built-in demo plan.');
    if (flags.lang && !LANGUAGES.includes(flags.lang)) throw new UsageError(`--lang must be one of: ${LANGUAGES.join(', ')}.`);
    // The demo application and its plan speak the panel's language.
    const lang = pickLanguage(flags.lang);
    process.env.GUIDED_SMOKE_LANG = lang;
    const demoProject = flags.project ? project : 'guided-smoke-demo';
    const planPath = path.join(__dirname, '..', 'examples', 'demo', 'steps.js');
    // A pointer in the data folder, so that list and report find the demo plan like any other. In a project of the
    // user's (--project), a plan of their own named "demo" is never replaced.
    const pointer = store.planFile(demoProject, 'demo');
    if (flags.project && !samePlan(pointer, planPath)) {
      throw new UsageError(`Project ${demoProject} already has a plan named "demo" (${pointer}). Leave out --project to use the demo's own project.`);
    }
    fs.mkdirSync(path.dirname(pointer), { recursive: true });
    fs.writeFileSync(pointer, pointerTo(planPath));
    const server = require('../examples/demo/server');
    const app = await server.start({ lang });
    try {
      return await runWalk({ project: demoProject, planId: 'demo', planPath, flags: { ...flags, base: app.url, lang } });
    } finally {
      await app.close();
    }
  }

  // ---- run ----
  const ref = positional[0];
  if (!ref) throw new UsageError('run needs a plan, walk, work item or steps file.');
  if (positional.length > 1) throw new UsageError('run takes one plan reference.');
  let planId;
  let sourceWalk = null;
  const asFile = /\.c?js$/i.test(ref) && fs.existsSync(path.resolve(ref));
  if (asFile) {
    const file = path.resolve(ref);
    const plan = loadPlan(file);
    // A plan's id is its own "id", else the folder of a steps.js, else the file name without ".steps.js".
    const fromName = path.basename(file).toLowerCase() === 'steps.js'
      ? path.basename(path.dirname(file))
      : path.basename(file).replace(/(\.steps)?\.c?js$/i, '');
    planId = String(plan.id || fromName).toLowerCase();
    if (!store.PLAN_ID.test(planId)) throw new UsageError(`Cannot derive a plan id from ${file}; add id: '...' to the module.`);
    // A different plan already stored under this id is replaced only with --force.
    const target = store.planFile(project, planId);
    if (!samePath(target, file)) {
      if (!samePlan(target, file) && !flags.force) {
        throw new UsageError(`Plan ${planId} already exists in this project (${target}). Give the module another id, or use --force to replace it with a link to ${file}.`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, pointerTo(file));
    }
  } else {
    const r = store.resolve(project, ref);
    planId = r.planId;
    sourceWalk = r.walkId;
  }
  return runWalk({ project, planId, planPath: store.planFile(project, planId), flags, sourceWalk });
}

/** One walk of a plan: checks the flags, opens the browser, writes the report. */
async function runWalk({ project, planId, planPath, flags, sourceWalk = null }) {
  const source = planSource(planPath);
  const plan = loadPlan(source);
  const total = plan.steps.length;

  const filters = ['from', 'only', 'retry-failed'].filter(f => flags[f]);
  if (filters.length > 1) throw new UsageError(`Use only one of --from, --only, --retry-failed (got ${filters.map(f => '--' + f).join(', ')}).`);
  let allowed = null;
  let filterNote = null;
  if (flags.from) {
    const from = Number(flags.from);
    if (!Number.isInteger(from) || from < 1 || from > total) throw new UsageError(`--from must be a step number 1–${total}.`);
    allowed = new Set(Array.from({ length: total - from + 1 }, (_, i) => from + i));
    filterNote = `--from ${from}`;
  } else if (flags.only) {
    allowed = parseNumbers(flags.only, total, 'only');
    filterNote = `--only ${[...allowed].join(',')}`;
  } else if (flags['retry-failed']) {
    const src = sourceWalk || store.latestWalkId(project, planId);
    if (!src) throw Object.assign(new Error(`Plan ${planId} has no walk to retry.`), { exit: EXIT.resolve });
    const failed = [...report.finalStates(store.readEvents(project, src)).values()].filter(e => e.answer === 'diff').map(e => e.n);
    if (failed.length === 0) { console.log(`Walk ${src} has no steps marked different; nothing to retry.`); return EXIT.ok; }
    allowed = new Set(failed);
    filterNote = `--retry-failed ${src}: ${failed.join(',')}`;
  }

  if (flags.pace && !['slow', 'normal', 'fast'].includes(flags.pace)) throw new UsageError('--pace must be slow, normal or fast.');
  if (flags.screens && !['diff', 'all'].includes(flags.screens)) throw new UsageError('--screens must be diff or all (leave it out for none).');
  if (flags.lang && !LANGUAGES.includes(flags.lang)) throw new UsageError(`--lang must be one of: ${LANGUAGES.join(', ')}.`);
  if (flags.locale && !/^[a-z]{2}(-[A-Z]{2})?$/.test(flags.locale)) throw new UsageError('--locale looks like tr-TR or en-US.');
  const panel = parsePanel(flags.panel);
  const base = flags.base || plan.base;
  if (!base) throw new UsageError('No address: pass --base https://host:port or set base in the plan.');
  try { new URL(base); } catch { throw new UsageError(`--base "${base}" is not a URL.`); }

  const chosen = browser.choose(flags.browser);
  const playwright = loadPlaywright();
  if (flags.video && !browser.videoReady(store.runtimeDir())) {
    throw Object.assign(new Error("--video needs Playwright's ffmpeg (about 4 MB, from Playwright's download servers). Install it once: node run.js setup --video"), { exit: EXIT.runtime });
  }

  const walkId = store.nextWalkId(project, planId);
  const walkDir = store.walkDir(project, walkId);
  fs.mkdirSync(walkDir, { recursive: true });
  fs.copyFileSync(source, path.join(walkDir, 'steps.snapshot.js'));
  console.log(`walk ${walkId} · ${chosen.name} (${chosen.source}) · ${base}${filterNote ? ' · ' + filterNote : ''}`);

  const { walk } = require('./engine');
  try {
    await walk({
      plan, planId, walkId, project, walkDir, playwright, profile: store.profileDir(project, chosen.name),
      options: {
        browser: chosen, base, pace: flags.pace || 'slow', allowed, filterNote, skipWrites: !!flags['skip-writes'],
        allowRemoteWrites: !!flags['allow-remote-writes'], workItem: flags['work-item'] || plan.workItem || null,
        fresh: !!flags.fresh, screens: flags.screens || null, locale: flags.locale || plan.locale || systemLocale(),
        lang: pickLanguage(flags.lang || plan.lang), keepDownloads: !!flags['keep-downloads'],
        auto: !!flags.auto, trace: !!flags.trace, video: !!flags.video, panel,
      },
    });
  } catch (e) {
    if (/user data directory is already in use|ProcessSingleton/i.test(String(e && e.message))) {
      e.message = `The smoke profile is already open in another browser window. Close that window and run again. (${e.message.split('\n')[0]})`;
    }
    const r = (() => { try { return writeReport(project, planId, walkId); } catch { return null; } })();
    if (r) console.log(`report: ${r.file}`);
    throw e;
  }
  const r = writeReport(project, planId, walkId);
  console.log(`report: ${r.file}`);
  console.log(`result: ${r.meta.result} · ✔${r.counts.pass} ✖${r.counts.diff} ⏭${r.counts.skip} ○${r.counts.none}${r.against.length ? ` · ⚠ passed over a failed check: ${r.against.join(', ')}` : ''}${r.errorSteps.length ? ` · ⚠ browser errors in steps: ${r.errorSteps.join(', ')}` : ''}`);
  return EXIT.ok;
}

main().then(code => { process.exitCode = code; }).catch(e => {
  if (e instanceof store.ResolveError) {
    console.error(e.message + (e.candidates.length ? `\nAvailable: ${e.candidates.join(', ')}` : ''));
    process.exitCode = EXIT.resolve;
  } else if (e instanceof UsageError) {
    console.error(e.message);
    process.exitCode = EXIT.usage;
  } else {
    console.error(e && e.message ? e.message : String(e));
    process.exitCode = e && e.exit ? e.exit : EXIT.error;
  }
});
