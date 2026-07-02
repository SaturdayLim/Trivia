# Stack Webapp — Product Requirements Document

Version 1.0 — 2026-07-02. Author: lead model (Fable). Sub-agents: build ONLY from this
document plus the task brief you are given; do not invent mechanics not specified here.
Game-rule provenance: docs/RULES-v6.md (mined from the v6 Excel/PPT implementation).

## 1. Overview

Web-app rebuild of "Stack", a team trivia game currently implemented as Excel
(`Database.xlsm`) + PowerPoint (`Trivia Template.pptm`) driven by one game-master (GM)
machine. The web version gives every player a live screen on their own phone, replaces
manual GM scoring with rule-driven scoring (GM can still override), and keeps the
question bank as human-editable files in the same GitHub repo that serves the app.

Deployment: static files on GitHub Pages. No build step, no bundler, no framework —
vanilla HTML/CSS/JS ES modules. The only external service is Firebase Realtime Database
(free Spark tier) reached through a swappable sync adapter; a local mock driver allows
full play/testing in multiple tabs on one device with no Firebase and no internet.

Non-goals (v1): accounts/auth, spectator chat, sound design, non-MCQ question types,
question editing UI inside the app (repo files are the editor), i18n.

## 2. Roles

Entry screen offers exactly three roles:
- **Player** — joins a room with a code, belongs to a team, taps in, selects, answers.
- **GM** — creates the room, owns settings, paces the game, reveals, overrides scores,
  sees fun facts. Exactly one GM per room (the room creator's device).
- **Display** — read-only big screen (TV/projector): board, score bars, current
  question, locks, reveals. Never shows fun facts. Any number may join.

## 3. Question content

### 3.1 Repo layout
```
questions/           one .md file per category, filename = category slug (kebab-case)
questions/_sample-category.md   canonical example, excluded from app listing (leading _)
```
The app discovers categories via `questions/index.json` (array of filenames), which the
importer/validator regenerates. (GitHub Pages cannot list directories.)

### 3.2 Category file format (strict)
```markdown
# Category: Movie Night
Icon: Icon_MovieCam            (optional; filename in assets/icons, no extension)
Color: #ED7D31                 (optional; tile accent)

## E1
Q: Which film won Best Picture at the 2020 Oscars?
A) Parasite
B) 1917
C) Joker
D) Once Upon a Time in Hollywood
Answer: A
Fact: First non-English-language film to win Best Picture.
```
Rules:
- Question IDs are headings `## E<n>`, `## M<n>`, `## H<n>` — at least one per
  difficulty, numbered sequentially from 1 (no gaps, no duplicates; any other ID
  errors). Files commonly hold ~30 questions (the legacy bank averages 10 per
  difficulty); the game draws a fresh subset at setup (§4.7).
- `Q:` text runs until the `A)` line; may span multiple lines (joined with newline
  preserved for display).
- Exactly four options `A)`–`D)`, single line each.
- `Answer:` is one of A/B/C/D. Required.
- `Fact:` single or multi-line until next heading; optional (may be empty). GM-only.
- Global question reference: `<categorySlug>:<qid>` e.g. `movie-night:E1` — used for
  used-question tracking, board state, and logs. Renaming a file resets its history.
- Parser is strict: any violation is a reported error with file + line number; a file
  with errors is rejected whole (no partial load).

### 3.3 Importer
`tools/import.html` (self-contained page, SheetJS from CDN, only used on a dev machine):
drop `Trivia Question Bank (900Q 30Cat).xlsx`, map columns interactively if headers
don't auto-match, download a zip of category .md files + `index.json` + an import report
(rows skipped and why).

### 3.4 Validator
`tools/validate.html`: drop one or more .md files, see pass/fail with line-level errors,
and regenerate `index.json`. The same parser module (`js/engine/questions.js`) powers
the app and both tools — one grammar, one implementation.

## 4. Game structure

### 4.1 Teams and players
- Teams: 2–8 (v6 supported 4; colors beyond 4 derive from the palette). Each team has
  name, color, order index, score. Players have display name + team membership.
- Registration: GM creates room → room code (5 chars, unambiguous alphabet) + QR.
  Players self-serve: join, name themselves, create or join a team. GM can rename,
  reorder (sets round-1 order), move players, and lock registration. Late joiners can
  join an existing team mid-game (never create one after lock).

### 4.2 Rounds, rotations, turns
- Game = ordered list of **rounds**. Each round has: `mode` (see 4.4), `rotations`
  (int ≥1), `multiplier` (int ≥1), `penalty` (`on|off|half`), `orderMode`
  (`registration|winnerFirst|loserFirst`), `timerSec` (0 = no timer). Defaults =
  the four v6 stages in order: COMMUNITY (registration, ×1, off, 3 rotations),
  EXCLUSIVE (winnerFirst, ×1, on, 3), CONTEST (loserFirst, ×1, contestor rule, 1),
  SUDDEN DEATH (loserFirst, ×2, on, 1). GM may add/remove/reorder/edit rounds.
- **Rotation** = every team takes exactly one turn.
- **Turn** = active team taps in → selector chooses category+difficulty → question
  plays out → scored → next team.
- Team order: per-round `orderMode` — `registration` (GM-set lobby order; v6's
  "Youngest" convention is applied by the GM when ordering) or
  `winnerFirst`/`loserFirst` by cumulative score, ties broken by registration
  order. Global `orderRecalc`: `perRound` (computed at round start, held) or
  `perRotation` (recomputed at each rotation start). Round 1 always registration.
- Round ends after its rotations complete; game ends after last round (GM may end
  round/game early). Final standings = cumulative scores.

### 4.3 Tap-in
When the board returns between turns, only the next team's members get an active
TAP IN button. First successful claim (adapter transaction, first-write-wins) makes
that player the **selector**; teammates' screens show who won. Selector alone picks
category and difficulty from the board.

### 4.4 Round modes (the four v6 stages — provenance in docs/RULES-v6.md §A)
| mode | v6 name | who may answer | penalty applies to |
|---|---|---|---|
| `community` | 01 COMMUNITY | every team | all answering teams (default off) |
| `exclusive` | 02 EXCLUSIVE | selecting team only | selecting team |
| `contest` | 03 CONTEST | selecting team + contestors | contestors only (selector exempt) |
| `suddendeath` | 04 SUDDEN DEATH | every team | all answering teams (default ×2 points) |

Each team's earliest lock is its answer; teams score independently. The engine
implements modes behind a strategy interface (`mayAnswer(teamId, state)`,
`scoreOutcome(locks, correct, roundCfg)`) so variants drop in without state-machine
changes.

### 4.5 Question lifecycle
```
board → (tap-in) → selecting → open → [locking…] → revealed → scored → board
```
- **open**: eligible players (per mode) see options and may lock exactly one answer.
  A lock is immutable. A team's answer = its earliest lock (adapter transaction per
  team). The selecting team's locked choice becomes visible to all screens immediately
  (v6 behavior: selection glows on the shared screen before reveal).
