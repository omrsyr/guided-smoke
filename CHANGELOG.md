# Changelog

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
