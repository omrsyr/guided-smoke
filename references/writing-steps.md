# Writing steps

A plan is a CommonJS module in `plans/<plan-id>/steps.js`. See `examples/demo/steps.js` (runnable with
`node engine/run.js demo`) for every kind of step.

```js
module.exports = {
  title: 'Orders: due date',        // shown in reports
  workItem: '7001',                 // optional
  lang: 'en',                       // panel language: 'tr' | 'en' (default: the user's)
  base: 'https://localhost:5001',   // --base overrides
  start: '/orders/1001',            // opened first and again after sign-in
  ready: '#order-card',             // selector present only when signed in and on the start page
  login: 'account/login',           // regex source for sign-in URLs (optional)
  locale: 'en-US',                  // optional browser locale
  ignoreErrors: ['GET /hub/negotiate → 404'],   // optional: known browser noise (see rule 16)
  network: { slowMs: 1000, origins: ['https://api.example.com'], ignore: ['/hub/'] },   // optional, for --network (rule 17)
  data: { order: 1001 },            // optional: the test records the steps use (ctx.data)
  db: { server: 'localhost', database: 'Orders', login: 'windows' },   // optional: the test database for sql() (rule 20)
  envs: {                           // optional: other environments, picked with --env (rule 19)
    test: { base: 'https://test01.corp.example/Orders', start: '/orders/2001', data: { order: 2001 },
      signIn: 'windows', login: '/Account/', db: { server: 'sqltest01', database: 'OrdersTest', login: 'sql' } },
  },
  appVersion: async ({ page, text }) => text(page.locator('#app-version')),   // optional: read once after the sign-in (rule 21)
  steps: [ /* … */ ],
};
```

## A step

```js
{
  title: 'Machine added with its own end date',
  did: 'I typed SMOKE-A as the machine ID, 30.11.2026 as the date and clicked "Add machine".',
  expect: ['Green "Machine added." message at the top.', 'New row: SMOKE-A · End date 2026-11-30 · Status "Active".'],
  run: async ({ page, mark, submit }) => { /* do the action, then mark what to look at */ },
  check: async ({ page, text }) => [ok, 'text when ok', 'text when not'],   // optional
}
```

The step context (`ctx`) offers:

| Member | Use |
|---|---|
| `page`, `context` | Playwright objects |
| `mark(locator)` | Outline the place the user should look at (orange) and scroll to it |
| `submit(locator)` | Click and wait for the page that loads (POST / redirect) |
| `goto(path)` | Open a path of the application. Paths are relative to `base` including its own path: with `base` `https://test01/App` (an IIS application), `goto('/orders')` opens `https://test01/App/orders`. A full address is opened as it is |
| `download(locator)` | Click, save the download, return `{ name, size }`; the file is deleted unless `--keep-downloads` |
| `text(locator)` | Text of the first match a person can see (the one `mark()` outlines), whitespace collapsed (uses `textContent`) |
| `visible(locator)`, `count(locator)` | Small helpers |
| `secretBox({ title, fields })` | A box on the page where the user types values a step needs (an API account); `null` removes it |
| `inPage(fn, arg)` | Run `fn({ fields, arg, url })` inside the page; the box's values come back masked as `•••`. Waits while a required field is empty. Call the application as `fetch(url('/api/…'))`, so the call keeps `base`'s path |
| `poll(fn, { until, timeout, interval })` | Call `fn` until `until(value)` holds (default: truthy) or `timeout` ms pass (default 30000, every 1000); returns the last value |
| `undo(n)` | Run step `n`'s undo now, in this step (a clean-up step); `true` if it ran, `false` if step `n` has none waiting (not allowed, or already put back). A failed undo throws |
| `probe({ field, submit, saved, message, values })` | Send one field's form once per value and sort what happened; only in a step marked `probe: true` (rule 18, [probing](probing.md)) |
| `state` | An object shared by all steps of the walk |
| `data` | The environment's test records: the plan's `data` with the chosen environment's laid over it (rule 19) |
| `sql(query)` | Run SQL on the environment's test database (rule 20): `{ rows, affected, value }`, every field as text |
| `url(path)` | The full address of a path of the application, read as `goto` reads it |
| `sleep(ms)`, `log(msg)`, `walkDir` | — |

