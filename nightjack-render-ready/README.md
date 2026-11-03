# NIGHTJACK Game Hub — Version 2.0

A browser-based social card-game hub. No real or virtual wagering: **chips are non-transferable score points**, earned by winning free rounds. No purchases, trade, cash-out, or prizes.

## Game modes

- **Player vs player Twenty-One** — no dealer. Start with two cards, choose Hit or Stand in turn. Closest to 21 without busting wins (+100 score chips). Ties share the win. Opponents' cards and totals are hidden until results.
- **Texas Hold'em hand showdown** — two private hole cards per player; the host reveals flop, turn and river. Best five-card hand from seven cards wins (+150 score chips). Players can fold, but there is **no betting, checking, raising, blinds or pots**. Equal poker hands share a win.
- **Accounts** — username and password only, start at 2,000 score chips, wins and games tracked. Passwords are salted and hashed with Node scrypt.
- **Leaderboard** — highest total score chips across accounts, rather than within a single room.
- **Private rooms** — random six-character codes, 2–6 players, host controls, table chat, live updates, reconnection while server is active.
- **Animated UI** — custom fan/hover-tilt cards, an editorial forest-green/cream/orange game-hub aesthetic, mobile-responsive pages and sound toggle.

## Deploy to the *existing* Render web service

Replace all the files inside `TINGLE/nightjack-render-ready` in your GitHub repository with the contents of this ZIP. **Do not upload a new parent folder inside `nightjack-render-ready`.** Keep your existing Render settings:

- Root directory: `nightjack-render-ready`
- Language: Node
- Build: `npm install`
- Start: `npm start`
- Instance type: Free

If auto-deploy is enabled, updating the `main` branch automatically updates the live website. Consider updating a separate branch first if you want to test before changing the live game. Your existing room sessions will reset when Render deploys a new version.

## IMPORTANT: Persistent accounts require an external Postgres database

The application starts **without** a database and still works for testing, but accounts, passwords and leaderboard scores live **only in server memory**. On a Render Free instance, they will disappear when the server spins down, restarts or redeploys. This is *not suitable for accounts that you want to keep*. The UI clearly labels this as demo score mode.

For lasting scores, create a Postgres database from a trusted provider (e.g. Supabase Free, subject to its activity limits) and set its secret connection URL as the Render environment variable `DATABASE_URL` (never commit the URL to GitHub or send it in chat). Then redeploy. The app automatically creates the `nightjack_users` table. The database should use TLS as specified by the provider. 

The optional `DATABASE_URL` variable is the only database configuration key used. If the database is unavailable at launch, the app fails to start rather than silently losing score data. Existing *demo-mode* scores won't be migrated into Postgres when it is connected.

For free Render Postgres, note it currently expires after 30 days. Render's Free Web Service filesystem is ephemeral and cannot store persistent SQLite data. Check plan and usage limits before connecting external services.

## Local development

```bash
npm install
npm test
npm start
```

Visit `http://localhost:3000` in two browser profiles to test multiplayer. `npm run check` validates syntax. `/health` reports whether a persistent database is connected.

## Current limitations

- Free Render servers spin down during inactivity, temporarily interrupting games and removing any in-memory rooms.
- Account login sessions are stored in server memory and will require re-login after a restart, even when a database is connected.
- One active browser session per user account at a time.
- Hold'em is **hand showdown**, not traditional wagering poker. The room host controls street reveals.
- No email or password recovery. Keep your password safe; accounts are username-only.
- Designed for small private games, not high-traffic public hosting. Add stronger abuse controls and monitoring before opening it broadly.

## Original project

Based on the original NIGHTJACK 1.0 room-code version. New files: `account-store.js`, `state.js`, and expanded rules, server and frontend.
