# Writing steps

A plan is a CommonJS module in `plans/<plan-id>/steps.js`. See `examples/example.steps.js` for every kind of step.

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
| `goto(path)` | Open a path relative to `base` |
| `download(locator)` | Click, save the download, return `{ name, size }`; the file is deleted unless `--keep-downloads` |
| `text(locator)` | Visible text of the first match, whitespace collapsed (uses `textContent`) |
| `visible(locator)`, `count(locator)` | Small helpers |
| `state` | An object shared by all steps of the walk |
| `sleep(ms)`, `url(path)`, `log(msg)`, `walkDir` | — |

`check` returns `true/false`, `[ok, text]`, `[ok, okText, failText]` or `{ ok, text }`. If `run` or `check` throws,
the panel shows the error as a failed check and the user decides.

## Rules

1. **One step, one action.** Several clicks that form one action are fine (fill + submit); two things to verify are two
   steps. The user wanted it slow: more short steps beat fewer long ones.
2. **`did` is past tense, concrete, with on-screen names in quotes.** "I clicked "Save"", not "save the form".
3. **`expect` uses the screen's exact texts**, taken from localisation files or views, in the panel's language. Say
   where to look ("at the top", "in the row of …") and what must be absent when that matters.
4. **Mark every step.** `mark()` the element the user should look at; for a message, the message; for a table change,
   the row.
5. **Check whenever it can be checked.** The automatic check is a second pair of eyes, not a replacement for the user.
6. **Order:** setup → happy path → validation errors → edge cases (expired, limits, empty) → confirmations and
   permissions → help pages → the other language → clean-up. A step may rely on the previous ones; `--from`/`--only`
   then need the earlier changes in place (the panel says so).
7. **Use test records.** Write ids into the plan; never act on records the user did not choose for testing.
8. **Irreversible screen actions** (suspend, delete, send): either click the dialog's "No/Cancel" and verify the dialog
   only, or make the step a permitted one (`approve`) so the user agrees first.
9. **Permitted steps** (`approve`) for anything outside the page — see [safety](safety.md). Use `skipTo: <n>` when the
   steps after it make no sense without it (steps before `n` are skipped too).
10. **Navigation:** after a click that loads a page use `submit()` (or `Promise.all([page.waitForEvent('load'),
    click])`); `waitForLoadState` alone returns at once on the current page.
11. **Text:** read with `textContent`/`text()`; `innerText` returns CSS-transformed text (upper-case headers).
12. **Dates:** fill `<input type="date">` with `yyyy-MM-dd`; the browser shows it in its own format. To see a validation
    balloon, click submit and read `validity` / `validationMessage` of the field.
13. **Stable selectors:** ids, `data-*`, form `action*="handler=…"`, a row filtered by its exact cell text. Avoid
    positions (`nth`) unless the order is the thing being tested.
