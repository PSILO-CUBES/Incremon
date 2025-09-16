// server/systems/movementLoop.js
//
// Server-authoritative movement (fixed tick) with continuous collision vs MOVING entities
// using a frozen world snapshot, then a static push-out vs MAP PROPS from colliderRegistry.
//
// Key fix in this version:
//   The per-tick POS SNAPSHOT now includes { type, mobType, mapId, instanceId, entityId }
//   so collision.js can correctly compute radii and map-scoped collisions.
//   (Previously the snapshot only had { x, y, r }, which broke both entity and wall collisions.)
//
// Public API:
//   onMoveStart(playerId, entityId, dir)
//   onMoveStop(playerId, entityId)
//   setDir(playerId, entityId, dir)    // for server AI
//
// Conventions: camelCase, no semicolons.

const FSM              = require("../systems/fsm")
const Store            = require("../world/entityStore")
const Collide          = require("./collision")
const ENEMIES          = require("../defs/enemiesConfig")
const { DEFAULT_PLAYER_DATA } = require("../defs/playerDefaults")
const Colliders        = require("../maps/colliderRegistry")
const { getMapInfo }   = require("../maps/mapRegistry")

// ─────────────────────────────────────────────────────────────────────────────
// Ticking
// ─────────────────────────────────────────────────────────────────────────────
const TICK_MS = 50  // ~20Hz fixed tick

// Per-player movement intents: Map<playerId, Map<entityId, {x,y}>>
const INTENTS = new Map()

// Last known positions (for velocity indexing): Map<playerId, Map<entityId, {x,y}>>
const LAST_POS = new Map()

function _sub(root, key) {
  let m = root.get(String(key))
  if (!m) { m = new Map(); root.set(String(key), m) }
  return m
}

function _normDir(d) {
  const x = Number(d?.x) || 0
  const y = Number(d?.y) || 0
  const len = Math.hypot(x, y)
  if (len <= 1e-6) return { x: 0, y: 0 }
  // already normalized on client, but guard anyway
  const nx = x / len
  const ny = y / len
  // tiny deadzone to avoid micro creep
  return (Math.abs(nx) < 1e-4 && Math.abs(ny) < 1e-4) ? { x: 0, y: 0 } : { x: nx, y: ny }
}

function _speedOf(ent) {
  if (!ent) return 0

  if (ent.type === "player") {
    const s = ent.stats || {}
    const spd = Number(s.spd)
    if (Number.isFinite(spd)) return spd
    return Number(DEFAULT_PLAYER_DATA?.spd) || 200
  }

  if (ent.type === "mob") {
    const s = ent.stats || {}
    const spd = Number(s.spd)
    if (Number.isFinite(spd)) return spd
    const def = ENEMIES[ent.mobType]
    return Number(def?.spd) || 50
  }

  return 0
}

function _integrate(ent, dir, dtSec) {
  const spd = _speedOf(ent)
  const dx = dir.x * spd * dtSec
  const dy = dir.y * spd * dtSec
  const x0 = Number(ent?.pos?.x) || 0
  const y0 = Number(ent?.pos?.y) || 0
  return { prev: { x: x0, y: y0 }, wish: { x: x0 + dx, y: y0 + dy } }
}

// Clamp to map bounds, preferring collider JSON bounds, padded by entity radius.
function _clampToMap(ent, x, y) {
  const radius = Collide.radiusOf(ent) || 0

  const bounds = Colliders.getMapBounds(ent?.mapId)
  if (bounds && Number.isFinite(bounds.x)) {
    const minX = bounds.x + radius
    const minY = bounds.y + radius
    const maxX = bounds.x + bounds.w - radius
    const maxY = bounds.y + bounds.h - radius
    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY),
    }
  }

  // Fallback to mapRegistry info if bounds file is absent
  const info = getMapInfo(ent?.mapId)
  if (!info) return { x, y }
  const minX = 0 + radius, minY = 0 + radius
  const maxX = (Number(info?.widthPx)  || 4096) - radius
  const maxY = (Number(info?.heightPx) || 4096) - radius
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  }
}

// Build per-player relative velocity index (pixels moved last tick).
function _buildVelocityIndex(playerId) {
  const vel = new Map()
  const last = _sub(LAST_POS, playerId)

  Store.each(playerId, (eid, ent) => {
    const x = Number(ent?.pos?.x) || 0
    const y = Number(ent?.pos?.y) || 0
    const prev = last.get(String(eid)) || { x, y }
    vel.set(String(eid), { x: x - prev.x, y: y - prev.y })
  })

  return vel
}

