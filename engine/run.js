#!/usr/bin/env node
'use strict';
// guided-smoke engine CLI. Claude calls this; the canonical user-facing forms are described in SKILL.md.
//
//   node run.js setup [--video]                        install playwright-core into the data folder (once); --video adds ffmpeg
//   node run.js doctor [--base <url>]                  data folder, project, browser, runtime; --base: what the browser meets there
//   node run.js init <plan-id> [--title T] [--work-item N] [--force]
//   node run.js run <plan|walk|work-item|file.js> [--env <name>] [flags] [--force]
//   node run.js run <folder> [--env <name>] [flags]    walk every plan of the folder, one after another (a suite)
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
const { compileConfig } = require('./network');
const { checkEnvs, pickEnv } = require('./envs');
const suites = require('./suite');

const PLAYWRIGHT_VERSION = '1.63.0';
// The floor of that playwright-core: below it, loading it ends the process with its own message.
const MIN_NODE = 20;
const VERSION = '1.5.0';

const EXIT = { ok: 0, error: 1, usage: 2, runtime: 3, resolve: 4 };
// How far back a report looks for the walk in which a step was last answered.
const EARLIER_WALKS = 20;

const FLAGS = {
  common: { project: 'value', json: 'bool', help: 'bool' },
  setup: { video: 'bool' },
  doctor: { browser: 'value', base: 'value' },
  paths: {},
  init: { title: 'value', 'work-item': 'value', force: 'bool' },
  run: {
    browser: 'value', base: 'value', pace: 'value', from: 'value', only: 'value', 'retry-failed': 'bool',
    'skip-writes': 'bool', 'allow-remote-writes': 'bool', 'work-item': 'value', fresh: 'bool', screens: 'value',
    locale: 'value', lang: 'value', 'keep-downloads': 'bool', force: 'bool', auto: 'bool', trace: 'bool', video: 'bool',
    panel: 'value', network: 'bool', probe: 'bool', env: 'value',
  },
  demo: {
    browser: 'value', pace: 'value', from: 'value', only: 'value', 'retry-failed': 'bool', 'skip-writes': 'bool',
    fresh: 'bool', screens: 'value', locale: 'value', lang: 'value', 'keep-downloads': 'bool', auto: 'bool', trace: 'bool',
    video: 'bool', panel: 'value', network: 'bool', probe: 'bool',
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

/** A plan file's id: its own "id", else the folder of a steps.js, else the file name without ".steps.js". */
function planIdOf(file, plan) {
  const fromName = path.basename(file).toLowerCase() === 'steps.js'
    ? path.basename(path.dirname(file))
    : path.basename(file).replace(/(\.steps)?\.c?js$/i, '');
  const planId = String(plan.id || fromName).toLowerCase();
  if (!store.PLAN_ID.test(planId)) throw new UsageError(`Cannot derive a plan id from ${file}; add id: '...' to the module.`);
  return planId;
}

/** The project's stored plan with this id when it is another plan than the file, else null. */
function otherPlan(project, planId, file) {
  const target = store.planFile(project, planId);
  return !samePath(target, file) && !samePlan(target, file) ? target : null;
}

/** Links a plan file into the project's plans, so that list, report and a later run find it by its id. */
function linkPlan(project, planId, file) {
  const target = store.planFile(project, planId);
  if (samePath(target, file)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, pointerTo(file));
}

// What a step may say. Anything else is a mistake the engine would otherwise pass over in silence (a skipIf that never
// skips), so it is refused like an unknown flag.
const STEP_KEYS = ['title', 'did', 'expect', 'run', 'check', 'approve', 'skipTo', 'probe', 'undo', 'db'];

function loadPlan(file) {
  delete require.cache[require.resolve(file)];
  const plan = require(file);
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new UsageError(`${file}: "steps" must be a non-empty array.`);
  plan.steps.forEach((s, i) => {
    if (!s || !s.title) throw new UsageError(`${file}: step ${i + 1} has no title.`);
    const unknown = Object.keys(s).filter(k => !STEP_KEYS.includes(k));
    if (unknown.length) {
      throw new UsageError(`${file}: step ${i + 1} ("${s.title}") has ${unknown.length > 1 ? 'unknown keys' : 'an unknown key'} ${unknown.map(k => `"${k}"`).join(', ')}. A step knows: ${STEP_KEYS.join(', ')}.`);
    }
    if (typeof s.run !== 'function') throw new UsageError(`${file}: step ${i + 1} ("${s.title}") has no run function.`);
    if (s.check && typeof s.check !== 'function') throw new UsageError(`${file}: step ${i + 1} check must be a function.`);
    if (s.probe !== undefined && typeof s.probe !== 'boolean') throw new UsageError(`${file}: step ${i + 1} probe must be true or false.`);
    if (s.db !== undefined && typeof s.db !== 'boolean') throw new UsageError(`${file}: step ${i + 1} db must be true or false.`);
    if (s.skipTo && !s.approve && !s.probe) throw new UsageError(`${file}: step ${i + 1} uses skipTo without approve.`);
    if (s.undo !== undefined) {
      if (!s.approve && !s.probe) throw new UsageError(`${file}: step ${i + 1} ("${s.title}") has an undo but asks no permission: undo belongs to a permitted step (approve).`);
      const u = s.undo;
      const shape = u && typeof u === 'object' && typeof u.what === 'string' && u.what.trim() && typeof u.run === 'function'
        && Object.keys(u).every(k => k === 'what' || k === 'run');
      if (!shape) throw new UsageError(`${file}: step ${i + 1} undo must be { what: 'what it puts back', run: async ctx => { … } }.`);
    }
  });
  try { compileIgnore(plan.ignoreErrors); compileConfig(plan.network); } catch (e) { throw new UsageError(`${file}: ${e.message}`); }
  const envError = checkEnvs(plan);
  if (envError) throw new UsageError(`${file}: ${envError}`);
  if (plan.appVersion !== undefined && typeof plan.appVersion !== 'function') throw new UsageError(`${file}: appVersion must be a function, such as async ({ page }) => page.locator('#version').textContent().`);
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
  return { walkId, env: meta.env || null, result: meta.result, startedAt: meta.startedAt, measuredSeconds: meta.measuredSeconds, ...c };
}

/** The newest walk of a plan in an environment (null: the plan's own), or null. */
function latestWalkIn(project, planId, env) {
  for (const n of store.walkNumbers(project, planId).reverse()) {
    const id = `${planId}-${n}`;
    const meta = store.readJson(path.join(store.walkDir(project, id), 'walk.json'));
    if (meta && (meta.env || null) === env) return id;
  }
  return null;
}

function writeReport(project, planId, walkId) {
  const dir = store.walkDir(project, walkId);
  const meta = store.readJson(path.join(dir, 'walk.json'));
  if (!meta) throw new Error(`Walk ${walkId} has no walk.json.`);
  // The earlier walks in the same environment, newest first: each step is compared with the walk in which it was last
  // answered. A test server's data and version are not a developer machine's, so walks elsewhere are left out.
  const n = Number(walkId.slice(planId.length + 1));
  const env = meta.env || null;
  const earlier = store.walkNumbers(project, planId).filter(x => x < n).reverse().map(x => {
    const id = `${planId}-${x}`;
    const m = store.readJson(path.join(store.walkDir(project, id), 'walk.json'));
    return m && (m.env || null) === env ? { id, meta: m } : null;
  }).filter(Boolean).slice(0, EARLIER_WALKS).map(w => ({ meta: w.meta, events: store.readEvents(project, w.id) }));
  const { markdown, counts, against, errorSteps, networkSteps, probeSteps, undoLeft } = report.build(meta, store.readEvents(project, walkId), earlier.length ? earlier : null);
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, markdown);
  return { file, markdown, counts, against, errorSteps, networkSteps, probeSteps, undoLeft, meta };
}

async function main() {
  const { command, positional, flags } = parse(process.argv.slice(2));
  if (command === 'help' || flags.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 15).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
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
      // Only a plan with a test database needs it (db: { server, database }).
      sqlcmd: (await require('./db').version()) || 'missing (needed only for a plan with db)',
    };
    // --base: the address opened once in a headless browser, as a walk's browser would meet it.
    if (flags.base) {
      try { new URL(flags.base); } catch { throw new UsageError(`--base "${flags.base}" is not a URL.`); }
      if (runtime === 'missing' || !chosen) {
        throw Object.assign(new Error(`doctor --base needs ${runtime === 'missing' ? 'playwright-core (node run.js setup)' : 'Chrome or Edge'}.`), { exit: EXIT.runtime });
      }
      const { checkSite } = require('./site');
      data.site = { address: flags.base, ...(await checkSite({ playwright: loadPlaywright(), browser: chosen, base: flags.base })) };
    }
    const line = ([k, v]) => `${k}: ${v && typeof v === 'object' ? JSON.stringify(v) : v}`;
    const { site, ...rest } = data;
    const siteText = site ? ['site:', ...Object.entries(site).filter(([k, v]) => k !== 'ok' && v != null).map(e => `  ${line(e)}`)] : [];
    out(flags, data, [...Object.entries(rest).map(line), ...siteText].join('\n'));
    if (runtime === 'missing') return EXIT.runtime;
    return site && !site.ok ? EXIT.error : EXIT.ok;
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
      ...(p.walks.length ? p.walks.map(w => `  ${w.walkId}  ${(w.startedAt || '').slice(0, 16).replace('T', ' ')}  ${w.result}  ✔${w.pass} ✖${w.diff} ⏭${w.skip} ○${w.none}${w.env ? `  [${w.env}]` : ''}`) : ['  (no walks yet)']),
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
    // Step 14 of the demo plan says what --network shows there.
    process.env.GUIDED_SMOKE_DEMO_NETWORK = flags.network ? '1' : '';
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
  if (!ref) throw new UsageError('run needs a plan, walk, work item, steps file or folder of plans.');
  if (positional.length > 1) throw new UsageError('run takes one plan reference.');
  let planId;
  let sourceWalk = null;
  const there = fs.existsSync(path.resolve(ref)) ? fs.statSync(path.resolve(ref)) : null;
  if (there && there.isDirectory()) {
    // "smoke" may name a folder here and a plan of the project at once: nothing is guessed. Written as a path
    // (./smoke) it is the folder.
    let also = null;
    try { also = store.resolve(project, ref); } catch { /* a folder only */ }
    if (also) {
      throw new UsageError(`"${ref}" is both a folder here and ${also.walkId ? `walk ${also.walkId}` : `plan ${also.planId}`} of this project. For the folder (a suite) write it as a path: .${path.sep}${ref}. For the plan give its file: ${store.planFile(project, also.planId)}.`);
    }
    return runSuite({ project, folder: path.resolve(ref), flags });
  }
  const asFile = /\.c?js$/i.test(ref) && !!there;
  if (asFile) {
    const file = path.resolve(ref);
    const plan = loadPlan(file);
    planId = planIdOf(file, plan);
    // A different plan already stored under this id is replaced only with --force.
    const other = otherPlan(project, planId, file);
    if (other && !flags.force) {
      throw new UsageError(`Plan ${planId} already exists in this project (${other}). Give the module another id, or use --force to replace it with a link to ${file}.`);
    }
    linkPlan(project, planId, file);
  } else {
    const r = store.resolve(project, ref);
    planId = r.planId;
    sourceWalk = r.walkId;
  }
  return runWalk({ project, planId, planPath: store.planFile(project, planId), flags, sourceWalk });
}

