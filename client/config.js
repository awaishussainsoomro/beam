// Point this at your deployed signaling server (see the server/ folder).
// - Locally: "ws://localhost:8080"
// - In production: "wss://your-server.onrender.com" (wss, not ws — most
//   hosts require TLS)
//
// You can also override it per-visit with ?server=wss://... in the URL,
// which is handy while testing without editing this file.
const BEAM_CONFIG = {
  signalingUrl: "ws://localhost:8080",
};
