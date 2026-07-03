# Stack — Trivia Webapp

Web rebuild of the Stack trivia game (formerly Excel + PowerPoint). Static site:
every file here is served as-is (GitHub Pages); there is no build step.

- Play/testing on one device: serve this folder (`python -m http.server`) and open
  multiple tabs — the mock sync driver runs offline.
- Real game nights: Firebase realtime sync (see docs/FIREBASE-SETUP.md, ~10 min once).
- Questions live in `questions/` as one Markdown file per category — edit them right
  on GitHub. Format spec: docs/PRD.md §3. Validate with tools/validate.html.
- Import from the old Excel bank: tools/import.html.

## Try it now (one device, no accounts)
1. In this folder: `python -m http.server 8000`
2. Open http://localhost:8000 in several tabs: one **GM** (create room — the first-night
   board is pre-selected), two+ **Players** (join with the room code, make two teams),
   one **Display**. Play a full game offline via the mock sync driver.
3. Engine regression suite: `node tests/full-game.test.mjs` (plus the suites the
   engine build left in the session scratchpad; the repo test is self-contained).

## Game night over the internet
1. One-time: follow docs/FIREBASE-SETUP.md (~10 min), paste config into
   js/sync/firebase-config.js, and switch the one driver import in js/main.js
   (marked `SWAP POINT`).
2. Push to GitHub, enable Pages, share the URL + room code.

Project state and task ledger: PROGRESS.md. Spec: docs/PRD.md. Decisions: docs/DECISIONS.md.
Rules provenance from the original Excel/PPT: docs/RULES-v6.md.
