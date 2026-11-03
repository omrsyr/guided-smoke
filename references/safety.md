# Safety

## Sign-in and secrets

- The user signs in, always. The script waits until the browser leaves the sign-in pages. Never put a user name,
  password, token or verification code in a plan, a command, an environment variable or the chat.
- The smoke profile (`profiles/<project>-<browser>`) keeps the session cookie between walks; Chrome and Edge encrypt
  it with the operating system's key. Password saving is switched off in that profile. `--fresh` uses a throw-away
  profile; `reset-login` and the closing screen's "Sign out and clear the profile" delete it.
- Never print connection strings, keys, license keys or file contents into the panel, the events, the report or the
  chat. Read configuration without echoing it.

## Permitted steps (`approve`)

Anything that changes state **outside the page under test** is a permitted step: database writes, files, e-mails or
messages, calls to external services, clock or configuration changes. Irreversible screen actions may be permitted
steps too (see writing-steps rule 8).

```js
{
  title: 'Expired machine (date moved into the past)',
  approve: { what: 'In the dev database set SMOKE-A\'s end date to yesterday: one UPDATE limited to that machine; the row count is shown.', yes: 'Yes, move the date' },
  skipTo: 15,
  did: '…', expect: ['…'],
  run: async ctx => { /* call the project's own database tool */ },
  check: async ({ state }) => [state.rows === 1, '1 row updated.', `${state.rows} rows updated (expected 1).`],
}
```

- The panel shows `what` and waits for **Yes / Skip / Stop** before `run` is called. The answer is recorded.
- `--skip-writes` skips every permitted step without asking.
- When the address is not local (anything other than localhost, 127.0.0.1, ::1 or `*.localhost`), permitted steps are
  skipped unless `--allow-remote-writes` is given. Do not suggest that flag for production.
- Limit a write to one test record by its id, report the affected row count, and treat a count other than expected as
  a failed check.
- Use the project's existing database tooling; read credentials from configuration without printing them.

## What is recorded

`events.jsonl` keeps step numbers and titles, answers, notes, automatic-check texts, durations, and screenshot paths.
It never keeps page HTML, cookies, values typed into forms, or credentials. Screenshots are taken only on request
(📷, `--screens diff|all`) and stay in the walk folder on this machine; they may show personal data, so treat them
like the screen itself.
