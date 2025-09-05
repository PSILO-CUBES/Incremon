// server/systems/movementLoop.js
//
// Server-authoritative movement (fixed tick) with continuous collision vs MOVING entities
// using a frozen world snapshot, then a static push-out vs MAP PROPS from colliderRegistry.
//
// Core fix: build a per-tick POS SNAPSHOT and pass it into collision so sweeps never
// read live, already-mutated positions (which can cause slip/teleport).
//
// Public API:
//   onMoveStart(playerId, entityId, dir)
//   onMoveStop(playerId, entityId)
//   setDir(playerId, entityId, dir)    // for server AI
//
const Store       = require("../world/entityStore")
const Collide     = require("./collision")
const Colliders   = require("../maps/colliderRegistry")
const { getMapInfo } = require("../maps/mapRegistry")
const ENEMIES     = require("../defs/enemiesConfig")
const { DEFAULT_PLAYER_DATA } = require("../defs/playerDefaults")

// ---------- fixed tick ----------
const TICK_HZ = 24
const TICK_MS = Math.floor(1000 / TICK_HZ)

const INTENTS   = new Map()   // Map<playerId, Map<entityId, {x,y}>>
const LAST_POS  = new Map()   // Map<playerId, Map<entityId, {x,y}>>
let   _last     = Date.now()

function _sub(map, playerId) {
  let m = map.get(playerId)
  if (!m) { m = new Map(); map.set(playerId, m) }
  return m
}
function _normDir(d) {
  const dx = Number(d?.x), dy = Number(d?.y)
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 }
  const len = Math.hypot(dx, dy)
  if (len <= 1e-6) return { x: 0, y: 0 }
  return { x: dx / len, y: dy / len }
}

// Start/refresh a movement intent for an entity.
function onMoveStart(playerId, entityId, dir) {
  if (!playerId || !entityId) return
  _sub(INTENTS, playerId).set(String(entityId), _normDir(dir))

  const ent = Store.get(playerId, entityId)
  if (ent && ent.state !== "walk") {
    Store.setState(playerId, entityId, "walk")
  }
}

// AI helper alias
function setDir(playerId, entityId, dir) {
  return onMoveStart(playerId, entityId, dir)
}

function onMoveStop(playerId, entityId) {
  if (!playerId || !entityId) return
  const sub = INTENTS.get(playerId)
  if (sub) sub.delete(String(entityId))

  const ent = Store.get(playerId, entityId)
  if (ent && ent.state !== "idle") {
    Store.setState(playerId, entityId, "idle")
  }
}

function _speedOf(ent) {
  if (!ent) return 0
  if (ent.type === "player") {
    return Number(DEFAULT_PLAYER_DATA?.spd) || 200
  }
  if (ent.type === "mob" || ent.mobType) {
    const def = ent.mobType ? ENEMIES[ent.mobType] : null
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

// Clamp to map bounds, preferring collider JSON bounds.
// Pads by entity radius so we don't half-exit.
function _clampToMap(ent, x, y) {
  const radius = Collide.radiusOf(ent) || 0

  // Prefer exported collider bounds
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

  // Fallback to mapRegistry (old style)
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
// NOTE: we purposely use last-tick displacement so relative motion is stable.
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
function _buildPosIndex(playerId) {
  const pos = new Map()
  Store.each(playerId, (eid, ent) => {
    pos.set(String(eid), {
      x: Number(ent?.pos?.x) || 0,
      y: Number(ent?.pos?.y) || 0,
      mapId: ent?.mapId,
      instanceId: ent?.instanceId,
      type: ent?.type,
      mobType: ent?.mobType || null,
      entityId: ent?.entityId || eid,
      state: ent?.state,
    })
  })
  return pos
}

// After we finish the tick, update LAST_POS with current store state
function _snapshotPositions(playerId) {
  const last = _sub(LAST_POS, playerId)
  last.clear()
  Store.each(playerId, (eid, ent) => {
    const x = Number(ent?.pos?.x) || 0
    const y = Number(ent?.pos?.y) || 0
    last.set(String(eid), { x, y })
  })
}

// ---------- main step ----------
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

    for (const entityId of ids) {
      const ent = Store.get(playerId, entityId)
      if (!ent) { sub.delete(entityId); continue }
      if (ent.state === "dead") { sub.delete(entityId); continue }

      const dir = sub.get(entityId) || { x: 0, y: 0 }
      if (dir.x === 0 && dir.y === 0) continue

      // Integrate
      const { prev, wish } = _integrate(ent, dir, dtSec)

      // Pre-clamp to bounds to avoid giant vectors
      const clampedWish = _clampToMap(ent, wish.x, wish.y)

      // Resolve with frozen snapshot (dynamic sweep uses posIndex + velIndex)
      const resolved = Collide.resolveWithSubsteps(
        playerId,
        posIndex.get(String(entityId)) || ent, // movingEnt meta for radius/mapId/instanceId
        prev,
        clampedWish,
        velIndex,
        posIndex
      )

      // Post clamp & commit
      const bounded = _clampToMap(ent, resolved.x, resolved.y)
      Store.setPos(playerId, entityId, bounded)
    }

    // Refresh LAST_POS snapshot at end of player tick
    _snapshotPositions(playerId)
  }
}

// start fixed tick
setInterval(() => {
  const now = Date.now()
  const dtMs = Math.max(1, now - _last)
  _last = now
  step(dtMs / 1000)
}, TICK_MS)

module.exports = {
  onMoveStart,
  onMoveStop,
  setDir,
  // exposed for tests
  _INTENTS: INTENTS,
  _step: step,
}
