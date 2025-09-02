// server/world/entityStore.js
//
// Per-player entity store.
// Shape inserted by create(...):
//   { entityId, ownerId, type, mapId, instanceId, pos, state, ...meta }
//
// API:
//   create(playerId, { entityId, type="player", mapId, instanceId, pos={x:320,y:320}, state="idle" })
//   get(playerId, id)
//   remove(playerId, id)
//   setState(playerId, id, state)
//   setPos(playerId, id, pos)
//   each(playerId, cb)            // NEW: iterate each (id, row)
//   clearPlayer(playerId)         // NEW: drop entire player's map (no events)

const Bus = require("./bus");

const _stores = new Map(); // playerId -> Map(entityId -> row)

function _store(playerId) {
  if (!playerId) return null;
  let s = _stores.get(playerId);
  if (!s) {
    s = new Map();
    _stores.set(playerId, s);
  }
  return s;
}

function create(
  playerId,
  {
    entityId,
    type = "player",
    mapId,
    instanceId,
    pos = { x: 320, y: 320 },
    state = "idle",
    ...rest
  } = {}
) {
  const s = _store(playerId);
  if (!s) return null;

  const e = {
    entityId,
    ownerId: playerId,
    type,
    mapId,
    instanceId,
    pos,
    state,
    ...rest,
  };

  s.set(entityId, e);
  return e;
}

function get(playerId, id) {
  const s = _stores.get(playerId);
  return s ? (s.get(id) || null) : null;
}

function remove(playerId, id) {
  const s = _stores.get(playerId);
  if (s && s.has(id)) {
    s.delete(id);
    return true;
  }
  return false;
}

function setState(playerId, id, state) {
  const s = _stores.get(playerId);
  if (!s) return null;
  const e = s.get(id);
  if (!e) return null;
  if (e.state === state) return e;

  const from = e.state;
  e.state = state;

  Bus.emit("entity:stateChanged", { playerId, entityId: id, from, to: state, entity: e });
  return e;
}

function setPos(playerId, id, pos) {
  const s = _stores.get(playerId);
  if (!s) return null;
  const e = s.get(id);
  if (!e) return null;

  e.pos = { x: Number(pos.x) || 0, y: Number(pos.y) || 0 };
  Bus.emit("entity:posChanged", { playerId, entityId: id, pos: e.pos, entity: e });
  return e;
}

// ---- NEW: safe iteration helper (no direct Map leaks) ----
function each(playerId, cb) {
  const s = _stores.get(playerId);
  if (!s) return 0;
  let n = 0;
  for (const [id, row] of s.entries()) {
    try { cb(id, row); } catch (_e) {}
    n++;
  }
  return n;
}

// ---- NEW: clear an entire player's store (no events) ----
function clearPlayer(playerId) {
  const s = _stores.get(playerId);
  if (!s) return 0;
  const n = s.size;
  s.clear();
  _stores.delete(playerId);
  return n;
}

module.exports = {
  create,
  get,
  remove,
  setState,
  setPos,
  each,         // NEW
  clearPlayer,  // NEW
};
