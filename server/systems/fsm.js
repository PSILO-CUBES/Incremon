const DEFS = require("../defs/stateDefs");
const Store = require("../world/entityStore");

function allowed(playerId, entityId, intent) {
  if (!playerId) return { ok: false, reason: "unknownOwner" };

  const ent = Store.get(playerId, entityId);
  if (!ent) return { ok: false, reason: "unknownEntity" };

  // if (ent.type != 'player') console.log(ent.state)
  const def = DEFS[ent.type] || DEFS.player || {};
  const row = def[ent.state] || {};
  const rule = row[intent];

  if (!rule) return { ok: false, reason: "blocked", from: ent.state };
  return { ok: true, to: rule.to ?? ent.state };
}

function apply(playerId, entityId, intent) {
  const res = allowed(playerId, entityId, intent);
  if (!res.ok) return res;

  const ent = Store.setState(playerId, entityId, res.to);
  return { ok: true, to: res.to, type: ent?.type, mapId: ent?.mapId, instanceId: ent?.instanceId };
}

module.exports = { allowed, apply };