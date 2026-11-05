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
- **Steps:** number, title, result (with the reason of a skip), automatic check, the user's note, screenshot link.
- **Compared with the previous walk** of the same plan: every step whose result changed (`✖ → ✔`).
- **To paste into the work item:** a plain-text block with the ✔/✖ list and the measured time.

## What to tell the user afterwards

Keep it short:

1. The counts and the measured time.
2. Every ✖ with the user's note, and what you think it means (a bug, a wrong expectation in the plan, test data).
3. The next action: fix and `--retry-failed`, or "all passed".

## Effort

- The measured time is the browser walk only. The user's own extra checking (looking at data, reading logs) is theirs
  to state; when you propose an effort figure, ask for or include it instead of using the measured time alone.
- Smoke time is part of the work item being tested; it does not get a work item of its own.
- If a tracker skill is in use, hand the paste block to it; this skill never writes to the tracker itself. Without a
  work item or tracker access, leave that part out.
