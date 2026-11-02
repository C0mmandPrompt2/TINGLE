# NIGHTJACK • Private Room Twenty-One

A real-time multiplayer card game for friends, with no purchases, wagers, real money, or prizes. Players earn purely virtual table points: 3 for a natural blackjack, 2 for an ordinary win, 1 for a push. Players cannot bet or exchange points for anything.

## Features
- 6-character private room codes, 2–6 players
- A shared dealer, server-controlled cards and turns
- Hit, stand, ace scoring, natural blackjack, dealer stands on all 17s
- Automatic round settlement and scoreboards
- Private chat, connection indicator, host controls and host handoff
- Temporary reconnection via browser session token
- Accessible, responsive dark green / gold interface

## Run locally (Windows 11)

Install Node.js 20+ if necessary. In an extracted project folder, use:

```powershell
npm install
npm start
```

Then open `http://localhost:3000` in two browser tabs. To test different players, use one normal tab and one Incognito tab, or a second device. Only start after at least 2 connected players have joined.

Use `npm test` for card-rule unit tests.

## Deploy on Render (Free Web Service)

1. Create a NEW GitHub repository, for example `nightjack-private-rooms`.
2. Upload **all the files inside** this project folder to the repository (not the ZIP file itself).
3. In the Render dashboard, choose **New → Web Service**, connect the repository.
4. Choose **Node**, **Free**, and ideally the **Singapore** region for Australian players.
5. Build command: `npm install`; Start command: `npm start`. (The included `render.yaml` also describes this configuration.)
6. After deployment completes, share your `https://....onrender.com` link. Create a room and send its 6-character code or the in-app room invitation link.

The server listens on `0.0.0.0` and Render's `PORT` variable. Do **not** deploy as a static site: Socket.IO requires a running server.

## Important limitations
- Rooms, scores, and chat are **in memory**, so a service restart/redeploy will clear them. This keeps the hobby project simple and does not require a database.
- Render's Free Web Services can sleep after 15 minutes of inactivity; the first visit after a sleep can take some time to respond.
- Room codes are private-ish invite codes, **not passwords**. Only share them with people you know.
- When the host disconnects, host status transfers to an available connected player.
- Players who briefly disconnect may rejoin via their browser's saved private session token, as long as the server has not restarted and their seat remains available.
- To keep the game purely social and non-wagering, it uses points instead of any betting mechanics.

Source files: `server.js` is the Socket.IO server, `rules.js` has the game rules, `public/` has the interface.
