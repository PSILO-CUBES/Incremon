// server/systems/movementLoop.js
//
// Server-authoritative movement (fixed tick) + continuous collision vs MOVING enemies,
// then a post-pass push-out vs STATIC MAP PROPS exported from Godot (handled inside collision.js).
//
// Flow:
//   • Build per-tick velocity index for ALL entities (pixels this tick) so dynamic sweeps can run in relative space.
//   • For each entity with a movement intent, integrate -> resolve collisions -> clamp to bounds -> commit.
//   • Restore Bus "entity:stateChanged" by invoking Store.setState(...) when intents start/stop.
//
// Public API:
//   onMoveStart(playerId, entityId, dir)
//   onMoveStop(playerId, entityId)
//   setDir(playerId, entityId, dir)    // for server AI
//
const Store             = require("../world/entityStore");
const Bus               = require("../world/bus");
const { getMapInfo }    = require("../maps/mapRegistry");
const { DEFAULT_PLAYER_DATA } = require("../defs/playerDefaults");
const Collide           = require("./collision");          // resolveWithSubsteps, radiusOf
const Colliders         = require("../maps/colliderRegistry"); // getMapBounds(mapId)

// ---------- fixed tick ----------
const TICK_HZ = 24; // raise to 30 if you want smaller per-tick vectors
const TICK_MS = Math.max(1, Math.floor(1000 / TICK_HZ));

// ---------- intents ----------
/** Map<playerId, Map<entityId, {x:number,y:number}>> */
const INTENTS = new Map();
/** Map<playerId, Map<entityId, {x:number,y:number}>> — last positions for per-tick velocity */
const LAST_POS = new Map();

