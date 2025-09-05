const FSM        = require("../../../../systems/fsm");
const Store      = require("../../../../world/entityStore");
const wsRegistry = require("../../../../wsRegistry");
const Movement   = require("../../../../systems/movementLoop");
const AttackLoop = require("../../../../systems/attackLoop");

module.exports = (ws, data = {}) => {
  if (!ws.playerId || !ws.hasSpawned) return;
  const entityId = data.entityId || ws.playerEntityId;
  const key = String(entityId);

  let resumeDir = null;
  try {
    const intents = Movement._INTENTS && Movement._INTENTS.get(ws.playerId);
    if (intents && intents.has(key)) {
      resumeDir = intents.get(key);
      intents.delete(key);
    }
  } catch (_) { }

  const res = FSM.apply(ws.playerId, entityId, "attackIntentStart");
  if (!res.ok) return;

  const ent = Store.get(ws.playerId, entityId);

  // wsRegistry.sendTo(ws.playerId, {
  //   event: "entityStateUpdate",
  //   payload: { entityId, state: ent.state }
  // });

  const durationMs = Math.max(1, Math.floor(Number(data?.durationMs) || Number(process.env.ATTACK_MS) || 180));
  AttackLoop.start(ws.playerId, entityId, durationMs, resumeDir);
};