// Build a frozen position snapshot for this tick so sweeps don't read live-mutated positions.
// IMPORTANT: include the metadata that collision.js needs:
//   type, mobType, mapId, instanceId, entityId
function _buildPosIndex(playerId) {
  const pos = new Map()
  Store.each(playerId, (eid, ent) => {
    pos.set(String(eid), {
      x          : Number(ent?.pos?.x) || 0,
      y          : Number(ent?.pos?.y) || 0,
      r          : Collide.radiusOf(ent) || 0, // not used directly by collision.js, but handy
      type       : ent?.type,
      mobType    : ent?.mobType,
      mapId      : ent?.mapId,
      instanceId : ent?.instanceId,
      entityId   : ent?.entityId ?? String(eid),
    })
  })
  return pos
}

function _snapshotPositions(playerId) {
  const last = _sub(LAST_POS, playerId)
  Store.each(playerId, (eid, ent) => {
    const x = Number(ent?.pos?.x) || 0
    const y = Number(ent?.pos?.y) || 0
    last.set(String(eid), { x, y })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Movement API
// ─────────────────────────────────────────────────────────────────────────────

// Start/refresh a movement intent for an entity.
function onMoveStart(playerId, entityId, dir) {
  if (!playerId || !entityId) return

  const ent = Store.get(playerId, entityId)
  if (!ent) return

  // If attacking, queue the move to resume after attack
  if (ent.state === "attack") {
    try {
      const AttackLoop = require("./attackLoop")
      if (ent.type === "player") {
        AttackLoop.queueMove(playerId, entityId, _normDir(dir))
      }
    } catch (_e) {}
    return
  }

  _sub(INTENTS, playerId).set(String(entityId), _normDir(dir))

  if (ent.state !== "walk") {
    FSM.apply(playerId, entityId, "moveIntentStart")
  }
}

// Stop movement for an entity.
function onMoveStop(playerId, entityId) {
  if (!playerId || !entityId) return

  const ent = Store.get(playerId, entityId)
  if (!ent) return

  const sub = _sub(INTENTS, playerId)
  sub.delete(String(entityId))

  if (ent.state === "walk") {
    FSM.apply(playerId, entityId, "moveIntentStop")
  }
}

// For server AI (e.g., mobs) to steer continuously without client input.
function setDir(playerId, entityId, dir) {
  if (!playerId || !entityId) return
  const sub = _sub(INTENTS, playerId)
  sub.set(String(entityId), _normDir(dir))
  const ent = Store.get(playerId, entityId)

  if (ent && ent.state !== "walk") {
    FSM.apply(playerId, entityId, "moveIntentStart")
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main step
// ─────────────────────────────────────────────────────────────────────────────

function step(dtSec) {
  // Build per-player indexes BEFORE applying this frame's moves.
  const velIndexes = new Map()
  const posIndexes = new Map()
  for (const playerId of INTENTS.keys()) {
    velIndexes.set(playerId, _buildVelocityIndex(playerId))
    posIndexes.set(playerId, _buildPosIndex(playerId))
  }

  for (const [playerId, sub] of INTENTS) {
    const ids = Array.from(sub.keys())
    const velIndex = velIndexes.get(playerId) || new Map()
    const posIndex = posIndexes.get(playerId) || new Map()

    for (let i = 0; i < ids.length; i++) {
      const entityId = ids[i]
      const ent = Store.get(playerId, entityId)
      if (!ent) { sub.delete(entityId); continue }

      // Only move entities in 'walk' (attack blocks movement)
      if (ent.state !== "walk") continue

      const dir = sub.get(entityId) || { x: 0, y: 0 }
      if ((dir.x === 0 && dir.y === 0)) continue

      // Integrate desired motion
      const { prev, wish } = _integrate(ent, dir, dtSec)

      // Pre-clamp to bounds to avoid giant vectors
      const clampedWish = _clampToMap(ent, wish.x, wish.y)

      // Resolve with frozen snapshot (dynamic sweep uses posIndex + velIndex)
      const resolved = Collide.resolveWithSubsteps(
        playerId,
        posIndex.get(String(entityId)) || ent, // movingEnt meta for radius/mapId/instanceId/type
        prev,
        clampedWish,
        velIndex,
        posIndex
      )

      // Post clamp & commit
      const bounded = _clampToMap(ent, resolved.x, resolved.y)
      Store.setPos(playerId, entityId, bounded)

      console.log(JSON.stringify({
        tag: "serverPos",
        entityId: ent.entityId,
        pos: bounded,
        tick: Date.now()
      }))
    }

    // Refresh LAST_POS snapshot at end of player tick
    _snapshotPositions(playerId)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot loop
// ─────────────────────────────────────────────────────────────────────────────
let _last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dtMs = Math.max(1, now - _last)
  _last = now
  step(dtMs / 1000)
}, TICK_MS)

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  onMoveStart,
  onMoveStop,
  setDir,
  // exposed for tests
  _INTENTS: INTENTS,
  _step: step,
}
