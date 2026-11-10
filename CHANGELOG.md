# Changelog

## Unreleased

- **`--probe`: probing a form the way an experienced tester would.** A step marked `probe: true` sends one form field
  every value the user approved in the plan, one value at a time, and the panel shows one table of what each led to.
  - The table has a row per value: the value (shortened, `x×92`), what the plan expected and where that comes from
    (🔧 the code · 📘 the catalog · ❓ an assumption), what happened, and the application's message.
  - What happened: 💥 crashed (a 5xx, a script error or a failed request) · 🛑 not sent (the browser's own check, a
    field that does not take the value, a disabled button) · ⛔ refused (the application's message, or an error status
    with nothing on the screen) · ✔ saved (✂ when a `maxlength` kept only part of it) · ❔ unclear.
  - A row that differs from its expectation is red and fails the step's automatic check, so ✔ takes a second click.
  - Without `--probe` probe steps are skipped ("runs with --probe"), so a plan can keep them. Naming one with `--only`
    or `--retry-failed` without `--probe` is refused with a clear message.
- **A probe step is always a permitted step.** It asks first, also without an `approve` of its own, and is off on a
  remote address unless `--allow-remote-writes` is given. It never goes on by itself under `--auto`. While it runs, the
  panel shows "Try 3 of 11" with ■ Stop and lets clicks through to the page. A stop keeps the tries before it.
- **A form is waited for, not its page load.** Each try waits until something happens (an error answer, the browser's
  refusal, "saved", the application's message) or its timeout runs out. A form that sends with a script and never
  loads a page is probed like one that posts.
- **What a probe sends does not turn into noise.** A refused value's 4xx belongs to its try, not to the step's
  browser errors; a 5xx or a script error is both. Each try counts "the same call" on its own, so a page opened once
  per try is not a repeated call for `--network`.
- **The report has a "Probing" section.** Each probe step has a table, with notes: rows not sent did not test the
  server, and an assumed expectation that differs is doubted first. The summary and the note column count the tries;
  the paste block lists only the rows that differ, each with the application's message.
  - A probe step skipped without `--probe` stays out of the comparison with earlier walks and of the paste block.
- **The application's message is recorded, cut to 120 characters.** It is the only message text a walk keeps, since
  it answers the plan's own test value. A probe does not run while the value box is open.
- New `references/probing.md`: when to probe, reading expectations from the code's rules, the catalog of values
  (text, characters, number, date, e-mail, phone, flow probes such as a double click), test-record prefixes and the
  clean-up step.
- The demo has four probe steps (`demo --probe`): the order's notes (at most 100 characters; an emoji fails with 500
  on purpose), the due date, a double click on "Add note", and the clean-up of what they saved. Without `--probe` the
  demo walks its 14 steps as before.

## 1.3.2 — 2026-11-09

- **`--network` no longer reads a translation file's labels as secrets.** In the first walk on a real application, an
  Angular translation file (`assets/i18n/tr.json`) was a critical "secret field" finding: its keys such as
  `common.password` map to the label the screen shows. A translation file is now known by its folder (`i18n`, `l10n`,
  `locales`, `lang`, `translations`) or by a language code as its name outside an API path (`en-US.json`), and its
  field names are not read. A configuration file the page loads (`assets/config.json`) is still read: a key in it is
  a real leak.
- **Each step is compared with the walk in which it was last answered.** A report compared with the walk just before,
  so after a walk stopped at its first step every step read "○ → ✔". The same noise followed a `--retry-failed` walk
  that ran a few steps. A step is now compared with the newest earlier walk in which it got ✔ or ✖ (up to 20 walks
  back).
  - The heading names the walks compared with.
  - When there are several, each line names its walk.
  - "No longer in the plan" still refers to the walk just before.
- **`--network` no longer adds up sizes the browser does not know.** The browser gives -1 for such answers. In
  sign-in steps full of redirects, a step's size came out below zero.
- The report says why a response body was not read: the page had moved on (a sign-in through the identity provider),
  or time ran out.

## 1.3.1 — 2026-11-09

- **The comparison with the previous walk follows a step by its title.** It matched steps by number, so in a plan
  that gained, lost or moved a step every later step was compared with another one. A step is now the same step when
  its title is; of two steps with the same title, the second stays the second.
  - A new step reads "new step → ✔".
  - A step that moved names its old number ("was step 2").
  - A step no longer in the plan is listed.
  - A plan translated or renamed throughout shares no title with its previous walk. With as many steps, it is still
    matched by number.
