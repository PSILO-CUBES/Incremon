const FSM = require("../../../../systems/fsm");
const Store = require("../../../../world/entityStore");
const Movement = require("../../../../systems/movementLoop");

module.exports = (ws, data = {}) => {
  if (!ws.playerId || !ws.hasSpawned) return;
  const entityId = data.entityId || ws.playerEntityId;

  const res = FSM.apply(ws.playerId, entityId, "moveIntentStart");
  if (!res.ok) return; // blocked by FSM/state

  // Record server-side intended direction for the ticker
  const dir = (data && data.dir) ? data.dir : { x: 0, y: 0 };
  Movement.onMoveStart(ws.playerId, entityId, dir);

  const ent = Store.get(ws.playerId, entityId);
  ws.send(JSON.stringify({
    event: "entityStateUpdate",
    payload: { 
      dir,
      entityId,
      state: ent.state, // "walk"
    }
  }));
};