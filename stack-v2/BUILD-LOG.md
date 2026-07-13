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

## Design amendment (Michael, 2026-07-10) — CARRY TO S5
"Currently looking decently functional, but I'd like a smoother motion."
Requirement: eased, intentional transitions everywhere state changes — screen-to-screen
(lobby > category > difficulty > question > reveal > home), score count-ups, timer,
reveal flashes. No hard cuts. Suggested tool: Framer Motion (free) or CSS
transitions; decide in S5. Recorded as decision V2-25.

## S2 2026-07-10 - State schema (exposure, host PIN, lifecycle, selection claim) - Opus
Done:
- S1 CARRY-ITEM: `git mv questions/ public/questions/`. This was a live production bug,
  not tidiness — `vite build` only copies `public/`, so the deployed v2 app would have
  404'd on every question file. Verified: dist/ now ships 59 .md + index.json; dev server
  returns 200 for /questions/index.json, /questions/marvel.md, /icons/manifest.json.
  `loadCategories()` needed no change (its baseUrl is app-root-relative).
- S1 CARRY-ITEM: icon slug mapping. Michael chose "mechanism, no assignments".
  New `src/content/icons.js` — pure resolver, order: (1) `<category-slug>.png` in the
  manifest [PRD §5 convention], (2) the category's `Icon:` frontmatter stem, (3) numbered
  circle [V2-8]. New `public/icons/manifest.json` (18 category icons, logos excluded)
  regenerated by `npm run icons:manifest`; a manifest rather than 404-probing so absence
  is known before first paint. Deciding WHICH icon belongs to which of the 58 categories
  stays with Michael / the Admin UI (V2-6) — the fallback covers every unmapped tile.
- `src/state/room.js` (pure): auto room codes over a confusable-free alphabet + collision
  retry `pickFreeRoomCode` (V2-20); host PIN gen/compare (V2-19); `lifecycle` +
  `isRoomExpired`/`msUntilExpiry` (V2-20); selection-claim shape + `holdsClaim`/`isLockedOut`
  (V2-14).