- **timer**: if `timerSec > 0`, countdown starts at open; expiry locks the question.
  Teams with no lock at reveal score 0 (never penalized).
- **reveal**: GM-triggered (GM button; also available after timer expiry). Correct
  option highlighted; wrong locked picks marked; fun fact appears on GM screen only.
- **scored**: engine computes scores (4.6); GM sees the computed per-team deltas and
  may override any team's delta (+value / 0 / −value / custom int) before confirming
  "Back to board" (mirrors v6 manual +/nil/− flow, but pre-filled by rules).
- **skip**: GM may abort a question pre-reveal; it returns to the board unused.

### 4.6 Scoring
- Question value = difficulty base (Easy 1, Medium 2, Hard 3) × round `multiplier`.
- Correct team: +value. Wrong locked answer, when the round's penalty applies to
  that team: −value if `on`, −ceil(value/2) if `half`, 0 if `off`. No lock: 0.
- **Contest** (mode `contest`): the selecting team answers with no penalty exposure
  (wrong = 0 regardless of penalty setting). Once the selecting team's choice is
  public and until reveal, any other team may lock a *different* option to become a
  contestor (UI enforces a contrasting pick; earliest lock per team). At reveal each
  contestor resolves independently: correct → +value, wrong → −value (symmetric
  full value; contestors always bear this risk regardless of penalty setting).
- **Sudden death** (mode `suddendeath`): community-style all-team answering with
  penalty default `on` and round multiplier default 2.
- GM may additionally adjust any team's total at any time from the GM console
  (bonus/correction, mirrors v6 bonus column O2:O5).

### 4.7 Board and exhaustion
- Board = GM-picked categories (default 10, setting `boardSize`) from the repo pool.
  Setup shows each category's fresh-question count (after exclusions).
