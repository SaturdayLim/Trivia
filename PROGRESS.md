# Stack Webapp — Progress Ledger

Objective: web-app version of the Stack trivia game. Static frontend (GitHub Pages) +
Firebase Spark realtime sync behind a swappable adapter. Roles: Player / GM / Display.
Questions live as one Markdown file per category in this repo.

## Status: BUILD COMPLETE (2026-07-03); Firebase wired, NSFW/Nat categories removed, repo public + Pages enabled (2026-07-04) — pending user: browser click-through, live cross-device test

## Acceptance criteria (PRD §7) verdicts
| # | Criterion | Verdict |
|---|---|---|
| 1 | Zero-build static serve | PASS — full import graph + assets 200 over local HTTP |
| 2 | Multi-tab mock game | Mechanics PASS headless (tests/full-game.test.mjs); browser click-through pending user (checklist in tools/sync-test.html + below) |
| 3 | Registration flows | Built; create/join actions engine-tested; UI click pending |
| 4 | Settings take effect | PASS — 4-mode game driven by round config; updateRoundSettings guard tested |
| 5 | Tap-in exactly-one-winner | PASS on mock (same-tick race + atomic gate); Firebase live test = task 10 |
| 6 | Turn order modes | PASS — winnerFirst/loserFirst/ties/recalc fixtures |
| 7 | Locks earliest-per-team, selector lock public | PASS |
| 8 | Mode matrix (community/exclusive/contest/suddendeath) | PASS |
| 9 | Contest: contrasting pick, selector exempt, ±full | PASS |
| 10 | Scoring value×multiplier, penalty on/half/off | PASS (full matrix) |
| 11 | Answer/fact never on wire pre-reveal | PASS by design + UI grep audit |
| 12 | GM delta override, adjust, skip | PASS (commitScores(edited), adjustScore, skip returns ref) |
| 13 | Exhaustion: tier disable, category hide, end prompt | PASS engine; UI built |
| 14 | Used-question memory + exclude + reset | PASS + one-tap v6 legacy import wired |
| 15 | Refresh resume | Built (identity restore, GM serializer recovery, settings hydration); click pending |
| 16 | Timer expiry locks, unanswered 0 | PASS (auto lockQuestion + scoring) |
| 17 | Importer on real bank | PASS — executed: 60 categories, 0 parse errors |
| 18 | Firebase cross-device | Config wired + driver swapped 2026-07-04 (docs/DECISIONS.md #25); live 2-device click-through still pending user |

## Bugs found & fixed in integration
- advance() left the scored question in state → requestSelection deadlocked every
  game after question 1 (stale-detector masked it visually). Fixed: advance clears it.
- claimTapIn gate check wasn't atomic with the claim (stale-gate win possible). Fixed.
- GM delta edits were wiped by 2s presence rerenders. Fixed (edits keyed by question).
- Serializer duplicate-request redelivery could double-apply writes. Fixed (requestId dedup).

## Follow-ups (non-blocking)
- QR-code join (deferred; room code + URL shown). Vendored QR lib if wanted.
- 6 archive rows skipped for answer-text bugs → questions/import-report.txt.
- Icon/Color lines absent on imported categories; "Categories & Icons" sheet in the
  bank has icon keywords that could be mapped to assets/icons later.
- claude-mem plugin worker was unreachable all session (hook noise only; no build impact).

## Done so far (all committed)
- Parser/validator + sample + 3 demo categories (T3) — node round-trip verified
- Sync adapter + mock driver (T5) — reviewed, hardened (request dedup, atomic
  tap-in gate), node smoke-tested; manual harness tools/sync-test.html
- Game engine (T6) — scoring/scheduler/board/actions/storage; 100 node tests
  green; review added setBoard, lobby actions, selectIntent flow, lockQuestion
- Excel importer (T4) — tools/import.html; mapping verified against the real
  900Q workbook; output round-trips through the shared parser
- UI (T7) — agent in flight: index.html, css, main.js, js/ui/* per PRD §6
- Content loaded (2026-07-03): 60 categories live in questions/ (30 bank +
  30 archive-*), used-legacy.json (251 refs from Database.xlsm Archive col L),
  game-defaults.json (first-night board). Integration pass must wire: GM picker
  preset from game-defaults.json + one-tap used-legacy import into storage.recordUsed.

## Decisions locked (interview 2026-07-02)
| Area | Decision |
|---|---|
| Sync | Firebase Spark (free tier) behind thin adapter; local mock driver for dev/testing |
| Hosting | GitHub Pages, no build step |
| Turn order | Settings-driven: round 1 = registration order; later rounds winner-first or loser-first; persist-per-round OR recalc-per-rotation |
| Selector | Tap-in race among active team's players decides selector |
| Rounds | GM sets number of rounds (stages) and rotations per round; current game has 4 stages (Leaderboard!S10:S13) |
| Game modes | COMMUNITY / EXCLUSIVE / CONTEST / SUDDEN DEATH — full semantics in docs/RULES-v6.md |
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
1. ~~Firebase project~~ — DONE 2026-07-04: project `stack-ep5` created, config wired, driver swapped live.
2. ~~GitHub repo visibility~~ — DONE 2026-07-04: removed `questions/archive-nsfw.md` and `questions/archive-nat.md` (Nat's birthday category), then made `SaturdayLim/Trivia` public and enabled GitHub Pages, live at https://saturdaylim.github.io/Trivia/ (docs/DECISIONS.md #33).
3. Confirm: vanilla-JS stack, challenge visibility rule (does challenger see selecting team's locked answer before challenging?), Crown/Target phase semantics if mining is inconclusive.
4. Live click-through: once hosting is decided, open the live URL on two real devices and run the docs/FIREBASE-SETUP.md §6 verification checklist.

## Next
- T3 parser/validator, T4 importer, T5 sync layer (agents)
- Then T6 engine → T7 UI → T8 Firebase driver → T9 integration test
- NOTE 2026-07-03: first 4-agent wave died on the session token limit (the mining
  agent read giant pptx XMLs raw); rules were re-mined inline with targeted greps.
  Keep agent briefs surgical; never let an agent read whole Office XML files.

## Resume instructions (fresh session)
Read this file + docs/PRD.md + docs/DECISIONS.md. Source game: ..\Stack\ (v6 Excel+PPT).
Task list lives in the session task tracker; mirror of statuses kept here after each phase.
