# Beam

Send a file or a chunk of text from your laptop to your phone (or back)
without going through WhatsApp, email, or a cloud drive.

Open the page on both devices, one shows a 4-digit code (and a QR code),
you enter that code (or scan it) on the other — the two devices then
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
4. The server introduces them and gets out of the way — a direct
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
`client` folder with any static server — e.g. `npx serve client`).
`client/config.js` already points at `ws://localhost:8080` by default,
so it should just work. Open the page in two browser tabs (or two
devices on the same WiFi, using your laptop's local IP instead of
`localhost`) to test a transfer.

---

## 2. Deploy the signaling server (Render, free tier)

You can use any Node host (Railway, Fly.io, a VPS) — these steps are
for [Render](https://render.com) since it has a straightforward free tier.

1. Push this project to a GitHub repo (or just the `server/` folder).
2. In Render: **New +** → **Web Service** → connect your repo.
3. Set:
   - **Root directory**: `server`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. Deploy. Render will give you a URL like:
   `https://beam-signaling.onrender.com`
5. Your WebSocket URL is the same thing with `wss://` instead of
   `https://`:
   `wss://beam-signaling.onrender.com`

> Free-tier services on Render spin down when idle and take a few
> seconds to wake up on the next connection — expect a short delay on
> the first pairing after inactivity. Fine for personal use.

---

## 3. Point the client at your deployed server

Edit `client/config.js`:

```js
const BEAM_CONFIG = {
  signalingUrl: "wss://beam-signaling.onrender.com",
};
```

---

## 4. Deploy the client (any static host)

The `client/` folder is plain HTML/CSS/JS — drag-and-drop it onto any
static host.

**Netlify (easiest):**
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the `client` folder in
3. You'll get a URL like `https://beam-yourname.netlify.app`

**Vercel / GitHub Pages** work the same way — no build step needed,
it's just static files.

Open that URL on your laptop and your phone. That's the whole app.

---

## Known limits (v1, on purpose)

- **Same rough network conditions**: works reliably on the same WiFi,
  and on most home/mobile networks thanks to STUN. A small number of
  strict corporate/carrier NATs may block the direct connection
  entirely — the fix for that is a TURN relay server, deliberately
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
  relay fallback — the free peer-to-peer path stays free forever.
- PWA manifest so it installs to a phone's home screen like an app.