/**
 * A plan made ready to walk: loaded and checked, its environment picked, the steps to walk chosen. Null, after saying
 * so, when --retry-failed finds nothing to retry. `plan`: the plan when the caller has loaded it already.
 */
function planSettings({ project, planId, source, flags, sourceWalk = null, plan = loadPlan(source) }) {
  const total = plan.steps.length;
  let env;
  try { env = pickEnv(plan, flags.env); } catch (e) { throw new UsageError(e.message); }

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
    // The newest walk in this environment: what failed on a test server is not what failed on this machine.
    const src = sourceWalk || latestWalkIn(project, planId, env.name);
    if (!src) throw Object.assign(new Error(`Plan ${planId} has no walk${env.name ? ` in environment ${env.name}` : ''} to retry.`), { exit: EXIT.resolve });
    const failed = [...report.finalStates(store.readEvents(project, src)).values()].filter(e => e.answer === 'diff').map(e => e.n);
    if (failed.length === 0) { console.log(`Walk ${src} has no steps marked different; nothing to retry.`); return null; }
    allowed = new Set(failed);
    filterNote = `--retry-failed ${src}: ${failed.join(',')}`;
  }
  // A probe step named on purpose (--only, --retry-failed) would only be skipped without --probe: say so instead.
  if (allowed && !flags.from && !flags.probe) {
    const probes = [...allowed].filter(n => plan.steps[n - 1].probe).sort((a, b) => a - b);
    if (probes.length) throw new UsageError(`Step${probes.length > 1 ? 's' : ''} ${probes.join(', ')} ${probes.length > 1 ? 'are probe steps' : 'is a probe step'}: add --probe to run ${probes.length > 1 ? 'them' : 'it'}.`);
  }
  return { plan, env, allowed, filterNote };
}

