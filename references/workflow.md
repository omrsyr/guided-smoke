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

### From a work item alone (`guided-smoke plan 6655`)

A tester often starts from the work item, without the session that made the change. Read in this order:

1. **The work item:** description, acceptance criteria, comments (a technical summary, a "how to test" note). Use
   the user's own way in: `gh issue view`, a tracker skill or connector, or the text pasted into the chat. Read only.
2. **The change:** the commits and pull requests linked to it, or naming it as its tracker links them, and their diff.
3. **The repository:** the screens' texts (localisation files, views), the validation rules, the scripts the change
   brought.

A work item rarely says what a plan also needs: where the application runs and who signs in, the screens' exact
texts, which test records to use, what changes outside the page and how it is put back. Take them from the
repository and the environment (step 2 below), and ask for what neither holds.

### A thin work item

A title and little else. Do not refuse it, and do not write the plan from the code in silence: a plan read from the
code checks that the code does what the code does.

1. Draft the plan from the diff and the repository.
2. Ask at most three questions, only where the answer changes the plan, each with a default the user can accept:
   what the change is for, in a sentence · which roles see it and whether a test account exists for each · which test
   records to use (the plan's own, or existing ones and how to recognise them) · what the change touches outside the
   page.
3. Mark where each expectation comes from (step 3 below), so the user sees how much of the plan is the code's word.

### A work item that is ready for a smoke

When a project's work items are thin again and again, suggest once that they carry a short "Smoke" part. Free text
is enough; nothing parses it, and every tracker can hold it:

- **Where:** the menu path or the screen the change shows on.
- **Who:** the roles that see it, and whether a test account exists for each.
- **Test data:** the records to use, or that the smoke makes its own, and how to recognise them.
- **Outside the page:** what the change writes elsewhere (a table, a mail, a job), and how a test puts it back.
- **Not a smoke:** the criteria no screen shows (a script safe to run twice, the shape of a log line), so that a plan
  can say why it leaves them out.

Suggest the text; the skill never writes to a tracker.

## 2. Preflight (before writing steps)

Check, do not assume:

- **Runtime:** `node run.js doctor`. Runtime missing → tell the user `setup` installs `playwright-core` from npm into
  the data folder and run it after they agree. Without access to the public npm registry (a closed network): npm
  honours the company's registry or proxy (`npm config set registry <internal registry>`, or `HTTPS_PROXY`), or copy
  the data folder's `runtime` folder from a machine of the same operating system that has it (`node run.js paths`
  names it on both).
- **The application runs the new code:** the running process started after the last change (compare the process start
  time with the last build or file change), or ask the user to restart it. An old process makes every step lie.
- **Address:** the port the application listens on (process ports, launch settings). Pass it as `--base` or put it in
  the plan. For a shared test server, add it as an environment of the plan (`envs`, then `--env test`) with its own
  test records in `data` ([writing steps](writing-steps.md) rule 19).
- **Database / migrations:** if the project uses manual migration scripts and the branch (or a pull) brought new ones,
  check read-only whether their objects exist on the target database. Missing scripts are the user's call to run.
  When someone else will walk the plan, or it will be walked elsewhere, make that check the plan's first step: a
  look taken once here says nothing about the tester's environment.
  A plan with `db` needs `sqlcmd` (`doctor` names its version); tell the user the walk will first ask for a database
  account in a tab of its own, unless `login: 'windows'`.
- **Test data:** find suitable records read-only (an entity in the right state, enough free capacity, an account).
  Use test records; write their ids into the plan, not the user's real data.
- **A shared test server** (an environment that is not this machine), before the first walk there:
  1. `node run.js doctor --base <url>`: it answers, its certificate, whether it asks for a Windows sign-in (then
     `signIn: 'windows'` in the environment), whether it leads to a sign-in page, its server.
  2. The build: give the plan an `appVersion` and ask the user whether that build carries the change.
  3. The schema: make step 1 of the plan a read-only check that the objects the change needs exist (`sql()` counting
     them, `db: true`), so a missing migration shows at once instead of as a wrong screen later.
  4. Each permitted step gets an `undo`: the next tester finds the records as they were.

## 3. Write the plan

`node run.js init <plan-id> --title "…" [--work-item N]` creates `plans/<plan-id>/steps.js`; fill it following
[writing steps](writing-steps.md). Take every on-screen text from the application's own sources (localisation files,
views) so `expect` matches the screen word for word.

**A plan others will walk.** When a tester or a colleague will walk the plan (on a shared test server, before a
release), keep it in the repository next to the code, where it is reviewed like code: `smoke/<plan-id>.steps.js`, or
`smoke/<plan-id>/steps.js` with the files it requires. Walk the file (`run smoke/<plan-id>.steps.js`); it is linked
into the project's plans, not copied. Give it the test server as an environment (writing-steps rule 19), its record
ids in `data`, an `undo` for every permitted step, and its checks of the environment as first steps. The folder is
then a suite the tester walks with `run smoke/ --env test`. Ask before adding files to the repository.

