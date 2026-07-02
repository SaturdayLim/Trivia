# Stack Webapp — Progress Ledger

Objective: web-app version of the Stack trivia game. Static frontend (GitHub Pages) +
Firebase Spark realtime sync behind a swappable adapter. Roles: Player / GM / Display.
Questions live as one Markdown file per category in this repo.

## Status: PHASE 0 — planning & scaffold (build started 2026-07-02)

## Decisions locked (interview 2026-07-02)
| Area | Decision |
|---|---|
| Sync | Firebase Spark (free tier) behind thin adapter; local mock driver for dev/testing |
| Hosting | GitHub Pages, no build step |
| Turn order | Settings-driven: round 1 = registration order; later rounds winner-first or loser-first; persist-per-round OR recalc-per-rotation |
| Selector | Tap-in race among active team's players decides selector |
| Rounds | GM sets number of rounds (stages) and rotations per round; current game has 4 stages (Leaderboard!S10:S13) |
| Game modes | v6 has 4 phases: Comm(1), Solo(2), Crown(3), Target(4) — exact semantics being mined from sources |
| Scoring | Base 1/2/3 (E/M/H) × per-round multiplier; penalty per round: on/off/half |
| Challenge | Symmetric stakes: ±full multiplied value; selector-only questions; per-team earliest lock |
| Open answer | Per-round flag; every team's earliest lock scored independently, full value |
| Pacing | GM-driven reveal + optional per-round auto-lock timer |
| Content | One .md per category; correct-answer field added to schema; importer from Trivia Question Bank (900Q 30Cat).xlsx |
| Used questions | Persist across nights in GM device localStorage; exclude toggle + reset |
| Registration | Room code/QR self-serve join; GM renames/reorders/locks; reorder sets round-1 order |
| Roles | Entry screen: Player / GM / Display (read-only big screen) |
| Style | Match existing deck: setup-color.txt palette, category icon PNGs, Stack logos |
| Stack (provisional) | No-build vanilla JS ES modules (user hasn't confirmed) |

## Blocked on user (batch when back)
1. Firebase project: needs user's Google account — 10-min console setup, then paste config into js/sync/firebase-config.js. Until then everything runs on the local mock driver (BroadcastChannel, multi-tab on one device).
2. GitHub repo: name + account to create/push + enable Pages.
3. Confirm: vanilla-JS stack, challenge visibility rule (does challenger see selecting team's locked answer before challenging?), Crown/Target phase semantics if mining is inconclusive.

## Next
- Mine v6 rules (agent) → docs/RULES-v6.md
- Write docs/PRD.md → scaffold app → engine → screens → Firebase driver → tests → deploy

## Resume instructions (fresh session)
Read this file + docs/PRD.md + docs/DECISIONS.md. Source game: ..\Stack\ (v6 Excel+PPT).
Task list lives in the session task tracker; mirror of statuses kept here after each phase.
