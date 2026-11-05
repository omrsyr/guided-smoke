# Changelog

## Unreleased

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
