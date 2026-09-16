import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

const PORT = process.env.PORT || 8080;

// rooms: Map<roomCode, Set<ws>>  (max 2 peers per room)
const rooms = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// Plain HTTP server: lets platforms like Render/Railway health-check the
// service, and gives the WS server something to attach to.
const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("beam signaling server is running\n");
});

const wss = new WebSocketServer({ server: httpServer });

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function otherPeers(roomCode, self) {
  const peers = rooms.get(roomCode);
  if (!peers) return [];
  return [...peers].filter((p) => p !== self);
}

function leaveRoom(ws) {
  if (!ws.roomCode) return;
  const peers = rooms.get(ws.roomCode);
  if (!peers) return;
  peers.delete(ws);
  otherPeers(ws.roomCode, ws).forEach((p) => send(p, { type: "peer-left" }));
  if (peers.size === 0) rooms.delete(ws.roomCode);
  log("left room", ws.roomCode, "remaining:", peers.size);
  ws.roomCode = null;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed input
    }

    switch (msg.type) {
      case "join": {
        const roomCode = String(msg.room || "").trim();
        if (!roomCode) {
          send(ws, { type: "error", message: "Room code required." });
          return;
        }

        let peers = rooms.get(roomCode);
        if (!peers) {
          peers = new Set();
          rooms.set(roomCode, peers);
        }

        if (peers.size >= 2) {
          send(ws, { type: "room-full" });
          return;
        }

        const isFirst = peers.size === 0;
        peers.add(ws);
        ws.roomCode = roomCode;

        send(ws, { type: "joined", role: isFirst ? "host" : "guest" });

        // Tell the existing peer someone new arrived, so it can start
        // the WebRTC offer/answer exchange.
        if (!isFirst) {
          otherPeers(roomCode, ws).forEach((p) => send(p, { type: "peer-joined" }));
        }

        log("joined room", roomCode, "role:", isFirst ? "host" : "guest");
        break;
      }

      // WebRTC handshake messages (offer / answer / ice-candidate) are
      // opaque to this server - just relay them to the other peer.
      case "signal": {
        if (!ws.roomCode) return;
        otherPeers(ws.roomCode, ws).forEach((p) =>
          send(p, { type: "signal", data: msg.data })
        );
        break;
      }

      case "leave": {
        leaveRoom(ws);
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => leaveRoom(ws));
  ws.on("error", () => leaveRoom(ws));
});

// Drop dead connections so rooms don't fill up with ghosts.
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  log(`Beam signaling server listening on port ${PORT}`);
});