- At setup the game draws `tierSize` (default 4) random fresh questions per
  difficulty per board category — the classic 12-per-category board. Each board
  category exposes E/M/H tiers with remaining counts. Selecting a difficulty draws
  randomly from that tier; consumed questions leave the pool. Empty tier →
  difficulty button disabled. Empty category → tile hidden (v6 behavior). All
  empty → GM prompted to end game.
- Used-question memory: the GM device persists used refs in localStorage across
  sessions. Setup offers "exclude previously used" (default on) + a reset. Used refs
  are recorded when a question reaches `revealed`.

## 5. Realtime architecture

### 5.1 Authority model
- The **GM client is the sole writer** of: phase transitions, settings, turn/round
  advancement, computed scores, room lifecycle.
- Players write only: their presence, their tap-in claim, their own answer lock,
  their challenge arm. All contested writes go through `transact` (first-write-wins).
- Display writes nothing.
- All clients render purely from synced room state (single source of truth). No
  client-local game logic divergence: the engine runs everywhere for rendering
  hints, but only GM commits state transitions.

### 5.2 Sync adapter (js/sync/adapter.js)
```js
const sync = await createSync({ driver, roomCode, clientId, role });
sync.update(path, value)                    // fire-and-forget set at path
sync.transact(path, txnFn)                  // atomic read-modify-write; txnFn(cur) ->
                                            // newVal | undefined (abort); resolves
                                            // {committed, snapshot}
sync.onChange(path, cb)                     // subscribe subtree; cb(value)
sync.onPresence(cb)                         // roster of connected clientIds
sync.serverNow()                            // estimated server epoch ms
sync.close()
```
Drivers implement `{connect, update, transact, subscribe, presence, offsetProbe}`.
- **driver-mock.js**: BroadcastChannel `stack-<roomCode>` + localStorage snapshot.
  The room-creator tab (GM) is the serializer: all writes/transactions round-trip
  through it; it stamps times, applies first-write-wins, rebroadcasts state. Supports
  full multi-tab play on one device, offline.
- **driver-firebase.js**: RTDB compat SDK (vendored or CDN with pinned version),
  `runTransaction` for transact, `onDisconnect` for presence, `ServerValue.TIMESTAMP`
  + `.info/serverTimeOffset` for serverNow. Config from `js/sync/firebase-config.js`
  (gitignored `.example` provided). Database rules: writes only under `/rooms/$code`,
  room TTL cleanup documented in FIREBASE-SETUP.md.

### 5.3 Room state schema (single JSON tree at rooms/<code>)
```jsonc
{
  "meta":   { "createdAt": 0, "gmClientId": "…", "status": "lobby|playing|ended" },
  "settings": {
    "orderRecalc": "perRound|perRotation", "tierSize": 4,
    "boardSize": 10, "categories": ["movie-night", "…"], "excludeUsed": true,
    "rounds": [ { "mode": "community|exclusive|contest|suddendeath",
                  "rotations": 3, "multiplier": 1, "penalty": "on|off|half",
                  "orderMode": "registration|winnerFirst|loserFirst",
                  "timerSec": 0 } ]
  },
  "teams":  { "t1": { "name": "…", "color": "#4472C4", "order": 0, "score": 0,
                      "players": { "p_ab12": { "name": "…" } } } },
  "clients":{ "p_ab12": { "role": "player", "teamId": "t1", "name": "…" } },
  "game": {
    "round": 0, "rotation": 0, "turnIdx": 0, "teamOrder": ["t1","t2"],
    "activeTeam": "t1",
    "tapIn": { "openFor": "t1", "winner": null },       // winner via transact
    "board": { "movie-night": { "E": ["E1","E3"], "M": [...], "H": [...] } },
    "question": {
      "ref": "movie-night:E2", "state": "selecting|open|revealed|scored",
      "value": 2, "openedAt": 0, "deadline": 0,
      "payload": { "q": "…", "options": ["…","…","…","…"] },   // answer NOT synced
      "locks": { "t1": { "playerId": "p_ab12", "choice": "A", "at": 0 } },
      // contest mode: a non-selecting team's lock IS its contest entry
      "result": { "correct": "A", "deltas": { "t1": 2, "t2": -2 }, "fact": null }
    },
    "log": [ { "ref": "…", "round": 0, "deltas": {}, "at": 0 } ]
  }
}
```
The correct answer and fun fact are never written into synced state before reveal
(players could read the wire). GM holds the full question bank locally; at reveal the
GM writes `result` (correct + deltas). Fun fact never syncs at all.

