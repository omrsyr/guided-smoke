'use strict';
// A plan's environments. The plan's own base, start and data are its default environment; `envs` names others (a
// shared test server, a UAT server) that override them, and --env picks one. A walk records the environment's name, and
// its report compares it only with earlier walks in the same environment.

const { checkDb } = require('./db');

const ENV_KEYS = ['base', 'start', 'data', 'db', 'signIn', 'login'];
const ENV_NAME = /^[A-Za-z0-9][\w-]*$/;

const isPlain = v => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));

function checkOne(e, where) {
  if (e.base != null) {
    try { new URL(e.base); } catch { return `${where}: base "${e.base}" is not a URL.`; }
  }
  if (e.start != null && typeof e.start !== 'string') return `${where}: start must be a path, such as '/orders'.`;
  if (e.data != null && !isPlain(e.data)) return `${where}: data must be an object, such as { order: 1001 }.`;
  if (e.login != null) {
    try { new RegExp(e.login); } catch { return `${where}: login "${e.login}" is not a regular expression (the sign-in pages' addresses, such as '/Account/').`; }
  }
  if (e.signIn != null && e.signIn !== 'windows') return `${where}: signIn takes 'windows' (the browser signs in with this machine's Windows account), or is left out.`;
  return checkDb(e.db, where);
}

/** What is wrong with the plan's environments, as one sentence; null when nothing is. */
function checkEnvs(plan) {
  const top = checkOne(plan, 'the plan');
  if (top || plan.envs == null) return top;
  if (!isPlain(plan.envs) || !Object.keys(plan.envs).length) {
    return "envs must name at least one environment: envs: { test: { base: 'https://test01/App' } }.";
  }
  for (const [name, e] of Object.entries(plan.envs)) {
    if (!ENV_NAME.test(name)) return `envs: "${name}" is not a usable name (letters, digits, "-" and "_").`;
    if (!isPlain(e)) return `envs.${name} must be an object, such as { base: 'https://test01/App' }.`;
    const unknown = Object.keys(e).filter(k => !ENV_KEYS.includes(k));
    if (unknown.length) {
      return `envs.${name} has ${unknown.length > 1 ? 'unknown keys' : 'an unknown key'} ${unknown.map(k => `"${k}"`).join(', ')}. An environment knows: ${ENV_KEYS.join(', ')}.`;
    }
    const bad = checkOne(e, `envs.${name}`);
    if (bad) return bad;
  }
  return null;
}

/**
 * The environment a walk runs in: { name, base, start, data, db, signIn, login }, name null for the plan's own. What an
 * environment leaves out comes from the plan; its data is laid over the plan's, key by key, its db replaces the plan's.
 * An unknown name throws, naming the known ones.
 */
function pickEnv(plan, name) {
  const own = {
    base: plan.base || null, start: plan.start || '/', data: { ...(plan.data || {}) }, db: plan.db || null,
    signIn: plan.signIn || null, login: plan.login || null,
  };
  if (name == null) return { name: null, ...own };
  const envs = plan.envs || {};
  if (!Object.prototype.hasOwnProperty.call(envs, name)) {
    const known = Object.keys(envs);
    throw new Error(known.length
      ? `The plan has no environment "${name}". Its environments: ${known.join(', ')}.`
      : `The plan has no environments, so --env ${name} has nothing to pick. Add envs: { ${/^\w+$/.test(name) ? name : 'test'}: { base: 'https://…' } } to the plan.`);
  }
  const e = envs[name];
  return {
    name, base: e.base || own.base, start: e.start || own.start, data: { ...own.data, ...(e.data || {}) },
    db: e.db || own.db, signIn: e.signIn || own.signIn, login: e.login || own.login,
  };
}

module.exports = { checkEnvs, pickEnv, ENV_KEYS };
