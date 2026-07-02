# Decision Record — Stack Webapp

Interview conducted 2026-07-02 (grill-me). Statuses: LOCKED (user-chosen),
PROVISIONAL (recommended, user AFK — veto anytime), MINED (from v6 sources), OPEN.

| # | Decision | Status | Detail |
|---|----------|--------|--------|
| 1 | Sync = managed realtime service | LOCKED | rejected LAN server & WebRTC |
| 2 | Service = Firebase Spark, swappable adapter, Cloudflare DO named fallback | LOCKED | free-permanence concern addressed; mock driver for offline dev |
| 3 | Team order settings-driven, not tap-in | LOCKED | round 1 = registration order; then winnerFirst/loserFirst; persist per round OR recalc per rotation |
| 4 | Tap-in decides selector within active team | LOCKED | first-write-wins transaction |
| 5 | Round = GM-set rotations count; GM sets number of rounds | LOCKED | v6 confirms: 4 stages, rotation counts in Leaderboard!S10:S13 |
| 6 | All-teams-answer rounds; earliest lock per team, scored independently | LOCKED | = v6 COMMUNITY and SUDDEN DEATH modes (RULES-v6 §A) |
| 7 | Scoring: base 1/2/3 × multiplier | LOCKED | v6: Diff_Score = base × stage multiplier |
| 8 | Multiplier per round (not live toggle) | LOCKED | user chose non-recommended option deliberately |
| 9 | Penalty on/off/half, assumed per-round | LOCKED (scope PROVISIONAL) | wrong lock: −value / −ceil(value/2) / 0; no lock always 0 |
| 10 | Challenge = v6 CONTEST mode: contestor symmetric ±full value; selector penalty-exempt | LOCKED+MINED | contrasting pick after selector's public lock; Host Manual row: Players = Selector, Contestor / Penalty = Contestor |
| 11 | Pacing GM-driven + optional per-round timer | LOCKED | reveal & back-to-board are GM buttons |
| 12 | Question storage: one Markdown file per category | LOCKED | strict template, `Answer:` field added (missing from user's original schema) |
| 13 | Used-question memory across nights on GM device | LOCKED | localStorage, exclude toggle + reset |
| 14 | Registration self-serve + GM reorder/lock | LOCKED | room code + QR |
| 15 | Roles: Player / GM / Display on entry screen | LOCKED | display = read-only big screen, in v1 |
| 16 | Visual style = match existing deck | LOCKED | palette ported from setup-color.txt; icons + logo reused |
| 17 | No-build vanilla JS ES modules | PROVISIONAL | permanence-friendly; user hasn't confirmed |
| 18 | Challenge window: selector's lock is public pre-reveal, challengers pick a different option | PROVISIONAL | inferred from v6 (selection glows on shared screen) + user wording |
| 19 | Unanswered at timer expiry = 0 (never penalized) | PROVISIONAL | |
| 20 | Ties in standings order broken by registration order | PROVISIONAL | |
| 21 | Teams 2–8 (v6 capped at 4) | PROVISIONAL | colors 5–8 derived from palette |
| 22 | Modes = COMMUNITY/EXCLUSIVE/CONTEST/SUDDEN DEATH (VBA: Comm/Solo/Crown/Target) | MINED | full table RULES-v6 §A; v6 defaults ported into round config |
| 23 | Category with 0 remaining questions is hidden (not greyed) | MINED | Scoring.bas LogAndReturn |
| 24 | GM manual per-team +/nil/− after reveal → becomes rule-computed deltas + GM override | MINED | Scoring.bas TeamAction/LogAndReturn |
| 25 | Firebase project config | OPEN (user) | Task 10 |
| 26 | GitHub repo name/account, Pages | OPEN (user) | Task 11 |
| 27 | Crown/Target mechanics — resolved into #22 | MINED | Task 1 complete 2026-07-03 |
| 28 | Question files: variable counts (≥1 per difficulty, sequential IDs); game draws tierSize=4 per difficulty | AMENDED | bank ≈30/cat would waste 60% at a fixed 12; user's "12 per category" preserved as the board draw |
| 29 | Sudden death default ×2 multiplier | MINED | Leaderboard H formula: stage 4 → ×2 |
| 30 | v6 turn order & contest scoring were manual/social (E column hand-filled; +/nil/− host buttons) | MINED | webapp automates both, GM override retained |
