# Stack v2 — Product Requirements Document

_Drafted 2026-07-10 by Fable (planning). Executors: Opus/Sonnet agents. Decision record:
`DECISIONS-V2.md` (amends v1 `docs/DECISIONS.md` in repo SaturdayLim/Trivia). Setup steps
for Michael: `SETUP.md`. Admin UI is out of scope here → `ADMIN-UI-BRIEF.md`._

## 1. Overview

Stack is a web trivia-hosting game (Jackbox/Kahoot-style) for game nights: one Host
(mobile), Players on phones, one or more read-only Displays (landscape, projected).
v1 (stack-trivia.vercel.app) is functionally complete but fails on UX polish and
join/lobby reliability. **v2 = renovation**: keep the regression-tested engine and
Firebase sync adapter; rebuild the UI layer and flows on a real build stack.

North-star qualities:
- **Reliability over reflexes** — every screen syncs within ≤1s; no dead ends, no
  "Connecting…" placeholders; refresh always resumes.
- **Player experience first** — design from best practices, not the legacy PPT.
- **Zero-cost stack** — Vite + React + Tailwind + Vitest, Firebase Spark, Vercel free tier.

## 2. Architecture

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vite + React + Tailwind CSS | Single app, three role routes (/host /play /display). Engine ported as-is to `src/engine/` (plain JS modules, Vitest suite ports with it). |
| Realtime | Firebase RTDB `stack-ep5` via existing swappable adapter (`src/sync/`) | Mock driver retained for single-device testing (V2-21). |
| Persistence | Firebase: rooms tree (live state) + `exposure/` tree (cross-game used-question memory, V2-5) + host PINs | Migrate `used-legacy.json` refs into `exposure/`. |
| Content | Repo: `public/questions/*.md` (one file per category, v1 strict format, single answer only) + `public/icons/<category>.png` | Icon fallback: numbered circle (V2-8). Authoring stays GitHub-side until Admin UI mini-project lands. |
| Hosting | Vercel (framework preset Vite), auto-deploy on push; v2 developed on `v2` branch w/ preview URLs; master = v1 fallback until cutover | GitHub Pages deprecated for v2 (no build) or via optional Action later. |

Authority model unchanged from v1: Host device is the game authority; players write
intents (join, select, lock); engine reduces; Display is read-only.

### Room state additions vs v1
- `room.hostPin` — set at creation; host rejoin requires it; single-host invariant (V2-19).
- `room.lifecycle` — `{createdAt, lastActivityAt}`; expire on close or 24h inactivity (V2-20).
- `exposure/<categoryId>/<questionId>` — global (not per-room), written at reveal.
- `room.selectionClaim` — team-turn first-click lock: `{playerId, screen}`; cleared by Back (V2-14).

## 3. Roles & screens

