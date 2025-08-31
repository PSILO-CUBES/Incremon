const Bus = require("./bus");

const _stores = new Map();

function _store(playerId) {
  if (!playerId) return null;
  let s = _stores.get(playerId);
  if (!s) {
    s = new Map();
    _stores.set(playerId, s);
  }
  return s;
}

function create(playerId, { entityId, type = "player", mapId, instanceId, pos = { x: 320, y: 320 }, state = "idle" }) {
  const s = _store(playerId);
  if (!s) return null;
  const e = { entityId, ownerId: playerId, type, mapId, instanceId, pos, state };
  s.set(entityId, e);
  return e;
}

function get(playerId, id) {
  const s = _stores.get(playerId);
  return s ? (s.get(id) || null) : null;
}

function remove(playerId, id) {
  const s = _stores.get(playerId);
  if (s) s.delete(id);
}

function setState(playerId, id, state) {
  const e = get(playerId, id);
  if (!e) return null;
  if (e.state === state) return e; // no-op, no emit
  const from = e.state;
  e.state = state;
  Bus.emit("entity:stateChanged", { playerId, entityId: id, from, to: state, entity: e });
  return e;
}

function setPos(playerId, id, pos) {
  const e = get(playerId, id);
  if (!e || !pos) return e || null;
  const prev = e.pos;
  const changed = !prev || prev.x !== pos.x || prev.y !== pos.y;
  if (changed) {
    e.pos = pos;
    Bus.emit("entity:posChanged", { playerId, entityId: id, pos, entity: e });
  }
  return e;
}

// For populating the client’s scene for THIS player only
function listByView(playerId, mapId, instanceId) {
  const s = _stores.get(playerId);
  if (!s) return [];
  const out = [];
  for (const e of s.values()) {
    if ((mapId ? e.mapId === mapId : true) && (instanceId ? e.instanceId === instanceId : true)) {
      out.push(e);
    }
  }
  return out;
}

// Cleanup when a player disconnects
function removePlayer(playerId) {
  _stores.delete(playerId);
}

// Optional: quick count for debugging
function count(playerId) {
  const s = _stores.get(playerId);
  return s ? s.size : 0;
}

module.exports = {
  create,
  get,
  remove,
  setState,
  setPos,
  listByView,
  removePlayer,
  count,
};