# Report

`run` writes `walks/<walk-id>/report.md` when it ends (also when stopped or failed); `node run.js report <ref>`
rebuilds it. It contains:

- **Header:** walk id, plan, work item, date and time, **measured walk time** (from the start page being ready to the
  last answer; sign-in wait excluded), browser, address, result (completed / stopped / error), filter, and links to
  the recordings of `--trace` / `--video` with a reminder to keep them on this machine.
- **Summary:** ✔ passed · ✖ different · ⏭ skipped · ○ not run, and the steps passed although their automatic check
  failed (also flagged in the note column and in the paste block). Mention them to the user; they still count as
  passed, since the user has the last word. With `--auto`, how many passed steps went on by themselves; those steps
  read "✔ passed (by itself)" in the table and the paste block. Say so when you summarise: the user did not look at them.
  The steps where the browser reported errors.
- **Steps:** number, title, result (with the reason of a skip), automatic check, the user's note (plan warnings and
  the browser's error counts too), screenshot link.
- **Browser errors** (only when there are any): per step the first ones as kept: kind, method, path, status, the
  error's type and the script's place; how many more; how many the plan's `ignoreErrors` left out. Messages are not
  in the records; "•••" alone means the value box was open.
- **Network** (only with `--network`): per step the requests, bytes, slowest call and findings (⛔ critical, ⚠
  warning), then every finding as a line; findings a local walk expects are marked "expected in this environment"
  and not counted. Then a "Site" part per address of the application: missing security headers (on how many pages),
  headers that name the server, session cookie flags, text sent uncompressed. On a local address all of it is
  expected there, to be checked on the test or production server. The summary names the steps with findings, and the
  paste block counts them.
- **Compared with earlier walks** of the same plan: every step whose result changed (`✖ → ✔`), each against the newest
  earlier walk in which that step was answered ✔ or ✖, so a walk stopped early or a `--retry-failed` walk adds no
  noise. The heading names the walks compared with, and with several each line names its own. Steps are matched by
  title: a new step reads "new step", a moved step names its old number, a step no longer in the plan is listed.
- **To paste into the work item:** a plain-text block with the ✔/✖ list (with the browser's error count per step) and
  the measured time.

## What to tell the user afterwards

Keep it short:

1. The counts and the measured time.
2. Every ✖ with the user's note, and what you think it means (a bug, a wrong expectation in the plan, test data).
   Also every step with browser errors, even a ✔ one: the user judged the screen, the browser saw more. Say whether
   the step expected them (a refused call) or they point at a bug (a 500, a script error); for recurring noise of
   the environment, suggest `ignoreErrors`. With `--network`, every ⛔ finding (a secret where it should not be:
   name the field or parameter and the call) and the ⚠ ones worth a change (a slow or repeated call, personal data
   the screen does not show); for a remote address also the site's missing headers and cookie flags. Never a value.
3. The next action: fix and `--retry-failed`, or "all passed".

## Effort

- The measured time is the browser walk only. The user's own extra checking (looking at data, reading logs) is theirs
  to state; when you propose an effort figure, ask for or include it instead of using the measured time alone.
- Smoke time is part of the work item being tested; it does not get a work item of its own.
- If a tracker skill is in use, hand the paste block to it; this skill never writes to the tracker itself. Without a
  work item or tracker access, leave that part out.
