const worldReady = require("../../world/worldReady");

module.exports = (ws, data = {}) => {
  if (!ws.playerId) return;

  // Idempotent: ignore duplicate acks
  if (ws.hasSpawned) return;

  ws.hasSpawned = true;
  console.log(`-* Player ${ws.playerId} acknowledged spawn`);

  // Will no longer re-send playerSpawn because worldReady is idempotent now
  worldReady(ws, { mapId: ws.currentMapId });
};