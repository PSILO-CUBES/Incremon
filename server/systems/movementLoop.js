// server/systems/movementLoop.js
//
// Server-authoritative movement (fixed tick) with continuous collision vs MOVING entities,
// solving as swept AABB vs static AABBs from colliderRegistry.
//
// Public API:
//   onMoveStart(playerId, entityId, dir)
//   onMoveStop(playerId, entityId)
//   setDir(playerId, entityId, dir)
//
// Conventions: camelCase, no semicolons

const FSM = require("../systems/fsm")
const Store = require("../world/entityStore")
const Collide = require("./collision")
const ENEMIES = require("../defs/enemiesConfig")
const { DEFAULT_PLAYER_DATA } = require("../defs/playerDefaults")
const Colliders = require("../maps/colliderRegistry")
const { getMapInfo } = require("../maps/mapRegistry")

const TICK_MS = 50  // ~20Hz

const INTENTS = new Map()
const LAST_POS = new Map()

function _sub(root, key) {
  const k = String(key)
  let m = root.get(k)
  if (!m) {
    m = new Map()
    root.set(k, m)
  }
  return m
}

function _normDir(d) {
  let x = 0
  let y = 0
  if (d && typeof d.x === "number") x = d.x
  if (d && typeof d.y === "number") y = d.y
  const len = Math.hypot(x, y)
  if (len <= 0.000001) return { x: 0, y: 0 }
  const nx = x / len
  const ny = y / len
  if (Math.abs(nx) < 0.0001 && Math.abs(ny) < 0.0001) return { x: 0, y: 0 }
  return { x: nx, y: ny }
}

function _speedOf(ent) {
  if (!ent) return 0

  if (ent.type === "player") {
    const s = ent.stats || {}
    const spd = Number(s.spd)
    if (Number.isFinite(spd)) return spd
    const defSpd = Number(DEFAULT_PLAYER_DATA && DEFAULT_PLAYER_DATA.spd)
    if (Number.isFinite(defSpd)) return defSpd
    return 200
  }

  if (ent.type === "mob") {
    const s = ent.stats || {}
    const spd = Number(s.spd)
    if (Number.isFinite(spd)) return spd
    const def = ENEMIES ? ENEMIES[ent.mobType] : undefined
    const defSpd = Number(def && def.spd)
    if (Number.isFinite(defSpd)) return defSpd
    return 50
  }

  return 0
}

function _integrate(ent, dir, dtSec) {
  const spd = _speedOf(ent)
  const dx = dir.x * spd * dtSec
  const dy = dir.y * spd * dtSec
  let x0 = 0
  let y0 = 0
  if (ent && ent.pos && typeof ent.pos.x === "number") x0 = Number(ent.pos.x)
  if (ent && ent.pos && typeof ent.pos.y === "number") y0 = Number(ent.pos.y)
  return { prev: { x: x0, y: y0 }, wish: { x: x0 + dx, y: y0 + dy } }
}

// AABB clamp using half-extents hx, hy
function _clampToMap(ent, x, y) {
  const size = Collide.halfExtentsOf(ent)
  const hx = size.hx
  const hy = size.hy

  const eidStr = ent && ent.entityId ? String(ent.entityId) : ""
  const b = Colliders.getMapBounds(ent && ent.mapId ? ent.mapId : undefined)
  if (b && Number.isFinite(b.x) && Number.isFinite(b.w) && Number.isFinite(b.h)) {
    const minX = b.x + hx
    const minY = b.y + hy
    const maxX = b.x + b.w - hx
    const maxY = b.y + b.h - hy
    const nx = Math.min(Math.max(x, minX), maxX)
    const ny = Math.min(Math.max(y, minY), maxY)
    if (nx !== x || ny !== y) {
      console.log("[CLAMP] eid=" + eidStr + " from=(" + x + "," + y + ") to=(" + nx + "," + ny + ") hx=" + hx + " hy=" + hy)
    }
    return { x: nx, y: ny }
  }

  const info = getMapInfo(ent && ent.mapId ? ent.mapId : undefined)
  if (!info) return { x: x, y: y }

  const widthPx = Number(info.widthPx)
  const heightPx = Number(info.heightPx)
  if (Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0) {
    const minX = 0 + hx
    const minY = 0 + hy
    const maxX = widthPx - hx
    const maxY = heightPx - hy
    const nx = Math.min(Math.max(x, minX), maxX)
    const ny = Math.min(Math.max(y, minY), maxY)
    if (nx !== x || ny !== y) {
      console.log("[CLAMP] eid=" + eidStr + " from=(" + x + "," + y + ") to=(" + nx + "," + ny + ") hx=" + hx + " hy=" + hy)
    }
    return { x: nx, y: ny }
  }

  return { x: x, y: y }
}

