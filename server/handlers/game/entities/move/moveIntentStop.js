const FSM = require("../../../../systems/fsm");
const Store = require("../../../../world/entityStore");

module.exports = (ws, data = {}) => {
  if (!ws.playerId || !ws.hasSpawned) return;
  const entityId = data.entityId || ws.playerEntityId;

  const res = FSM.apply(ws.playerId, entityId, "moveIntentStop");
  if (!res.ok) return;

  const ent = Store.get(ws.playerId, entityId);
  ws.send(JSON.stringify({
    event: "entityStateUpdate",
    entityId,
    state: ent.state, // "idle"
    payload: {}
  }));
};