### 5.4 Resilience
- Client identity (`clientId`, name, teamId, role, roomCode) persists in
  localStorage; refresh/reconnect rejoins silently and re-renders from state.
- GM refresh: room state lives in the sync layer (and mock snapshot in localStorage),
  so the GM tab resumes authority on rejoin. `meta.gmClientId` re-binds by stored id.
- Presence indicators on GM screen (who's connected).

## 6. Screens

**Player**: role select → join (code, name) → team pick/create → lobby → in game:
tap-in screen (when eligible), board view (read-only or selecting), question screen
(options, lock state, CONTEST counter-pick flow in contest rounds, timer), reveal,
standings between rounds. Mobile-first, thumb-sized targets.

**GM console** (tablet/laptop layout): room create + QR; registration manager
(rename/reorder/lock); settings editor (global + per-round rows matching 4.2); in
game: current state banner, question preview WITH correct answer + fun fact, reveal /
skip / back-to-board controls, per-team delta editor at scored step, score adjust,
end round/game, connection roster.

**Display**: board grid (icons, remaining counts), team score bars (positive up /
negative down, v6 style) + score bubbles, active team + selector name, question +
options with lock glows (team colors), reveal highlight, round/rotation banner
("Stage 2 — Rotation 1/2"), room code footer for late joiners.

Visuals: palette tokens generated from `assets/setup-color.txt` (CSS custom
properties, same key names), category icons from `assets/icons/`, Stack logo on
entry/display screens. Dark background, high contrast, readable at distance.

## 7. Acceptance criteria (v1 done =)
1. Static serve of repo root (`python -m http.server` or Pages) = fully working app;
   zero build, zero console errors on load.
2. GM creates room; two player tabs join different teams; display tab mirrors; all
   via mock driver, one device, offline.
3. Registration: create/join/rename/reorder/lock all function; reorder drives
   round-1 order.
4. Settings: per-round rotations/multiplier/penalty/mode/challenge/timer + global
   orderMode/orderRecalc/boardSize/categories/excludeUsed all take effect in play.
5. Tap-in: 2 simultaneous claims → exactly one winner, on both drivers.
6. Turn order: winnerFirst and loserFirst orders verified against score fixtures for
   both recalc modes, ties by registration order.
7. Locks immutable; earliest per team wins; selecting team's choice publicly visible
   pre-reveal.
8. Mode matrix: community/suddendeath — every team's earliest lock scored
   independently; exclusive — only the selecting team may lock (others read-only);
   contest — contestors may lock only after the selector's public lock exists.
9. Contest: contrasting option enforced; selector penalty-exempt; symmetric ±full
   value per contestor; multiple simultaneous contestors all resolve independently.
10. Scoring math: value = base(1/2/3) × multiplier; penalty on/half/off; no-lock = 0;
    verified by unit fixtures run in tools/validate.html or a test page.
11. Reveal: GM-only trigger; fun fact never appears in player/display DOM nor in
    synced state pre-reveal; correct answer absent from wire before reveal.
12. GM overrides: per-team delta edit before commit; arbitrary score adjust; skip
    returns question unused.
13. Exhaustion: tier disable, category hide, end-game prompt when board empty.
14. Used-question persistence across browser restart; exclude toggle; reset.
15. Refresh any client mid-question → rejoins with correct role/team/state ≤5s.
16. Timer: expiry locks question; unanswered teams score 0.
17. Importer: real 900Q workbook → 30 category files + index.json, all passing the
    validator; report lists any skipped rows.
18. Firebase driver passes criteria 5/7/15 across two physical devices once the user
    supplies config (blocked task).

## 8. Build plan (agent delegation)
- Task 3 parser/validator, Task 4 importer, Task 5 sync adapter+mock — parallel,
  Sonnet, independent file zones.
- Task 6 engine (Sonnet) after 5; Task 7 UI (Sonnet) after 6; Task 8 Firebase driver
  (Sonnet) after 5. Fable reviews each against §7, max 2 correction passes.
- Task 9 integration: scripted multi-tab run on mock driver.
- Code style: ES modules, no deps, JSDoc types, small pure functions in engine
  (unit-testable without DOM), one file per screen in ui/.

## 9. Open items
- User: Firebase config (Task 10); GitHub repo + Pages (Task 11); confirm vanilla
  stack (provisional); confirm contest flow matches table play (selector's lock
  public → contestors counter-pick a different option); confirm variable
  per-category question counts (bank ≈30/cat) with 12 drawn per game board.
