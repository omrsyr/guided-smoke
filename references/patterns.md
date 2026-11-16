# Patterns

Shapes that recur in real plans. Copy the shape; routes, tools and queries are the project's.

## Calling an API with the user's account

When a step must call an endpoint that needs an account (a client or machine API, a token sign-in), the user types
the account into a box on the page and the call runs inside the page. The script never sees the values. For the
application's own API, called as the user who is already signed in, no account is typed: see
[the next pattern](#calling-the-applications-own-api-as-the-signed-in-user), and its table for which one to use.

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
    state.r = await inPage(async ({ fields, arg, url }) => {
      const post = (path, body, token) => fetch(url(path), { method: 'POST', body: JSON.stringify(body),
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
  `secretBox(null)` removes the box; do it as soon as the API steps are done, because `--trace` records nothing while
  the box is on the page. **■ Stop** during that wait ends the walk at once: from then on the page sends no
  request and every helper refuses, even if the plan catches the error.
- Calls go to the page's own origin. Another origin needs the application's CORS and CSP to allow it.
- `url(path)` turns a path of the application into the path to call, keeping `base`'s own path: under an IIS
  application (`https://test01/App`) `url('/api/login')` is `/App/api/login`. A bare `fetch('/api/login')` would go
  to the server's root and miss the application there.

## Calling the application's own API as the signed-in user

When the API under test is the one the page itself calls, the browser already holds what the call needs: the
session. Nothing is typed and no box is drawn; the call runs inside the page with `inPage`, as the page's own calls
do, and the panel shows it like a line of an API client: `POST /api/models → 201 (17 ms)`.

```js
// Runs in the page. What the application signs its calls with stays there: only the outcome comes back.
const call = async ({ arg, url }) => {
  const token = sessionStorage.getItem('access_token');       // where this application keeps it; see below
  const started = performance.now();
  const r = await fetch(url(arg.route), {
    method: arg.method, credentials: 'include',
    headers: { ...(arg.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: arg.body ? JSON.stringify(arg.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ms: Math.round(performance.now() - started), id: j.id ?? null, total: Array.isArray(j.items) ? j.items.length : null };
};

{
  title: 'POST adds the model',
  approve: { what: 'Send POST /api/models { model: "SMOKE-API 1" }: one test record is added.' },
  undo: { what: 'The SMOKE-API records are removed again.', run: async ({ sql }) => { /* by the prefix; see below */ } },
  did: 'I sent POST /api/models with the model "SMOKE-API 1", as the user who is signed in.',
  expect: ['Automatic check: POST /api/models → 201.'],
  run: async ({ inPage, state }) => {
    state.added = await inPage(call, { method: 'POST', route: '/api/models', body: { model: 'SMOKE-API 1' } });
  },
  check: async ({ state }) => [state.added.http === 201, `POST /api/models → ${state.added.http} (${state.added.ms} ms)`],
},
```

- **Where the session is** differs per application; find it once while writing the plan (the browser's developer
  tools, Application ▸ Storage, or the application's own HTTP client in the repository):
  a session cookie needs nothing read (`credentials: 'include'`, and same-origin calls send it anyway); a
  single-page application that signs in through an identity provider keeps a token in `sessionStorage` or
  `localStorage`, often inside a JSON entry of its sign-in library (`JSON.parse(sessionStorage.getItem(key)).access_token`);
  an anti-forgery token sits in a `<meta>` tag or a cookie and goes into the header the application's own calls use.
  Let the lookup fail clearly: `if (!token) return { error: 'No session token where the plan looks for it.' }`.
- **The token never leaves the page.** Return what the next steps need (a status, a time, a count, the id of the test
  record the step made), never the token, a cookie or an answer's whole body. There is no box, so nothing is masked.
- A call that changes data is a permitted step with an `undo`, like any change outside the screen; a `GET` is a plain
  step. An API's error answer (a 400 that is the point of the step) shows under the step as a failed request: say so
  in `expect` (writing-steps rule 16).
- A step with only an API call has nothing to outline: leave `mark()` out, or reload and mark the row the call made.

**The box, or the session?**

| The step calls | Use |
|---|---|
| the application's own API, as the user who is signed in | the session, as above: nothing to type |
| an API with an account of another kind: a client or machine API (a client id and secret, an API key, a device key), a token endpoint | the value box (`secretBox`): the user types the account, as in the first pattern |
| an API outside the application (another origin) | the value box, when that API's CORS and the application's CSP allow the call from the page; otherwise the project's own tool, called from the plan |
| the same API as another user (a role that must get a 403) | neither: a walk of its own, signed in as that user (`--fresh`); a second factor or an identity provider cannot be typed into a box |

## A value the user gives, put into a form of the page

A test record that needs a secret of its own (a test user's password) gets it from the user, never from the plan,
not even a throw-away one. Asking the user to type into the page's own field works badly: the panel moves on while
they type, or they type into the wrong field. Let them type into the box; the step puts the value into the form and
checks it before anything is sent.

```js
{
  title: 'Test user form filled in',
  did: 'I filled in the "New user" form for smoke-user-1 and put the password you typed into the box into its "Password" field.',
  expect: ['The form shows the user name smoke-user-1 and dots in "Password". Nothing is sent yet.'],
  run: async ({ page, secretBox, inPage, mark, state }) => {
    await page.fill('#UserName', 'smoke-user-1');
    await secretBox({ title: 'Test user', fields: [{ name: 'password', label: 'Password for the test user', secret: true }] });
    state.filled = await inPage(({ fields }) => {             // waits, with the panel saying so, until the box is filled in
      const input = document.querySelector('#Password');
      input.value = fields.password;
      input.dispatchEvent(new Event('input', { bubbles: true }));   // the event the form's framework listens to
      return { length: input.value.length };
    });
    await secretBox(null);
    await mark(page.locator('#Password'));
  },
  check: async ({ state }) => [state.filled.length >= 8, 'The password field is filled in.', 'The password field is empty or shorter than 8 characters.'],
},
```

- The next step sends the form. When that cannot be undone (an account that cannot be deleted), make it a permitted
  step: the user has seen the filled form first.
- Return a length or a yes/no, never the value. Remove the box as soon as the value is placed.

## Reading and writing the database

On SQL Server, give the plan (or the environment) a `db` and use `sql()` ([writing steps](writing-steps.md) rule 20):
the user types the account into the engine's own tab, and the walk works the same on this machine and on a shared
test server.

```js
{
  title: 'Overdue order (due date moved into the past)',
  db: true,
  approve: { what: 'In the test database set order 2001\'s due date to yesterday: one UPDATE limited to that order.' },
  undo: {
    what: 'Order 2001\'s due date goes back to what it was.',
    run: async ({ sql, state, data }) => {
      if (!('due' in state)) return;    // the step did not get as far as reading it
      await sql(`UPDATE dbo.Orders SET DueDate = ${state.due === 'NULL' ? 'NULL' : `'${state.due}'`} WHERE Id = ${Number(data.order)}`);
    },
  },
  did: '…', expect: ['…'],
  run: async ({ sql, state, data, page }) => {
    state.due = (await sql(`SELECT CONVERT(char(10), DueDate, 23) FROM dbo.Orders WHERE Id = ${Number(data.order)}`)).value;
    state.rows = (await sql(`UPDATE dbo.Orders SET DueDate = DATEADD(day, -1, CAST(GETDATE() AS date)) WHERE Id = ${Number(data.order)}`)).affected;
    await page.reload();
  },
  check: async ({ state }) => [state.rows === 1, '1 row updated.', `${state.rows} rows updated (expected 1).`],
},
```

- Read the old value into `state` before changing it, and let the undo do nothing without it.
- Ids come from `data` and go through `Number()` (or a fixed text): query text is never built from what a page shows.

Another database, or a project that already has its own tool (a script in the repository, the database CLI the
project documents): call it from the plan. Pass fixed query text with ids from the plan or `state`, and never pass the
tool's output on.

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
- Connection strings stay in the tool's configuration: the plan neither reads nor prints them. With `db` there is
  none: the server and database names are in the plan, the account only in the engine's memory.
- To count only what the walk itself caused, read the database's own clock into `state` before the first action
  and filter by it. The script's clock and time zone may differ from the server's. Where the application writes the
  time itself (its own clock, another zone) or the rows cannot be told apart by a name (an encrypted column), read
  the table's highest id into `state` instead and count the rows above it.
- Clean up the way the application removes things. Where it only marks a record deleted (a soft delete), marking it
  is the clean-up: checks count the records still active, and `expect` says "no active SMOKE record", not "no row".
  Do not delete rows the application itself would keep.

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
