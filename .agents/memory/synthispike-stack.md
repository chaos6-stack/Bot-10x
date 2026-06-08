---
name: SynthiSpike stack & key conventions
description: Architecture overview, state bridge, file roles, and key decisions for the SynthiSpike bot dashboard.
---

## Stack
- Frontend: React + Vite + Tailwind in src/
- Server: Express + TypeScript in server.ts (port 5000, tsx runner)
- Bot brain: Python 3 in local_repo/ — entry point is `python3 main.py <symbol>`

## State Bridge
main.py writes `local_repo/logs/live_ticks.json` after every tick.
Express `/api/ticks` serves that file. React polls every 1.5s.

## Key Conventions
- All brain files exposed via `exportableFiles` allowlist in server.ts
- Config is edited via regex replace in server.ts — only keys in `configKeys` list are supported
- Bot is spawned with `{ cwd: localRepoPath, env: { ...process.env } }` so DERIV_API_TOKEN is inherited
- Symbol switch while bot is running → POST /api/bot/restart auto-called by selectActiveSymbol()
- multer upload → only files in exportableFiles allowed; .bak backup created on write

**Why:** Python bot runs in local_repo/ so relative imports work. State via JSON file (not IPC) keeps the architecture simple and survives server restarts.
