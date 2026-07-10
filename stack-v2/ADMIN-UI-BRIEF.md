# Mini-Project Brief — Stack Question Admin UI

_Standalone brief to hand to an Opus agent. Parent project: Stack v2 (see PRD.md,
DECISIONS-V2.md in this folder). Decision V2-6._

## Goal
A web admin interface where Michael manages the Stack question bank without editing
Markdown on GitHub: create/edit categories and questions, upload category icons,
validate, and publish.

## Constraints (inherited — do not relitigate)
- Source of truth stays the repo `SaturdayLim/Trivia`: one Markdown file per category
  (strict v1 format, repo `docs/PRD.md §3`), icons as PNG in `public/icons/`.
- Exposure state lives in Firebase (`stack-ep5`), NOT in the files — the admin UI may
  view/reset exposure but never writes it to Markdown.
- Single correct answer per question. Difficulties E/M/H. Fields: category, sub-category,
  difficulty, question, options A–D, answer, fun fact.
- Free tooling only. Same stack family as v2 (Vite + React + Tailwind) preferred.

## Core flows
1. **Category list** — all categories with icon, per-tier counts, exposure stats.
2. **Question editor** — form-based create/edit; A–D options with answer picker
   (radio, single answer); duplicate detection (same question text); live validation
   mirroring the v1 validator rules.
3. **Icon upload** — PNG, auto-resize/crop to square, preview against night theme.
4. **Exposure panel** — per category: view exposed questions, reset one/all (writes Firebase).
5. **Publish** — commits changed Markdown/PNGs to the repo.

## Open design decisions (agent should present options, Michael picks)
- **Publish mechanism**: (a) GitHub API commits via a fine-grained PAT entered at runtime
  (never stored in code); (b) GitHub OAuth app; (c) generate a downloadable changeset
  Michael pushes himself. Weigh: no-server preference vs token hygiene (see
  STANDING-ORDERS.md — never persist tokens).
- Hosted where: separate Vercel project vs `/admin` route in the Stack app (gated).
- Draft storage before publish: localStorage vs Firebase.

## Acceptance
- Round-trip fidelity: file edited via UI re-parses identically through the v1 validator.
- Cannot publish an invalid bank (validation blocks).
- Exposure reset reflects in the game's category picker within one refresh.

## Deliverables
Working app + README (setup, publish mechanism, token handling) + short handover note
appended to stack-v2/PROGRESS.md.