function _buildVelocityIndex(playerId) {
  const vel = new Map()
  const last = _sub(LAST_POS, playerId)

  Store.each(playerId, (eid, ent) => {
    let x = 0
    let y = 0
    if (ent && ent.pos && typeof ent.pos.x === "number") x = Number(ent.pos.x)
    if (ent && ent.pos && typeof ent.pos.y === "number") y = Number(ent.pos.y)
    const key = String(eid)
    const prev = last.get(key) || { x: x, y: y }
    vel.set(key, { x: x - prev.x, y: y - prev.y })
  })

  return vel
}

// Snapshot includes collider half-extents for AABB sweep
function _buildPosIndex(playerId) {
  const pos = new Map()
  Store.each(playerId, (eid, ent) => {
    const key = String(eid)

    let x = 0
    let y = 0
    if (ent && ent.pos && typeof ent.pos.x === "number") x = Number(ent.pos.x)
    if (ent && ent.pos && typeof ent.pos.y === "number") y = Number(ent.pos.y)

    const he = Collide.halfExtentsOf(ent)

    let type = undefined
    if (ent && ent.type) type = ent.type

    let mobType = undefined
    if (ent && ent.mobType) mobType = ent.mobType

    let mapId = undefined
    if (ent && ent.mapId) mapId = ent.mapId

    let instanceId = undefined
    if (ent && ent.instanceId) instanceId = ent.instanceId

    let entityId = key
    if (ent && ent.entityId) entityId = ent.entityId

    pos.set(key, {
      x: x,
      y: y,
      hx: he.hx,
      hy: he.hy,
      type: type,
      mobType: mobType,
      mapId: mapId,
      instanceId: instanceId,
      entityId: entityId
    })
  })
  return pos
}

