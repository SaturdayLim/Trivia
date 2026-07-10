# Stack v2 — Decision Record

Answers collected 2026-07-10 (Part 2). Amends v1 `docs/DECISIONS.md` (repo SaturdayLim/Trivia).
All LOCKED (user) unless noted. V2-numbering; v1 decisions stand unless amended here.

| # | Decision | Detail / supersedes |
|---|---|---|
| V2-1 | Renovate, don't rebuild | Keep tested engine + Firebase adapter; rebuild UI/flows. Priority shift: wide reliability over split-second intra-team racing. Everything syncs ≤1s lag. |
| V2-2 | Real build stack, free tools | Vite + React + Tailwind + Vitest (Fable-recommended within Michael's "real build stack" mandate). Supersedes v1 #17 (no-build, was PROVISIONAL). Engine modules ported as-is into src/engine. |
| V2-3 | Firebase RTDB stays | Project stack-ep5, Spark plan. Confirms v1 #2/#25. |
| V2-4 | Identity: Stack under Saturday Solutions | New Stack logo to be designed; Solutions design features + Saturday Services logo present. Hub links.json entry at launch. |
| V2-5 | Exposure lives in Firebase | Persistent store (not localStorage, not repo write-back). Supersedes v1 #13. Legacy used-question data should migrate in. |
| V2-6 | Admin UI = separate mini-project | In-app question/icon authoring UI, own brief (ADMIN-UI-BRIEF.md), Michael engages an Opus agent for it. v2 core keeps repo-Markdown authoring. |
| V2-7 | Single correct answer only | No multi-answer MCQs. |
| V2-8 | Icons: PNG per category in repo | Fallback = circle containing the category's number (1–10). |
| V2-9 | Contest mode excluded | Supersedes v1 #10/#18. Engine mode retained in code but not surfaced. |
| V2-10 | Turn order options | Who-selects-first: Registration / Winner / Loser. Who-selects-next: Registration / Winner / Loser. Ties → registration order (confirms v1 #20). |
| V2-11 | Scoring flow | After reveal, Host toggles each team's delta sign (+ / − / nil; auto-scored default pre-filled), then locks in → scores commit, all screens reset to Home. Manual score modifiers remain available anytime via Host peripherals. |
| V2-12 | Penalty: On/Off only | Removes "half" (supersedes v1 #9). Penalty magnitude = question value × multiplier. |
| V2-13 | Mid-game joins | New teams join at 0 pts, slotted below existing order; players may join existing teams mid-game. |
| V2-14 | Team-level selection w/ first-click lock | During a team's selection turn, first member to click a category takes control and locks others' selection UI until they press Back. Peripherals (scores, log, settings view) always available to all. |
| V2-15 | Timer semantics | Default 30s. Expiry → options auto-disable (any currently-selected option is locked in as the answer). Host may extend → options unlock. A player's explicit lock-in drops timer to 0 and locks everyone (ALL-contestant rounds). |
| V2-16 | DQ softened | No answer selected when time runs out = no answer (0 / penalty-exempt). No exit-view disqualification. Supersedes new-spec DQ rule. |
| V2-17 | Board draw | Per-category question count is a setting ("per-category" N). Draw evenly across difficulties up to N per tier where available; short tiers just contribute what they have (e.g. N=5 with only 3 Mediums → 13 questions). Supersedes v1 #28 fixed tierSize=4. |
| V2-18 | Scale envelope | One room at a time; max 30 players, 30 teams, 30 displays, exactly 1 host. |
| V2-19 | Host rejoin PIN | Rejoin as host allowed via PIN created at room creation; no second concurrent host ever. |
| V2-20 | Room codes auto-generated | Expire on game close, or after 24h inactivity (mid-game breaks survive). Supersedes host-chosen codes. |
| V2-21 | Mock/offline driver stays | Single-device testing preserved. |
| V2-22 | Display: QR join + landscape | "Flipped phone" = landscape orientation, not mirrored output. QR lib to be vendored/bundled. |
| V2-23 | Game vocabulary standardized | Each **Game** = 4 **Stages**; each Stage = pre-set number of **Rotations**. All user-facing copy in proper case & spacing. |
| V2-24 | v1 defect register is must-fix scope | The 10 A1 items (see PRD §8) are acceptance criteria for v2. |