- `main` now holds released versions only. Work happens on `next` and reaches `main` with a release, so an install
  from the marketplace or a clone of `main` never gets unreleased code.

## 1.3.0 — 2026-11-09

- **`--network`: what the network did, under each step.** A 🌐 line in the panel gives the step's requests, bytes on
  the wire and slowest call, followed by its strong findings, updated while the panel waits.
  - ⛔ **Critical:** a secret field in a JSON answer (`password`, `passwordHash`, `secret`, `apiKey`, a card number,
    a token outside a sign-in or token endpoint), a secret in an address (`?access_token=`), or part of a connection
    string in an error answer.
  - ⚠ **Warning:** a call taking 3 × `slowMs` or more, the same call three or more times in one step (N+1), a
    personal data field (`iban`, `tckn`, a national id), or a stack trace or database error in an error answer.
  - The report adds a "Network" section with every finding, also calls over `slowMs` and answers over 1 MB, and per
    site the missing security headers (on how many pages), headers that name the server, session cookies without
    HttpOnly or Secure, and text sent uncompressed.
  - Headers and bodies are read only for the application's own addresses (the walk's host on any port, plus the
    plan's `network.origins`), and only in memory. `events.jsonl` gains `network` and `walk.json` gains `network`;
    both keep counts, times, sizes, paths as for browser errors, and the names of the fields
    (`$.items[].passwordHash`), parameters, headers and cookies a finding is about, never a value.
  - A request sent while the value box is drawn is counted and timed only.
  - On a local address, what a developer machine shows on purpose (the framework's error page, the site's headers) is
    marked "expected in this environment" and not counted.
  - A critical finding keeps `--auto` from going on by itself; a warning does not.
  - A plan can set `network: { slowMs, origins, ignore }`. A bad setting is refused before the browser opens.
- **Work items with a key.** `run PROJ-123` and `report PROJ-123-2` find the plan of a Jira or Linear key like a
  number. A key that is also a walk of another plan (plan `proj`, walk `proj-123`) is an error that lists both, never
  a guess. The report writes `#` only before a number. The workflow reads `PROJ-123`, `AB#6655` and `#6655` in
  branches and commits.
- **Plans in the repository.** The README describes keeping a plan next to the code and walking it with
  `run <file.js>`, with or without Claude.
- The demo's help page makes three more background calls that change nothing on the screen: a profile that sends a
  password hash, settings asked for three times, and statistics that take 1.5 s. `demo --network` shows them in
  step 14. Without the flag the demo walks as before.

## 1.2.0 — 2026-11-06

- **Browser errors under each step.** The panel shows what the screen does not: uncaught script errors (and unhandled
  rejections), `console.error`, HTTP 4xx/5xx responses and requests that failed, counted from the previous answer to
  this step's answer, and updated while the panel waits. Chrome's own "Failed to load resource" echo (it would count
  every failed request twice, with its query) and cancelled requests (`net::ERR_ABORTED`: downloads, a page leaving)
  are left out, and so is the sign-in. `events.jsonl` gains `browserErrors` (counts and the first five entries: kind,
  method, path without query, id-like parts as `•••`, status, the error's type and the script's place; never a
  message or a body); while the value box is drawn even the path is masked. The report flags those steps in the
  summary, the note column and the paste block, and lists them in a new "Browser errors" section; the closing panel
  and the `result:` line count them. A step with browser errors does not go on by itself under `--auto`.
- **`ignoreErrors`** in a plan: regular expressions or pattern strings for noise the application always makes in that
  environment, matched against the panel's line; such errors are counted as ignored, not as errors. A bad pattern is
  refused before the browser opens.
- The demo's help page loads its tips in the background and the demo fails that call on purpose (step 14); step 12
  shows the refused API sign-in with its address masked.
- The description now also says "acceptance test" and "UAT walkthrough", the words people search for; the trigger
  list gains "acceptance test / UAT / walkthrough" and "kabul testi". No change in behaviour.

## 1.1.0 — 2026-11-05

- **Install as a plugin.** The repository is now a Claude Code plugin and its own marketplace
  (`.claude-plugin/plugin.json` and `marketplace.json`): `claude plugin marketplace add omrsyr/guided-smoke`, then
  `claude plugin install guided-smoke@omrsyr`; `claude plugin update guided-smoke@omrsyr` brings a new version. The
  clone into `~/.claude/skills` keeps working, and when both are present the plugin takes precedence. A test keeps
  the plugin's version in step with SKILL.md and run.js.

