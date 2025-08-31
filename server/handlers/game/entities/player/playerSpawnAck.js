const worldReady = require("../../world/worldReady");

module.exports = (ws, data = {}) => {
  if (!ws.playerId) return;

  // Idempotent: ignore duplicate acks
  if (ws.hasSpawned) return;

  ws.hasSpawned = true;
  console.log(`-* Player ${ws.playerId} acknowledged spawn`);

  // Complete phase 2 of the handshake (this will hit the branch that logs worldReady)
  worldReady(ws, { mapId: ws.currentMapId });
};