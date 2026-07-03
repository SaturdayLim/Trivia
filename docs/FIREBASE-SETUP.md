# Firebase Realtime Database setup

10 minutes, no coding, free (Spark plan — no credit card required). Do this
once per deployment of Stack (e.g. once for your household/group). At the end
you'll have a `js/sync/firebase-config.js` file that lets every device on the
internet — not just tabs on one computer — join the same game room.

You do **not** need this to playtest Stack. Without it, the app runs on the
built-in same-device mock driver (multiple browser tabs on one computer).
This guide is only for real multi-device play.

---

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and sign in with any Google
   account.
2. Click **Add project** (or **Create a project**).
3. Give it any name (e.g. "stack-trivia"). Click **Continue**.
4. You'll be asked about Google Analytics — flip it **off** (not needed).
   Click **Create project**, wait for the spinner, then **Continue**.

This is the free **Spark plan** by default. Nothing here asks for a credit
card, and nothing you do in this guide requires upgrading.

## 2. Enable the Realtime Database

Do this **before** adding a web app, so the config snippet you copy in step 3
already includes the database URL.

1. In the left sidebar, under **Build**, click **Realtime Database**.
2. Click **Create Database**.
3. Pick a **region** close to you (e.g. `us-central1` or `europe-west1`) —
   this can't be changed later, but it doesn't matter much for a small trivia
   app.
4. When asked about security rules, choose **Start in locked mode**. (Locked
   mode denies all reads/writes until you paste the rules in step 4 — this is
   the safer default. Do not pick "test mode".)
5. Click **Enable**.

## 3. Add a Web App and copy the config

1. Click the **gear icon** next to "Project Overview" (top left) → **Project
   settings**.
2. Scroll to **Your apps**. Click the **`</>`** (Web) icon to register a new
   app.
3. Give it a nickname (e.g. "stack-web"). Leave "Also set up Firebase
   Hosting" **unchecked**. Click **Register app**.
4. You'll see a code block that looks like this — keep this tab open, you'll
   need four values from it in step 5:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "stack-trivia-xxxxx.firebaseapp.com",
     databaseURL: "https://stack-trivia-xxxxx-default-rtdb.us-central1.firebasedatabase.app",
     projectId: "stack-trivia-xxxxx",
     ...
   };
   ```
5. Click **Continue to console** (you can skip the SDK install instructions —
   Stack loads Firebase itself).

## 4. Set the security rules

1. Back in **Realtime Database**, click the **Rules** tab.
2. Delete everything there and paste this instead:
   ```json
   {
     "rules": {
       "rooms": {
         "$code": {
           ".read": true,
           ".write": true
         }
       },
       "presence": {
         "$code": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
3. Click **Publish**.

**Why this is safe enough:** Stack has no login system — the room code
*is* the shared secret, the same trust model as a Jackbox-style party game.
Anyone who has the code can read/write that one room (`rooms/<code>` and
`presence/<code>`); nobody can touch any other room, and everything outside
those two trees stays locked by default (Realtime Database denies access
unless a rule explicitly grants it). There's no personal data at stake beyond
whatever nickname a player types in, and rooms are short-lived. This rule set
trades per-user auth for zero sign-up friction, which is the right trade for
a couch game.

## 5. Paste the config into the app

1. In your Stack project folder, go to `js/sync/`.
2. Copy `firebase-config.example.js` to a new file named `firebase-config.js`
   in that same folder.
3. Open `firebase-config.js` and replace the four placeholder strings with
   the real values from step 3's code block (`apiKey`, `authDomain`,
   `databaseURL`, `projectId`).
4. Save. This file is already listed in `.gitignore`, so it won't
   accidentally get committed/shared.

## 6. Verify it works

`tools/sync-test.html` is a manual test harness. Today it's wired to the
same-device mock driver only; once a driver picker is added there (or you
temporarily edit its import to match the swap-point comment in `js/main.js`:
`import * as driver from './sync/driver-firebase.js';`), verify like this:

1. Open the page on **two different devices** (e.g. your laptop and your
   phone, over Wi-Fi — this is the real test Firebase is for, unlike the
   mock driver which only works across tabs on one machine).
2. Device 1: enter a room code, role **gm**, click **Create room**.
3. Device 2: same room code, role **player**, click **Join room**. Both
   trees should match.
4. Click **Set random value** on either device — it should appear on both
   within a second or two.
5. Close device 2's tab entirely. Within about 15 seconds, device 1's roster
   should show it as disconnected (this is the presence heartbeat timing
   out, not an instant close signal).
6. In the Firebase console, open **Realtime Database → Data** — you should
   see your room live under `rooms/<code>` and a heartbeat under
   `presence/<code>`.

## Cleanup: rooms are ephemeral

Every game you create leaves a `rooms/<code>` (and briefly `presence/<code>`)
node behind — Firebase never deletes them on its own. For casual/personal use
on the Spark plan this is harmless (the free tier's 1GB storage holds many
thousands of finished games), but if you want to tidy up:

- **Manual delete**: Firebase console → **Realtime Database → Data**, hover
  the `rooms` (or `presence`) node, click the **⋮** menu → **Remove**, or
  select an individual `<code>` child to delete just that one game.
- **Automatic TTL**: Realtime Database has no built-in per-key expiry (unlike
  e.g. Redis). If you outgrow manual cleanup, the standard pattern is a
  scheduled Cloud Function (needs the pay-as-you-go **Blaze** plan, which
  still has an always-free monthly quota) that runs daily, reads each room's
  `meta.createdAt`, and deletes any room older than, say, 24 hours. That's a
  future enhancement, not required to use Stack today.
