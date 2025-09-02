// server/world/despawn.js
//
// Consistent despawn helper. Removes from store and emits "entity:despawned".
// Use this for deaths, timeouts, or disconnect cleanup.

const Bus = require("./bus");
const Store = require("./entityStore");

function despawn(playerId, entityId, reason = "unknown") {
  const e = Store.get(playerId, entityId);
  if (!e) return false;

  // mark dead (optional)
  e.state = "dead";

  // remove from per-player store
  Store.remove(playerId, entityId);

  // one canonical event
  Bus.emit("entity:despawned", { playerId, entityId, reason });
  return true;
}

module.exports = { despawn };
