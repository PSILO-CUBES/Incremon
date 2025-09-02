const FSM = require("../../../../systems/fsm");
const Store = require("../../../../world/entityStore");
const Movement = require("../../../../systems/movementLoop");

module.exports = ( ws, data = {} ) => {
  if (!ws.playerId || !ws.hasSpawned) return;
  const entityId = data.entityId || ws.playerEntityId;

  const res = FSM.apply(ws.playerId, entityId, "moveIntentStop");
  if (!res.ok) return;

  // Clear server-side intended direction so the ticker stops moving
  Movement.onMoveStop(ws.playerId, entityId);

  const ent = Store.get(ws.playerId, entityId);
  ws.send(JSON.stringify({
    event: "entityStateUpdate",
    payload: {
      entityId,
      state: ent.state, // "idle"
    }
  }));
};