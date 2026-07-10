# Stack v2 (Trivia Webapp) — PRD Workstream Progress

_Resumable ledger. Update after every working part. Started 2026-07-10._
_Moved 2026-07-10 from `Landing Page/Saturday Services/stack-v2` to `Stack v6 260611/stack-v2`
(sibling of `Stack Webapp` = local v1). Executor sessions log to `BUILD-LOG.md`; this file
stays the planning/review ledger._

## Objective
Strategize a PRD for the v2 rebuild/overhaul of the Stack trivia-hosting webapp
(host/player/display, room-code join, category>difficulty>MCQ loop, 4-stage games).
Michael is unsatisfied with v1's **design and function**. Fable/Opus = planning +
review; Sonnet/Opus = execution (per STANDING-ORDERS.md).

## Status: PARTS 1-3 COMPLETE (2026-07-10) — all answers received, 24 decisions locked, full PRD + setup doc + admin brief written. AWAITING MICHAEL'S PRD REVIEW, then Phase 0 (his machine setup) can start.

## Part log
| Part | Scope | Status |
|---|---|---|
| 1 | Survey infra + draft/send architecture-first clarifying questions | DONE 2026-07-10 |
| 2 | Ingest answers > lock decisions (DECISIONS-V2.md, V2-1..V2-24) | DONE 2026-07-10 |
| 3 | Full PRD (PRD.md) + SETUP.md (Sonnet agent, Fable-reviewed/fixed) + ADMIN-UI-BRIEF.md | DONE 2026-07-10 |
| 4 | Michael reviews PRD > amendments > kick off Phase 0/1 per PRD section 9 | PENDING |

## Part 2-3 summary (2026-07-10)
- Michael answered all 22 questions (see chat / QUESTIONS.md). Headlines: renovate v1
  engine; Vite+React+Tailwind build stack; Firebase stays; exposure > Firebase; single
  answer only; contest excluded; DQ softened; auto room codes + host rejoin PIN;
  1 room / max 30 players / 30 teams / 30 displays; Stack joins Saturday Solutions
  (new logo needed).
- v1's 10 UX defects (A1) recorded as must-fix acceptance criteria (PRD section 8).
- Deliverables in this folder: DECISIONS-V2.md - PRD.md - SETUP.md - ADMIN-UI-BRIEF.md.
- SETUP.md was Sonnet-authored; Fable review fixed Tailwind v4 install flow + handoff
  paths (planning docs must be copied into the repo's stack-v2/ before agent handoff).
- Build phases + agent assignments: PRD section 9 (Phase 1 Sonnet scaffold/port > Phases 2-4
  Opus > Phase 5 Sonnet design pass > Phase 6 cutover). Stack logo = separate
  Fable-supervised task (agents historically weak on marks).

## Infra findings (Part 1)
- **v1 repo: github.com/SaturdayLim/Trivia** (public, branch `master`), live at
  **stack-trivia.vercel.app** (Vercel `saturdaysvc/stack-trivia`, auto-deploy) + GitHub Pages.
  NOT the "Stack v6 260611" local folder (that's the pre-web Excel/PPT era source; unmounted).
- **v1 state (its PROGRESS.md): BUILD COMPLETE 2026-07-03/04.** No-build vanilla JS ES modules;
  engine (scheduler/scoring/actions/questions/board/storage) passed full regression suite
  incl. 4 round modes, tap-in atomicity, penalty matrix, refresh-resume.
- **Sync:** Firebase RTDB project `stack-ep5` (asia-southeast1), Spark plan, swappable
  adapter (`js/sync/adapter.js`) + offline mock driver. Client config committed (RTDB rules =
  security boundary).
- **Question bank:** one Markdown file per category in `questions/` (strict format, PRD s3),
  ~60 categories (30 active + 30 archive-*) imported from the old Excel bank; importer +
  validator tools exist. Used-question memory = GM-device localStorage + `used-legacy.json`.
- **v1 docs:** docs/PRD.md, docs/DECISIONS.md (33 numbered decisions), docs/RULES-v6.md,
  PROGRESS.md ledger — v2 amends, not restarts, this record.
- **Design system available:** hub repo `saturday-services/design/` — `saturday-core/` +
  `solutions/` suites (night theme, canvas #0B0C10, solutions accent #FFE600); hub lists
  games under Saturday Solutions via `links.json` (TapTap precedent).
- **Deploy flow:** push to GitHub main > Vercel auto-deploy; gh CLI auth on Michael's machine.

## Next steps (for resume)
1. Michael reviews PRD.md; log amendments as V2-25+ in DECISIONS-V2.md.
2. Michael runs SETUP.md section 1-2 (Node install, v2 branch), Vercel config section 4.
3. Kick off Phase 1 (Sonnet): scaffold + engine/adapter port, Vitest green, on `v2` branch.
4. Stack logo design task (Fable-supervised) + hub links.json entry can run in parallel.
5. Admin UI mini-project: Michael engages an Opus agent with ADMIN-UI-BRIEF.md when ready.

## Pitfalls (carried + new this session)
- **Edit tool CAN truncate files on this mount at the old byte-length** (hit on this very
  file 2026-07-10, silently). After ANY Write/Edit here: `wc -c` + `tail` via bash; if
  truncated, rewrite whole file via bash python3 open().write().
- web_fetch caches/times out on deploys — verify via Michael hard-refresh.
- Push via /tmp working copy if git can't init on the mount; gh CLI is the credential helper.
