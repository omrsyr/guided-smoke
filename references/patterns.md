# Patterns

Shapes that recur in real plans. Copy the shape; routes, tools and queries are the project's.

## Calling an API with the user's account

When a step must call an endpoint that needs an account (a client or machine API, a token sign-in), the user types
the account into a box on the page and the call runs inside the page. The script never sees the values.

```js
{
  title: 'API box ready',
  did: 'I added a box at the bottom left of the page.',
  expect: ['Type the test account\'s e-mail and password into the box, then click "Correct, continue".'],
  run: async ({ page, secretBox, mark }) => {
    await secretBox({ title: 'Client API test', fields: [
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'password', label: 'Password', secret: true },
    ] });
    await mark(page.locator('#__guided_smoke_box'));
  },
},
{
  title: 'Check answers "Valid"',
  did: 'I signed in with the box\'s account and called POST /api/check for machine SMOKE-A.',
  expect: ['The box shows http 200 and status "Valid".'],
  run: async ({ inPage, state }) => {
    state.r = await inPage(async ({ fields, arg }) => {
      const post = (url, body, token) => fetch(url, { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
      const login = await (await post('/api/login', { email: fields.email, password: fields.password })).json();
      if (!login.token) return { error: 'Sign-in refused: check the e-mail and password in the box.' };
      const r = await post(arg.route, { machine: arg.machine }, login.token);
      const j = await r.json().catch(() => ({}));
      return { http: r.status, status: j.status };          // only what the product branches on
    }, { route: '/api/check', machine: 'SMOKE-A' });
  },
  check: async ({ state }) => state.r.error ? [false, state.r.error] : [state.r.status === 'Valid', `http ${state.r.http} · ${state.r.status}`],
},
```

- `inPage(fn, arg)` runs `fn({ fields, arg })` in the page. Before its result or error leaves the page, every value
  typed into the box is replaced with `•••`, and the masked result is shown in the box. Masking is a safety net:
  return only what the product branches on (HTTP status, status codes, messages, counts), never tokens, keys or ids.
- `fn` runs in the page. It cannot see variables from the plan file, so pass what it needs in `arg` (plain JSON). Write
  it as an arrow function or a `function` expression.
- When a required field is empty (the user moved on before typing, or a page load cleared the box), `inPage` waits:
  the box is outlined and shows **✔ Use these values**, and the panel offers only **■ Stop**. A step may therefore draw
  the box and call `inPage` at once. Still put the API steps before any step that reloads, so the user types once.
  `secretBox(null)` removes the box. **■ Stop** during that wait ends the walk at once: from then on the page sends no
  request and every helper refuses, even if the plan catches the error.
- Calls go to the page's own origin. Another origin needs the application's CORS and CSP to allow it.

## Reading and writing the database

Use the project's own tool: a script in the repository, or the database CLI the project documents. Pass fixed query
text with ids from the plan or `state`, and never pass the tool's output on.

```js
const { execFileSync } = require('child_process');

function sql(query) {
  try {
    return execFileSync(TOOL, [...TOOL_ARGS, query], { cwd: REPO, encoding: 'utf8' });
  } catch {
    // The tool's message may carry server names or data: never pass it on.
    throw new Error('The database tool failed (details hidden).');
  }
}
const rowsAffected = out => Number((out.match(/^\s*(\d+)\s*$/m) || [])[1]);
```

- A write is a permitted step (`approve`), limited to one test record by its id. Its check compares the affected row
  count with the expected one.
- Read-only counts are plain steps. Select only what the check needs (counts, outcomes), not addresses, keys or
  personal data. Never put raw output into `did`, `expect`, a check text or `log`.
- Connection strings stay in the tool's configuration: the plan neither reads nor prints them.
- To count only what the walk itself caused, read the database's own clock into `state` before the first action
  and filter by it. The script's clock and time zone may differ from the server's.

## Triggering a background job and waiting for its effect

A scheduled job (clean-up, retention, reminder) is smoked by triggering it from the application's job dashboard, when
there is one, and then waiting for its effect.

```js
{
  title: 'Clean-up job triggered',
  approve: { what: 'Run the "log-retention" job now; it deletes rows older than 180 days in the dev database.' },
  did: 'I opened the job dashboard, selected "log-retention" and clicked "Trigger now".',
  expect: ['The job\'s row shows a new "Last execution" time within a few seconds.'],
  run: async ({ page, goto, mark }) => { /* open the dashboard, tick the job's row, click its trigger button */ },
},
{
  title: 'Old rows are gone',
  did: 'I counted old rows in the dev database, waiting up to 30 seconds for the job to finish.',
  expect: ['Automatic check: 0 old rows.'],
  run: async ({ poll, state }) => {
    state.old = await poll(() => countOldRows(), { until: n => n === 0, timeout: 30000, interval: 2000 });
  },
  check: async ({ state }) => [state.old === 0, 'No old rows left.', `${state.old} old rows left after 30 s.`],
},
```

- Triggering a job that changes data is a permitted step.
- Dashboards split long lists into pages. Open a page size that holds the job (for example Hangfire's
  `/recurring?count=500`) instead of paging through.
- `poll` returns the last value even when time runs out; the check decides.
