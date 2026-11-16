# Report

`run` writes `walks/<walk-id>/report.md` when it ends (also when stopped or failed); `node run.js report <ref>`
rebuilds it. It contains:

- **Header:** walk id, plan, work item, date and time, **measured walk time** (from the start page being ready to the
  last answer; sign-in wait excluded), browser, the environment (with `--env`), address, the test database (with
  `db`: connected with a SQL or the Windows account, or none and its steps skipped), the application's version (with
  `appVersion`; it also goes into the paste block's first line), result (completed / stopped /
  error), filter, and links to the recordings of `--trace` / `--video` with a reminder to keep them on this machine.
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
- **Probing** (only with `--probe`): per probe step its table of tries (value, expected with its origin, what
  happened, the application's message), the rows that differ marked ✖, and notes: values not sent did not test the
  server; an assumed expectation that differs is doubted first. The summary counts tries and differing rows; the note
  column says "🧪 10/11 as expected"; the paste block lists only the rows that differ. A probe step skipped without
  `--probe` reads "runs with --probe" and stays out of the comparison and the paste block.
- **Undo** (only when a permitted step had an `undo`): per step whether its change was put back (by a step of the
  plan, at the end, after Stop, an error or the browser closing), failed (with the reason) or is still pending (the
  process ended first), each with what it puts back. The summary warns about every change not put back, and the
  paste block counts them.
- **Compared with earlier walks** of the same plan in the same environment (a walk on the test server is not compared
  with one on this machine): every step whose result changed (`✖ → ✔`), each against the newest
  earlier walk in which that step was answered ✔ or ✖, so a walk stopped early or a `--retry-failed` walk adds no
  noise. The heading names the walks compared with, and with several each line names its own. Steps are matched by
  title: a new step reads "new step", a moved step names its old number, a step no longer in the plan is listed.
- **To paste into the work item:** a plain-text block with the ✔/✖ list (with the browser's error count per step) and
  the measured time; its first line names the environment ("Smoke on test (…)").

## A suite's report

`run <folder>` writes a report of each walk as above, and one over them all: `suites/<suite>-<n>/report.md` in the
project's data folder (the suite is named after its folder; its records are numbered and never overwritten). It is
built from the suite's record (`suite.json`: the plans, the walk each became, how that ended) and the walks' own:

- **Header:** the suite and its number of plans, the environment, date and time, the measured walk time (the walks
  added up), the addresses and application versions walked, the flags it ran with, the result (completed / stopped).
- **Summary:** how many plans were walked and the steps' ✔ ✖ ⏭ ○ over all of them; where the user stopped it (in a
  plan, or after one on the screen between two plans); the plans not walked; the plans that ended with an error; the
  plans with a change not put back.
- **Plans:** a row per plan in walking order: its walk (a link to that walk's report), how it ended, its counts and
  time, and what its own report flags (a ✔ over a failed check, browser errors, network findings, probe rows that
  differ, changes not put back), or the error it ended with.
- **Different (✖):** every ✖ step of every plan, with the user's note.
- **To paste:** a plain-text block with a line per plan and its ✖ steps. It is the suite's, for a release or test
  cycle record; a work item still gets the paste block of its own plan's walk.

A walk that was one plan of a suite names the suite in its own report's header.

## What to tell the user afterwards

Keep it short:

1. The counts and the measured time.
2. Every ✖ with the user's note, and what you think it means (a bug, a wrong expectation in the plan, test data).
   Also every step with browser errors, even a ✔ one: the user judged the screen, the browser saw more. Say whether
   the step expected them (a refused call) or they point at a bug (a 500, a script error); for recurring noise of
   the environment, suggest `ignoreErrors`. With `--network`, every ⛔ finding (a secret where it should not be:
   name the field or parameter and the call) and the ⚠ ones worth a change (a slow or repeated call, personal data
   the screen does not show); for a remote address also the site's missing headers and cookie flags. Never a value.
   With `--probe`, every red row: the value, what was expected and what happened, and whether it is a bug (a crash, a
   value saved that should be refused) or an expectation to revisit (❓). Say when 🛑 rows mean the server was not
   tested.
3. Every change not put back (⚠ in the summary): the step, why, and what to do by hand.
4. The next action: fix and `--retry-failed` (with `--probe` for a probe step), or "all passed".

After a suite, first the whole: the plans walked and not walked, where it was stopped, any plan that ended with an
error and why. Then the points above per plan, only for plans that have something to say. The next action names the
plan: `run <plan-id> --retry-failed`, or the folder again for the plans not walked.

## Effort

- The measured time is the browser walk only. The user's own extra checking (looking at data, reading logs) is theirs
  to state; when you propose an effort figure, ask for or include it instead of using the measured time alone.
- Smoke time is part of the work item being tested; it does not get a work item of its own.
- If a tracker skill is in use, hand the paste block to it; this skill never writes to the tracker itself. Without a
  work item or tracker access, leave that part out.