/** The flags that say how a walk looks and goes, checked: the same for every plan of a suite. */
function lookSettings(flags) {
  if (flags.pace && !['slow', 'normal', 'fast'].includes(flags.pace)) throw new UsageError('--pace must be slow, normal or fast.');
  if (flags.screens && !['diff', 'all'].includes(flags.screens)) throw new UsageError('--screens must be diff or all (leave it out for none).');
  if (flags.lang && !LANGUAGES.includes(flags.lang)) throw new UsageError(`--lang must be one of: ${LANGUAGES.join(', ')}.`);
  if (flags.locale && !/^[a-z]{2}(-[A-Z]{2})?$/.test(flags.locale)) throw new UsageError('--locale looks like tr-TR or en-US.');
  return { panel: parsePanel(flags.panel) };
}

/** The address a plan is walked at: --base, else its environment's. */
function addressOf(flags, env) {
  const base = flags.base || env.base;
  if (!base) throw new UsageError(`No address: pass --base https://host:port or set base in the plan${env.name ? ` or in envs.${env.name}` : ''}.`);
  try { new URL(base); } catch { throw new UsageError(`--base "${base}" is not a URL.`); }
  return base;
}

/** The browser and the runtime a walk needs, found before any window opens. */
function tools(flags) {
  const chosen = browser.choose(flags.browser);
  const playwright = loadPlaywright();
  if (flags.video && !browser.videoReady(store.runtimeDir())) {
    throw Object.assign(new Error("--video needs Playwright's ffmpeg (about 4 MB, from Playwright's download servers). Install it once: node run.js setup --video"), { exit: EXIT.runtime });
  }
  return { chosen, playwright };
}

