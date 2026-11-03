# NIGHT JACK 3.0 — Pixel-Art Multiplayer Card Game Hub

An actual update to the existing NIGHTJACK project, built for the same Render Node.js service and the existing Supabase PostgreSQL database. **All chips are free, fictional game-score points. No real-money deposits, purchases, transfer, redemption, prizes or cash-out.**

## What is included

- **Visual rebuild:** main menu using the supplied NIGHT JACK artwork with functioning Play, Shop, Quests and Settings hotspots; original pixel-art face-card sprites and Joker; hover tilt, card dealing, CRT, particle and sound options; responsive supporting screens.
- **Accounts:** same existing `nightjack_users` records; username-or-email login, new email field for registrations, password hashing, saved sessions and one-time *displayed* account recovery code. New users still start with **2,000** chips. Existing accounts can log in with their username and original password.
- **Two game modes:** two human players versus an automated Blackjack dealer (Hit, Stand, Double), or Texas Hold'em 2–6 players with Check, Call, Raise, Fold and All-in. Server controls the deck and turns, community cards are revealed one at a time, and poker calculates winning hands, ties and side pots.
- **Room codes and social play:** public room browser, private six-character rooms, join by shared code/link, host start button, chat and brief disconnect recovery.
- **Score and quests:** free virtual-chip scores can rise and fall; persistent leaderboard, eight claim-once quests, +500 daily bonus once per 24 hours. Server authorizes balance changes and prevents duplicate reward claims.
- **Shop:** fully styled **THE NIGHT MARKET — COMING SOON**, with no purchasable skins/items. Empty SQL tables lay the groundwork for local-only cosmetic designs later. No shop purchases are implemented.
- **Settings:** functional audio sliders / sound toggle, graphics toggles, card animation, reduced effects, gameplay hints and confirmation before folding, stored locally.

## How to update your *existing* website

**DO NOT deploy a new Render service or create a new Supabase project.**

1. Keep your current live Render service at `https://nightjack.onrender.com` unchanged while preparing the update.
2. In GitHub `C0mmandPrompt2/TINGLE`, create a new branch, e.g. `nightjack-v3-pixel`, from `main`.
3. Open the folder `nightjack-render-ready` **inside that branch**.
4. Upload/replace the contents of this ZIP's `nightjack-render-ready` folder in the existing folder. Do NOT nest an extra `nightjack-render-ready` folder. Verify that `server.js`, `account-store.js`, `rules.js`, `package.json`, `public/` and `tests/` are at the same level.
5. Commit to that **new branch only**. Create a Pull Request into `main`, review it, then merge when you are ready. Since Render auto-deploys `main`, merging publishes the update.
6. Keep Render's existing configuration: Root directory `nightjack-render-ready`, build `npm install`, start `npm start`, Node runtime. Keep the existing secret `DATABASE_URL` variable untouched.
7. After deploy, read Render logs. Successful startup should log `NIGHT JACK v3 listening ...; database: true`. Check `/health` returns `{ "ok": true, "version": "3.0", "persistentAccounts": true }`. Do NOT share database credentials or Render secret values.
8. Hard-refresh the website with `Ctrl + Shift + R`. Create two **test accounts**, use two separate browsers to join a room, check chat, private cards, blackjack and Hold'em, then verify the scores/quests.

### Database upgrades

On startup, the server **reuses** the old Supabase `nightjack_users` table and applies *additive* SQL migrations: `email`, `recovery_hash`, streak and mode-win stats, bonus timestamp; saved session table, claim table, round-settlement ID table and two empty cosmetic tables. **No existing user balances are intentionally reset.**

The SQL migration hasn't been run against the user's actual Supabase instance in this sandbox, so **back up any important account data and verify the deploy logs**. With no `DATABASE_URL`, a local demo memory-mode still starts, but data will not persist across restarts. The Render URL already has a configured `DATABASE_URL`; no extra secret needs to be added to the repository.

**Privacy:** Real recovery codes are shown once upon signup. Save them in a password manager. The app does *not* email recovery links, since no email-sending provider has been configured. Existing V2 accounts have no recovery code; they retain username/password login. New accounts have a real recovery-code reset flow. Do not use real passwords in test accounts.

### Realistic limitations

- The project passed automated rule, account, interface-routing and simulated-Socket.IO tests. **Live multiplayer testing on Render, live Supabase schema migration, and a full browser/visual regression test are still pending.**
- On the free Render plan, inactive web services spin down and in-memory rooms are cleared; PostgreSQL-backed accounts/score data remains saved. Database sessions persist, but room sessions don't survive server restarts.
- Free virtual score chips are committed to each hand for gameplay and can be earned/lost, but have no monetary value. No buying, trading, loot boxes or prizes.
- Current Blackjack uses a two-human-plus-dealer table, without pair splitting or insurance.
- Public room lists are live in server memory; they are not stored across Render restarts.
- Optional room passwords and email delivery are not yet implemented. A six-character private join code is the available privacy mechanism.
- Cosmetic tables are intentionally empty; there is no skin purchase or equipment UI until assets are added.
- Intended for a small friends-only social game. Additional abuse controls, database review and user testing are recommended before opening to a large public audience.

## Local development (Windows 11)

Install Node.js 20+ and open Command Prompt in the folder containing `package.json`:

```bash
npm install
npm run check
npm test
npm start
```

Then open `http://localhost:3000`. With no `DATABASE_URL`, accounts reset when the server stops. To test online, only supply the secret connection string in server environment variables, never in files checked into GitHub.

## Tech stack and file map

- `public/index.html` — page shell and browser assets
- `public/app.js` — functional frontend views, Socket.IO client, settings, game UI
- `public/styles.css` — full retro pixel-art look and responsive design
- `public/assets/` — reference-based main menu art and new original pixel sprites
- `server.js` — Express, Socket.IO, room manager, Blackjack and Hold'em progression
- `rules.js` — blackjack points and poker hand evaluations
- `account-store.js` — Supabase/PostgreSQL migration, session/account/quest/score persistence
- `tests/v3*.test.js` — automated tests

### Safety and security

Server-side operations own all sensitive card/state/score data. Hidden opponent cards and hidden dealer card are omitted from each client's room snapshot. Passwords are salted and hashed. No secret keys belong in the frontend or in GitHub. Public chat is basic, escaped and rate-limited; avoid sharing personal information with other players.