- `src/state/exposure.js`: the global `exposure/<slug>/<id> = <epoch ms>` tree (V2-5).
  It gets its OWN store + backends because every adapter path is scoped to
  `rooms/<code>` — the room-scoped sync handle cannot address a root-level tree at all.
  Backends: firebase (RTDB root, `update()` so concurrent categories can't clobber),
  localStorage (offline/mock, V2-21), memory (tests). `toRefs()` feeds `buildBoard`'s
  existing `usedRefs`, so the engine is untouched.
- `src/engine/actions.js` extended (v1 actions unchanged): `createRoomState` now writes
  `hostPin`, `lifecycle`, `selectionClaim`; retired `meta.createdAt` in favour of
  `lifecycle.createdAt` (nothing read it). Added `touchActivity`, `closeRoom`, `claimHost`,
  `releaseHost`, `claimSelection`, `releaseSelection`, `clearSelectionClaim`. `advance()`
  and `endRound()` now clear `selectionClaim`.
- `src/sync/driver-firebase.js`: added `getDatabase()` (root-tree access for exposure) and
  `roomExists()` (probe before creating an auto-coded room — `connect({create:true})` does
  a `set()`, which would evict a live game on a collision). Verified it still imports clean
  in node with no top-level browser/network access.
- `scripts/migrate-exposure.mjs` + `npm run migrate:exposure`. Dry run executed: 230 refs
  read, 230 valid, 0 rejected, 21 categories. Writes one REST `PATCH /exposure/<slug>.json`
  per category (merges children, idempotent, preserves exposures gained since the last run);
  a single nested `PATCH /exposure.json` would replace each category wholesale. Legacy refs
  are stamped with the v6 import instant (2026-07-03T07:52:04.912Z), not "now".
- `firebase-rules.json` at repo root + docs/FIREBASE-SETUP.md §4 rewritten: the live rules
  deny `/exposure` outright (probed: HTTP 401), so the migration cannot run until Michael
  pastes these. Documented why `exposure/` must be world-readable (a new room reads it
  before it has an audience) and that `hostPin` is not a security boundary.
- Bug found by a test, fixed in the code: `pinMatches('', '')` returned true — a room
  created with `hostPin: ''` would have been claimable by anyone submitting a blank field.
- Housekeeping: stack-v2/BUILD-LOG.md contained 799 stray NUL bytes on one line (S1
  artifact) which made git treat it as binary. Stripped.
Deviations from PRD (if any, + why):
- PRD §5 says `public/icons/<category-slug>.png`; the repo has 18 semantically-named PNGs
  (Icon_Basketball, Icon_MovieCam, …) against 58 categories, so no 1:1 rename exists. The
  resolver honours the PRD path as its FIRST rule, and frontmatter as the escape hatch.
  No icon files renamed, no assignments invented. Michael's call, asked and answered.
- Exposure migration NOT written to live Firebase (Michael's call: build + dry-run only).
  S2's "schema writes visible in Firebase console" is therefore UNMET pending two manual
  steps — see Next.
- V2-17's per-category "Questions per tier" N is still the global `settings.tierSize` from
  v1. Not in S2's row; belongs with the stage-setup UI (S4).
Vitest: 38 passed / 38 (5 files). New: room-schema (6), exposure (8), state-actions (16),
  icons (7). Pre-existing full-game integration still green — the `createRoomState` change
  did not disturb the engine.
Next / blockers:
- BLOCKER for the exposure done-when, Michael, 2 steps: (1) paste `firebase-rules.json`
  into the RTDB console's Rules tab and Publish; (2) run `npm run migrate:exposure -- --commit`.
  The script verifies its own readback and fails loudly on a short write.
- Still outstanding from S1: nobody has run tools/sync-test.html's 3-tab checklist in a real
  browser. S2 added no new BroadcastChannel behaviour, so this is still S3's risk to carry.
- S3 (Opus): shell + lobby + join flows (defects 1, 10 first). The state layer it needs is
  now in place: `pickFreeRoomCode` + `roomExists` for creation, `claimHost` for rejoin,
  `isRoomExpired` for the join screen, `touchActivity` on every write path.

## S3 2026-07-10 - Shell + lobby + join flows - Opus
Done:
- Routes (PRD §2): `/` `/host` `/play` `/display` on react-router-dom. BrowserRouter, not
  hash routing, because `/play?room=ABCD` is what a QR should hand a human. `vercel.json`
  added for the SPA rewrite; its negative lookahead keeps `/questions/`, `/icons/`,
  `/tools/`, `/assets/` OUT of the rewrite, so a missing category file still 404s instead
  of returning index.html with HTTP 200 (which `loadCategories` would try to parse).
- DEFECT #1 (shared live lobby) is fixed structurally, not cosmetically: `Lobby.jsx` is ONE
  component rendered by all three roles, so there is no longer a per-role waiting screen
  that can get stuck. `useRoom` publishes the tree in the same tick `createSync` resolves
  (adapter's `onChange` fires synchronously), so `room` is never null in the `ready` phase.
  The spinner covers one real network round trip and always resolves to a lobby or a named
  error with Retry.
- DEFECT #10 (join after creation) is fixed and encoded once, in `canJoin`: the only states
  that refuse a Player are `closed` and `ended`. Mid-Game joins (V2-13) use the same form
  and the same two writes; the difference is a banner. Registration is never locked in S3.
- `src/state/lobby.js` (pure): marries the durable room tree with the driver's presence
  roster — the tree alone can't grey out a sleeping phone, presence alone would delete a
  player from their Team when their screen locks. Also `teamKey`/`matchTeam`, which is what
  makes PRD §3.3's single "enter/join team name" field work: same name -> same team id ->
  `createTeam` first-write-wins, and the loser falls through to `joinTeam`.
- `src/app/driver.js`: the one swap point (V2-21). `?driver=mock` is sticky and rides the QR
  URL, so a scanned phone stays offline with the rest of the room. Both drivers load lazily —
  the build confirms it, they land in separate chunks (driver-mock 8.5kB, driver-firebase 6kB).
- `src/app/createRoom.js`: creation is an imperative action, never an effect, so StrictMode's
  double-mount cannot write a room twice. It closes its session and lets `useRoom` reconnect
  with `create:false` — so first-load and refresh-resume share one code path.
- Host seat (V2-19) in `Host.jsx`: same device refreshing reclaims silently from the stored
  PIN; a different device must type it; `claimHost` refuses while the seated host is live on
  the roster. `roomExists` added to driver-mock, mirroring the Firebase one.
- QR (V2-22) via the bundled `qrcode` package — nothing fetched from a QR web service at game
  time. Rendered dark-on-white rather than themed: a #FFE600-on-#0B0C10 code scans badly
  across a room. A QR that fails to render returns null rather than blanking the lobby.
- Two real bugs found by tests, both fixed in the code:
  (1) `teamKey('日本')` -> `''`, which would have written to `teams/` and corrupted the room.
      Now folds accents (Café == CAFE, one Team) and falls back to a hash for names with no
      Latin letters, preserving one-name-one-team in any script.
  (2) identity + clientId were keyed in localStorage by room alone. Correct for real phones,
      WRONG for the mock driver, whose entire purpose (V2-21) is several TABS of one browser
      sharing one localStorage — the second player to open a tab would have been mistaken for
      the first and inherited their seat. `app/identity.js` now picks its store by driver:
      localStorage for Firebase (one browser = one participant, survives close/reopen),
      sessionStorage for mock (one tab = one participant, survives F5).
- Also fixed: a flaky test, not app code. `join-flow` asserted another tab's tree the instant
  its own write resolved. A write resolves when the room's authority applies it; the diff
  reaches other tabs a tick later, and PRD §6 only promises convergence within 1s. The test
  now waits for convergence. Verified by running the full suite 8x green.
- `@vitejs/plugin-react` does not run on Vitest's SSR transform, so JSX compiled to the
  classic runtime and every screen test died on "React is not defined". Fixed at the config
  level (`esbuild.jsx = 'automatic'`), not per-file.
- `src/state/roles.js` extracted so the pure layers can name a role without importing the
  driver-selection machinery.
Deviations from PRD (if any, + why):
- PRD §3.1 lists peripherals (Scores, Question Log, Round Settings) as available at all times.
  Not built: they display game state that does not exist until S4. The Host lobby carries a
  disabled "Begin Game" so the flow's shape is visible.
- Tooltips (defect #3), motion (V2-25) and the Solutions design suite are S5 by the build
  plan. `ui.jsx` does enforce the two acceptance criteria that are not taste: ≥44px touch
  targets, and proper-case copy throughout.
Vitest: 58 passed / 58 (8 files). New: lobby (8, pure selectors), join-flow (6, drives the
  REAL driver-mock over BroadcastChannel + the CAS propose path), screens (6, jsdom, mounts
  the actual React screens against the mock driver). Pre-existing full-game + S2 suites green.
Next / blockers:
- S3's done-when ("2 phones + display join and sit in live lobby") is met HEADLESS, not on
  devices. `screens.test.jsx` mounts two Player screens and a Display against a real Host
  room and asserts they converge on one lobby; `join-flow.test.mjs` does the same through the
  driver itself. Neither proves Firebase, two physical phones, or ≤1s sync. That pass is
  Michael's, and it also discharges S1's outstanding sync-test.html item.
- Verified by me: `npm run build` clean; dev server returns 200 for `/`, `/host`, `/play`,
  `/play?room=ABCD`, `/display`, and still for `/questions/index.json`, `/icons/manifest.json`,
  `/tools/sync-test.html`.
- STILL BLOCKED from S2: exposure migration needs Michael to publish `firebase-rules.json`,
  then `npm run migrate:exposure -- --commit`.
- S4 (Opus): Host live loop + Stage setup UI + Player selector/lock-in + Display views.
  `claimSelection`/`releaseSelection` (V2-14) are already in `actions.js`, untouched by S3.

## S2+S3 REVIEW (Fable) 2026-07-10 — BOTH APPROVED
Verified in a clean environment against the working tree: Vitest 58/58 across all 8
suites, `npm run build` clean, dist ships the question bank, `vercel.json` rewrite
correct, S2/S3 additions all present (roomExists, getDatabase, claimHost,
claimSelection, exposure store, lobby/join screens). Quality of both entries is high;
deviations were correctly reasoned and are accepted.

INCIDENT NOTE (transparency): reviewing through the Cowork VM mount produced STALE
reads that mimicked file truncation (package.json, package-lock.json, vite.config.js,
src/App.jsx, actions.js, both drivers, this log). Before the staleness was diagnosed,
Fable overwrote those 7 files with reconstructions validated green (58/58 + build).
Current tree is coherent and approved — but if S4 hits anything odd in those files,
compare against the S2/S3 Claude Code session transcripts before debugging forward.
Rule for future sessions: verify repo state via HOST file tools, never the VM mount;
run git only on Michael's PowerShell or a /tmp clone.

## EXECUTION STATUS (Fable) 2026-07-10
- Rules publish + exposure migration: NOT yet executed. Sandbox cannot reach
  *.firebasedatabase.app and the Chrome extension was disconnected, so Fable could
  not perform the console publish. Michael's 2 steps (or reconnect Chrome and ask
  Fable to drive): (1) console.firebase.google.com > stack-ep5 > Realtime Database >
  Rules > paste firebase-rules.json > Publish; (2) `npm run migrate:exposure -- --commit`
  (self-verifies readback; expect 21 categories / 230 refs).
- Rules posture accepted for a party game: rooms/presence/exposure world-readable and
  world-writable (no auth exists by design; same posture as v1). Anyone with the DB URL
  can vandalize a live game — accepted risk, revisit only if it ever bites.
- Working tree is UNCOMMITTED. Michael, in C:\Users\user\Trivia (PowerShell):
  `npm test` then `git add -A` then
  `git commit -m "S2+S3: state schema + lobby/join flows (Fable-reviewed)"` then
  `git push`. If git errors on the index: `del .git\index` then `git reset`, retry.

## S4 REQUIREMENTS (Fable) — read before starting
1. V2-17 CARRY: per-category "Questions per Tier" N is still v1's global
   `settings.tierSize`. S4's stage-setup UI must implement V2-17 (draw up to N per
   tier, short tiers contribute what they have).
2. PRD §3.1 peripherals (Scores, Question Log, Round Settings — all roles, all times)
   are S4 scope now that game state exists. Host additionally: score modifiers,
   Return to Home, Close Room, Show QR.
3. Host live loop per V2-11 (delta toggles PRE-FILLED by auto-scoring), timer per
   V2-15 (extend re-opens options; a lock-in zeroes the timer and locks everyone in
   ALL-contestant stages), no-answer handling per V2-16 (0 points, penalty-exempt,
   never DQ).
4. Selection flow uses claimSelection/releaseSelection (V2-14) — first click claims,
   Back releases; teammates' selection UI locked while claimed.
5. Exposure migration may still be pending — S4 must behave correctly against an
   EMPTY exposure tree (it does not block S4).
6. Design stays out of scope (S5): keep ui.jsx standards (44px targets, proper case)
   but no motion/theme work.
7. Defects #7 (dropdowns persist until explicit selection), #8 (timer default 30s),
   #9 (numeric fields typeable) land in S4's stage-setup UI — do not defer to S5.
8. Still outstanding for a human: browser pass of tools/sync-test.html and a real
   2-phone + display lobby check; S4 should not silently absorb it.

## S4 2026-07-11 - Host live loop + player selector/lock-in + display views - Opus
Done:
- New PURE layers (no React/sync/clock; each is a unit test, not a click-through):
  - `src/state/stages.js` — the Stage vocabulary (V2-23) and the seam between it
    and the engine's `RoundConfig`. Contestants Selector-Only/All maps to the
    engine's exclusive/community modes; contest/suddendeath stay in the engine but
    the v2 UI never writes them (V2-9). `defaultStages()` replaces v1's
    DEFAULT_ROUNDS at room creation (v1's round 3 was `contest`). 30s default timer
    (defect #8), typeable-field clamping (defect #9), `orderModeNext` for V2-10.
  - `src/state/game.js` — the whole live-game view every screen branches on:
    mayAnswer, holdsClaim/lockedOut (V2-14), hasExplicitLock (the V2-15
    lock-in-vs-expiry distinction), missedIt (V2-16), cycleDelta (V2-11), timer
    seconds, standings, log rows. `selectGame`/`selectMe`.
  - `src/content/catalog.js` — Host loads the 58-file bank; Players/Displays read a
    small `settings.categoryMeta` directory the Host writes at Confirm, so 30 phones
    fetch nothing. Answer/fact never leave the Host device.
- ENGINE — four ADDITIVE changes only, v1 logic untouched (regression suite green):
  - `board.tierSizeFor` + `buildBoard` per-category N (V2-17); short tiers give what
    they have. `scheduler.rotationOrderMode` + `advanceTurn` consult "Who Selects
    Next" per rotation (V2-10), falling back to orderMode for v1 rounds.
  - `actions`: `updateBoardSettings`, `releaseTapIn`; selectionClaim gains `slug`
    (Display needs it, PRD §3.4); `revealQuestion` now writes result BEFORE state
    (separate paths — an observer must never see `revealed` with a null result);
    `createRoomState` now persists `tierSizes`/`categoryMeta` (were silently dropped
    by its settings whitelist — real bug).
- SCREENS: HostSetup (Category select + per-cat N + 4-Stage setup), HostGame (the
  three authority effects: fulfil selection, seal on explicit lock-in, seal at
  expiry after a grace window; delta toggles pre-filled per V2-11; extend re-opens
  options per V2-15), PlayGame (claim=tap-in+selection as one gesture, difficulty,
  options, big-letter lock-in, auto-lock at expiry per V2-15, no-DQ per V2-16),
  DisplayGame (read-only home/difficulty/question/reveal). Shell screens (Host/Play/
  Display) hand off to these once status=playing. `Peripherals` bar (Scores/Log/
  Stage Settings all roles; Host adds Modifiers/QR/Return Home/Close Room).
  ui.jsx gains NumberField (defect #9), Select (defect #7), Segmented, Sheet.
- Real bugs found by tests, fixed in code: (1) createRoomState dropped tierSizes/
  categoryMeta; (2) revealQuestion state-before-result race crashed screens on a
  null result; (3) tap-in claimed AFTER the selection claim let the difficulty
  screen appear before the selector seat was taken, so requestSelection raced and
  was refused — now claim tap-in FIRST; (4) grids went inert `div`s while a write
  was in flight instead of disabled buttons.
Deviations from PRD (if any, + why):
- Display carries NO tap-peripheral bar (a projector is not an input surface); it
  shows Scores + Stage summary + remaining Categories inline on its home instead.
  PRD §3.1 "peripherals per role" is satisfied for Host/Player; the Display's role
  is to display. Flag if Michael wants the sheets mirrored there.
- Vitest pool switched to `forks` (vite.config.js): the mock driver uses Node's
  process-global BroadcastChannel; under the default `threads` pool concurrent test
  files share one dispatcher and a reveal diff for one room can be starved by
  another file's traffic — flaky, unrelated to the app. Separate processes fix it.
- Archive categories (`archive-*`) are NOT filtered from the Host's grid: v1 showed
  all 58 and nothing in the PRD retires them; curation is the Admin UI's job (V2-6).
- Defects #2 (uniform tiles), #6 (proper case), #7/#8/#9 landed here as required.
  Tooltips (#3) and motion (V2-25) remain S5.
Vitest: 89 passed / 89 (15 files). New: stages (8), game-view (9), live-loop (6,
  full turns through the real driver-mock: claim/select/lock/reveal/commit/advance,
  V2-14/15/16 + mid-game join), live-turn/live-noanswer/live-back (3, real React
  Host+Player+Display clicked through a whole turn in jsdom), form-controls (5,
  defects #7/#9 directly). Pre-existing S1/S2/S3 suites all still green; `npm run
  build` clean; dev server serves `/ /host /play /display /questions /icons` 200.
Next / blockers:
- STILL BLOCKED from S2 (Michael, unchanged): publish `firebase-rules.json` in the
  RTDB console, then `npm run migrate:exposure -- --commit`. S4 runs correctly
  against an empty/denied exposure tree (shows a banner, treats every question as
  fresh), so this does not block playing — only the "don't repeat questions" memory.
- HUMAN pass still owed (carried from S1/S3): real 2-phone + 1-display game on
  Firebase, ≤1s sync spot-check, and tools/sync-test.html's 3-tab checklist. The
  headless tests prove logic + React render + the mock driver, not physical devices.
- S5 (Sonnet): design pass (Solutions suite) + defect #3 tooltips + motion (V2-25)
  + copy/tooltip sweep. The screens are built to standards but plain.

## S4 REVIEW (Fable) 2026-07-10 — APPROVED; all 3 deviations ACCEPTED
Structural verification against host tree (VM mount unusable for fresh files —
incident note above): V2-17 tierSizeFor/per-slug N confirmed in board.js; V2-11
pre-filled deltas confirmed (game.js cycleDelta from engine result); V2-15 confirmed
incl. Extend Timer in HostGame and the LOCK_GRACE_MS design (grace window for
in-flight expiry locks — good engineering, keep); defects #7/#8/#9 in stages.js +
ui.jsx NumberField/Select. Engine changes verified additive. Executable gate =
Michael's local `npm test` (S4 reports 89/89; Fable could not replicate in sandbox
due to mount staleness, not code).
Deviations: (1) Display inline scores instead of tap-peripherals — correct, a
projector is not an input surface; PRD §3.1 amended in spirit, noted for PRD v2.1.
(2) forks pool — correct and well-reasoned. (3) archive-* in Host grid — agreed,
curation belongs to the Admin UI (V2-6).
S5 note: motion (V2-25) must not break LOCK_GRACE_MS timing or add transition
delays to authority effects (fulfil/seal) — animate presentation, never authority.

## S4.6 REQUIREMENTS (Fable, 2026-07-10) — bugfix sprint, PRIORITY over S5
Game night is ~3h out. Scope = PRD §8b register R1–R8 exactly; nothing else. Notes:
- R1: Display highlight of locked letters — check DisplayGame renders `question.locks`
  pre-reveal; it may only render `result`.
- R2: Extend is wired in HostGame (handleExtend, line ~237) but reportedly inert —
  find the real cause (deadline write path / state guard / sealed-question check).
  Add a regression test that extends after expiry and asserts options re-open.
- R5: copy branch on answer-eligibility (game.js mayAnswer), not on lock state.
- R6: Final Results = status 'ended' view on all three roles; plain is fine (S5 polishes).
- R8: preselect from public/questions/game-defaults.json at HostSetup mount.
- Run the FULL suite; append entry; DO NOT start S5 design work in this session.
Session runs in C:\Users\user\Trivia (NOT the planning folder — see 2026-07-10
wrong-folder incident in chat).

## S5 2026-07-11 - Design pass (Solutions suite) + defect #3 + motion (V2-25) - Sonnet
Done:
- Walked the S4 REQUIREMENTS/S4 REVIEW notes and the v1 defect register (PRD §8)
  against the working tree before writing anything, per the read-first rule at
  the top of this file. Found #2/#6/#7/#8/#9 already correct (spot-checked with
  a grep sweep of src/screens + src/components for stray slug/CONST-case text —
  every match was a code identifier or comment, nothing rendered) and #1/#4/#10
  settled in earlier sessions. #3 (tooltips) and V2-25 (motion) were the actual
  S5 scope.
- Typography (PRD §7 "playful-but-clean… legible at TV distance"): Fredoka
  (headings) + Nunito (body), the same pairing v1's game-show pass (commit
  a69826b) landed on — re-used rather than re-litigated, since `saturday-services/
  design/saturday-core/` + `design/solutions/` (the suites PRD §7 names as the
  base prompt pack) are not present in this repo or machine to draw from.
  Wired via Google Fonts `<link>` in index.html (matches v1's precedent) and
  `--font-sans`/`--font-display` theme tokens in index.css; headings pick it up
  through a plain `h1,h2,h3` rule rather than touching every screen's className.
  Also added `theme-color` to index.html (was missing).
- DEFECT #3 (click-in tooltips): new `Tooltip` in ui.jsx — tap to open (no
  hover; this is mobile-first), dismiss on outside tap OR Escape (deliberately
  NOT `Select`'s "stays open" rule — a definition is a glance, V2-14/#7 is about
  a decision). The (?) glyph stays visually small but its tap target doesn't:
  an invisible `-inset-3` extends the hit area to PRD §6's 44px floor without
  inflating the layout. Wired into `NumberField`/`Segmented`/`Select` via an
  optional `tooltip` prop, and into Stage setup's six under-explained fields
  (Rotations, Thinking Time, Multiplier, Penalty, Who Selects First/Next) plus
  the Category screen's "Questions per Tier" header — the exact header PRD §8's
  defect #3 row names as the example. Copy lives once, in `state/stages.js`
  `FIELD_HELP`, not duplicated at each call site. Contestants was left alone —
  it already carries a one-line caption underneath, and a tooltip there would
  have been the redundant kind.
- V2-25 (motion), scoped exactly to what Michael asked for ("smoother motion…
  no hard cuts") and exactly to what the S4 REVIEW fenced off (never delay or
  reorder an authority effect — animate presentation, not the decision):
  - Tooling decision: CSS, not Framer Motion. Nothing here needs spring physics
    or layout animation — screen fades, a score count-up, a reveal flash, a
    timer pulse — and CSS keeps the zero-dependency posture (PRD §1 "zero-cost
    stack") intact rather than adding a ~50kB runtime for four keyframes.
  - `Screen` (every top-level screen renders through it) now carries
    `animate-stack-in`, a 260ms fade+rise that plays once per mount — this is
    what makes lobby→category→difficulty→question→reveal→home read as a
    sequence instead of a cut, for free, because every screen swap IS a mount.
  - `Options` tiles get a one-shot `animate-stack-flash` exactly when a tile's
    correct/wrong state turns true (a plain conditional class — no JS timer,
    so nothing here can race the Host's reveal). `Timer` gets a colour
    transition and a `animate-stack-urgent` pulse in the last 5s. `BigLetter`
    pops in on the locked letter. `Sheet` and `Select`'s panel get the same pop.
  - Score count-up: `useCountUp` in game.jsx eases a displayed number toward
    `team.score` over 450ms. Extracted a `ScoreRow` subcomponent per Team so the
    hook's call order stays stable when a Team joins mid-Game (V2-13) — calling
    a hook inside the existing `.map()` would have varied the hook count across
    renders. Real bug caught while building it: seeding `startTime` from
    `performance.now()` before the first `requestAnimationFrame` callback
    produced wildly wrong intermediate numbers (a jsdom test caught a `-80` on
    a 2→9 change) because the two clocks aren't guaranteed to share an origin;
    fixed by taking `startTime` from the first rAF timestamp itself, so both
    ends of the interval come from the same clock everywhere, not just in tests.
  - `prefers-reduced-motion` collapses every animation/transition to ~0 (index.css)
    and `useCountUp` skips straight to the target under it — checked via
    `window.matchMedia` with a defensive fallback (jsdom doesn't implement it,
    so the fallback is what keeps the suite from throwing, not a special case
    for tests).
  - Did NOT touch: `HostGame.jsx`'s three authority effects, `LOCK_GRACE_MS`,
    or any engine file. Confirmed by inspection (no edits in that file this
    session) and by the full existing live-loop/live-turn/live-noanswer/
    live-back suite staying green unmodified.
Deviations from PRD (if any, + why):
- PRD §7's named design suites (`saturday-services/design/saturday-core/` +
  `design/solutions/`) are not in this repo or reachable from this machine —
  used the palette/typography already locked (V2-4's night canvas + accent,
  v1's Fredoka/Nunito precedent) as the base prompt pack instead of inventing
  one. Flag for Michael if those suites exist somewhere and should be pulled in.
- Tooltips were not added inside `Peripherals.jsx`'s `StagesSheet` (the
  read-only Stage Settings peripheral), even though its `dt` labels have zero
  explanation either. That sheet's content wrapper is `overflow-y-auto`, which
  per the CSS overflow spec silently promotes `overflow-x` to `auto` too —
  an absolutely-positioned tooltip popover risked being clipped or scrolled out
  of view there in a way I could not visually verify (browser extension
  disconnected, see below). Left it out rather than ship an unverified defect;
  Stage setup and Category select — the screens where these headers are first
  encountered — do carry them.
- Stack logo and the Saturday Solutions hub `links.json` entry are out of S5
  scope per PRD §9 (separate task / S6).
Vitest: 96 passed / 96 (17 files). New: tooltip (4 — open/close, outside-tap +
  Escape dismissal, 44px tap-target-despite-small-glyph, one tooltip per
  under-explained Stage-setup field), motion (3 — ScoreList shows the real
  score immediately on mount, settles on a changed score, stays correct per
  row when a Team joins mid-Game). Pre-existing S1-S4 suites (89) all still
  green, unmodified. `npm run build` clean; built CSS confirmed to contain the
  new fonts/keyframes (`Fredoka`/`Nunito`/`stack-in`/`stack-pop`/`stack-flash`/
  `stack-urgent`) via grep, since these are hand-authored CSS rather than
  Tailwind-generated utilities and so aren't subject to its content-scan purge.
- NOT observed: a real browser click-through. The Chrome extension was
  disconnected this session (same limitation the S2/S3 incident note and the
  S1/S3/S4 entries flagged for their own browser passes) — `tabs_context_mcp`
  returned "Browser extension is not connected." Verification here is jsdom
  component tests (real DOM render + click/keydown events, not screenshots)
  plus a grep of the built CSS bundle for the new classes/fonts. Nobody has
  yet SEEN the fade-in, the flash, the count-up, or the tooltip popover
  render correctly in an actual browser at a real viewport — that's still owed.
Next / blockers:
- HUMAN/BROWSER PASS OWED (carried forward, now larger): (1) the fade/flash/
  pulse/count-up/tooltip-popover visuals this session added, on a real phone
  and the Display's TV-scale layout; (2) tools/sync-test.html's 3-tab checklist
  (S1); (3) a real 2-phone + 1-display Firebase game (S3/S4). None of these
  block S6 starting, but S6's "Live test protocol + fixes" is exactly where
  they get discharged — do not let S6 silently absorb them without walking the
  defect register live.
- STILL BLOCKED from S2 (unchanged): publish `firebase-rules.json`, then
  `npm run migrate:exposure -- --commit`.
- Working tree is UNCOMMITTED. Michael, in C:\Users\user\Trivia (PowerShell):
  `npm test` then `git add -A` then
  `git commit -m "S5: design pass, defect #3 tooltips, motion (V2-25)"` then
  `git push`.
- S6 (Sonnet + Fable): live test protocol + fixes; PRE-CUTOVER FABLE REVIEW;
  cutover master→v2; hub links.json entry. The defect register is now
  structurally PASS end-to-end (#1-#10) but not yet visually confirmed — S6's
  "walked end-to-end on 2 devices + 1 display before cutover" gate (PRD §9) is
  where that confirmation has to happen before the Fable review, not after.

## S4.6 2026-07-11 - Bugfix sprint: v2.1 register R1-R8 - Sonnet
SEQUENCING NOTE: this sprint was specced as PRIORITY over S5, but the working
tree already carried S5's uncommitted diff (tooltips, motion, Fredoka/Nunito)
when this session started — the S4.6 REQUIREMENTS entry's own "DO NOT start
S5" instruction was not honored by whatever session ran between it and this
one. Flagging per the read-first/report-faithfully rule rather than silently
reordering history. R1-R8 below are layered on top of S5's diff; nothing here
touches S5's tooltip/motion work, and the full suite (both sessions' tests)
is green together.
Done, one per finding:
- R1 (Display: locked answers invisible pre-reveal): `Options` (game.jsx) now
  accepts `locked` as an array, not just one Player's own letter; `DisplayGame`
  passes every current `game/question/locks` choice. Safe by construction, not
  by care taken here: a lock already zeroes the timer and locks every other
  Team out (V2-15), so nothing shown here could be copied into a still-open
  answer.
- R2 (Extend Timer does nothing) — the real bug, not the button: `openQuestion`
  never cleared `game/question/locks` on a re-open, only on first open. A
  Player's expiry auto-lock from the OLD deadline survived onto the NEW one,
  and `hasExplicitLock` (state/game.js) reads a lock's `at` against whatever
  deadline is live *right now* — so the leftover auto-lock read as an
  *explicit* Lock In against the extended deadline, and HostGame's own
  authority effect resealed the question the instant it reopened, before a
  human could see anything unlock. Fixed in `openQuestion`: locks clear on
  every open. First pass cleared locks LAST (after state/deadline), which
  left a narrower version of the same race — each `sync.update` is its own
  round trip, so a listener could observe the NEW deadline paired with the
  STILL-STALE locks for one hop. Reordered to clear locks FIRST, so every
  observable intermediate state pairs a live deadline with already-empty
  locks. Second, related bug found while building the regression test:
  `PlayGame`'s auto-lock effect guarded on `g.ref`, so a Player already
  auto-locked once for a question would never get a second chance to
  auto-lock in an extended window (their still-pending choice would silently
  vanish) — reguarded on `g.deadline`, which is what actually changes across
  an Extend. New test `tests/live-extend.test.jsx`: real Host+Player screens
  over the real mock driver, drives a question through expiry, grace-seal,
  and Extend, and asserts the Player genuinely returns to answering — this
  bug lived in a React effect, and the pure-actions test in
  `live-loop.test.mjs` (which already existed and stayed green throughout)
  never exercised it.
- R3 (delta tap-to-cycle is clumsy): replaced with a one-tap, 3-state
  Plus/Nothing/Minus `radiogroup` per Team (`DELTA_SIGNS`/`signOfDelta`/
  `deltaForSign` in state/game.js, 44px targets). `cycleDelta` had no other
  caller left after this, so it's removed rather than kept as dead code;
  `game-view.test.mjs`'s V2-11 test now covers the sign helpers instead.
  Updated `live-turn.test.jsx` and `live-noanswer.test.jsx`, which drove/
  asserted the old cycle button.
- R4 (Question Log lacks selector): `selectQuestion` now takes an optional
  `{playerId, teamId}` and stores it as `question.selectedBy` — captured once,
  at selection, because by commit time (`commitScores`, which is where the log
  entry gets written) the live tap-in/selectIntent state has already moved on
  to the next turn. `commitScores` carries it onto the log entry;
  `logRow` (state/game.js) resolves it to display names the same way it
  already resolves `categoryName`; `Peripherals`' LogSheet renders "Selected
  by `<name>` · `<team>`" under each row.
- R5 (wrong timeout copy for non-contestants): `PlayGame`'s post-expiry
  banners now branch on `me.mayAnswer` (eligibility) first, then on
  `me.missedIt` (lock state) — previously they were two independent
  conditions that could both render at once, so a Team that was never in the
  running (Selector Only, not their turn) saw both "Only X may answer… Watch
  along." AND "No answer from `<their own Team>` — no points, and no
  penalty," which is a caveat that only makes sense for a Team that COULD
  have answered. Ineligible Teams now see plain "Time is up." once the
  question locks; the fuller caveat is exclusively for an eligible Team that
  didn't lock in time. New test `tests/live-timeout-copy.test.jsx`.
- R6 (no end-of-game screen): Host and Player already had a plain Final
  Scores view from S4 (`g.ended` branches in HostGame/PlayGame) — that part
  of the finding predates this sprint and needed nothing. Display's `ended`
  view gets the "podium treatment" the requirement specifically calls for:
  top three raised by rank, everyone else as a plain list below. Kept
  deliberately plain (no motion, no medal art) per the requirement's own
  "plain is fine (S5 polishes)."
- R7 ("Show QR Code" is Host-only): new `room.meta.showQr` (synced, not local
  UI state) + `setShowQr` action. `Peripherals`' Host-only QR toggle drives it
  via an effect keyed only on `open` (not on the `host` prop object, which is
  a fresh literal every HostGame render and would otherwise re-fire — and
  re-write the synced flag — on every unrelated re-render); reading the
  latest handler off a ref keeps that effect from going stale. `DisplayGame`
  checks the flag before anything else and, when set, shows QR + Room Code
  in place of whatever it would otherwise be showing — mid-question included,
  since a Player needing to rejoin doesn't wait for a convenient moment.
- R8 (no Quickstart preset): `content/catalog.js` gets `loadGameDefaults()`
  (fetches `public/questions/game-defaults.json`, degrades to `[]` on a
  missing/bad file — same posture as `loadIconManifest`); `useCatalog.js`
  wraps it as `useGameDefaults()`. `Host.jsx`'s existing first-time-setup
  routing (opens the Category step when a fresh room has none chosen) now
  waits one tick for the preset before opening, and seeds the draft selection
  from it instead of empty — still fully a draft, so every tile stays
  editable before Confirm.
Deviations from PRD (if any, + why):
- R2's fix clears ALL locks on every reopen, including an explicit Lock In
  from an ALL-contestant Stage that had already sealed the question (not only
  expiry auto-locks). V2-15 says "Host may extend → options unlock" without
  carving out that case, and once Extend is pressed the Host is the one
  overriding the seal — but if Michael wants an explicit Lock In to survive
  an Extend (so only the Teams who never answered get a second chance),
  that's a follow-up, not implied by the register as written. Flagging rather
  than guessing.
- Did not touch `LOCK_GRACE_MS`, the three HostGame authority effects
  themselves, or anything under S5's tooltip/motion diff — verified by
  running that diff's own tests (tooltip.test.jsx, motion.test.jsx) unmodified
  and green.
Vitest: 103 passed / 103 (21 files, both sessions' tests together). New this
  session: live-extend (1), live-timeout-copy (1), display-game (3),
  quickstart (1). Modified: live-turn.test.jsx and live-noanswer.test.jsx
  (delta-control assertions updated for R3), game-view.test.mjs (cycleDelta
  test replaced; two new logRow/selectedBy cases for R4). `npm run build`
  clean (363.5kB main chunk, unchanged shape); pre-existing
  `INEFFECTIVE_DYNAMIC_IMPORT` build warning for exposure.js is unrelated to
  this session (not touched) and was not investigated.
Next / blockers:
- NOT observed in a real browser: R1/R6/R7's visuals (locked-letter
  highlight, podium, the Display's QR override) and R2/R5's live-device
  timing. All verified via jsdom component tests over the real mock driver,
  not eyes on a screen. Folds into the same HUMAN/BROWSER PASS S5 already
  flagged as owed — do not let it get bigger without someone actually looking.
- Working tree is UNCOMMITTED and now carries S4.6 layered on S5. Michael, in
  C:\Users\user\Trivia (PowerShell): `npm test` then `git add -A` then
  `git commit -m "S4.6+S5: v2.1 bugfix sprint (R1-R8) + design pass"` then
  `git push` — recommend one commit covering both since they were never
  split apart in the tree, unless Michael would rather I `git stash`/replay
  them separately first (ask before doing that; it rewrites nothing on disk
  today but is worth confirming).
- Still outstanding, unchanged from S2/S3/S4/S5: exposure migration blocked
  on `firebase-rules.json` publish; tools/sync-test.html's 3-tab checklist;
  a real 2-phone + 1-display Firebase game. S6 is where all of this gets
  walked live before cutover.
- RESOLVED (next entry): the "Working tree is UNCOMMITTED" line above was
  committed and pushed as `b010e63` on `v2` shortly after this entry was
  written.

## S4.6-R9 2026-07-11 - Bugfix: Team switch double-counts the Player - Sonnet
Done:
- REPRO confirmed by reading the code before touching it: `createTeam` and
  `joinTeam` (engine/actions.js) each wrote the Player onto their NEW Team's
  roster but never touched their OLD one. Neither the UI nor the wire has a
  distinct "leave" action — Back in the lobby only releases a selection/
  tap-in claim (V2-14) — so a switch (Back -> create/join a different Team)
  left `teams/<old>/players/<id>` sitting there forever. `selectLobby`'s
  counts are derived straight from `teams/*` (state/lobby.js), so the ghost
  entry double-counted the Player on every screen, permanently.
- New `leavePreviousTeam(sync, playerId, newTeamId)`, private to actions.js,
  called from both `createTeam` (after its team-creation transact commits)
  and `joinTeam` (after the new-team write): reads the Player's CURRENT Team
  off `clients/<id>/teamId`, no-ops if there isn't one or it's the Team
  they're switching TO (retyping your own Team's name is not a switch), then
  transacts the old Team node — delete the Player's key, and if that leaves
  zero Players AND `meta/status === 'lobby'`, delete the Team node outright
  (`transact` returning `null` is a real delete, per adapter.js's
  `setAtPath`). Mid-Game the emptied Team is left in place: its `score` and
  its seat in `game/teamOrder` are live state `scheduler.advanceTurn` still
  expects to find, not lobby bookkeeping.
- `status` is read once via `readPath` before the transact, matching how
  every other cross-path guard in this file already works (`claimHost`'s
  `hostPin`/seat check is the same shape) — not a new risk introduced here.
- Order of writes in both callers is new-roster-first, old-roster-second, so
  a Player is never transiently uncounted (worst case they're briefly on
  both, which is the bug being fixed, not a new one — and it resolves within
  the same action, not across a render).
Deviations from PRD (if any, + why): none. R9's three required behaviors
  (remove from old roster; delete an emptied Team only in the lobby; the
  client record always points at the new Team) are implemented exactly as
  specified — the last one needed no code change, since `registerClient`
  (already called by both actions) has always written the given `teamId`
  unconditionally.
Vitest: 106 passed / 106 (21 files, run twice to check for flakiness — both
  green). New in `tests/join-flow.test.mjs`: (a) a Player who was the whole
  of their Team switches — old roster entry gone, old Team deleted, counts
  correct; (b) a teammate remains — old Team survives with one Player; (c)
  mid-Game switch — old Team survives at zero Players, score and
  `game/teamOrder` both untouched. `npm run build` clean, same shape as the
  prior entry.
Next / blockers:
- NOT observed in a real browser — same standing caveat as every prior
  session; this is a jsdom+mock-driver verification, not a device pass.
- Working tree is UNCOMMITTED pending my own commit+push this session (see
  the instruction that started it) — expect this to be resolved by the time
  anyone reads this entry.
- Everything else outstanding is unchanged from S2-S4.6: exposure migration
  blocked on `firebase-rules.json`; the sync-test.html/2-phone device passes;
  S6 is where those get walked before cutover.

## S6 2026-07-11 - Live test protocol + pre-cutover review - Sonnet
SCOPING NOTE: no separate "S6 REQUIREMENTS (Fable)" entry exists in this file
(unlike S4/S4.6). Michael confirmed treating PRD §9's S6 row + the S5 entry's
carried note ("PRE-CUTOVER FABLE REVIEW; cutover master→v2; hub links.json...
S6's 'walked end-to-end on 2 devices + 1 display before cutover' gate is where
that confirmation has to happen before the Fable review, not after") as the
requirements. Recorded here rather than inventing a requirements doc after
the fact.
Done:
- Baseline: `npm test` 106/106 (21 files), `npm run build` clean — unchanged
  shape from S4.6-R9.
- RESOLVED, contradicting every "STILL BLOCKED" note carried since S2: the two
  Firebase steps are already done. Checked read-only, no writes: `GET
  /rooms/<code>.json`, `/presence/<code>.json`, `/exposure.json` all return
  200 against the live `stack-ep5` RTDB — `firebase-rules.json` is live in
  production. (The earlier "401" probes in the S2/S3 notes were almost
  certainly against the parent collection path — `/rooms.json` with no code —
  which Firebase's path-scoped rules correctly deny even when
  `rooms/$code/.read` is `true`; I re-probed at the wildcard-scoped path to
  confirm this isn't a real gap.) `exposure.json` readback shows 230 refs
  across 21 categories, exact match to the legacy-migration stamp
  (`1783065124912`) that `scripts/migrate-exposure.mjs` would write — the
  migration has already been committed by someone, outside this log. I did
  NOT run `migrate:exposure -- --commit` myself: the harness's own auto-mode
  classifier blocked it as an unreviewed production write against real
  rooms/presence data, correctly — and it would have been a no-op anyway
  since the data already matches.
- Pre-cutover code review (standing in for the Fable review this session
  can't self-supply): re-read `HostGame.jsx`, `DisplayGame.jsx`,
  `PlayGame.jsx`, `Peripherals.jsx`, and the `actions.js` functions behind
  R1-R9 and the v1 defect register, cross-checked against PRD §8b and
  DECISIONS-V2.md line by line. Confirmed in the actual code (not just the
  prior entries' prose): R1's `lockedLetters` passed into `DisplayGame`'s
  `Options`; R2's `openQuestion` clearing `game/question/locks` before
  `state`/`deadline`, and `PlayGame`'s auto-lock effect keyed on `g.deadline`;
  R3's Plus/Nothing/Minus `radiogroup`; R4's `selectedBy` threaded from
  `selectQuestion` through `commitScores`'s log entry to `Peripherals`'
  "Selected by "; R5's copy branching on `me.mayAnswer` before `me.missedIt`;
  R6's podium `DisplayGame` view; R7's `showQr` effect wired only on `open`
  via a ref (not the `host` object) and `DisplayGame`'s override check; R9's
  `leavePreviousTeam` called from both `createTeam` and `joinTeam`. No bugs
  found, no changes made — this sprint's fixes hold up under a second read.
  Also confirmed `tools/sync-test.html`'s imports (`../src/sync/adapter.js`,
  `../src/sync/driver-mock.js`) still match the current module shape.
- Searched this machine for the Saturday Solutions hub repo (`links.json`) —
  not present locally; that entry has to happen from wherever that repo
  actually lives, same conclusion PROGRESS.md already recorded.
Deviations from PRD (if any, + why):
- Did NOT perform the actual cutover (merge `v2`→`master`, production
  repoint, v1 archive) or the hub `links.json` entry. PRD §9's gate order is
  explicit — live device pass, THEN Fable review, THEN cutover — and the
  live device pass could not happen this session: `tabs_context_mcp` reported
  "Browser extension is not connected," the same recurring blocker flagged in
  every S1/S2/S3/S4/S5 entry, so no multi-tab/multi-device walkthrough of the
  defect register or `tools/sync-test.html`'s 3-tab checklist was possible,
  and there were no physical phones to substitute. Running cutover without
  that gate would be deviating from the locked plan, not executing it, and a
  production repoint is exactly the kind of action worth confirming rather
  than assuming. Treating "no requirements doc + no way to satisfy the gate"
  as license to skip straight to "Prod repointed; v1 archived" would have
  been the actual deviation.
Vitest: 106 passed / 106 (21 files, unchanged from S4.6-R9 — no code touched
  this session). `npm run build` clean, same shape.
Next / blockers:
- CUTOVER IS THE ONLY THING LEFT, gated on one thing: a real live pass — 2
  phones + 1 display (or the Chrome extension reconnected so this session can
  drive multiple tabs against the real Firebase driver) walking the defect
  register (#1-#10) and the v2.1 register (R1-R9) end to end, plus
  `tools/sync-test.html`'s 3-tab checklist. Once that's done and reports
  clean, cutover is mechanical: merge `v2` into `master` (or whatever branch
  Vercel's dashboard has bound to production) and push; then the hub
  `links.json` entry, from the hub repo (not present on this machine).
- Firebase rules + exposure migration: no longer blockers — confirmed live,
  see above. Nothing further needed there.
- Everything else (motion/tooltips/visual polish) was already S5-complete
  and untouched this session.

## S6.5 2026-07-11 - Trial-round register R10-R14 + V2-26 (3-way Contestants) - Opus
Scope = PRD §8c (R10-R14) and DECISIONS-V2 V2-26 exactly. Done:
- ENGINE (scoring.js), ADDITIVE — the four v1 modes (community/exclusive/
  contest/suddendeath) are UNTOUCHED so tests/full-game.test.mjs still pins
  the ported engine (V2-1). Added three DEDICATED v2 modes carrying the
  amended trial-round scoring: `selectorOnly`, `all`, `fastest`. The rule that
  holds across all three (V2-26): the SELECTING team must answer and takes the
  no-answer penalty when Penalty is On; a NON-selecting team is scored only if
  it answers and is penalty-exempt on silence. `fastest` differs from `all`
  only in the selecting-team penalty condition — `all` penalizes the selector
  on its own silence; `fastest` penalizes it only when NObody answered (raced,
  not silent).
- stages.js: Contestants is now 3-way (`CONTESTANTS` = Selector Only / All /
  Fastest Fingers, V2-26). `modeFor`/`contestantsOf` remap to the three v2
  modes; the four legacy v1 modes still read back as a live Contestants value
  (MODE_TO_CONTESTANTS keeps them) so a room persisted before this change
  renormalizes cleanly rather than showing a blank control (V2-9: contest stays
  unsurfaced). R14: ORDER_MODES labels renamed "Winner First"->"Winning Team",
  "Loser First"->"Lowest Score"; the `winnerFirst`/`loserFirst` VALUES and the
  registration tiebreak are unchanged, so the scheduler and every persisted
  room need no migration. `everyoneAnswers()` added (true for All + Fastest);
  `isAllContest()` kept (now strictly "All"). defaultStages Stage 3 -> All,
  Stage 4 -> Fastest Fingers, matching PRD §4's named bookends.
- game.js: `lockEnding({locks,deadline,contestants,selectingTeamId})` is the
  pure decision the Host loop consults — 'seal' (Selector Only / Fastest, on
  the first explicit lock), 'pull' (All: only the *Selector's* explicit lock
  ends it, by pulling the timer in), or null. Added `contestants` and
  `selectorChoice` to the game view (R11).
- actions.js: `pullDeadline(sync, role, deadline)` — drops the live question's
  deadline WITHOUT clearing locks or state, unlike `openQuestion`. This is
  R10's mechanism: the Selector's Lock In drops the timer to now, every other
  team's device auto-locks its pending selection (V2-15's existing PlayGame
  auto-lock, already keyed on `g.deadline` since R2), then authority effect 3
  grace-seals. `openQuestion` would have wiped the Selector's own answer.
- HostGame.jsx (R10): authority effect 2 rewritten to branch on `lockEnding` —
  seal immediately for Selector Only/Fastest, or pull-then-grace-seal for All.
  A new `pulling` ref guards the pull to once per question (the pulled deadline
  re-triggers the effect). The old "seal on ANY explicit lock" path now lives
  only in Fastest Fingers.
- PlayGame.jsx (R12): the pre-reveal status messages collapse into ONE
  fixed-height reserved slot above the A-D grid, so an alert appearing (the
  question sealing when a team Locks In) can no longer reflow the options and
  push a mid-tap from D onto C. Options already disable the instant the
  question leaves `open` (via `answering`), so a tap during the transition
  can't register — belt and suspenders. Also: the selecting-team no-answer
  copy now warns of the penalty when it applies (V2-26), except in Fastest
  Fingers when someone else answered (raced, not penalized).
- DisplayGame.jsx (R11): pre-reveal highlights ONLY the Selector's locked
  letter (`g.selectorChoice`), never another team's — in All a non-selector's
  lock does not end the question (R10), so showing every lock would leak
  answers. Pre-reveal Contestants text is now 3-way (Fastest Fingers / All +
  "X controls the finish" / Selector Only).
- HostSetup / Peripherals: no code change — both are data-driven off CONTESTANTS
  and ORDER_MODES, so the 3-way control and R14 labels flow through.
Deviations from PRD (if any, + why):
- defaultStages changed Stage 3 -> All and Stage 4 -> Fastest Fingers (were
  community/community). PRD §4 now names Stage 4 as Fastest Fingers, so this
  aligns the default with the doc; every field stays editable before Begin.
- R12 fixed with a reserved fixed-height slot + instant disable, NOT a floating
  absolute overlay. Reserved space is simpler, can't be clipped, and satisfies
  "must not reflow the grid" + "disable the options the instant the alert
  appears." Flag if a floating banner is specifically wanted.
- vite.config.js: raised testTimeout/hookTimeout to 20000. The jsdom
  live-screen tests each finish in ~2-3s in isolation but the forks pool runs
  all files concurrently, and under that CPU contention the 5s default
  intermittently tripped on correct work (observed 2-3 timeouts per full run
  pre-change, 0 after). Not a logic change; a genuine hang still fails inside
  the window.
Vitest: 119 passed / 119 (23 files). New: contestants-modes (7 — scoreOutcome
  for all three modes incl. penalty on/off, selecting-team no-answer penalty,
  Fastest ties + raced-selector, and `lockEnding` for every mode incl. untimed),
  live-all-mode (1 jsdom — the R10 flow end to end through the real Host+Player
  screens: Selector Locks In, the other team's PENDING selection is captured,
  both score). Extended: live-loop (+4, real driver — All selector-control,
  All selecting-team no-answer penalty, Fastest first-press, Fastest ties),
  display-game (+1 — R11 shows only the Selector's lock). Updated for the new
  mapping/labels/scoring: stages.test, game-view.test. Pre-existing S1-S6
  suites all still green. `npm run build` clean (366kB main chunk;
  pre-existing INEFFECTIVE_DYNAMIC_IMPORT warning for exposure.js unrelated,
  untouched).
Next / blockers:
- NOT observed in a real browser (standing caveat, every prior session): R11's
  Display highlight, R12's no-reflow on a real phone at a real viewport, and
  the R10 All-mode capture across physical devices. All verified via jsdom +
  the real mock driver, not eyes on a screen. Folds into S6's owed device pass.
- Branch is `v2`, per constraints — NOT cut over to master. Working tree
  UNCOMMITTED. Michael, in C:\Users\user\Trivia (PowerShell): `npm test` then
  `git add -A` then `git commit -m "S6.5: trial-round R10-R14 + V2-26 3-way
  Contestants (Opus)"` then `git push`.
- The S6 cutover gate (live 2-phone + 1-display pass of the defect + trial
  registers before the Fable review) is unchanged and still owed — R10-R14 now
  need walking live alongside #1-#10 and R1-R9.
