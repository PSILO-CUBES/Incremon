// server/index.js
const WebSocket = require("ws");
const express = require("express");

const handleMessage = require("./handlers/index");
const dbModule = require("./db");
const wsRegistry = require("./wsRegistry");
const Bus = require("./world/bus");
const Spawns = require("./systems/spawnLoop");
const onDisconnect = require("./systems/onDisconnect");
const verifyRoute = require("./http/verifyRoute");

require("dotenv").config();

const PORT = Number(process.env.PORT || 8080);
const WS_MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD || 64 * 1024); // 64KB default
const ORIGIN_REGEX = process.env.ORIGIN_REGEX ? new RegExp(process.env.ORIGIN_REGEX) : null;

// ---------- Bus forwarders (unchanged) ----------
Bus.on("entity:stateChanged", ({ playerId, entityId, to }) => {
  wsRegistry.sendTo(playerId, { event: "entityStateUpdate", entityId, state: to });
});

Bus.on("entity:posChanged", ({ playerId, entityId, pos, entity }) => {
  wsRegistry.sendTo(playerId, { event: "changePosition", entityId, pos, entity, ts: Date.now() });
});
async function start() {
  await dbModule.connect();

  // Minimal HTTP server for health/verify endpoints
  const app = express();
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, players: wsRegistry.dumpBindings().length, ts: Date.now() });
  });
  app.use("/", verifyRoute);

  const server = app.listen(PORT, () => {
    console.log(`-* HTTP server listening on http://127.0.0.1:${PORT}`);
  });

  // ---------- WebSocket server: HARDENED ----------
  const wss = new WebSocket.Server({
    server,
    // Security/perf: drop huge frames before they hit your handler
    maxPayload: WS_MAX_PAYLOAD,
    // Avoid compression bombs; your payloads are tiny and frequent
    perMessageDeflate: false,
  });

  // Heartbeat sweep (detect zombie sockets)
  const HEARTBEAT_MS = 30_000;
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, HEARTBEAT_MS);

  wss.on("close", () => clearInterval(sweep));

  wss.on("connection", (ws, req) => {
    // Optional origin guard (off by default)
    const origin = req.headers?.origin || "";
    if (ORIGIN_REGEX && !ORIGIN_REGEX.test(origin)) {
      try { ws.close(1008, "Origin not allowed"); } catch {}
      return;
    }

    // Heartbeat wiring
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    const clientIp = req.socket.remoteAddress;

    ws.on("message", (raw) => {
      // App-layer handler already does: size cap, rate limit, sanitize, auth checks
      handleMessage(ws, raw, clientIp);
    });

    ws.on("close", () => {
      onDisconnect(ws);
    });

    ws.on("error", () => {
      // Error usually followed by 'close'; nothing special to do
    });
  });

  // Start per-player spawn loop after WS is ready
  if (typeof Spawns.start === "function") {
    Spawns.start();
  }

  console.log(`-* WebSocket server running (port ${PORT}) maxPayload=${WS_MAX_PAYLOAD} deflate=off`);
}

start().catch((e) => {
  console.error("Fatal server start error:", e);
  process.exit(1);
});
