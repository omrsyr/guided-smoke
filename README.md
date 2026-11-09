# guided-smoke

[![test](https://github.com/omrsyr/guided-smoke/actions/workflows/test.yml/badge.svg)](https://github.com/omrsyr/guided-smoke/actions/workflows/test.yml)

**A smoke or acceptance test you can follow: a UAT walkthrough.** A Claude Code skill that walks you through a change in a real browser: Playwright
performs each step, a panel on the page tells you **what was done** and **what you should see** (outlined in orange),
and nothing moves on until you click **✔ Correct, continue**.

[Türkçe](README.tr.md)

![A step of the demo walk: the saved message is outlined in orange; the panel says what was done, what to see and what the automatic check found](docs/screenshot.png)

Most browser-testing skills run tests on their own and hand you a result. `guided-smoke` is for the moment before a
change goes to review, when a person has to look at the screen and say "yes, that is right" — without reading a
checklist, clicking through it alone, or watching a script race past.

## What it does

- Claude writes a **plan** for the change you just made (from the conversation, the branch diff and the acceptance
  criteria) and shows it to you as a numbered list.
- After your OK a browser opens. For every step the script acts, outlines the spot, runs an automatic check and waits:
  - **✔ Correct, continue** · **✖ Different** (write a short note) · **■ Stop** · **📷 Save screenshot** · **Minimize**
  - When the automatic check failed, **✔** asks for a second click, and the report marks the step.
- Steps that change something **outside the page** (a database row, a file, an e-mail) ask first: **Yes, do it / Skip /
  Stop**. On a non-local address they are off unless you allow them.
- A step that calls an API with an account of its own asks you to type that account into a **value box** on the page.
  The call runs inside the page; the script never sees the values, and they are masked in what it gets back. If you
  move on before typing, the step waits for the box.
- Under each step the panel also shows what you cannot see on the screen: **script errors, console errors and failed
  requests** (HTTP 4xx/5xx, a call that never got an answer) the browser reported during the step.
- With `--network` it also reads the **network** for you: per step the requests, the bytes and the slowest call, and
  findings such as a slow or repeated call, a password hash or token in an answer, a secret in an address, a
  connection string or stack trace in an error page, or personal data the screen may not need. The report adds the
  site's missing security headers and session cookie flags. Only names and numbers are kept, never a value.
- Every answer is saved at once. The **report** lists what passed and what differed, the steps with browser errors,
  the measured walk time, what changed since the previous walk, and a block to paste into your work item.
- After a fix, `run 6655 --retry-failed` runs only the steps marked ✖.

## Requirements

- Claude Code (or another agent with shell access) on Windows, macOS or Linux
- Node.js 20 or newer (the floor of Playwright; 20 itself is past its end of life, so 22 or 24 is the better choice)
- Google Chrome or Microsoft Edge (no browser is downloaded; the installed one is driven)

Every push runs the tests on Windows, macOS and Linux (GitHub Actions): the engine's tests, and the demo walked
headless in Chrome. Edge is driven the same way, but the hosted runners only test Chrome.

## Install

Two ways; the skill is the same, and when both are present the plugin takes precedence over the clone.

**As a plugin**, updated by one command:

```bash
claude plugin marketplace add omrsyr/guided-smoke
claude plugin install guided-smoke@omrsyr
```

Inside a session the two steps are one: `/plugin install guided-smoke --marketplace omrsyr/guided-smoke`
(Claude Code 2.1.275 or later). A new version arrives with `claude plugin update guided-smoke@omrsyr`.

**As a skill folder**, updated by `git pull`:

```bash
git clone https://github.com/omrsyr/guided-smoke ~/.claude/skills/guided-smoke
```

On Windows (PowerShell): `git clone https://github.com/omrsyr/guided-smoke "$env:USERPROFILE\.claude\skills\guided-smoke"`

Start a new Claude Code session. The first run asks to install `playwright-core` (a few MB, from npm) into the data
folder — not into the skill folder. You can also do it yourself: `node <folder>/engine/run.js setup`, where the folder
is `~/.claude/skills/guided-smoke` for the clone, or the `Read from` path that `claude plugin list` prints for the plugin.

## Try it

```bash
node ~/.claude/skills/guided-smoke/engine/run.js setup     # once: playwright-core into the data folder
node ~/.claude/skills/guided-smoke/engine/run.js demo      # from the plugin: the same two commands in its folder
```

A small demo application starts on 127.0.0.1 and a 14-step walk opens in your browser: sign in with the account shown
on the page, then follow the panel (about 5 minutes). It covers every kind of step: a form, a validation the browser
blocks, a download, a dialog, two permitted steps, a background job, API calls through the value box and a background call that fails on purpose (the panel shows it; `demo --network` also shows what the help page's other calls send and cost). Nothing
leaves your machine, and the demo forgets everything when it stops. In Claude Code you can also say
`/guided-smoke demo`.

## Use

Say "run a smoke for this" or type:

```text
/guided-smoke                     plan the smoke for the current work, show it, run it after your OK
/guided-smoke plan 6655           plan only (no browser)
/guided-smoke run 6655            run it (a new walk: 6655-machine-expiry-1, -2, …)
/guided-smoke run 6655 --retry-failed
/guided-smoke report 6655         report of the latest walk (6655-2 for walk 2)
/guided-smoke list
```

Useful flags: `--browser chrome|edge`, `--base https://localhost:5001`, `--pace slow|normal|fast`, `--from 5`,
`--only 3,7-9`, `--screens diff|all`, `--locale tr-TR` (default: your system's), `--skip-writes`, `--fresh`,
`--auto` (a step whose check passed goes on by itself after 3 s), `--panel left,min` (corner, start minimized),
`--video`, `--trace` (recordings in the walk folder; the value box is left out of the trace; `--video` needs
`run.js setup --video` once, about 4 MB), `--network` (what the network did, under each step and in the report).
See [SKILL.md](SKILL.md).

## Sign-in and data

- **You sign in.** The script never sees a password; the browser's password saving is off in the smoke profile.
- The smoke uses its **own browser profile** per project and browser, so your everyday browser is untouched and you
  sign in once. `--fresh` uses a throw-away profile; "Sign out and clear the profile" on the closing screen deletes it.
- Plans, walks, reports and profiles live outside your repository:
  `%LOCALAPPDATA%\guided-smoke` (Windows), `~/Library/Application Support/guided-smoke` (macOS),
  `~/.local/share/guided-smoke` (Linux), or `GUIDED_SMOKE_HOME`.
- Recorded: step titles, your answers and notes, automatic-check texts, times, and of browser errors only the kind,
  method, path (no query, ids masked) and status; with `--network` also request counts, sizes, times and the names
  of the fields, parameters, headers and cookies a finding is about. Never: page HTML, cookies, form values,
  credentials, request or response bodies, error messages, the value of anything found. Screenshots only when you ask.

![The value box at the bottom left: the user typed the API account; the result shown in the box carries no e-mail or password](docs/screenshot-box.png)

## Writing plans

A plan is a small JavaScript module; Claude writes it, you can edit it. See
[references/writing-steps.md](references/writing-steps.md) and [examples/demo/steps.js](examples/demo/steps.js).

```js
{
  title: 'Due date saved',
  did: 'I typed 2030-01-31 into "Due date" and clicked "Save".',
  expect: ['A green "Saved." message appears.', 'Due date reads 2030-01-31.'],
  run: async ({ page, mark, submit }) => {
    await page.locator('#dueDate').fill('2030-01-31');
    await submit(page.locator('button[type=submit]'));
    await mark(page.locator('#order-card'));
  },
  check: async ({ page, text }) => [(await text(page.locator('#order-card'))).includes('2030-01-31'), 'Date shown.', 'Date not shown.'],
}
```

## Plans in the repository, walked without Claude

A plan does not have to live in the data folder. Keep it next to the code, for example
`smoke/6655-machine-expiry.steps.js`, and review it like code. Anyone with Node.js and Chrome or Edge can then walk
it, with or without Claude: a tester, a colleague, you before a release.

```bash
git clone https://github.com/omrsyr/guided-smoke ~/guided-smoke            # once, or use the installed skill's folder
node ~/guided-smoke/engine/run.js setup                                    # once: playwright-core into the data folder
node ~/guided-smoke/engine/run.js run smoke/6655-machine-expiry.steps.js --base https://localhost:5001
```

The panel, the questions and the report are the same as in Claude Code. The file is linked into the project's plans,
not copied, so it stays the one copy to edit, and `run 6655` finds it the next time. Its own `require`s of project
files keep working. The plan's id is its `id`, else the file name without `.steps.js`. Walks and reports stay in the
data folder of the machine that walked them. A plan is code that runs with your rights: walk only plans you have read
(see [safety](references/safety.md)).

## Development

`main` holds released versions only; work happens on the `next` branch and reaches `main` with a release.

```bash
node --test engine/test/engine.test.js     # no browser needed
node --test engine/test/demo.test.js       # the demo walked headless in Chrome or Edge (needs setup)
node examples/demo/screenshots.js          # regenerate the screenshots in docs/
node engine/run.js doctor
```

## License

[MIT](LICENSE) © 2026 Ömer Soyer