function _snapshotPositions(playerId) {
  const last = _sub(LAST_POS, playerId)
  Store.each(playerId, (eid, ent) => {
    let x = 0
    let y = 0
    if (ent && ent.pos && typeof ent.pos.x === "number") x = Number(ent.pos.x)
    if (ent && ent.pos && typeof ent.pos.y === "number") y = Number(ent.pos.y)
    last.set(String(eid), { x: x, y: y })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Movement API
// ─────────────────────────────────────────────────────────────────────────────

function onMoveStart(playerId, entityId, dir) {
  if (!playerId) return
  if (!entityId) return

  const ent = Store.get(playerId, entityId)
  if (!ent) return

  if (ent.state === "attack") {
    try {
      const AttackLoop = require("./attackLoop")
      if (ent.type === "player") {
        const nd = _normDir(dir)
        AttackLoop.queueMove(playerId, entityId, nd)
      }
    } catch (_e) {}
    return
  }

  const nd = _normDir(dir)
  _sub(INTENTS, playerId).set(String(entityId), nd)

  if (ent.state !== "walk") {
    FSM.apply(playerId, entityId, "moveIntentStart")
  }
}

function onMoveStop(playerId, entityId) {
  if (!playerId) return
  if (!entityId) return

  const ent = Store.get(playerId, entityId)
  if (!ent) return

  const sub = _sub(INTENTS, playerId)
  sub.delete(String(entityId))

  if (ent.state === "walk") {
    FSM.apply(playerId, entityId, "moveIntentStop")
  }
}

function setDir(playerId, entityId, dir) {
  if (!playerId) return
  if (!entityId) return
  const nd = _normDir(dir)
  const sub = _sub(INTENTS, playerId)
  sub.set(String(entityId), nd)
  const ent = Store.get(playerId, entityId)
  if (ent && ent.state !== "walk") {
    FSM.apply(playerId, entityId, "moveIntentStart")
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main step
// ─────────────────────────────────────────────────────────────────────────────

function step(dtSec) {
  const velIndexes = new Map()
  const posIndexes = new Map()
  for (const pid of INTENTS.keys()) {
    velIndexes.set(pid, _buildVelocityIndex(pid))
    posIndexes.set(pid, _buildPosIndex(pid))
  }

  for (const pair of INTENTS) {
    const playerId = pair[0]
    const sub = pair[1]

    const ids = Array.from(sub.keys())
    const velIndex = velIndexes.get(playerId) || new Map()
    const posIndex = posIndexes.get(playerId) || new Map()

    for (let i = 0; i < ids.length; i++) {
      const entityId = ids[i]
      const ent = Store.get(playerId, entityId)
      if (!ent) {
        sub.delete(entityId)
        continue
      }

      if (ent.state !== "walk") continue

      const dir = sub.get(entityId) || { x: 0, y: 0 }
      if (dir.x === 0 && dir.y === 0) continue

      const result = _integrate(ent, dir, dtSec)
      const prev = result.prev
      const wish = result.wish

      console.log("[MOVE pre] eid=" + entityId + " prev=(" + prev.x + "," + prev.y + ") wish=(" + wish.x + "," + wish.y + ")")

      const clampedWish = _clampToMap(ent, wish.x, wish.y)

      const movingMeta = posIndex.get(String(entityId))
      let resolved = null
      if (movingMeta) {
        resolved = Collide.resolveWithSubsteps(
          playerId,
          movingMeta,   // includes hx, hy, mapId
          prev,
          clampedWish,
          velIndex,
          posIndex
        )

        if (typeof movingMeta.hx === "number" && typeof movingMeta.hy === "number") {
          console.log("[MOVING META] eid=" + entityId + " mapId=" + String(movingMeta.mapId) + " hx=" + movingMeta.hx + " hy=" + movingMeta.hy)
        }
      } else {
        console.log("[WARN] no movingMeta for eid=" + entityId + " — using clampedWish directly")
        resolved = { x: clampedWish.x, y: clampedWish.y }
      }

      console.log("[MOVE res] eid=" + entityId + " resolved=(" + resolved.x + "," + resolved.y + ")")

      const deviatesX = Math.abs(resolved.x - wish.x) > 0.1
      const deviatesY = Math.abs(resolved.y - wish.y) > 0.1
      if (deviatesX || deviatesY) {
        const he = Collide.halfExtentsOf(ent)
        const mapId = ent && ent.mapId ? String(ent.mapId) : "unknown"
        console.log("[META] eid=" + entityId + " mapId=" + mapId + " hx=" + he.hx + " hy=" + he.hy)
        console.log("[COLLISION] eid=" + entityId + " wish=(" + wish.x + "," + wish.y + ") got=(" + resolved.x + "," + resolved.y + ")")
      }

      const bounded = _clampToMap(ent, resolved.x, resolved.y)

      Store.setPos(playerId, entityId, { x: bounded.x, y: bounded.y })
    }

    _snapshotPositions(playerId)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot loop
// ─────────────────────────────────────────────────────────────────────────────

let _last = Date.now()
setInterval(() => {
  const now = Date.now()
  let dtMs = now - _last
  if (dtMs < 1) dtMs = 1
  _last = now
  step(dtMs / 1000)
}, TICK_MS)

module.exports = {
  onMoveStart,
  onMoveStop,
  setDir,
  _INTENTS: INTENTS,
  _step: step
}
