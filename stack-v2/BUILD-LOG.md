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
