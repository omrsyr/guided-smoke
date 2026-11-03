'use strict';
// Where plans, walks and browser profiles live, and how a short reference ("6655", "6655-2") becomes a plan or a walk.
//
//   <root>/runtime/                         playwright-core, installed once
//   <root>/projects/<project>/plans/<plan>/steps.js
//   <root>/projects/<project>/walks/<plan>-<n>/{walk.json, events.jsonl, report.md, steps.snapshot.js, screens/, downloads/}
//   <root>/profiles/<project>-<browser>/   browser profile (session cookies; no passwords)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PLAN_ID = /^[a-z0-9][a-z0-9._-]*$/;

function dataRoot() {
  if (process.env.GUIDED_SMOKE_HOME) return path.resolve(process.env.GUIDED_SMOKE_HOME);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'guided-smoke');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'guided-smoke');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'guided-smoke');
}

/** The project a smoke belongs to: the git repository's folder name, otherwise the working folder's. */
function detectProject(cwd = process.cwd()) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (top) return safeName(path.basename(top));
  } catch { /* not a git repository */ }
  return safeName(path.basename(cwd));
}

function safeName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function projectDir(project, root = dataRoot()) { return path.join(root, 'projects', project); }
function plansDir(project, root) { return path.join(projectDir(project, root), 'plans'); }
function walksDir(project, root) { return path.join(projectDir(project, root), 'walks'); }
function planDir(project, planId, root) { return path.join(plansDir(project, root), planId); }
function planFile(project, planId, root) { return path.join(planDir(project, planId, root), 'steps.js'); }
function walkDir(project, walkId, root) { return path.join(walksDir(project, root), walkId); }
function profileDir(project, browser, root = dataRoot()) { return path.join(root, 'profiles', `${project}-${browser}`); }
function runtimeDir(root = dataRoot()) { return path.join(root, 'runtime'); }

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
}

function listPlans(project, root) {
  return listDirs(plansDir(project, root)).filter(id => fs.existsSync(planFile(project, id, root))).sort();
}

/** Walk numbers of a plan, ascending. A walk id is "<plan>-<n>". */
function walkNumbers(project, planId, root) {
  const prefix = planId + '-';
  return listDirs(walksDir(project, root))
    .filter(w => w.startsWith(prefix) && /^\d+$/.test(w.slice(prefix.length)))
    .map(w => Number(w.slice(prefix.length)))
    .sort((a, b) => a - b);
}

function nextWalkId(project, planId, root) {
  const nums = walkNumbers(project, planId, root);
  return `${planId}-${nums.length ? nums[nums.length - 1] + 1 : 1}`;
}

function latestWalkId(project, planId, root) {
  const nums = walkNumbers(project, planId, root);
  return nums.length ? `${planId}-${nums[nums.length - 1]}` : null;
}

class ResolveError extends Error {
  constructor(message, candidates = []) {
    super(message);
    this.candidates = candidates;
  }
}

/**
 * Turns a reference into { planId, walkId|null }. Accepted forms:
 *   <plan-id>            e.g. 6655-machine-expiry
 *   <plan-id>-<n>        a walk of that plan
 *   <work-item>          e.g. 6655 — the only plan whose id is 6655 or starts with "6655-"
 *   <work-item>-<n>      walk n of that plan
 * Nothing is guessed: no match or several matches is an error listing what exists.
 */
function resolve(project, ref, root) {
  const plans = listPlans(project, root);
  const value = String(ref || '').trim().toLowerCase();
  if (!value) throw new ResolveError('A plan or walk reference is required.', plans);

  if (plans.includes(value)) return { planId: value, walkId: null };

  const walkMatch = /^(.+)-(\d+)$/.exec(value);
  if (walkMatch && plans.includes(walkMatch[1])) {
    return { planId: walkMatch[1], walkId: existingWalk(project, walkMatch[1], Number(walkMatch[2]), root) };
  }

  const byItem = item => plans.filter(p => p === item || p.startsWith(item + '-'));
  if (/^\d+$/.test(value)) return { planId: single(byItem(value), value, plans), walkId: null };

  const itemWalk = /^(\d+)-(\d+)$/.exec(value);
  if (itemWalk) {
    const planId = single(byItem(itemWalk[1]), itemWalk[1], plans);
    return { planId, walkId: existingWalk(project, planId, Number(itemWalk[2]), root) };
  }

  throw new ResolveError(`No plan matches "${ref}".`, plans);
}

function single(matches, item, plans) {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new ResolveError(`No plan for "${item}".`, plans);
  throw new ResolveError(`"${item}" matches several plans; use the full id.`, matches);
}

function existingWalk(project, planId, n, root) {
  const id = `${planId}-${n}`;
  if (!fs.existsSync(walkDir(project, id, root))) {
    throw new ResolveError(`Walk ${id} does not exist.`, walkNumbers(project, planId, root).map(x => `${planId}-${x}`));
  }
  return id;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readEvents(project, walkId, root) {
  const file = path.join(walkDir(project, walkId, root), 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

module.exports = {
  PLAN_ID, dataRoot, detectProject, safeName, projectDir, plansDir, walksDir, planDir, planFile, walkDir, profileDir, runtimeDir,
  listPlans, walkNumbers, nextWalkId, latestWalkId, resolve, ResolveError, readJson, readEvents,
};
