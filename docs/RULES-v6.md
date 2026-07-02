# RULES-v6 — mined from the Excel/PowerPoint implementation

Sources: Trivia Template.pptm (extracted slide XML), Host Manual pptx (Archive snapshot
2305300258, slides 28-32), Resources\v6 ColorConfig\*.bas, Database.xlsm extracted
sheet XML (Leaderboard = sheet6, Questions = sheet4). Mined 2026-07-03.

## A. Stages / modes (Host Manual slide 29 + Phases.bas mapping)
VBA phase values (Questions!H1): Comm=1, Solo=2, Crown=3, Target=4.
Display names: 01 COMMUNITY, 02 EXCLUSIVE, 03 CONTEST, 04 SUDDEN DEATH.

| Stage | Selection (who picks) | Players (who answers) | Multiplier | Penalty | Rotations default |
|---|---|---|---|---|---|
| 01 COMMUNITY | Youngest | All | 1 | N | 4 (manual) / 3 (current template) |
| 02 EXCLUSIVE | Winning Team | Selector | 1 | Y | 4 / 3 |
| 03 CONTEST | Losing Team | Selector, Contestor | 1 | Contestor | 4 / 1 |
| 04 SUDDEN DEATH | Losing Team | All | 2 | Y | 4 / 1 |

- "Contestor" = any non-selecting team that counter-answers; the penalty column
  "Contestor" means only the contestor is at risk in CONTEST (selector exempt).
- "Youngest" / "Winning Team" / "Losing Team" are applied socially by the host in v6
  (see §B — no formula computes the selecting team).

## B. Turn scheduling (Leaderboard sheet)
- B9 = SEQUENCE(100): turn serial numbers (RSN rows 9-108 area; H1 = COUNTA(F:F)+7
  points at the current row — a turn is "played" when its question number lands in F).
- Stage of turn n (C10 formula): thresholds at cumulative rotations × team count:
  `IF(B10<=S10*S7, R10, IF(B10<=SUM(S10:S11)*S7, R11, …))` with R10:R13 = 1,2,3,4
  (stage ids), S10:S13 = rotations per stage (currently 3,3,1,1), S7 = team count (4).
  So: stage length = rotations × teams turns; a rotation = one turn per team.
- D10 = IF(C10=C9, D9+1, 1): turn counter within stage; UI label "stage-D" (e.g. 1-4).
- E column (selecting team per turn): NO formula, hand-maintained → v6 does not
  automate winner/loser-first; the webapp scheduler automates it (PRD §4.2).

## C. Scoring (Leaderboard + Scoring.bas + QnLoad.bas)
- Effective points H9 = IF(diff="Easy",1, IF(diff="Med",2, 3)) × IF(stage=4, 2, 1).
- v6.1 made both factors configurable: difficulty base from Leaderboard!R2:R4
  (fallback 1/2/3), per-stage multiplier from T10:T13 (fallback 1; stage-4 ×2 remains
  the shipped default). EffScore = base × stageMult (QnLoad.QnDict).
- After reveal the host sets each team's outcome via +/nil/− buttons (Scoring.bas
  TeamAction): upload ∈ {+1, 0, −1}; LogAndReturn writes upload × EffScore per team
  into the turn row (I:L). Manual buttons = how EXCLUSIVE penalties, CONTEST
  contestors, and SUDDEN DEATH all-team scoring are enacted today.
- Team totals L2:L5 = running total at latest turn + bonus column O2:O5.
- Score bars: positive = Σ(positive deltas)/10 cm, negative = Σ(negative)/20 cm.

## D. Questions data model (Questions sheet)
- Bank table (Table2) rows 14+: B=Category, D=Question text, E=Difficulty
  (Easy/Med/Hard), F:I=Options A-D, J=Answer (formula referencing one of F:I —
  the correct answer is stored as the option TEXT, letter derived at load),
  K=FunFact, L=Answered flag (0/1).
- 10 active categories in A2:A11, icon filenames F2:F11 (PNG in Icons\, no ext).
- Remaining per difficulty per category: Q/R/S2:11 = loaded − answered; P = total
  remaining → category tiles HIDE when P=0 (Scoring.LogAndReturn).
- Helper L3 = 12 − remaining(selected cat): the standard game loads 12 per category
  (4/4/4); the select wheel has 20 arc slots (template capacity, ArcUnused fills).
- Question draw: player picks difficulty; the "Current Selection" flag column marks
  the drawn question; H5 = INDEX(Table2[Question SN], MATCH(1,[Current Selection],0)).
- Fun fact + correct letter go into the question slide's SPEAKER NOTES →
  host-only view (UpdateDeets: "Correct answer: X, <funfact>").

## E. Question flow on screen (Qn.bas + instruction slides)
- Selecting team's confirmed answer is PUBLIC before reveal ("Confirmed answers will
  be highlighted yellow" — instruction slide; SelectOption glows the picked option).
- REVEAL: correct option green; a wrong selection turns red; host reads fun fact.
- Home button activates after reveal → LogAndReturn → Categories Home.
- Difficulty descriptions (slide 31): Easy "known by anyone", Med "well-versed",
  Hard "you're better off guessing unless an absolute expert".

## F. Not present in v6 (webapp additions, from spec interview)
- Automated turn order (winnerFirst/loserFirst/registration, persist vs per-rotation).
- Automated contest/penalty scoring (v6 = manual host buttons).
- Tap-in selector race, per-player devices, rooms — new in webapp.
- Used-question memory across nights (v6 tracks only within the loaded game via L flag).
