# Stack v2 — Build Log (executor ledger)

_Every coding session: read PRD.md + DECISIONS-V2.md + this file FIRST; append an entry
LAST (append-only; keep entries short). Planning/review ledger = PROGRESS.md._

Repo: github.com/SaturdayLim/Trivia - branch `v2` - copy this stack-v2/ folder into the
repo root before Session 1 so docs travel with the code.

## Session template
```
## S<n> <date> - <phase name> - <model>
Done:
Deviations from PRD (if any, + why):
Vitest: <pass/fail counts>
Next / blockers:
```

## Planned sessions (PRD section 9)
| # | Phase | Model | Done-when |
|---|---|---|---|
| S1 | Scaffold + engine/adapter/mock port | Sonnet | Vitest green; mock game playable in tabs at localhost |
| S2 | State schema: exposure tree, host PIN, lifecycle, selection claim, legacy migration | Opus | Schema writes visible in Firebase console; tests added |
| S3 | Shell + lobby + join flows (defects 1, 10 first) | Opus | 2 phones + display join and sit in live lobby |
| S4 | Host live loop + player selector/lock-in + display views | Opus | Full game playable cross-device |
| S5 | Design pass (Solutions suite) + defect sweep 2-9 + copy/tooltips | Sonnet | Defect register all PASS |
| S6 | Live test protocol + fixes; PRE-CUTOVER FABLE REVIEW; then cutover + hub links.json | Sonnet + Fable | Prod repointed; v1 archived |

## Entries

## S1 2026-07-10 - Scaffold + engine/adapter/mock port - Sonnet
Done:
- Copied stack-v2/ docs into repo root (this file's home) so docs travel with the code.
- Scaffolded Vite + React + Tailwind v4 at repo root: package.json, vite.config.js
  (react + @tailwindcss/vite plugins, vitest `test` block), index.html, src/main.jsx,
  src/index.css (Tailwind import + night-canvas #0B0C10 / accent #FFE600 tokens),
  src/App.jsx (placeholder landing, real routes land in S3).
- Ported engine as-is: js/engine/*.js -> src/engine/*.js (git mv, no logic changes).
- Ported sync adapter + drivers as-is: js/sync/*.js -> src/sync/*.js (adapter.js,
  driver-mock.js, driver-firebase.js, firebase-config.js, firebase-config.example.js).
  Internal relative imports (engine -> ../sync/adapter.js, driver-firebase ->
  ./firebase-config.js) needed no changes since sibling layout under src/ is preserved.
- Removed legacy v1 static UI now superseded by the Vite app: root index.html, css/,
  js/ui/*, js/main.js (git rm; recoverable from history if needed).
- Moved assets/ -> public/ (icons, logo, setup-color.txt) unchanged; filenames are
  still Icon_*.png, not yet the `<category-slug>.png` convention from PRD §5 — that
  rename is content-pipeline work, out of scope for S1 (flagged below).
- Ported tests/full-game.test.mjs to Vitest: switched top-level dynamic imports to
  static imports from ../src/..., wrapped the whole scenario in one `test(...)` block,
  kept all assertions/logic untouched (still uses node:assert internally).
- Repointed tools/*.html (engine-test, import, sync-test, validate) import paths from
  ../js/... to ../src/...; verified all four + new src/* modules serve 200 over the
  Vite dev server (manual curl smoke test, not a browser click-through).
- Added node_modules/dist to .gitignore.
Deviations from PRD (if any, + why):
- Icon filenames not yet renamed to category slugs (see above) — explicitly deferred,
  not a v2 core-app requirement until content pipeline / Admin UI work.
- "Mock game playable in tabs" verified via the existing tools/sync-test.html harness
  (full driver contract: room create/join, presence, tap-in race, GM-refresh recovery)
  rather than a new React-based play surface — real Host/Player/Display screens are
  explicitly S3/S4 scope per PRD §9. Confirmed only that the harness and its src/*
  imports serve correctly over the dev server (curl); did NOT open real browser tabs
  and click through the manual checklist in that file — flagging as not fully observed.
Vitest: 1 passed / 1 passed (tests/full-game.test.mjs, full integration scenario:
  12 turns, 4 modes, guards, endRound/endGame, final scores match hand-computed values)
Next / blockers:
- `npm run build` and `npm run dev` both verified working (build: 213ms; dev: all
  probed routes incl. tools/*.html and src/engine|sync/*.js returned 200).
- S2 (Opus): state schema additions (exposure tree, host PIN, lifecycle/expiry,
  selectionClaim) + legacy used-question migration.
- Recommend a human/browser pass on tools/sync-test.html's 3-tab checklist before S2
  builds on top of the sync layer, since S1 only confirmed it loads, not that the
  BroadcastChannel/localStorage flows behave correctly in a real browser.