function _sub(map, playerId) {
  let m = map.get(playerId);
  if (!m) { m = new Map(); map.set(playerId, m); }
  return m;
}
function _normDir(d) {
  const dx = Number(d?.x), dy = Number(d?.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

/**
 * Start/refresh a movement intent for an entity.
 * Also ensure state = "walk" (emits Bus "entity:stateChanged" via entityStore).
 */
function onMoveStart(playerId, entityId, dir) {
  if (!playerId || !entityId) return;
  _sub(INTENTS, playerId).set(String(entityId), _normDir(dir));

  const ent = Store.get(playerId, entityId);
  if (ent && ent.state !== "walk") {
    // Will emit Bus "entity:stateChanged"
    Store.setState(playerId, entityId, "walk");
  }
}

/**
 * AI helper alias (same as onMoveStart but name used by AI follow loop).
 */
function setDir(playerId, entityId, dir) {
  onMoveStart(playerId, entityId, dir);
}

/**
 * Stop a movement intent for an entity.
 * Also ensure state = "idle" (emits Bus "entity:stateChanged" via entityStore).
 */
function onMoveStop(playerId, entityId) {
  if (!playerId || !entityId) return;
  const sub = INTENTS.get(playerId);
  if (sub) sub.delete(String(entityId));

  const ent = Store.get(playerId, entityId);
  if (ent && ent.state !== "idle") {
    // Will emit Bus "entity:stateChanged"
    Store.setState(playerId, entityId, "idle");
  }
}

// ---------- helpers ----------
function _speedPxSec(ent) {
  const spd = Number(ent?.stats?.spd ?? ent?.data?.spd ?? DEFAULT_PLAYER_DATA.spd ?? 200);
  return Number.isFinite(spd) ? spd : 200;
}
function _integrate(ent, dir, dtSec) {
  const spd = _speedPxSec(ent);
  const dx = dir.x * spd * dtSec;
  const dy = dir.y * spd * dtSec;
  const x0 = Number(ent.pos?.x) || 0;
  const y0 = Number(ent.pos?.y) || 0;
  return { prev: { x: x0, y: y0 }, wish: { x: x0 + dx, y: y0 + dy } };
}

/**
 * Clamp to map bounds, preferring collider JSON bounds (server/maps/colliders/<area>/<map>.json).
 * Falls back to mapRegistry sizes if collider bounds are missing.
 * Pads by entity radius so we don't "half-exit" the map.
 */
function _clampToMap(ent, x, y) {
  const radius = Collide.radiusOf(ent) || 0;

  // Prefer exported collider bounds
  const bounds = Colliders.getMapBounds(ent?.mapId);
  if (bounds && Number.isFinite(bounds.x)) {
    const minX = bounds.x + radius;
    const minY = bounds.y + radius;
    const maxX = bounds.x + bounds.w - radius;
    const maxY = bounds.y + bounds.h - radius;
    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY),
    };
  }

  // Fallback to mapRegistry (old style)
  const info = getMapInfo(ent?.mapId);
  if (!info) return { x, y };
  const minX = 0 + radius, minY = 0 + radius;
  const maxX = (Number(info?.widthPx)  || 4096) - radius;
  const maxY = (Number(info?.heightPx) || 4096) - radius;
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

/**
 * Build a velocity index for all entities in the player's namespace:
 * Map<entityId, {x,y}> where x,y are *pixels this tick* (currentPos - lastPos).
 * This powers relative sweeps in collision.js for moving obstacles.
 */
function _buildVelocityIndex(playerId) {
  const vel = new Map();
  const last = _sub(LAST_POS, playerId);

  Store.each(playerId, (eid, ent) => {
    const x = Number(ent?.pos?.x) || 0;
    const y = Number(ent?.pos?.y) || 0;
    const prev = last.get(String(eid)) || { x, y };
    vel.set(String(eid), { x: x - prev.x, y: y - prev.y });
  });

  return vel;
}

/** After we finish the tick, update LAST_POS with current store state */
function _snapshotPositions(playerId) {
  const last = _sub(LAST_POS, playerId);
  last.clear();
  Store.each(playerId, (eid, ent) => {
    const x = Number(ent?.pos?.x) || 0;
    const y = Number(ent?.pos?.y) || 0;
    last.set(String(eid), { x, y });
  });
}

// ---------- main step ----------
function step(dtSec) {
  const now = Date.now();

  // Build per-player velocity indexes BEFORE applying this frame's moves.
  const velIndexes = new Map();
  for (const playerId of INTENTS.keys()) {
    velIndexes.set(playerId, _buildVelocityIndex(playerId));
  }

  for (const [playerId, sub] of INTENTS) {
    const ids = Array.from(sub.keys());
    const velIndex = velIndexes.get(playerId) || new Map();

    for (const entityId of ids) {
      const ent = Store.get(playerId, entityId);
      if (!ent) { sub.delete(entityId); continue; }
      if (ent.state === "dead") { sub.delete(entityId); continue; }

      const dir = sub.get(entityId) || { x: 0, y: 0 };
      if (dir.x === 0 && dir.y === 0) continue;

      // Integrate
      const { prev, wish } = _integrate(ent, dir, dtSec);

      // Clamp wish to bounds (cheap pre-clamp to avoid giant vectors)
      const clampedWish = _clampToMap(ent, wish.x, wish.y);

      // Resolve collisions:
      //   • dynamic sweep + slide vs moving entities (relative space)
      //   • static prop push-out from map colliders (inside collision.js)
      const resolved = Collide.resolveWithSubsteps(playerId, ent, prev, clampedWish, velIndex);

      // Final clamp (radius-aware) in case push-out nudged to an edge
      const finalPos = _clampToMap(ent, resolved.x, resolved.y);

      // Commit & publish only on actual movement
      if ((Math.abs(finalPos.x - prev.x) + Math.abs(finalPos.y - prev.y)) > 0.001) {
        Store.setPos(playerId, entityId, { x: finalPos.x, y: finalPos.y, t: now });
        Bus.emit("entity:posChanged", {
          playerId,
          entityId,
          pos: { x: finalPos.x, y: finalPos.y, t: now },
          entity: ent,
        });
      }
    }

    // After processing this player's moves, snapshot new positions to feed next tick's velocity
    _snapshotPositions(playerId);
  }
}

// ---------- fixed ticker ----------
let _last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dtMs = Math.max(1, now - _last);
  _last = now;
  step(dtMs / 1000);
}, TICK_MS);

module.exports = {
  onMoveStart,
  onMoveStop,
  setDir,
  // exposed for tests
  _INTENTS: INTENTS,
  _step: step,
};
