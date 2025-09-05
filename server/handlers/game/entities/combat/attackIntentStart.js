const FSM   = require("../../../../systems/fsm");
const Store = require("../../../../world/entityStore");

// You can move this to a config if you want
const ATTACK_DURATION_MS = 350;

module.exports = (ws, data = {}) => {
  if (!ws.playerId || !ws.hasSpawned) return;
  const entityId = data.entityId || ws.playerEntityId;

  // Try to enter 'attack' via FSM
  const res = FSM.apply(ws.playerId, entityId, "attackIntentStart");
  if (!res.ok) return;

  const ent = Store.get(ws.playerId, entityId);
};
