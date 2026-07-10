# Trivia v2 Setup Checklist

Migration from no-build vanilla JS to Vite + React + Tailwind, backend stays Firebase RTDB.

Legend: **[YOU]** = do this yourself on your machine. **[AGENT]** = hand this to the coding agent, it works in the repo.

---

## 1. One-Time Machine Setup **[YOU]**

1. Install Node.js LTS.
   - Easiest: download the Windows installer from https://nodejs.org (LTS version) and run it.
   - Alternative (lets you switch Node versions later): install nvm-windows from https://github.com/coreybutler/nvm-windows, then:
     ```
     nvm install lts
     nvm use lts
     ```
2. Verify install in a new PowerShell window:
   ```
   node -v
   npm -v
   ```
   You want Node 18 or newer.
3. Git: you likely already have it since `gh` CLI is authenticated as SaturdayLim. Confirm:
   ```
   git --version
   ```
   If missing, install from https://git-scm.com/download/win.

---

## 2. Repo Prep **[YOU]**

1. Clone the repo locally (skip if you already have a local copy):
   ```
   gh repo clone SaturdayLim/Trivia
   cd Trivia
   ```
2. Create the `v2` branch off `master`. Master stays untouched as the live v1 fallback:
   ```
   git checkout master
   git pull
   git checkout -b v2
   git push -u origin v2
   ```
3. From here on, all v2 work happens on the `v2` branch. Don't merge to `master` until v2 is verified working in production.

---

## 3. Scaffold Overview **[AGENT]**

The agent will run this inside the repo, on the `v2` branch, under a `stack-v2/` subfolder:

```
npm create vite@latest stack-v2 -- --template react
cd stack-v2
npm install tailwindcss @tailwindcss/vite
```
(Tailwind v4 uses the Vite plugin — no `tailwind.config`/`postcss` init needed. If the
agent installs Tailwind v3 instead, the old `npx tailwindcss init -p` flow also works.)

Target folder layout inside `stack-v2/`:

```
stack-v2/
  src/
    engine/       <- ported from js/engine/*, logic largely unchanged
    ui/           <- React components
    sync/         <- Firebase RTDB read/write layer
    firebase-config.js
  public/
    questions/    <- moved from questions/ (Markdown question bank)
    icons/        <- category icon PNGs
  PRD.md
  SETUP.md        <- this file
```

Notes:
- `firebase-config.js` stays committed (public client config; RTDB security rules are the real boundary) — same as v1.
- Anything in `public/` is served as-is and fetchable at runtime, which is why `questions/` and the icon PNGs move there instead of `src/`.
- The engine port should be close to a copy-paste from `js/engine/*`; avoid a rewrite.

---

## 4. Vercel Changes **[YOU]** (dashboard clicks) + **[AGENT]** (repo config)

**[YOU]** in the Vercel dashboard, project `saturdaysvc/stack-trivia`:
1. Go to Project Settings > General > Build & Development Settings.
2. Once `stack-v2/` exists on the `v2` branch, you'll add a **second Vercel project** (or reconfigure this one) pointing at:
   - Framework Preset: **Vite**
   - Root Directory: `stack-v2`
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. Keep the production alias `stack-trivia.vercel.app` pointed at `master` (current static site) until v2 is verified. Vercel will auto-create **preview deploys** for the `v2` branch on every push — use those preview URLs to test.
4. Only repoint prod to `v2`/`stack-v2` once you're confident it's ready — that's a manual alias switch in the dashboard.

**[AGENT]** will add a `vercel.json` inside `stack-v2/` if needed to pin root directory/build settings in code rather than relying solely on dashboard config.

**GitHub Pages note:** Pages currently just serves static files as-is — it will NOT run a Vite build. Two options, decide later:
- Drop GitHub Pages entirely once Vercel v2 is live (simplest), or
- Add a GitHub Action later that runs `npm run build` and publishes `stack-v2/dist` to the `gh-pages` branch (optional, not needed for launch).

---

## 5. Local Dev Loop **[YOU]**

Once the agent has scaffolded `stack-v2/`:

1. Install dependencies:
   ```
   cd stack-v2
   npm install
   ```
2. Run the dev server:
   ```
   npm run dev
   ```
   Opens at `http://localhost:5173` with hot reload.
3. Run the engine test suite (Vitest):
   ```
   npm test
   ```
4. Build for production locally (sanity check before pushing):
   ```
   npm run build
   npm run preview
   ```

---

## 6. Handing Off to the Coding Agent

First copy the planning docs from your planning folder
(`…\Claude\Stack v6 260611\stack-v2\`) into the repo's `stack-v2/`
folder so they ship with the branch, then point the agent at:
```
stack-v2/PRD.md
stack-v2/DECISIONS-V2.md
stack-v2/SETUP.md
```
