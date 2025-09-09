const FSM = require("../../../../systems/fsm");
const Store = require("../../../../world/entityStore");
const Movement = require("../../../../systems/movementLoop");
const AttackLoop = require("../../../../systems/attackLoop");

module.exports = ( ws, data = {} ) => {
  if (!ws.playerId || !ws.hasSpawned) return;
  const entityId = data.entityId || ws.playerEntityId;

  const ent = Store.get(ws.playerId, entityId);
  if (ent && ent.state === "attack") {
    AttackLoop.clearQueued(ws.playerId, entityId);
    return;
  }

  const res = FSM.apply(ws.playerId, entityId, "moveIntentStop");
  if (!res.ok) return;

  Movement.onMoveStop(ws.playerId, entityId);

  const nowEnt = Store.get(ws.playerId, entityId);
  ws.send(JSON.stringify({
    event: "entityStateUpdate",
    payload: {
      entityId,
      state: nowEnt.state,
    }
  }));
};