`check` returns `true/false`, `[ok, text]`, `[ok, okText, failText]` or `{ ok, text }`. If `run` or `check` throws,
the panel shows the error as a failed check and the user decides.

For an API (called with an account of its own, or as the user who is signed in), a value of the user's put into a
form, the database, or a background job, see [patterns](patterns.md).

## Rules

1. **One step, one action.** Several clicks that form one action are fine (fill + submit); two things to verify are two
   steps. The user wanted it slow: more short steps beat fewer long ones.
2. **`did` is past tense, concrete, with on-screen names in quotes.** "I clicked "Save"", not "save the form".
3. **`expect` uses the screen's exact texts**, taken from localisation files or views, in the panel's language. Say
   where to look ("at the top", "in the row of …") and what must be absent when that matters.
4. **Mark every step.** `mark()` the element the user should look at; for a message, the message; for a table change,
   the row. `mark()` outlines the first match a person can see — layouts often hold screen-reader-only twins (a hidden
   `h2` before the page title). Give it the whole locator, **not** `.first()`: `.first()` picks the hidden twin before
   the engine can choose (it widens a narrowed locator as a fallback, but do not rely on it). A specific selector
   (`page.locator('h2', { hasText: '…' })`) is best. When nothing visible matches, the panel shows "the place to look
   at was not found"; when several visible elements match (`hasText` matches substrings: two paragraphs carrying the
   same phrase), it says only the first is outlined, and `text()` says so too if their texts differ. Treat both as
   plan bugs: narrow the locator (an exact `hasText` regex, the containing card, an id). A step with nothing on the
   screen to look at (a database count, a job waited for — see [patterns](patterns.md)) does not call `mark()`; its
   panel then heads `expect` with "What to expect" instead of pointing at an orange outline.
5. **Check whenever it can be checked.** The automatic check is a second pair of eyes, not a replacement for the user.
6. **Order:** setup → happy path → validation errors → edge cases (expired, limits, empty) → confirmations and
   permissions → help pages → the other language (where the application has one) → clean-up. A step may rely on the
   previous ones; `--from`/`--only` then need the earlier changes in place (the panel says so).
7. **Use test records.** Write ids into the plan; never act on records the user did not choose for testing. What the
   plan creates, it removes, the way the application removes things: where the application only marks a record
   deleted, that mark is the clean-up, and the checks count the records still active.
8. **Irreversible screen actions** (suspend, delete, send): either click the dialog's "No/Cancel" and verify the dialog
   only, or make the step a permitted one (`approve`) so the user agrees first.
9. **Permitted steps** (`approve`) for anything outside the page — see [safety](safety.md). Use `skipTo: <n>` when the
   steps after it make no sense without it (steps before `n` are skipped too). Give such a step an `undo` whenever its
   change can be put back:

   ```js
   undo: {
     what: 'Order 2001\'s due date goes back to what it was.',     // shown when asking, and in the report
     run: async ({ state, data }) => { if ('dueBefore' in state) await setDue(data.order, state.dueBefore); },
   },
   ```

   The undo is taken down when the user allows the step, before `run`: a step that fails half-way is put back too, so
   write the undo to do the right thing whatever the step got done (read the old value into `state` first, and do
   nothing without it). A clean-up step may run it with `undo(n)`; what is left runs when the walk ends, after ■ Stop,
   an error or the browser closing, last change first, without asking. An undo gets `state`, `data`, `base`, `url`,
   `log` and `poll`, never the page (the browser may be gone): use the database tool or an API. It has 60 s. The
   closing panel and the report's "Undo" section say what was put back and what was not, with `what` to do by hand.
10. **Navigation:** after a click that loads a page use `submit()` (or `Promise.all([page.waitForEvent('load'),
    click])`); `waitForLoadState` alone returns at once on the current page.
