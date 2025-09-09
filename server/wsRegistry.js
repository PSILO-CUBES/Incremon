// server/wsRegistry.js
const WebSocket = require("ws");

const socketsByPlayer = new Map();

// Soft backpressure limit: if socket is too backed up, drop the message
const OUTBOUND_SOFT_LIMIT = 256 * 1024; // 256KB buffered

/** Return the WebSocket for a player or null. */
function get(playerId) {
  return socketsByPlayer.get(playerId) || null;
}

/** Is this socket open and sendable? */
function isOpen(ws) {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

/**
 * Bind a WebSocket to a playerId.
 * - Cleans any previous socket for that player.
 * - Installs close/error handlers to auto-unregister.
 */
function bindPlayer(ws, playerId) {
  if (!ws || !playerId) return;

  // If another socket was bound to this player, close the old binding.
  const existing = socketsByPlayer.get(playerId);
  if (existing && existing !== ws) {
    try { existing.close(1000, "Rebind"); } catch {}
  }

  // Store reverse pointer for cleanup
  ws.playerId = playerId;
  socketsByPlayer.set(playerId, ws);

  // Ensure we only attach once
  if (!ws._registryHandlersInstalled) {
    ws._registryHandlersInstalled = true;

    ws.on("close", () => {
      if (ws.playerId && socketsByPlayer.get(ws.playerId) === ws) {
        socketsByPlayer.delete(ws.playerId);
      }
      ws.playerId = null;
    });

    ws.on("error", () => {
      // Error will typically be followed by close; guard anyway.
      if (ws.playerId && socketsByPlayer.get(ws.playerId) === ws) {
        socketsByPlayer.delete(ws.playerId);
      }
      ws.playerId = null;
    });
  }
}

/** Explicitly unbind a playerId (optional; close/error also cleans up). */
function unbindPlayer(playerId) {
  const ws = socketsByPlayer.get(playerId);
  if (ws) {
    socketsByPlayer.delete(playerId);
    try { ws.close(1000, "Unbind"); } catch {}
  }
}

/**
 * Safe send to a single player.
 * Returns true if we sent, false otherwise (missing socket or not open).
 *
 * Backpressure guard:
 * - If ws.bufferedAmount > OUTBOUND_SOFT_LIMIT, drop the message (avoid RAM bloat).
 * - You can flip this to 'close' if you prefer to kill slow consumers:
 *     if (ws.bufferedAmount > OUTBOUND_SOFT_LIMIT) { try { ws.close(1011, "Backpressure"); } catch {} return false; }
 */
function sendTo(playerId, msg) {
  const ws = get(playerId);
  if (!ws || !isOpen(ws)) return false;

  // Avoid hot loops when a client is not reading
  if (ws.bufferedAmount > OUTBOUND_SOFT_LIMIT) {
    // Drop this message; caller should treat send as best-effort
    return false;
  }

  try {
    // JSON serialization errors shouldn't blow up callers
    const payload = (typeof msg === "string") ? msg : JSON.stringify(msg);
    ws.send(payload, (err) => {
      // Optional: you could log err for diagnostics
    });
    return true;
  } catch {
    return false;
  }
}

/** Best-effort send to many playerIds. Returns count of successful sends. */
function sendToMany(playerIds, msg) {
  let ok = 0;
  for (const pid of playerIds) {
    if (sendTo(pid, msg)) ok++;
  }
  return ok;
}

/** Debug helper (optional): list currently bound players. */
function dumpBindings() {
  return Array.from(socketsByPlayer.keys());
}

module.exports = {
  get,
  isOpen,
  bindPlayer,
  unbindPlayer,
  sendTo,
  sendToMany,
  dumpBindings,
};