## 1.0.1 — 2026-11-05

- **A download in the second walk of a kept profile crashed Chrome.** Chrome keeps downloads in the profile's
  browsing history; with the earlier walk's download in it (a file Playwright had already deleted), Chrome 153
  crashed at the next download, or hung headless. The engine now drops that history before the browser opens a
  profile; the sign-in is kept elsewhere and stays. Edge was not affected. The tests now also walk twice on one
  kept profile.
- **`--video` after a crash.** The recording was renamed while Playwright still held it, and the walk ended with
  `EBUSY`. Recordings are now saved with Playwright's `saveAs`, in the order the pages opened; after a crash the
  walk links the file Playwright was writing, under its own name.
- With `--fresh`, a crashed browser's helper processes could keep the throw-away profile busy and end the walk
  with an error while removing it. The removal now retries and then leaves the folder to the system.

## 1.0.0 — 2026-11-05

- **`--auto`.** A step whose automatic check passed without plan warnings goes on by itself after a 3-second
  countdown in the panel; **⏸ Wait** or any button keeps it for the user. Failed or missing checks, permitted steps
  and value-box waits always wait. Such steps are recorded with `answeredBy: "auto"` and read "✔ passed (by
  itself)" in the report and the paste block; the closing panel counts them.
- **`--panel left|right[,min]`.** The panel's corner (the value box takes the other one) and whether it starts
  minimized; the user's own minimize choice carries over to the next panels.
- **`--video`.** The walk is recorded as `video/walk.webm` in the walk folder; while recording, every field of the
  value box shows dots. It needs Playwright's ffmpeg, fetched once by the new `setup --video` (about 4 MB); without it
  `--video` stops before the browser opens and says so, and `doctor` shows whether video is ready.
- **`--trace`.** A Playwright trace after the sign-in, in parts (`trace-1.zip`, …): each part is its own recording,
  ending when the value box appears and starting again when the plan removes it, so the box's values and the requests
  sent with them are in no part (a test unzips the parts to check). The report links the recordings and says to keep
  them on this machine; safety.md explains what they hold.
- **Node.js 20 or newer** (was 18): playwright-core 1.63 needs it. Older versions get a clear message and exit
  code 3 before anything loads.
- **Tested on Windows, macOS and Linux.** GitHub Actions runs `setup`, the engine's tests and the headless demo in
  Chrome on all three on every push (Node.js 24), and on Linux with Node.js 20, the oldest supported. With
  `GUIDED_SMOKE_REQUIRE_BROWSER` set, the browser tests fail instead of skipping when no browser can run.
- **Demo.** `node engine/run.js demo` (or `/guided-smoke demo`) starts a small orders application on 127.0.0.1 and
  walks a 14-step plan against it, in the panel's language (English or Turkish): sign-in, a form, a validation the
  browser blocks, a download, the application's dialog, two permitted steps, a background job waited for with
  `poll`, and API calls through the value box. The data lives in memory only. `examples/demo/steps.js` replaces
  `examples/example.steps.js` as the example of every kind of step.
- `engine/test/demo.test.js` walks the demo headless in both languages, with a harness in the user's place; it is
  skipped when playwright-core or a browser is missing. `examples/demo/screenshots.js` regenerates the README
  screenshots in `docs/` (English only; both READMEs use them).
- **Value box for API calls.** `secretBox({ title, fields })` draws a box at the bottom left of the page where the user
  types an account a step needs; `inPage(fn, arg)` runs `fn({ fields, arg })` inside the page. Before a result or an
  error leaves the page, every value from the box is masked as `•••`; the masked result is shown in the box. A page
  load clears the box. Screenshots leave it out.
- **A step waits for an empty value box.** When the user moves on before typing (or a page load emptied the box),
  `inPage` waits instead of failing: the box is outlined in orange with a **✔ Use these values** button, the panel offers only
  **■ Stop**, and the step goes on once the box is filled in.
- **✔ over a failed automatic check takes a second click.** The button turns orange and asks again; the step is
  recorded as passed with `againstCheck`, and the report flags it in the summary, the note column and the paste block,
  as does the closing panel and the `result:` line.
- **The panel works over the application's modal `<dialog>`.** `showModal()` makes the rest of the page inert, so the
  panel and the value box could not be clicked and the walk stalled. While a modal dialog is open they now live inside
  it, and they come back to the page when it closes; what was typed stays. The demo's cancel dialog is a native
  `<dialog>` to keep this covered.
