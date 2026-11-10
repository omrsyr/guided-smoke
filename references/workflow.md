# Workflow

The same order every time: find what to smoke → check the environment → write the plan → show it → run after the
user's approval → report → fix and retry the steps marked ✖.

## 1. Find what to smoke

Stop at the first source that answers it:

1. **The command:** `guided-smoke run 6655`, `guided-smoke plan 6655-machine-expiry`. If the plan exists, use it.
2. **This session:** the change you and the user just made — decisions, acceptance criteria, screens touched, texts
   added. This is the richest source; prefer it.
3. **Git:** the branch name (`feature/6655-machine-expiry` → work item 6655, plan id `6655-machine-expiry`;
   `feature/PROJ-123-login` → PROJ-123, plan id `proj-123-login`), the diff against the branch it came from
   (`git merge-base`), commits that mention the work item the way its tracker links them: `#6655` (GitHub, Azure
   DevOps), `AB#6655` (Azure Boards from GitHub), `PROJ-123` (Jira, Linear).
4. **Records:** acceptance criteria in the work item (read only, if a tracker skill and access exist), a handoff or
   design document in the repository.

If none of them tells you what to test (new session, on the main branch, no diff), do not guess. Ask one question and
offer the recent plans (`node run.js list`) and branches as choices.

**Plan id:** `<work-item>-<short-name>` in lower case (`6655-machine-expiry`, `proj-123-login`), matching the branch
slug when there is one; without a work item a short name (`login-flow`). Never end a plan id with `-<number>`: that
reads as a walk. Pass the work item as the tracker writes it (`--work-item PROJ-123`); the report puts `#` only
before a number.

## 2. Preflight (before writing steps)

Check, do not assume:

- **Runtime:** `node run.js doctor`. Runtime missing → tell the user `setup` installs `playwright-core` from npm into
  the data folder and run it after they agree.
- **The application runs the new code:** the running process started after the last change (compare the process start
  time with the last build or file change), or ask the user to restart it. An old process makes every step lie.
- **Address:** the port the application listens on (process ports, launch settings). Pass it as `--base` or put it in
  the plan.
- **Database / migrations:** if the project uses manual migration scripts and the branch (or a pull) brought new ones,
  check read-only whether their objects exist on the target database. Missing scripts are the user's call to run.
- **Test data:** find suitable records read-only (an entity in the right state, enough free capacity, an account).
  Use test records; write their ids into the plan, not the user's real data.

## 3. Write the plan

`node run.js init <plan-id> --title "…" [--work-item N]` creates `plans/<plan-id>/steps.js`; fill it following
[writing steps](writing-steps.md). Take every on-screen text from the application's own sources (localisation files,
views) so `expect` matches the screen word for word.

## 4. Show the plan, get approval

For probe steps (`plan --probe`, or the user asked to probe a form), show first, per field, the table of values with
their expectations and where each comes from (🔧 code · 📘 catalog · ❓ assumption) and how many come from the code, ask
at most three questions that change the plan, and write only the approved values into the plan ([probing](probing.md)).

In the chat, list the steps as a numbered list: title and one line of what the user will check. Mark probe steps (they
run only with `--probe`). Mark permitted steps
(they will ask again in the browser). Say how many steps there are and roughly how long it takes (about 30 s per step).
Wait for the user's go-ahead. `guided-smoke plan` stops here.

## 5. Run

Start in the background and tell the user what will happen:

```text
node <skill-dir>/engine/run.js run <plan-id> --base <url> [--work-item N] [other flags]
```

- A browser window opens. If the application asks for a sign-in, the panel says so; the **user** signs in. The
  profile keeps the session for the next walk of this project (`--fresh` for a throw-away one).
- Tell the user: green **✔ Correct, continue** moves on, red **✖ Different** asks for a short note, grey **■ Stop**
  ends the walk, **Minimize** hides the panel, **📷** saves a screenshot of the current step. When the automatic check
  failed, **✔** takes a second click; the report flags such steps. With `--auto`, a step whose check passed goes on by
  itself after a 3 s countdown; **⏸ Wait** or any button keeps it for the user. Suggest `--auto` only for a re-run
  the user already walked once by hand.
- A plan with probe steps runs them only with `--probe`. Each asks first, then shows its progress ("Try 3 of 11") with a
  ■ Stop button, and ends with the table: tell the user that red rows differ from what was approved and that ✔ then
  takes a second click.
- Suggest `--network` once when the change touches API calls, lists or error handling, or the walk runs on a test
  server: the panel then also shows the 🌐 line and its ⛔/⚠ findings under each step.
- Do not poll. Wait until the command finishes.

## 6. Report

`run` writes `report.md` at the end; `node run.js report <ref>` rebuilds it. Read it and give the user a short
summary: counts, every ✖ with its note, the measured time. Follow [report](report.md).

## 7. Fix and retry

For each ✖: understand the note, fix the code (or the plan, if the plan was wrong), rebuild/restart, then
`run <plan-id> --retry-failed` — a new walk that runs only the steps marked ✖ last time. The report of that walk shows
what changed. A wrong plan is fixed in `plans/<plan-id>/steps.js`; earlier walks keep their own snapshot.
