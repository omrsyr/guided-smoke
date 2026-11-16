# A tester's guide

[Türkçe](testers.tr.md)

You test a change on a shared test server. The developer wrote a **plan** for it and keeps it in the repository,
next to the code. You walk that plan: the browser does each step, a panel tells you what was done and what you should
see, and you answer. This guide is what you need for that, with or without Claude.

## What you need

- Node.js 20 or newer, and Google Chrome or Microsoft Edge.
- The repository with the plans (usually a `smoke` folder), and access to the test server from your machine.
- For plans that read or change the test database: `sqlcmd`, and an account for that database (ask for one that may
  read, and write only where the plans do).
- guided-smoke itself, once:

```bash
git clone https://github.com/omrsyr/guided-smoke ~/guided-smoke
node ~/guided-smoke/engine/run.js setup        # playwright-core into your data folder (no browser is downloaded)
```

Without the public npm registry, see "Without the public npm registry" in the [README](../README.md#install).

The commands below are long to type. Give them a short name once per terminal:

```bash
gsmoke() { node ~/guided-smoke/engine/run.js "$@"; }                                # bash, zsh
function gsmoke { node "$env:USERPROFILE\guided-smoke\engine\run.js" @args }        # PowerShell
```

Run them from inside the repository: its folder name is the project your walks are kept under.

## Before the first walk on a server

```bash
gsmoke doctor --base https://test01.corp.example/Orders
```

It opens the address once in a hidden browser and says whether it answers, how long it took, whether its certificate
is trusted, whether it asks for a Windows sign-in, whether it leads to a sign-in page, and which server it is. If it
does not answer here, a walk will not either.

## Walk one plan

```bash
gsmoke run smoke/6655-machine-expiry.steps.js --env test
```

`--env test` picks the plan's test-server settings: its address, its test records, its database. What happens then:

1. **The test database**, if the plan uses one: a tab of its own opens first and asks for the account (and for the
   server and database, when the plan leaves them to you). The engine tries it at once and says why if it is refused.
   The account stays in memory until the walk ends and is written nowhere. **Continue without the database** skips the
   steps that need it.
2. **Sign-in:** you sign in yourself, as you always do. The script only waits. The smoke has its own browser profile,
   so you stay signed in for the next walk.
3. **Each step:** the script acts and outlines the place in orange; the panel says **what I did** and **what you
   should see**, and shows an automatic check. You answer:
   - **✔ Correct, continue** when the screen is as described.
   - **✖ Different** when it is not: write a short note of what you see instead. This note is what the developer
     reads, so say what is there, not only that it is wrong.
   - **■ Stop** ends the walk. **📷** saves a screenshot. **Minimize** gets the panel out of the way.
   - When the automatic check failed, ✔ takes a second click. Use it only when the screen really is right; the report
     marks such steps, and the plan probably needs a fix.
   - Under the step the panel also shows what the screen does not: script errors, console errors and failed requests.
     A ✔ step with such a line is still worth a word to the developer.
4. **Steps that change something outside the page** (a database row, a job) ask first: **Yes / Skip / Stop**. On a
   server that is not your own machine they are skipped unless you start the walk with `--allow-remote-writes`. Use
   it on a test server when the plan's author says the steps are safe there, never on production. A step with an undo
   puts its change back when the walk ends, also after ■ Stop.
5. **The closing screen** counts what passed and differed. **Close** keeps your sign-in for the next walk; **Sign out
   and clear the profile** removes it.

The terminal then prints where the report is.

## Walk the whole folder (a suite)

```bash
gsmoke run smoke/ --env test
```

Every plan of the folder is walked, one after another, in the order of their names (`01-…`, `02-…`).

- All plans are checked before a browser opens. If one cannot be walked, nothing starts and each problem is named:
  that is for the plan's author to fix.
- Each plan opens its own browser window, and the panel's header says where you are: "Plan 2/5 · Smoke 3 / 9".
- Between two plans a screen names the next one: **▶ Next plan** goes on, **■ Stop the suite** ends there.
- **■ Stop** in a step, or closing the window, ends the whole suite; the plans not reached are reported as "not
  walked". A plan that breaks (its page does not answer) ends alone, and the next plan is walked.
- The database account is asked for once. The next plans on the same database use it; it is forgotten when the suite
  ends.
- At the end the terminal prints `suite report:` and its path.

## Read the report

Each walk writes `report.md`: the result, a row per step with your answer and note, the steps where the browser
reported errors, what was put back and what was not, what changed since the step was last walked on this server, and
a block **to paste into the work item**. Copy that block into the work item yourself.

A suite adds one report over all its plans: a row per plan, where it was stopped, the plans not walked or broken,
every ✖ with its note, and a block to paste into the record of the test cycle.

Look at three things first: the ✖ steps, any line "not put back" (a change is still in the test data: do what the line
says by hand, or tell the plan's author), and any plan that ended with an error.

Reports, screenshots and recordings stay on your machine. A recording (`--video`, `--trace`) shows what the screen
showed and holds the session: do not attach it to a work item.

## After a fix

```bash
gsmoke run 6655 --env test --retry-failed      # only the steps you marked ✖ last time on this server
gsmoke report 6655                              # the latest report again
gsmoke list                                     # plans and walks
```

`6655` is the work item: it finds its only plan. A walk is never overwritten; the new report says what changed
(`✖ → ✔`).

## More when you want it

- `--network`: under each step also what the network did (slow or repeated calls, a secret or personal data in an
  answer); the report gets a section on the server's security headers and cookies. Worth it on a test server.
- `--probe`: walks the plan's probe steps, which send a form field the boundary and wrong values an experienced
  tester would try, and shows one table of what each led to.
- `--pace normal|fast`, `--screens diff` (a screenshot of every ✖), `--auto` (a step whose check passed goes on by
  itself; for a second walk of something you already walked by hand).

## With Claude Code

Everything above also works by asking: "walk the smoke folder on the test server", or
`/guided-smoke run smoke/ --env test`. Claude starts the walk, waits, reads the report and tells you what it means.

Claude can also write a plan from a work item (`/guided-smoke plan 6655`) when the developer left none. It reads the
work item, the commits linked to it and the repository, and shows you the plan before anything runs. Look at two
things there:

- Every expectation is marked with where it comes from: 📋 the work item, 🔧 the code, 👤 you, ❓ an assumption. A plan
  that is mostly 🔧 checks that the code does what the code does. Read the ❓ ones and correct them: you know what was
  asked for.
- A coverage table lists each acceptance criterion with the steps that cover it, or why the smoke leaves it out.

## A work item that is ready for a smoke

A plan needs more than acceptance criteria. Five short lines in the work item save a round of questions:

- **Where:** the menu path or the screen the change shows on.
- **Who:** the roles that see it, and whether a test account exists for each.
- **Test data:** the records to use, or that the smoke makes its own, and how to recognise them.
- **Outside the page:** what the change writes elsewhere (a table, a mail, a job), and how a test puts it back.
- **Not a smoke:** the criteria no screen shows.

## On a shared server

- Use the plan's test records only. A plan acts on the records its author chose; do not point it at real data.
- Leave things as you found them. That is what a step's undo is for; check the report's "Undo" section.
- Type a database account only into the engine's own tab, and a sign-in only into the application's own page. Never
  put either into a plan, a command or a chat.
- A plan is code that runs with your rights on your machine. Walk plans from your team's repository, which were
  reviewed there.

## When something goes wrong

| You see | Do |
|---|---|
| `The plan has no environment "test"` | The plan was not prepared for that server: the message lists the environments it has. Ask its author to add one. |
| `No address: pass --base …` | Add `--env test`, or `--base https://…` for a plan without environments. |
| `The suite was not started: …` | Each line names a plan and what is wrong with it. Nothing ran. |
| `The smoke profile is already open in another browser window` | Close the window of the earlier walk and run again. |
| The panel keeps saying "Sign in first" after you signed in | The plan does not recognise this server's sign-in pages: tell its author (`login` in the environment). |
| The page fails at once on a server with Windows sign-in | The environment needs `signIn: 'windows'`; `doctor --base` says so. |
| The database tab refuses the account | It says why: the user name or password, the database, the network, or `sqlcmd` missing. |
| Steps are skipped as "remote address" | They change data, and the server is not your machine: `--allow-remote-writes`, if that is meant. |
| The automatic check fails but the screen is right | ✔ twice, and tell the plan's author: the plan is wrong, not the application. |
| You closed the window by mistake | Run again: it is a new walk. `--from 7` starts at step 7 when the earlier steps' changes are still in place. |