/**
 * Walks a prepared plan: opens the browser, writes the report. Resolves to { walkId, result, stopSuite }; an error
 * carries the walk's id. `suite`: the walk's place in a suite, as suite.runAll hands it over.
 */
async function startWalk({ project, planId, source, plan, env, allowed, filterNote, base, panel, chosen, playwright, flags, suite = null, dbSession = null }) {
  const walkId = store.nextWalkId(project, planId);
  const walkDir = store.walkDir(project, walkId);
  fs.mkdirSync(walkDir, { recursive: true });
  fs.copyFileSync(source, path.join(walkDir, 'steps.snapshot.js'));
  if (suite) suite.started(walkId);
  console.log(`walk ${walkId} · ${chosen.name} (${chosen.source}) · ${base}${env.name ? ` · env ${env.name}` : ''}${filterNote ? ' · ' + filterNote : ''}${suite ? ` · suite ${suite.id}, plan ${suite.index}/${suite.total}` : ''}`);

  const { walk } = require('./engine');
  let done;
  try {
    done = await walk({
      plan, planId, walkId, project, walkDir, playwright, profile: store.profileDir(project, chosen.name), dbSession,
      options: {
        browser: chosen, base, pace: flags.pace || 'slow', allowed, filterNote, skipWrites: !!flags['skip-writes'],
        allowRemoteWrites: !!flags['allow-remote-writes'], workItem: flags['work-item'] || plan.workItem || null,
        fresh: !!flags.fresh, screens: flags.screens || null, locale: flags.locale || plan.locale || systemLocale(),
        lang: pickLanguage(flags.lang || plan.lang), keepDownloads: !!flags['keep-downloads'],
        auto: !!flags.auto, trace: !!flags.trace, video: !!flags.video, panel,
        network: flags.network ? compileConfig(plan.network) : null, probe: !!flags.probe,
        env: env.name, start: env.start, data: env.data, db: env.db, signIn: env.signIn, login: env.login,
        suite: suite ? { id: suite.id, index: suite.index, total: suite.total, next: suite.next } : null,
      },
    });
  } catch (e) {
    if (/user data directory is already in use|ProcessSingleton/i.test(String(e && e.message))) {
      e.message = `The smoke profile is already open in another browser window. Close that window and run again. (${e.message.split('\n')[0]})`;
    }
    const r = (() => { try { return writeReport(project, planId, walkId); } catch { return null; } })();
    if (r) console.log(`report: ${r.file}`);
    if (e && typeof e === 'object') e.walkId = walkId;
    throw e;
  }
  const r = writeReport(project, planId, walkId);
  console.log(`report: ${r.file}`);
  console.log(`result: ${r.meta.result} · ✔${r.counts.pass} ✖${r.counts.diff} ⏭${r.counts.skip} ○${r.counts.none}${r.against.length ? ` · ⚠ passed over a failed check: ${r.against.join(', ')}` : ''}${r.errorSteps.length ? ` · ⚠ browser errors in steps: ${r.errorSteps.join(', ')}` : ''}${r.networkSteps.length ? ` · ⚠ network findings in steps: ${r.networkSteps.join(', ')}` : ''}${r.probeSteps.length ? ` · ⚠ probe rows different in steps: ${r.probeSteps.join(', ')}` : ''}${r.undoLeft.length ? ` · ⚠ not put back (undo): steps ${r.undoLeft.join(', ')}` : ''}`);
  return { walkId, result: r.meta.result, stopSuite: !!(done && done.stopSuite) };
}

