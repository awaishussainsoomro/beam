(() => {
  "use strict";

  // ---------- Config ----------
  const params = new URLSearchParams(location.search);
  const SIGNALING_URL = params.get("server") || BEAM_CONFIG.signalingUrl;
  const INCOMING_ROOM = (params.get("room") || "").replace(/\D/g, "").slice(0, 4);
  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
  const CHUNK_SIZE = 16 * 1024; // 16KB - safe across browsers
  const BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024;

  // ---------- DOM ----------
  const el = {
    screenPair: document.getElementById("screen-pair"),
    screenConnected: document.getElementById("screen-connected"),
    roomCode: document.getElementById("room-code"),
    qrBox: document.getElementById("qr-box"),
    joinForm: document.getElementById("join-form"),
    joinInput: document.getElementById("join-input"),
    joinStatus: document.getElementById("join-status"),
    peerStatus: document.getElementById("peer-status"),
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    textForm: document.getElementById("text-form"),
    textInput: document.getElementById("text-input"),
    log: document.getElementById("transfer-log"),
    footNote: document.getElementById("foot-note"),
  };

  // ---------- State ----------
  let ws = null;
  let pc = null;
  let channel = null;
  let myRole = null; // "host" | "guest"
  let roomCode = null;
  let sendQueue = [];
  let isSending = false;
  let pendingGuestCode = null; // set right before we (re)open a connection to join a typed code
  const incoming = new Map(); // transferId -> { meta, chunks, received }

  // ================= Signaling =================

  function connectSignaling() {
    ws = new WebSocket(SIGNALING_URL);

    ws.addEventListener("open", () => {
      const code = pendingGuestCode || INCOMING_ROOM;
      pendingGuestCode = null;
      if (code) {
        joinAsGuest(code);
      } else {
        hostNewRoom();
      }
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleSignalingMessage(msg);
    });

    ws.addEventListener("close", () => {
      if (channel) setPeerStatus("Connection lost. Refresh to reconnect.", true);
    });

    ws.addEventListener("error", () => {
      setJoinStatus("Can't reach the signaling server. Check the server is running and BEAM_CONFIG.signalingUrl is correct.");
    });
  }

  function hostNewRoom() {
    roomCode = String(Math.floor(1000 + Math.random() * 9000));
    myRole = "host";
    wsSend({ type: "join", room: roomCode });
  }

  function joinAsGuest(code) {
    roomCode = code;
    myRole = "guest";
    setJoinStatus("Connecting…");
    wsSend({ type: "join", room: roomCode });
  }

  function wsSend(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function handleSignalingMessage(msg) {
    switch (msg.type) {
      case "joined":
        myRole = msg.role;
        if (myRole === "host") {
          showHostCode(roomCode);
        }
        ensurePeerConnection();
        break;

      case "peer-joined":
        // We're the host and someone just joined our room - start the offer.
        if (myRole === "host") startOffer();
        break;

      case "peer-left":
        setPeerStatus("The other device disconnected.", true);
        break;

      case "room-full":
        setJoinStatus("That code is already paired with another device.");
        break;

      case "signal":
        handleRTCSignal(msg.data);
        break;

      case "error":
        setJoinStatus(msg.message || "Something went wrong.");
        break;
    }
  }

  // ================= WebRTC =================

  function ensurePeerConnection() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        wsSend({ type: "signal", data: { candidate: event.candidate } });
      }
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setPeerStatus("Connection dropped.", true);
      }
    });

    pc.addEventListener("datachannel", (event) => {
      attachChannel(event.channel);
    });

    return pc;
  }

  async function startOffer() {
    ensurePeerConnection();
    const dc = pc.createDataChannel("beam");
    attachChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: "signal", data: { sdp: pc.localDescription } });
  }

  async function handleRTCSignal(data) {
    ensurePeerConnection();

    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsSend({ type: "signal", data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {
        // Benign if it arrives before the remote description is set.
      }
    }
  }

  function attachChannel(dc) {
    channel = dc;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;

    channel.addEventListener("open", () => {
      showConnectedScreen();
    });

    channel.addEventListener("close", () => {
      setPeerStatus("The other device disconnected.", true);
    });

    channel.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        handleControlMessage(JSON.parse(event.data));
      } else {
        handleChunk(event.data);
      }
    });
  }

  // ================= UI: pairing screen =================

  function showHostCode(code) {
    el.roomCode.textContent = code;
    el.qrBox.innerHTML = "";
    const url = `${location.origin}${location.pathname}?room=${code}`;
    // eslint-disable-next-line no-undef
    new QRCode(el.qrBox, {
      text: url,
      width: 128,
      height: 128,
      colorDark: "#14161f",
      colorLight: "#fdfbf6",
    });
  }

  function setJoinStatus(text) {
    el.joinStatus.textContent = text;
  }

  el.joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = el.joinInput.value.replace(/\D/g, "").slice(0, 4);
    if (code.length !== 4) {
      setJoinStatus("Enter the 4-digit code shown on the other device.");
      return;
    }
    setJoinStatus("Connecting…");
    incoming.clear();
    pendingGuestCode = code;
    if (ws) ws.close();
    connectSignaling();
  });

  // ================= UI: connected screen =================

  function showConnectedScreen() {
    el.screenPair.classList.add("screen--hidden");
    el.screenConnected.classList.remove("screen--hidden");
    setPeerStatus("Connected");
    el.footNote.textContent = "Files transfer directly between your devices over a peer-to-peer connection.";
  }

  function setPeerStatus(text, isProblem) {
    el.peerStatus.textContent = text;
    el.peerStatus.parentElement.style.color = isProblem ? "var(--danger)" : "";
  }

  // Dropzone interactions
  el.dropzone.addEventListener("click", () => el.fileInput.click());
  el.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.fileInput.click();
    }
  });
  el.fileInput.addEventListener("change", () => {
    queueFiles([...el.fileInput.files]);
    el.fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropzone.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove("is-dragover");
    })
  );
  el.dropzone.addEventListener("drop", (e) => {
    queueFiles([...e.dataTransfer.files]);
  });

  el.textForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = el.textInput.value.trim();
    if (!value || !channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify({ type: "text", value }));
    addTextLogItem(value, true);
    el.textInput.value = "";
  });

  // ================= Sending =================

  function queueFiles(files) {
    files.forEach((file) => {
      const id = crypto.randomUUID();
      sendQueue.push({ id, file });
      addFileLogItem(id, file.name, file.size, true);
    });
    pumpQueue();
  }

  async function pumpQueue() {
    if (isSending || sendQueue.length === 0) return;
    if (!channel || channel.readyState !== "open") return;
    isSending = true;

    const { id, file } = sendQueue.shift();
    await sendFile(id, file);

    isSending = false;
    pumpQueue();
  }

  async function sendFile(id, file) {
    channel.send(
      JSON.stringify({
        type: "file-meta",
        id,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
      })
    );

    let offset = 0;
    while (offset < file.size) {
      if (channel.bufferedAmount > BUFFERED_AMOUNT_LOW_THRESHOLD) {
        await waitForBufferedAmountLow();
      }
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      channel.send(buffer);
      offset += buffer.byteLength;
      updateFileProgress(id, offset, file.size);
    }

    channel.send(JSON.stringify({ type: "file-end", id }));
    markLogItemDone(id);
  }

  function waitForBufferedAmountLow() {
    return new Promise((resolve) => {
      channel.addEventListener("bufferedamountlow", function handler() {
        channel.removeEventListener("bufferedamountlow", handler);
        resolve();
      });
    });
  }

  // ================= Receiving =================

  function handleControlMessage(msg) {
    if (msg.type === "file-meta") {
      incoming.set(msg.id, { meta: msg, chunks: [], received: 0 });
      addFileLogItem(msg.id, msg.name, msg.size, false);
    } else if (msg.type === "file-end") {
      finalizeIncomingFile(msg.id);
    } else if (msg.type === "text") {
      addTextLogItem(msg.value, false);
    }
  }

  function handleChunk(buffer) {
    // Attribute this chunk to whichever incoming transfer is still open.
    // Files are sent one at a time, so the most recent unfinished entry
    // is always the right one.
    let target = null;
    for (const entry of incoming.values()) {
      if (entry.received < entry.meta.size) target = entry;
    }
    if (!target) return;

    target.chunks.push(buffer);
    target.received += buffer.byteLength;
    updateFileProgress(target.meta.id, target.received, target.meta.size);
  }

  function finalizeIncomingFile(id) {
    const entry = incoming.get(id);
    if (!entry) return;
    const blob = new Blob(entry.chunks, { type: entry.meta.mime });
    const url = URL.createObjectURL(blob);
    markLogItemDone(id, url);
    incoming.delete(id);
  }

  // ================= Log rendering =================

  function addFileLogItem(id, name, size, isOutgoing) {
    const item = document.createElement("div");
    item.className = "log-item";
    item.id = `log-${id}`;
    item.innerHTML = `
      <div class="log-item-row">
        <span class="log-item-name">${isOutgoing ? "↗" : "↘"} ${escapeHtml(name)}</span>
        <span class="log-item-meta">${formatBytes(size)}</span>
      </div>
      <div class="log-item-bar"><div class="log-item-fill"></div></div>
    `;
    el.log.prepend(item);
  }

  function addTextLogItem(text, isOutgoing) {
    const item = document.createElement("div");
    item.className = "log-item is-done";
    item.innerHTML = `
      <div class="log-item-row">
        <span class="log-item-meta">${isOutgoing ? "sent" : "received"}</span>
      </div>
      <div class="log-item-text"></div>
    `;
    item.querySelector(".log-item-text").textContent = text;
    el.log.prepend(item);
  }

  function updateFileProgress(id, sent, total) {
    const item = document.getElementById(`log-${id}`);
    if (!item) return;
    const pct = total === 0 ? 100 : Math.min(100, (sent / total) * 100);
    item.querySelector(".log-item-fill").style.width = `${pct}%`;
  }

  function markLogItemDone(id, downloadUrl) {
    const item = document.getElementById(`log-${id}`);
    if (!item) return;
    item.classList.add("is-done");
    item.querySelector(".log-item-fill").style.width = "100%";
    if (downloadUrl) {
      const row = item.querySelector(".log-item-row");
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.className = "log-item-link";
      link.textContent = "Save";
      link.download = "";
      row.appendChild(link);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ================= Boot =================

  connectSignaling();
})();
