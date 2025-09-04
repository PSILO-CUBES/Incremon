// server/index.js
const WebSocket = require("ws");
const express = require("express");

require("dotenv").config();

const handleMessage = require("./handlers/index");
const dbModule = require("./db");
const wsRegistry = require("./wsRegistry");
const Bus = require("./world/bus");
const Spawns = require("./systems/spawnLoop");
// Boot movement + AI systems (fixed tick)
require("./systems/movementLoop");
require("./systems/aiFollowLoop");

const verifyRoute = require("./http/verifyRoute");

const PORT = Number(process.env.PORT || 8080);
const WS_MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD || 64 * 1024); // 64KB default

async function start() {
  await dbModule.connect();

  const app = express();
  app.get("/verify", verifyRoute);
  const server = app.listen(Number(process.env.HTTP_PORT || 8080), () => {
    console.log(`-* HTTP server listening on ${server.address().port}`);
  });

  const wss = new WebSocket.Server({ server, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD });

  // --- Bus -> WebSocket fanout ---
  Bus.on("entity:stateChanged", ({ playerId, entityId, to }) => {
    wsRegistry.sendTo(playerId, { event: "entityStateUpdate", entityId, state: to });
  });

  Bus.on("entity:posChanged", ({ playerId, entityId, pos, entity }) => {
    // pos may contain t (server timestamp); forward as-is for client interpolation
    wsRegistry.sendTo(playerId, { event: "changePosition", entityId, pos, entity });
  });

  Bus.on("entity:spawned", ({ playerId, row }) => {
    wsRegistry.sendTo(playerId, { event: "entitySpawned", entity: row });
  });

  Bus.on("entity:despawned", ({ playerId, entityId, reason }) => {
    wsRegistry.sendTo(playerId, { event: "entityDespawned", entityId, reason });
  });

  wss.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress;

    ws.on("message", (raw) => {
      handleMessage(ws, raw, clientIp);
    });

    ws.on("close", () => {
      try {
        const onDisconnect = require("./systems/onDisconnect");
        onDisconnect(ws);
      } catch (e) {
        // no-op
      }
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
