# Stack v2 — Clarifying Questions (Part 1, sent 2026-07-10)

Tiered by architectural impact. "Rec" = my recommendation. Answer inline or by number.
Context: v1 (github.com/SaturdayLim/Trivia, live at stack-trivia.vercel.app) has a
regression-tested engine + Firebase RTDB sync + 60-category Markdown bank + its own
DECISIONS.md; questions below only cover what your new spec changes or leaves open.

## Tier A — Foundation (decides the whole build)

**A1. What exactly failed in v1?** Top ~3 frustrations, split into *design* (looks/feel/layout)
vs *function* (flow, bugs, missing features). This anchors every other decision.

**A2. Renovate or rebuild?** (a) Keep the tested engine + Firebase adapter, rebuild UI/flows
on top; (b) full greenfield, salvage only question bank + Firebase project + learnings.
Rec: (a) unless A1 reveals engine-level dissatisfaction.

**A3. Framework.** v1's "no-build vanilla ES modules" was only PROVISIONAL (Decision 17).
For the polish you want: move to a build stack (Vite + Svelte or React, component library,
animation lib)? Or stay no-build for permanence/simplicity? Affects who builds what and
all execution prompts.

**A4. Backend.** Keep Firebase RTDB `stack-ep5` (free, wired, adapter-swappable)? Rec: yes.
Only revisit if B1 forces a server component anyway.

**A5. Identity & hosting.** Keep repo `SaturdayLim/Trivia` + stack-trivia.vercel.app, listed
under Saturday Solutions on the hub? Visual identity: Solutions night theme (#FFE600 on
#0B0C10, design suites in saturday-services/design/) or a bespoke Stack identity?

## Tier B — Content pipeline (biggest spec delta)

**B1. Where does "exposed" live?** New spec says exposure persists "in the repo" across games.
(a) Firebase persistent store — any device, no tokens, no server (Rec);
(b) GitHub API write-back — true repo state but needs a token/serverless function;
(c) v1 localStorage — per-device only. This is the main fork deciding if v2 needs any backend beyond Firebase.

**B2. Question/icon authoring.** Keep editing Markdown on GitHub (v1, zero app scope), or
in-app admin UI (form/CSV upload + PNG icon upload)? Admin UI = large scope + storage
decision (repo commit vs Firebase Storage). A middle path: keep GitHub authoring, add an
in-app validator/preview.

**B3. Multiple correct answers.** Spec says "tick-to-select the correct answer(s)". Truly
multi-answer MCQs (changes schema, scoring, reveal UI), or always exactly one?

**B4. Icons.** One PNG per category — committed to repo alongside the category file? Fallback
when missing (letter tile)? Any per-category accent colour, or colour = difficulty only?

## Tier C — Mechanics deltas from v1

**C1. Contest mode.** v1 implemented v6 CONTEST (challenger picks contrasting answer, ±full,
selector exempt). Your new spec only mentions Selector-only vs ALL. Keep, drop, or defer contest?

**C2. Turn order.** Enumerate the full option lists for who-selects-first (stage start) and
who-selects-next (per cycle): e.g. registration order / lowest score / highest / next-lowest /
previous-winner? Tie-break = registration order (v1 provisional #20)?

**C3. Scoring authority.** Confirm: app auto-computes deltas (value × multiplier, penalty if on),
host sliders pre-filled with the computed delta for adjustment, UPDATE commits. Or fully
manual sliders from 0?

**C4. Penalty.** New spec: on/off. v1: on/half/off. Which? Penalty magnitude = full question value?

**C5. Mid-game joiners.** New team joins at 0 pts, slotted last — confirmed. Can a player also
join an *existing* team mid-game? Team cap still 2–8?

**C6. Timer.** On expiry with no lock-in: auto-lock at 0/no answer, then normal reveal flow?
Can host pause/extend/kill a running timer?

**C7. Disqualify-on-exit.** Spec DQs a player who leaves the big-letter view before host logs.
Phones lock/switch apps accidentally. Rec: lock-in is final at submit (timestamped, no DQ);
DQ only if never locked. Keep your version or soften?

**C8. Board draw.** Confirm: per selected category, fill up to 12 slots drawing Easy→Med→Hard
from unexposed pool (random within tier); category playable with <12 if depleted.

## Tier D — Ops / non-functional

**D1. Scale.** One room at a time, ~how many teams/devices max? (Spark plan is fine for
1 room / <30 devices.)

**D2. Host resilience.** If the host phone dies mid-game: rejoin as host via room code +
host PIN/token? (Rec: yes — cheap insurance, small scope.)

**D3. Room codes.** Host-chosen words (TENGAH) vs auto-generated? Collision handling and room
expiry (e.g. auto-delete after 24h)?

**D4. Offline/mock mode.** Keep the single-device mock driver for testing? (Rec: yes, it's free.)

**D5. Display details.** QR on display + host confirmed (needs vendored QR lib — v1 deferred).
"Horizontally-flipped phone" = landscape phone, or literally mirrored output?

---
Answers will be logged as numbered decisions in Part 2 (amending v1 docs/DECISIONS.md style).