- **`run <file.js>` links the file instead of copying it.** The plan's relative `require`s keep working, the file is
  the one copy to edit, and the walk's `steps.snapshot.js` holds the plan itself, not the link. A different plan
  already stored under the same id is replaced only with `--force`.
- **Stop during the box wait really stops.** Every helper refuses afterwards and the page sends no request, so a plan
  that catches the error cannot go on changing the application.
- **Masking covers more.** Form encoding, base64, Basic credentials (`a:b`) and numbers equal to a value are masked;
  an `Error`, a `URL`, a `Map` or a class instance is turned into plain data before it is masked, so nothing leaves
  the page with contents that were not looked at.
- With nested modal dialogs the panel goes into the one opened last, which is the one on top. Clicks and keys in the
  panel and the box no longer reach the page's handlers (close on an outside click, focus traps).
- A value box that vanished from the page (a client-side route change) is drawn again and waited for, instead of
  failing the step with "the value box is no longer on the page".
- A plan stored by 0.1.2 as a copy of the same file, or a path differing only in case on Windows, counts as the same
  plan for `run <file.js>`. `demo --project <name>` refuses to replace that project's own plan named "demo".
- The demo server answers a request it cannot parse with 400 instead of ending the walk, accepts sign-in targets on its
  own pages only and keeps the target after a mistyped password.
- `references/safety.md` opens with "A plan is code": what a plan can do, which plans to run, and what the guards are
  and are not.
- A browser test fails if a playwright-core upgrade breaks how `mark(locator.first())` finds the visible match.
- **`poll(fn, { until, timeout, interval })`** waits for an effect (a background job, a row count) and returns the
  last value.
- **Several matches are flagged.** `text()` reads the first match a person can see, the same element `mark()`
  outlines. When several visible elements match, the panel warns (for `text()`, only if their texts differ). The
  warnings are recorded and appear in the report's note column, and so does "nothing to outline".
- `references/patterns.md`: calling an API with the user's account, using the project's database tool, triggering a
  background job and waiting for it.
- The template marks `h1` instead of `h1, h2`.
- **The panel points at an orange outline only when there is one.** A step that outlined nothing (a database check,
  a job waited for) heads its expectations "What to expect" / "Beklenen sonuç" instead of "What you should see
  (outlined in orange)".

## 0.1.2 — 2026-11-03

- `mark(locator.first())` still outlined nothing when the first match was the hidden twin: `.first()` narrows the
  locator before the engine can choose. The engine now widens a locator narrowed with `.first()`/`.nth()` when that
  element is not on screen and outlines the first visible match of the same selector. The template no longer uses
  `.first()`, and writing-steps says to pass the whole locator.
- The sign-in, permission and closing panels no longer say "what you should see (outlined in orange)" — nothing is
  outlined there. They read "What you need to do", "What will change" and "Result".

## 0.1.1 — 2026-11-03

- **Outline the element a person can see.** `mark()` skipped the outline when the first match was hidden — common
  when a layout puts a screen-reader-only heading before the page title. It now picks the first match that is really
  on screen (size, display, visibility, opacity, clipping), brings a tall element in by its top edge below a fixed
  header and centres a short one, and draws a thicker outline. If nothing visible matches, the panel says so.
- **Browser language follows the system.** Without `--locale`, the walk uses the plan's `locale` or the system's
  (e.g. tr-TR), and Chrome/Edge is started with `--lang` so date inputs and validation balloons are in that language
  (before: "Value must be 10/25/2028 or earlier.", now: "Değer 25.10.2028 veya daha geri olmalıdır.").
- `doctor` shows the detected locale.

## 0.1.0 — 2026-11-03

First version.

- Guided walk in the installed Chrome or Edge (system default first, `--browser` to force): action, orange outline,
  automatic check, panel with ✔ Correct / ✖ Different (note) / ■ Stop / 📷 screenshot / minimize.
- Plans and walks with short ids (`6655`, `6655-2`); walks are never overwritten.
- Commands: `doctor`, `setup`, `init`, `run`, `list`, `report`, `reset-login`, `paths`.
- Partial runs: `--from`, `--only`, `--retry-failed`.
- Permitted steps for changes outside the page; off on non-local addresses unless `--allow-remote-writes`;
  `--skip-writes`.
- Per-project, per-browser profile (password saving off), `--fresh`, "sign out and clear the profile".
- `events.jsonl` written as it goes; `report.md` with measured time, comparison with the previous walk and a paste block.
- Panel in English and Turkish.
