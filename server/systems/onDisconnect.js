const { cleanupPlayerOnDisconnect } = require("../world/playerCleanup");

function onDisconnect(ws) {
  const playerId = ws && ws.playerId;
  if (!playerId) return;

  const { removed } = cleanupPlayerOnDisconnect(playerId);
  // (Optional) log
  console.log(`-* [disconnect] cleaned ${removed} entities for player ${playerId}`);
}

module.exports = onDisconnect;