---
name: guided-smoke
description: >
  Human-in-the-loop smoke test in a real browser. Playwright performs each step while a panel on the page explains what
  was done and what the user should see; nothing moves on until the user clicks "Correct, continue". Plans and walks
  are kept with short ids (6655, 6655-2) so a smoke can be re-run after a fix and reported. Use when the user invokes
  guided-smoke or explicitly asks to run a smoke / user smoke / acceptance walk-through of a change ("smoke koş",
  "smoke testi", "kullanıcı smoke'u", "Playwright ile smoke", "yönlendirmeli smoke"). Never start it on your own; at
  most suggest it once when a task reaches its smoke step.
license: MIT
compatibility: >
  Claude Code (or any agent with shell access) on Windows, macOS or Linux; Node.js 20+; Google Chrome or Microsoft
  Edge installed; the application under test reachable from this machine.
metadata:
  author: omrsyr
  version: "1.1.0"
---

# guided-smoke

A smoke the user can follow. The script drives a visible browser one step at a time; a panel on the page says
**what I did** and **what you should see** (the place is outlined in orange), shows an automatic check, and waits for
the user: **✔ Correct, continue**, **✖ Different** (with a note) or **■ Stop**. Steps that change something outside the
page (a database row, a file, an e-mail) ask first. Every answer is written down at once; the report says what passed,
what differed, how long the walk took and what changed since the previous walk.

## Activation boundary

Run only when the user invokes `guided-smoke` or explicitly asks for a smoke / acceptance walk-through. When a task you
are doing reaches its smoke step, you may suggest it **once** in one line ("Shall we run this with guided-smoke?") and
remember the answer for the rest of the session. If the user's memory says they always want guided smokes, skip the
suggestion: prepare the plan and ask only for its approval. Never open the browser without the user's go-ahead.

## Canonical forms

```text
guided-smoke                          prepare a plan for the current work, show it, run it after approval
guided-smoke plan [<id>]              prepare (or show) a plan only — no browser
guided-smoke run <ref>                run a plan: a new walk is numbered after the last one
guided-smoke list                     plans and walks of this project
guided-smoke report <ref>             report of a walk (default: the latest walk of the plan)
guided-smoke demo                     try it on the built-in demo application (no project needed)
```

`<ref>` is a plan id (`6655-machine-expiry`), a walk id (`6655-machine-expiry-2`), a work item (`6655` — its only
plan) or a work item with a walk number (`6655-2`). Several plans for one work item, or no match, is an error that
lists what exists — never guess another plan.

Flags (order free; unknown flags and bad values are refused with a clear message):

| Flag | Meaning |
|---|---|
| `--browser chrome\|edge` | Force a browser (default: the system's default browser when it is Chrome or Edge, else Chrome, else Edge) |
| `--base <url>` | Address of the application (default: the plan's `base`; detect the running app's port when writing the plan) |
| `--pace slow\|normal\|fast` | Browser speed (default `slow`) |
| `--from <n>` / `--only <n,m,a-b>` / `--retry-failed` | Run part of a plan (one of the three). `--retry-failed` reruns the steps marked ✖ in the given or latest walk |
| `--skip-writes` | Skip every permitted (approve) step without asking |
| `--allow-remote-writes` | Allow permitted steps when the address is not localhost (off by default) |
| `--work-item <no>` | Attach a work item to the walk and the report |
| `--screens diff\|all` | Screenshots on ✖ answers or on every step (default: none; the panel always has a 📷 button) |
| `--locale tr-TR\|en-US` | Browser language and locale (date inputs, validation messages). Default: the plan's `locale`, else the system's |
| `--fresh` | Throw-away browser profile for this walk (sign in again, nothing kept) |
| `--auto` | A step whose automatic check passed without plan warnings goes on by itself after a 3 s countdown (⏸ Wait or any button stops it). Failed or missing checks, permitted steps and value-box waits always wait. The report marks such steps "by itself" |
| `--panel left|right[,min]` | Panel corner (the value box takes the other one); `min` starts it minimized. The user's minimize choice carries over |
| `--video` | Record the walk as `video/walk.webm` in the walk folder. Needs Playwright's ffmpeg once (`setup --video`, about 4 MB; ask first) |
| `--trace` | Record a Playwright trace after the sign-in, in parts (`trace-1.zip`, …) that leave out the value box. Open with `npx playwright show-trace` |
| `--reset-login` | Delete this project's saved sign-in (`node engine/run.js reset-login`) |

## The engine

All work goes through `node <skill-dir>/engine/run.js` (`<skill-dir>` is this file's folder):

```text
node run.js doctor                    data folder, project, chosen browser, runtime — run this first
node run.js setup                     install playwright-core once (asks npm; get the user's OK first)
node run.js setup --video             also fetch Playwright's ffmpeg for --video (about 4 MB; get the user's OK first)
node run.js init <plan-id> [--title T] [--work-item N]   create plans/<plan-id>/steps.js from the template
node run.js run <ref|file.js> [flags] run a walk (start it in the background and wait for it to finish); a file is
                                      linked into the plans, --force replaces another plan with the same id
node run.js demo [flags]              start the demo application and walk its plan (same flags as run, except
                                      --base, --work-item, --allow-remote-writes, --force); walks are kept under
                                      project guided-smoke-demo (report demo --project guided-smoke-demo)
node run.js list | report <ref> | reset-login | paths
```

Exit codes: 0 done · 2 usage error · 3 runtime missing (`setup`) or Node.js too old · 4 reference not found or ambiguous · 1 other error.
The project is the git repository's folder name (override with `--project`). Data lives outside the repository:
`%LOCALAPPDATA%\guided-smoke` (Windows), `~/Library/Application Support/guided-smoke` (macOS),
`~/.local/share/guided-smoke` (Linux), or `GUIDED_SMOKE_HOME`.

## Load the applicable guidance

- Always: [safety rules](references/safety.md).
- `guided-smoke` and `plan`: [workflow](references/workflow.md) and [writing steps](references/writing-steps.md);
  [patterns](references/patterns.md) when a step calls an API with an account, uses the project's database tool or
  waits for a background job.
- `run`: [workflow](references/workflow.md) (preflight and while it runs).
- `report`, and after every walk: [report](references/report.md).

## Rules that always hold

- The user signs in. Never type, store, print or ask for a password; the browser's own password saving is off in the
  smoke profile. An account a step needs for an API call is typed by the user into the value box (`secretBox`).
- A permitted step (`approve`) is the only way to change anything outside the page. Show exactly what will change, limit
  it to one test record, and never print connection strings or keys.
- Walk records are never overwritten; a re-run is a new walk.
- Do not poll a running walk. Start `run` in the background, wait for it to finish, then read the report.
- The skill never writes to a work-item tracker. If a work item is known, the report carries a block to paste;
  without one (or without access), that part is simply left out.
- Smoke time belongs to the work item being tested. The report's "measured walk time" is the browser walk only; the
  user's own extra checking is theirs to add.
- `--video` and `--trace` files hold what the screen showed, cookies and page data. They stay in the walk folder; never
  attach them to a work item or send them anywhere. Suggest them only when the user asks for a recording.