11. **Text:** read with `textContent`/`text()`; `innerText` returns CSS-transformed text (upper-case headers).
12. **Dates:** fill `<input type="date">` with `yyyy-MM-dd`; the browser shows it in its own format. To see a validation
    balloon, click submit and read `validity` / `validationMessage` of the field.
13. **Stable selectors:** ids, `data-*`, form `action*="handler=…"`, a row filtered by its exact cell text. Avoid
    positions (`nth`) unless the order is the thing being tested.
14. **Values the user must give** (an account for an API call) go into `secretBox`, never into the plan, a constant,
    an environment variable or the chat. See [patterns](patterns.md#calling-an-api-with-the-users-account). A
    password for a test record the plan creates (a test user) is such a value too, however throw-away: the user
    types it into the box and the step puts it into the form
    ([patterns](patterns.md#a-value-the-user-gives-put-into-a-form-of-the-page)). The application's own API, called
    as the user who is signed in, needs no value at all
    ([patterns](patterns.md#calling-the-applications-own-api-as-the-signed-in-user)).
15. **The application's own dialogs.** While a modal `<dialog>` is open, the panel and the value box move inside the
    one on top, so they stay clickable; their clicks and keys stop there and never reach the page's handlers. A dialog
    styled with `transform`, `filter` or `contain` carries them along: they are placed and clipped against it. If the
    panel looks out of place inside such a dialog, mark the dialog's content and let the step close it with the next
    action.
16. **Browser errors.** The panel shows under each step what the browser reported since the previous answer: script
    errors (uncaught, unhandled rejections), `console.error`, failed requests and HTTP 4xx/5xx responses. Chrome's own
    "Failed to load resource" echo and cancelled requests (`net::ERR_ABORTED`: a download, a page leaving) are not
    counted. A step that expects an error response (a refused sign-in, a validation 400) says so in `expect`, in the
    panel's words: "Under the step the panel shows "⚠ In the browser: 1 failed request"". Such a step does not go on by
    itself under `--auto`. Put noise the application always makes in this environment (a dev-only hub, telemetry) in
    the plan's `ignoreErrors`: regular expressions, or pattern strings (case-insensitive), matched against the line
    the panel shows, e.g. `'GET /hub/negotiate → 404'` or `/WebSocket connection to .* failed/`. Ignored errors are
    still counted as ignored. Never use it to hide an error the change under test causes.
17. **Network (`--network`).** Under each step the panel also shows a 🌐 line (requests, bytes, the slowest call) and
    the strong findings. ⛔ critical: a secret field in a JSON answer (`password`, `passwordHash`, `token` outside a
    sign-in or token endpoint, `secret`, `apiKey`, a card number), a secret in an address (`?access_token=`), part of
    a connection string in an error answer. ⚠ warning: a call taking 3 × `slowMs` or more, the same call 3 or more
    times in a row (sent by the page itself within 2 s of the previous one's end, with no click or typing in between:
    a page polling on a timer or a step deleting rows one by one is not one), a personal data field (`iban`, `tckn`, a national id: does this screen need it?), a stack
    trace or database error in an error answer. The report lists every finding, also calls over `slowMs` and answers
    over 1 MB, and per site the missing security headers, headers that name the server, session cookies without
    HttpOnly or Secure, and text sent uncompressed. Headers and bodies are read only for the application's own
    addresses: the host of `base` on any port, and `network.origins` for an API elsewhere. On a local address the
    findings a developer machine shows on purpose (the framework's error page, the site's headers) are marked
    "expected in this environment" and not counted. A critical finding keeps `--auto` from going on; warnings do not.
    `network.slowMs` (default 1000) sets "slow"; `network.ignore` leaves calls out entirely (patterns matched against
    `GET /path`): a long poll or a streaming hub, never a finding the change under test causes. A step that expects a
    finding says so in `expect`, as for browser errors.
18. **Probing (`--probe`).** A step marked `probe: true` runs only with `--probe` and always asks first, as a permitted
    step does (its own `approve` says what it may save; without one the panel says so in general words). Inside it,
    `probe()` sends one field's form with every value the user approved in the plan, each with its expectation and
    where that comes from. Put probe steps after the happy path, end with a probe clean-up step, and see
    [probing](probing.md) for the catalog, the expectations and what a try leads to.
19. **Environments (`envs`, `--env`).** One plan walks on this machine and on a shared test server. The plan's own
    `base`, `start`, `data`, `login`, `db` and `signIn` are its default environment; `envs` names others, each
    overriding what it gives (an environment without `base` keeps the plan's, its `data` is laid over the plan's key
    by key). `login` belongs there too: one server signs in through an identity provider of its own, another through
    its own `/Account/` pages. `--env test` picks one; `--base` still overrides the address. Steps take record ids from `data` (`goto(`/orders/${data.order}`)`),
    never from constants, since a test server's records are not the developer machine's. Several plans share their
    environments with a module of their own: `envs: require('../envs')`. The walk records the environment's name; its
    report names it and compares only with earlier walks in the same environment, and `--retry-failed` reruns the ✖
    steps of the newest walk there. The remote-address rule for permitted steps is unchanged.

    `signIn: 'windows'` (in the plan or an environment) is for a site that signs in with the Windows account (IIS
    Windows authentication). Chrome and Edge send that account by themselves to `localhost` and a bare machine name,
    but not to a full name (`test01.corp.example`): there the page fails at once with no dialog, and the walk stops
    saying to add `signIn: 'windows'`. With it the browser may send the account to the host of `base`, and only there.
    `node run.js doctor --base <url>` shows beforehand whether the site asks for it and whether it then signs in.
20. **The test database (`db`, `sql()`, `db: true`).** A plan or environment with `db: { server, database, login }`
    (SQL Server, through `sqlcmd`) gets `sql(query)` in its steps and undos. With `login: 'sql'` (the default) the
    engine opens a tab of its own before the sign-in, shows the server and the database, and the **user** types an
    account there; the engine tries it at once and asks again when it is refused. A server or database the plan
    leaves out (`db: { login: 'sql' }`) is typed there too: the tester often knows the test server better than the
    plan's author. What the plan gives is shown, not editable. The account stays in the engine's
    memory for the walk and reaches sqlcmd in its environment only. With `login: 'windows'` the user's Windows account
    is used and the tab opens only when it fails. **Continue without the database** skips every step marked `db: true`
    ("no database", following its `skipTo` as a declined step does); `sql()` elsewhere then throws. Mark every step
    that needs the database `db: true`.

    In a suite (`run <folder>`) the tab is answered once: the next plans on the same database use that account, or go
    on without the database if that was the answer, and their reports say "as answered earlier in the suite". The same
    database means the same `login` kind and that every server or database the plan names is the one connected to; a
    plan that leaves the names out takes the ones typed. So the plans of one folder share their `db` through the
    module they share their environments with. A plan that names another database asks for itself.

    `sql()` returns `rows` (arrays of text, `NULL` as written), `affected` (the last "rows affected" count) and `value`
    (the first column of the first row). A failure says only its kind (the account, the database, the network, sqlcmd
    missing, no permission, a query): sqlcmd's message may hold data and is never shown. Write fixed query text with
    ids from `data` or `state`, select only counts and states, and put no row into `did`, `expect`, a check text or
    `log`. A write is a permitted step with an `undo` (rule 9); on a shared server, ask for an account that may write
    where the undo writes, or the change stays. See [patterns](patterns.md#reading-and-writing-the-database).
21. **The application's version (`appVersion`).** On a shared test server, say which build was walked: the plan's
    `appVersion(ctx)` runs once after the sign-in and returns a short text (a footer, an about page, a version API
    through `inPage`). The report's header and the first line of the paste block carry it, cut to 40 characters. If
    it opens another page, the walk goes back to the start page before step 1. A failure is recorded as "not read"
    and the walk goes on.
