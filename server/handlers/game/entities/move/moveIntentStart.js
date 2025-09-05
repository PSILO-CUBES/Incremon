const FSM = require("../../../../systems/fsm");
const Store = require("../../../../world/entityStore");
const Movement = require("../../../../systems/movementLoop");
const AttackLoop = require("../../../../systems/attackLoop");

module.exports = (ws, data = {}) => {
  if (!ws.playerId || !ws.hasSpawned) return;
  const entityId = data.entityId || ws.playerEntityId;

  const dir = (data && data.dir) ? data.dir : { x: 0, y: 0 };

  const ent = Store.get(ws.playerId, entityId);
  if (ent && ent.state === "attack") {
    AttackLoop.queueMove(ws.playerId, entityId, dir);
    return;
  }

  const res = FSM.apply(ws.playerId, entityId, "moveIntentStart");
  if (!res.ok) return;

  Movement.onMoveStart(ws.playerId, entityId, dir);

  const nowEnt = Store.get(ws.playerId, entityId);
  ws.send(JSON.stringify({
    event: "entityStateUpdate",
    payload: { 
      dir,
      entityId,
      state: nowEnt.state,
    }
  }));
};
