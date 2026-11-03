# Changelog

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
