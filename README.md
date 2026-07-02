# Stack — Trivia Webapp

Web rebuild of the Stack trivia game (formerly Excel + PowerPoint). Static site:
every file here is served as-is (GitHub Pages); there is no build step.

- Play/testing on one device: serve this folder (`python -m http.server`) and open
  multiple tabs — the mock sync driver runs offline.
- Real game nights: Firebase realtime sync (see docs/FIREBASE-SETUP.md, ~10 min once).
- Questions live in `questions/` as one Markdown file per category — edit them right
  on GitHub. Format spec: docs/PRD.md §3. Validate with tools/validate.html.
- Import from the old Excel bank: tools/import.html.

Project state and task ledger: PROGRESS.md. Spec: docs/PRD.md. Decisions: docs/DECISIONS.md.
