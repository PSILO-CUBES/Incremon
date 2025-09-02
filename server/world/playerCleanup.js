// server/world/playerCleanup.js
//
// Drops a player's runtime state cleanly on disconnect:
// - Despawn every entity (emits events → keeps spawnLoop indices in sync)
// - Clear the player's entityStore map
// - Notify spawnLoop to forget per-player spawn bookkeeping

const Store = require("./entityStore");
const { despawn } = require("../world/despawn");
const SpawnLoop = require("../systems/spawnLoop"); // will use onPlayerDisconnect()

function cleanupPlayerOnDisconnect(playerId) {
  if (!playerId) return { removed: 0 }; 

  // Despawn all known entities so listeners (including spawnLoop) stay consistent
  let removed = 0;
  Store.each(playerId, (id/*, row*/) => {
    if (despawn(playerId, id, "playerLeft")) {
      removed++;
    }
  });

  // Finally drop the player's store (should be empty now anyway)
  Store.clearPlayer(playerId);

  // Let the spawn loop discard timers/indexes for this player
  if (typeof SpawnLoop.onPlayerDisconnect === "function") {
    SpawnLoop.onPlayerDisconnect(playerId);
  }

  return { removed };
}

module.exports = { cleanupPlayerOnDisconnect };