**Where each expectation comes from.** An expectation read from the code confirms what the code does; it cannot show
that the code misread the requirement. Mark each one:

| Mark | From | It says |
|---|---|---|
| 📋 | the work item: a criterion, the description, a comment | what was asked for |
| 🔧 | the code: the diff, a validation rule, a text in the repository | what was built |
| 👤 | the user, in this conversation | what was asked for |
| ❓ | an assumption: none of the above says it | nothing yet: to be confirmed |

The marks go into the plan you show in the chat and, as comments, into the plan file (`// 📋 criterion 2 · 🔧 text
from the localisation file`). The panel does not show them. Probe values have marks of their own
([probing](probing.md): 🔧 code, 📘 catalog, ❓ assumed).

**What a diff does not show.** A diff holds what changed, not what must stay as it was:

- **Other writers of the same data.** For each thing the change stores (a new field, a field made editable), find
  the other flows that save the same record: another screen, an import, an API, a job. A flow that writes the record
  without knowing the new field may empty it. Add a regression step for each one a user can reach (save through the
  other flow, then the field is still there), or ask whether it matters.
- **The environment the plan will meet.** A script the change needs, a setting, a role: check it in a first step
  (see step 2), not in your head.

## 4. Show the plan, get approval

For probe steps (`plan --probe`, or the user asked to probe a form), show first, per field, the table of values with
their expectations and where each comes from (🔧 code · 📘 catalog · ❓ assumption) and how many come from the code, ask
at most three questions that change the plan, and write only the approved values into the plan ([probing](probing.md)).

In the chat, list the steps as a numbered list: title and one line of what the user will check. Mark probe steps (they
run only with `--probe`). Mark permitted steps
(they will ask again in the browser) and say which of them put their change back when the walk ends (`undo`). Say how many steps there are and roughly how long it takes (about 30 s per step).

For a plan made from a work item, also show:

- each step's expectations with their marks, and the count: "20 of 26 expectations come from the code (🔧), 5 from
  the work item (📋), 1 is an assumption (❓)". A plan that is mostly 🔧 is the code's word: say so, and name the ❓
  ones for the user to confirm or correct;
- a coverage table: each acceptance criterion → the steps that cover it, or why the smoke leaves it out (no test
  account for that role, nothing a screen shows).

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

### A folder of plans (a suite)

`run <folder>` walks every plan of a folder one after another: the plans of a release, or the ones a tester walks on
the test server (`run smoke/ --env test`).

- The plans are the folder's `<name>.steps.js` files and the `steps.js` of its folders; a shared `envs.js` or a helper
  is not one. They run in the order of those names, a number counting as a number (`2-` before `10-`), so a prefix
  orders them: `01-sign-in.steps.js`, `02-orders/steps.js`. A prefixed file keeps its plan id with `id:
  '6655-machine-expiry'` in the module, and with it its walk numbers and comparisons.
- Every plan is loaded and checked before a browser opens. One that cannot be walked (a mistake in the plan, no such
  environment, no address, an id used twice or already another plan's in the project) keeps the whole suite from
  starting, and all of them are named.
- Each plan is a walk of its own: a browser window of its own with the project's smoke profile, its own walk number
  and report. Every panel's header says where in the suite it is ("Plan 2/5 · Smoke 3 / 9"). Between two plans the
  closing screen names the next plan: **▶ Next plan** goes on, **■ Stop the suite** ends there.
- The database tab (a plan with `db`) is answered once: the account typed for one plan serves the next plans on the
  same database, and so does **Continue without the database**. A plan that names another server or database asks
  for itself ([writing steps](writing-steps.md) rule 20).
- **■ Stop** in a step, or closing the window, ends the suite: the plans after it are "not walked". A plan that ends
  with an error (its application did not answer) ends only itself: the next plan is walked, and the command ends with
  exit code 1.
- `--from`, `--only`, `--retry-failed`, `--work-item` and `--force` belong to one plan and are refused for a folder.
  To retry one plan's ✖ steps afterwards: `run <plan-id> --retry-failed`.
- A name that is both a folder here and a plan of the project is refused; written as a path (`./smoke`) it is the
  folder.
- Tell the user beforehand how many plans there are, their order, and roughly how long they take together.

## 6. Report

`run` writes `report.md` at the end; `node run.js report <ref>` rebuilds it. Read it and give the user a short
summary: counts, every ✖ with its note, the measured time. Follow [report](report.md). After a suite, read the
suite's report (`run` prints its path as `suite report:`), then the report of each walk it flags.

## 7. Fix and retry

For each ✖: understand the note, fix the code (or the plan, if the plan was wrong), rebuild/restart, then
`run <plan-id> --retry-failed` — a new walk that runs only the steps marked ✖ last time. The report of that walk shows
what changed. A wrong plan is fixed in `plans/<plan-id>/steps.js`; earlier walks keep their own snapshot.
