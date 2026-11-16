'use strict';
// The walk's own way to a SQL Server test database: sqlcmd, with the account the user typed into the engine's own tab
// (or the Windows account). The account lives only in this process's memory while the walk runs (in a suite, until its
// last plan has run: the next plans on the same database do not ask again) and reaches sqlcmd as SQLCMDUSER /
// SQLCMDPASSWORD in its environment, never as an argument, a file or a record. sqlcmd's own messages may name servers,
// users or data: they are sorted into a few kinds and never passed on.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const LOGINS = ['sql', 'windows'];
const KEYS = ['server', 'database', 'login'];
const TIMEOUT_MS = 90 * 1000;

/**
 * What is wrong with a db setting ({ server, database, login: 'sql' | 'windows' }), or null. A server or database left
 * out is asked for in the engine's database tab, with the account.
 */
function checkDb(db, where) {
  if (db == null) return null;
  const plain = typeof db === 'object' && !Array.isArray(db);
  const unknown = plain ? Object.keys(db).filter(k => !KEYS.includes(k)) : [];
  const text = v => v == null || (typeof v === 'string' && v.trim() !== '');
  if (!plain || unknown.length || !text(db.server) || !text(db.database) || (db.login != null && !LOGINS.includes(db.login))) {
    return `${where}: db must be { server: 'sql01', database: 'AppTest', login: 'sql' | 'windows' } (login defaults to 'sql'; a server or database left out is typed in the database tab).`;
  }
  return null;
}

/**
 * In a suite, whether the database an earlier plan connected to (or went on without) is this plan's too: `held` is
 * the suite's { config, account, without }. It is when the sign-in is of the same kind and every server or database
 * the plan names is the one held; a name the plan leaves out is the tester's to give, and was given once. Returns the
 * plan's db with the held names filled in, or null: then the plan asks for itself.
 */
function sameDb(db, held) {
  if (!db || !held || !held.config) return null;
  if ((db.login || 'sql') !== (held.config.login || 'sql')) return null;
  const same = (a, b) => String(a).trim().toLowerCase() === String(b || '').trim().toLowerCase();
  if (['server', 'database'].some(key => db[key] && !same(db[key], held.config[key]))) return null;
  return { ...db, server: db.server || held.config.server, database: db.database || held.config.database };
}

/** The sqlcmd to run: GUIDED_SMOKE_SQLCMD, else sqlcmd on the PATH. A .js file runs with this Node (the tests' stand-in). */
function command(args) {
  const tool = process.env.GUIDED_SMOKE_SQLCMD || 'sqlcmd';
  return /\.c?js$/i.test(tool) ? [process.execPath, [tool, ...args]] : [tool, args];
}

/** Fields of sqlcmd's output: one row per line, columns split at tabs; "(n rows affected)" lines give the counts. */
function parse(output) {
  const rows = [];
  let affected = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^\((\d+) rows? affected\)$/.exec(line.trim());
    if (m) { affected = Number(m[1]); continue; }
    rows.push(line.split('\t'));
  }
  return { rows, affected, value: rows.length ? rows[0][0] : null };
}

/** The kind of a failure, from sqlcmd's message or the error of starting it. Never the message itself. */
function classify(output, error) {
  if (error && error.code === 'ENOENT') return 'tool';
  if (error && error.killed) return 'timeout';
  const text = String(output || '');
  if (/Login failed|\b18456\b/i.test(text)) return 'login';
  if (/Cannot open database|\b4060\b/i.test(text)) return 'database';
  if (/network-related|server was not found|not accessible|TCP Provider|Named Pipes Provider|timeout expired|actively refused|No such host|error: (26|40|53)\b/i.test(text)) return 'network';
  // Msg 229/230/262/300…: the account may read but not write (a read-only test account), or not touch that object.
  if (/permission (was )?denied/i.test(text)) return 'permission';
  return 'query';
}

/**
 * Runs one batch of SQL on the database: { rows, affected, value } (value: the first column of the first row, as
 * text). A failure throws an Error with `.kind` (login, database, network, tool, timeout, permission, query) and no text of
 * sqlcmd's. The query goes in and the output comes back through files in a folder of this user's temp folder that is
 * removed at once: sqlcmd writes UTF-8 to a file whatever the console's code page is, while on the console its first
 * run in a process turns Turkish letters into plain ones.
 */
function runSql({ db, account, query }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-smoke-sql-'));
  const file = path.join(dir, 'query.sql');
  const outFile = path.join(dir, 'out.txt');
  fs.writeFileSync(file, String(query));
  const env = { ...process.env };
  delete env.SQLCMDUSER;
  delete env.SQLCMDPASSWORD;
  const auth = (db.login || 'sql') === 'windows' ? ['-E'] : [];
  if (!auth.length) {
    env.SQLCMDUSER = account ? account.user : '';
    env.SQLCMDPASSWORD = account ? account.password : '';
  }
  // -C trusts the server's certificate (a test server's own), -b turns an error into exit code 1, -I sets
  // QUOTED_IDENTIFIER ON as applications have it (sqlcmd's default is OFF, and SQL Server then refuses to write to a
  // table with a filtered index or an indexed view), -h -1 drops column headers, -W trailing spaces; columns are split
  // at tabs.
  const args = ['-S', db.server, '-d', db.database, ...auth, '-C', '-b', '-I', '-l', '15', '-t', '60', '-h', '-1', '-W',
    '-s', '\t', '-w', '65535', '-f', 'i:65001,o:65001', '-i', file, '-o', outFile];
  const [exe, argv] = command(args);
  return new Promise((resolve, reject) => {
    execFile(exe, argv, { env, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      let output = '';
      try { output = fs.readFileSync(outFile, 'utf8').replace(/^﻿/, ''); } catch { /* not started, or nothing written */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the system's temp folder */ }
      const all = `${output}\n${stdout}\n${stderr}`;
      if (error) reject(Object.assign(new Error(`sql ${classify(all, error)}`), { kind: classify(all, error) }));
      else resolve(parse(output));
    });
  });
}

/** sqlcmd's version line, or null when there is none to run. */
function version() {
  const [exe, argv] = command(['-?']);
  return new Promise(resolve => {
    execFile(exe, argv, { encoding: 'utf8', timeout: 15000, windowsHide: true }, (error, stdout) => {
      const m = /Version\s+([\d.]+)/i.exec(String(stdout || ''));
      resolve(m ? m[1] : error && error.code === 'ENOENT' ? null : 'unknown');
    });
  });
}

module.exports = { checkDb, sameDb, runSql, parse, classify, version, LOGINS };
