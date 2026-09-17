# Beam

Send a file or a chunk of text from your laptop to your phone (or back)
without going through WhatsApp, email, or a cloud drive.

Open the page on both devices, one shows a 4-digit code (and a QR code),
you enter that code (or scan it) on the other the two devices then
talk directly to each other over WebRTC. The file never touches the
server; the server only helps the two devices find each other.

```
beam/
  server/     Node.js WebSocket "signaling" server (pairs the two devices)
  client/     Static web app (the actual UI, works on desktop and mobile)
```

## How it works, in short

1. Both devices open the client page and connect to the signaling server.
2. Device A gets a code, e.g. `4821`, and shows it + a QR code.
3. Device B enters `4821` (or scans the QR).
4. The server introduces them and gets out of the way a direct
   peer-to-peer connection (WebRTC) forms between the two browsers.
5. Files and text now transfer straight from device to device.

No accounts, no database, no file storage anywhere.

---

## 1. Run it locally first (5 minutes)

```bash
cd server
npm install
npm start
```

This starts the signaling server at `ws://localhost:8080`.

Now open `client/index.html` directly in your browser (or serve the
`client` folder with any static server e.g. `npx serve client`).
`client/config.js` already points at `ws://localhost:8080` by default,
so it should just work. Open the page in two browser tabs (or two
devices on the same WiFi, using your laptop's local IP instead of
`localhost`) to test a transfer.

---

## 2. Deploy the signaling server (Railway, free, no card required)

You can use any Node host that keeps a process running continuously
(Railway, Render, Fly.io, a VPS) — this project's own server was
deployed on [Railway](https://railway.com), since it doesn't require a
card for a verified GitHub account, unlike Render.

1. Push this project to a GitHub repo (the whole `beam` folder is fine).
2. At [railway.com](https://railway.com), sign in with **"Continue with
   GitHub"** — signing in this way is what lets Railway verify you
   without asking for a card.
3. **New Project** → **Deploy from GitHub repo** → select your repo.
4. Click the new service → **Settings**, and set:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Still in **Settings**, under **Networking**, click **Generate
   Domain**. You'll get a URL like:
   `https://beam-production-xxxx.up.railway.app`
6. Your WebSocket URL is the same thing with `wss://` instead of
   `https://`:
   `wss://beam-production-xxxx.up.railway.app`

Visiting that URL in a normal browser tab will just show the plain
text `beam signaling server is running` — that's expected. Browsers
only render `http(s)` pages; the app itself connects to it over `wss://`,
which isn't something you can "view" directly.

> If your GitHub account is brand new or has little activity, Railway
> may place you on a "limited trial" with restricted network access
> instead of a full trial. If that happens, the $5/month Hobby plan
> (which does need a card) is the fallback — but most established
> GitHub accounts get the full trial with no card at all.

---

## 3. Point the client at your deployed server

Edit `client/config.js`:

```js
const BEAM_CONFIG = {
  signalingUrl: "wss://beam-production-xxxx.up.railway.app",
};
```

> **The one letter that matters most: `wss`, not `ws`.** A client page
> served over `https://` (which every static host uses) is blocked by
> the browser from opening a plain `ws://` connection it throws a
> "Mixed Content" / `SecurityError` in the console and the room code
> never appears. If that happens, this line is the first thing to
> check.
>
> Also remember: if you deploy the client from GitHub (Vercel, or
> Render/Netlify's Git-based flow), editing `config.js` on your
> computer does nothing until you commit and push that change to the
> repo — the host redeploys from GitHub, not your local files.

---

## 4. Deploy the client (Vercel, from the same GitHub repo)

The `client/` folder is plain HTML/CSS/JS, no build step. This
project's client was deployed on [Vercel](https://vercel.com):

1. At vercel.com, sign in with GitHub.
2. **Add New** → **Project** → select your `beam` repo.
3. Set **Root Directory** to `client`.
4. Set **Framework Preset** to **"Other"**, leave **Build Command**
   empty.
5. **Deploy**. You'll get a URL like `https://beam-yourname.vercel.app`.

Every time you push a change to `client/` on GitHub (like updating
`config.js`), Vercel redeploys automatically within a few seconds.

Netlify's drag-and-drop (`app.netlify.com/drop`) or GitHub Pages work
just as well if you'd rather not connect a Git repo, same static
files, same result.

Open your live URL on your laptop and your phone. That's the whole app.

---

## Troubleshooting

**Terminal shows the server hosting a new room instead of joining the
code you typed** (e.g. `left room 5778` immediately followed by
`joined room 6281 role: host`): this was a bug in an earlier version
of `app.js`, now fixed — entering a code closed the old connection but
never told the *new* one to join, so it silently defaulted back to
hosting. If you're on an older copy of the file, replace `client/app.js`
with the current version.

**Room code never appears, console shows a Mixed Content /
SecurityError**: `config.js` is pointing at `ws://` instead of
`wss://`. See the callout in step 3 above.

**Deployed the client but it still points at `localhost`**: the edit
to `config.js` was made locally but never pushed to GitHub, so
Vercel/Render's Git-based deploy is still serving the old version.
Commit and push the change, or edit the file directly on GitHub.

**Visiting the Railway server URL just shows plain text**: that's
correct — it's confirmation the server is running, not an error. The
app talks to it over `wss://`, which a browser tab visit won't show.

## Known limits (v1, on purpose)

- **Same rough network conditions**: works reliably on the same WiFi,
  and on most home/mobile networks thanks to STUN. A small number of
  strict corporate/carrier NATs may block the direct connection
  entirely the fix for that is a TURN relay server, deliberately
  left out of this first version to keep it simple and free to run.
- **One file at a time**: multiple dropped files send sequentially,
  not in parallel. Simple and reliable; easy to parallelize later.
- **No accounts, no history**: refreshing the page ends the session.
  That's the intended trade for "no data stored anywhere."
- **4-digit codes**: room for collisions are low-stakes here (codes
  are freed the moment a device disconnects), but if you want more
  headroom, widen the code in `app.js` (`hostNewRoom`) and the input's
  `maxlength` in `index.html`.

## Natural next steps, if this earns its keep

- A TURN server (e.g. via [Twilio](https://www.twilio.com/stun-turn) or
  [Cloudflare Calls](https://developers.cloudflare.com/calls/)) for the
  networks where direct connection fails.
- A "pro" tier: bigger files, persistent short links, cross-network
  relay fallback the free peer-to-peer path stays free forever.
- PWA manifest so it installs to a phone's home screen like an app.