### 3.1 Common shell
- Entry: Start (become Host) / Join (room code → Player or Display).
- Auto-generated room codes (V2-20); QR join rendered on Display and Host (bundled QR lib).
- **Waiting lobby for everyone**: players, displays, and host all land in a shared lobby
  showing joined teams/players/displays live — never a "Connecting…" placeholder (defect #1).
- Peripherals available at all times per role: Scores, Question Log, Round Settings
  (Host additionally: score modifiers, edit settings, Return to Home, Close Room, Show QR).
- All user-facing copy: proper case, standardized vocabulary — a **Game** has 4 **Stages**,
  each with a pre-set number of **Rotations** (V2-23). Headers get click-in (?) tooltips
  with definitions (defect #3).

### 3.2 Host flow (mobile-first)
1. Start → room code auto-generated + host PIN shown (save prompt).
2. Category selection: uniform-size tiles (defect #2), each showing icon + available
   count; empty/depleted categories unselectable until exposure reset. Confirm.
3. Stage setup: 4 Stages listed; per stage — Rotations count, Thinking Time (default 30s),
   Penalty On/Off, Contestants Selector-only/All, Multiplier (integer), Who-Selects-First
   (Registration/Winner/Loser), Who-Selects-Next (Registration/Winner/Loser). All numeric
   fields typeable AND steppable (defect #9); dropdowns stay open until explicit selection
   (defect #7). Confirm.
4. Lobby (can go Back to revise anything) → Begin.
5. Live loop per question: sees question + correct answer + fun fact; Start (countdown +
   options activate) → Reveal (correct flashes green, wrong red) → per-team delta toggles
   (+ / nil / −, pre-filled by auto-scoring) → Update (commits scores; writes exposure;
   all screens return Home).
6. Anytime: extend timer (reopens options, V2-15), score modifiers, close room (confirm).
7. Host disconnect → rejoin via room code + PIN; no join while a host is present.

### 3.3 Player flow (mobile)
1. Join → room code → Player → enter/join team name (mid-game joins allowed: new team at
   0 pts slotted last, or join an existing team; V2-13). Confirm → lobby. Back edits name;
   Exit leaves.
2. Selector turn (team-level): remaining categories shown to the whole team; first member
   to tap claims control and locks teammates' selection UI until Back (V2-14). Then
   difficulty (Easy/Med/Hard; unavailable tiers disabled) → options A–D + Lock In.
3. ALL-contestant stages: every team's players get options when Host starts the timer.
4. Lock In: shows their letter full-screen (big white letter on black) until Host updates.
   Leaving that view does NOT disqualify (V2-16). A lock-in zeroes the timer and locks
   everyone else (V2-15).
5. No selection when timer hits 0 = no answer: 0 points, penalty-exempt (V2-16).

### 3.4 Display flow (landscape desktop / landscape phone)
View-only progression: Home (scores, stage settings, available categories) →
difficulty-selection view (remaining counts per tier) → question view (category tinted
green/yellow/red by difficulty, question, A–D, countdown, selector name) → reveal view
(answers colored, points deltas) → back to Home on Update. Lobby shows QR + room code.

## 4. Game model

- **Game** = up to 4 Stages. **Stage** = settings bundle + N Rotations. **Rotation** =
  one selection turn per team in order. Typical: Stage 1 intro (30s, no penalty,
  selector-only, ×1, registration order), Stage 4 sudden death (penalty, all contest,
  ×2–3, loser-first).
- Turn order: Who-Selects-First seeds the stage (Registration/Winner/Loser); Who-Selects-Next
  orders each subsequent cycle (Registration/Winner/Loser); ties broken by registration
  order (V2-10). New teams slot below existing order.
- **Board draw** (V2-17): per-category setting N ("Questions per tier"); draw randomly up
  to N per difficulty tier from unexposed pool; short tiers contribute what they have.
- **Scoring**: base 1/2/3 (Easy/Med/Hard) × stage multiplier; penalty (if On) = −value on
  wrong lock; no answer = 0 always. Host sign-toggle before commit (V2-11).
- **Exposure**: written to Firebase at reveal; exposed questions excluded from future
  draws in all future games; Host can reset per category (unlocks depleted categories).
- Single correct answer per question (V2-7). Contest mode not surfaced (V2-9).

## 5. Content pipeline

- Format: v1 strict Markdown per category (`docs/PRD.md §3` in repo) — Category,
  sub-category, difficulty, options A–D, single Answer, fun fact. Exposed flag REMOVED
  from files (now Firebase). Validator tool ports to v2 (run in CI later if desired).
- Icons: `public/icons/<category-slug>.png`, referenced from category frontmatter;
  fallback numbered circle.
- Authoring UX improvements = Admin UI mini-project (separate; see ADMIN-UI-BRIEF.md).

## 6. Non-functional requirements

- Sync propagation ≤1s across host/player/display on the same Firebase region.
- Refresh-resume for all three roles (v1 had this — must survive the renovation).
- Scale: 1 concurrent room, ≤30 players, ≤30 teams, ≤30 displays, 1 host (V2-18).
- Room lifecycle: expire on close or 24h inactivity; mid-game breaks survive (V2-20).
- Mock driver: full game playable in multiple tabs offline (V2-21).
- Mobile-first Host/Player; landscape Display; touch targets ≥44px; no mirrored modes (V2-22).

## 7. Design language

Saturday Solutions family (V2-4): night canvas #0B0C10, Solutions accent #FFE600,
Saturday Services logo present; copy design suites from
`saturday-services/design/saturday-core/` + `design/solutions/` as the base prompt pack.
Difficulty semantics: green Easy / yellow Medium / red Hard. **New Stack logo required**
(design task; hub `links.json` entry under Saturday Solutions at launch).
Typography/motion: prioritize legibility at TV distance on Display; playful-but-clean.

## 8. v1 defect register (must-fix acceptance criteria, V2-24)

| # | Defect | v2 requirement |
|---|---|---|
| 1 | "Connecting…" placeholder pre-game | Shared live waiting lobby for players/displays/host |
| 2 | Category tiles uneven | Uniform tile grid |
| 3 | Unexplained headers (e.g. "Questions per tier") | Click-in (?) tooltips with definitions |
| 4 | Tick-mark function broken | Removed entirely for now |
| 5 | Inconsistent terminology | Game/Stage/Rotation vocabulary everywhere |
| 6 | Raw/repo-style casing in UI | Proper case + spacing in all user-facing text |
| 7 | Order-recalculation dropdown auto-dismisses | Dropdowns persist until explicit selection |
| 8 | Timer default unset | Default 30s |
| 9 | Numeric fields arrow-key only | Direct typing works on all numeric inputs |
| 10 | Player cannot join after room creation | Join works from lobby through entire game (incl. mid-game, V2-13) |

## 8b. v2.1 register — smoke-test findings (Michael, 2026-07-10, MUST-FIX before game night)

From the first real multi-tab playthrough. B = bug, E = enhancement. All in scope for
the S4.6 bugfix sprint (before/with S5); acceptance = the described behavior on Display,
Host and Player screens.

| # | Type | Finding | Required behavior |
|---|---|---|---|
| R1 | B | Locked answer not shown on Display | Once a team's answer is locked, the Display highlights the locked option letter (pre-reveal). Safe by design: in ALL-contestant stages a lock zeroes the timer and locks everyone (V2-15), so nothing can be copied. |
| R2 | B | Host "Extend Timer" button does nothing | Extend re-opens options and restarts countdown per V2-15. Diagnose root cause (state guard? deadline write?) — do not paper over. |
| R3 | E | Delta control: tap-to-cycle is clumsy | Replace with a 3-state flick/segmented control showing `+ / 0 / −` simultaneously; one tap selects the state. Values remain ±question value × multiplier (V2-11), pre-filled by auto-scoring. |
| R4 | E | Question log lacks selector | Log rows show who selected (player name + team) alongside category/difficulty/deltas. |
| R5 | E | Wrong timeout copy for non-contestants | Players not eligible to answer see "Time is up" only — no "No answer" caveat (that framing is for eligible players who did not lock). |
| R6 | E | No end-of-game screen | Add a Final Results page: final standings on all three roles when status=ended (Display gets the podium treatment; motion polish can wait for S5). |
| R7 | E | "Show QR Code" is Host-only | Host toggling Show QR also switches the Display to show the QR + room code (and back). |
| R8 | E | Quickstart preset | HostSetup pre-selects the game-night ten on room creation (editable): 2000s Pop, Desserts, Etymology, Flags, Inventions, Legends, Marvel, Memes, Ocean, Place Names. Wire from `public/questions/game-defaults.json` (v1 decision #32 — same ten, already shipped). |

## 9. Build plan & agent delegation

Per STANDING-ORDERS: Sonnet for well-specified execution, Opus for complex phases,
Fable for planning/review gates. Each phase ends with a review gate (Fable) + updated
PROGRESS.md. Suggested phases:

| Phase | Scope | Agent |
|---|---|---|
| 0 | Michael: machine setup + Vercel config per SETUP.md | Michael (+Sonnet Q&A) |
| 1 | Scaffold Vite/React/Tailwind on `v2` branch; port engine + Vitest suite green; port sync adapter + mock driver | Sonnet |
| 2 | State schema changes: exposure tree, host PIN, lifecycle/expiry, selection claim; migrate used-legacy.json | Opus |
| 3 | Screens: shell + lobby + join flows (defect #1, #10 first) | Opus |
| 4 | Host live loop + stage setup UI; Player selector/lock-in; Display views | Opus, then Sonnet polish |
| 4.6 | Bugfix sprint: v2.1 register R1–R8 (§8b) — priority over S5 for game night | Sonnet |
| 5 | Design pass: Solutions suite, tooltips, copy standardization, defect sweep #2–#9 | Sonnet |
| 6 | Cross-device live test protocol + fixes; cutover master→v2; hub links.json entry | Sonnet + Michael |
| — | Stack logo design | Separate task (Fable-supervised; agents weak here historically) |
| — | Admin UI mini-project | Opus (ADMIN-UI-BRIEF.md) |

Verification gates: Vitest engine suite green at every phase; defect register walked
end-to-end on 2 devices + 1 display before cutover; ≤1s sync spot-checked live.

## 10. Out of scope (v2)

Contest/challenge mode (code dormant), multi-answer questions, half-penalty, tick-mark
feature, in-app question authoring (separate project), auth beyond room code + host PIN,
multiple concurrent rooms, native apps.