/** One walk of a plan: checks the flags, opens the browser, writes the report. */
async function runWalk({ project, planId, planPath, flags, sourceWalk = null }) {
  const source = planSource(planPath);
  const picked = planSettings({ project, planId, source, flags, sourceWalk });
  if (!picked) return EXIT.ok;
  const look = lookSettings(flags);
  const base = addressOf(flags, picked.env);
  await startWalk({ project, planId, source, ...picked, ...look, base, ...tools(flags), flags });
  return EXIT.ok;
}

// What belongs to one plan: its step numbers, its work item, replacing its stored copy.
const ONE_PLAN_FLAGS = ['from', 'only', 'retry-failed', 'work-item', 'force'];

/**
 * A folder walked as a suite. Every plan is loaded and checked before a browser opens: one that cannot be walked keeps
 * the whole suite from starting, with all of them named. Then one walk after another, and one report over them.
 */
async function runSuite({ project, folder, flags }) {
  const stray = ONE_PLAN_FLAGS.filter(f => flags[f]);
  if (stray.length) {
    throw new UsageError(`${folder} is a folder, walked as a suite: ${stray.map(f => '--' + f).join(', ')} ${stray.length > 1 ? 'belong' : 'belongs'} to one plan. Walk that plan by itself.`);
  }
  const entries = suites.discover(folder);
  if (!entries.length) throw new UsageError(`No plans in ${folder}: a suite's plans are its <name>.steps.js files and the steps.js of its folders.`);
  const look = lookSettings(flags);

  const ready = [];
  const problems = [];
  const ids = new Map();
  for (const entry of entries) {
    const shown = path.relative(folder, entry.file).split(path.sep).join('/');
    try {
      const plan = loadPlan(entry.file);
      const planId = planIdOf(entry.file, plan);
      if (ids.has(planId)) throw new UsageError(`its id "${planId}" is also the id of ${ids.get(planId)}. Give one of them an id of its own (id: '…').`);
      ids.set(planId, shown);
      const other = otherPlan(project, planId, entry.file);
      if (other) throw new UsageError(`the project already has another plan with the id ${planId} (${other}). Give this one another id, or walk it once by itself with --force to replace that plan.`);
      const picked = planSettings({ project, planId, source: entry.file, flags, plan });
      ready.push({ name: entry.name, planId, title: plan.title || planId, source: entry.file, ...picked, base: addressOf(flags, picked.env) });
    } catch (e) {
      // A plan that does not load (a syntax error, a missing require) is as much in the way as one the engine refuses.
      const text = String(e && e.message ? e.message : e).split('\n')[0];
      problems.push(`- ${shown}: ${text.startsWith(`${entry.file}: `) ? text.slice(entry.file.length + 2) : text}`);
    }
  }
  if (problems.length) {
    throw new UsageError(`The suite was not started: ${problems.length} of its ${entries.length} plan${entries.length > 1 ? 's' : ''} cannot be walked.\n${problems.join('\n')}`);
  }

  const shared = { ...look, ...tools(flags) };
  for (const p of ready) linkPlan(project, p.planId, p.source);
  const given = Object.entries(flags).filter(([k]) => k !== 'project' && k !== 'json').map(([k, v]) => (v === true ? `--${k}` : `--${k} ${v}`)).join(' ');
  const { suite, save } = suites.begin({
    project, folder, env: flags.env || null, lang: pickLanguage(flags.lang || ready[0].plan.lang), flags: given, plans: ready,
  });
  console.log(`suite ${suite.suiteId} · ${ready.length} plan${ready.length > 1 ? 's' : ''}${flags.env ? ` · env ${flags.env}` : ''}: ${ready.map(p => p.planId).join(', ')}`);
  const byId = new Map(ready.map(p => [p.planId, p]));
  // What the database tab was answered with for one plan holds for the next plans on the same database: the account
  // is typed once. It is kept here, in this process's memory, and dropped when the suite ends, however it ends.
  const dbSession = { config: null, account: null, without: false };
  try {
    await suites.runAll({
      suite, save,
      walkOne: (p, at) => startWalk({ project, ...byId.get(p.planId), ...shared, flags, suite: at, dbSession }),
      // A walk's error ends that plan only: it is said here, in one line, and the next plan is walked.
      onError: p => console.error(`error in ${p.walkId || p.planId}: ${p.error}`),
    });
  } finally {
    dbSession.account = null;
  }
  const r = suites.writeReport(project, suite.suiteId);
  console.log(`suite report: ${r.file}`);
  console.log(`suite result: ${suite.result} · plans ${r.walked}/${r.total} walked · ✔${r.counts.pass} ✖${r.counts.diff} ⏭${r.counts.skip} ○${r.counts.none}${r.notWalked.length ? ` · not walked: ${r.notWalked.join(', ')}` : ''}${r.errors.length ? ` · ⚠ ended with an error: ${r.errors.join(', ')}` : ''}${r.undoLeft.length ? ` · ⚠ not put back (undo) in: ${r.undoLeft.join(', ')}` : ''}`);
  return r.errors.length ? EXIT.error : EXIT.ok;
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
