'use strict';
// Stands in for sqlcmd in the tests (GUIDED_SMOKE_SQLCMD points here). It takes the account in FAKE_SQLCMD_ACCOUNT
// ("user:password") or a Windows sign-in (-E), answers "SELECT 1" and the queries of FAKE_SQLCMD_ANSWERS (a JSON file:
// { "<query>": "<output>" }), fails like sqlcmd otherwise, and appends what it was given to FAKE_SQLCMD_LOG: its
// arguments, the query, the user name it saw and whether a password came through the environment. Like sqlcmd, it
// writes its output, errors included, to the -o file (UTF-8 with a byte order mark) when one is given.

const fs = require('fs');

const args = process.argv.slice(2);
const arg = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const out = (text, code) => {
  if (arg('-o')) fs.writeFileSync(arg('-o'), `﻿${text}`);
  else process.stdout.write(text);
  process.exit(code);
};

if (args.includes('-?')) out('Microsoft (R) SQL Server Command Line Tool\r\nVersion 99.0.1 NT\r\n', 0);
const query = fs.readFileSync(arg('-i'), 'utf8').trim();
if (process.env.FAKE_SQLCMD_LOG) {
  fs.appendFileSync(process.env.FAKE_SQLCMD_LOG, JSON.stringify({
    args, query, user: process.env.SQLCMDUSER || null, envPassword: !!process.env.SQLCMDPASSWORD,
  }) + '\n');
}
if (arg('-S') === 'unreachable') {
  out('Sqlcmd: Error: Microsoft ODBC Driver 18 for SQL Server : A network-related or instance-specific error has occurred while establishing a connection to SQL Server. Server is not found or not accessible.\r\n', 1);
}
const [user, password] = String(process.env.FAKE_SQLCMD_ACCOUNT || '').split(':');
if (!args.includes('-E') && (process.env.SQLCMDUSER !== user || process.env.SQLCMDPASSWORD !== password)) {
  out(`Sqlcmd: Error: Microsoft ODBC Driver 18 for SQL Server : Login failed for user '${process.env.SQLCMDUSER}'..\r\n`, 1);
}
if (query === 'SELECT 1') out('1\r\n\r\n(1 rows affected)\r\n', 0);
const answers = process.env.FAKE_SQLCMD_ANSWERS ? JSON.parse(fs.readFileSync(process.env.FAKE_SQLCMD_ANSWERS, 'utf8')) : {};
if (Object.prototype.hasOwnProperty.call(answers, query)) out(answers[query], 0);
out(`Msg 208, Level 16, State 1, Server ${arg('-S')}, Line 1\r\nInvalid object name 'secret_table'.\r\n`, 1);
