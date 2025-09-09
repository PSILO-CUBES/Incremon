// server/systems/hitboxManager.js
// Server-authoritative, time-stepped hitbox updates for cone swings.
// Chooses clockwise vs counterclockwise per swing, and exposes spawn data.

const HITBOX_DEFS = require('../defs/hitboxDefs')
const entityStore = require('../world/entityStore')

const TICK_MS = 16
const active = new Set()

const deg2rad = d => d * Math.PI / 180
const now = () => Date.now()

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a <= -Math.PI) a += Math.PI * 2
  return a
}

function angleBetween(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function dist2(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function entityRadius(e) {
  if (typeof e.collisionRadius === 'number') return e.collisionRadius
  if (e.stats && typeof e.stats.collisionRadius === 'number') return e.stats.collisionRadius
  return 12
}

function isInsideSector({ center, target, centerAngle, arcRad, radiusPx, targetRadiusPx }) {
  const d2 = dist2(center, target)
  const maxR = radiusPx + targetRadiusPx
  if (d2 > maxR * maxR) return false
  const a = angleBetween(center, target)
  const delta = Math.abs(normalizeAngle(a - centerAngle))
  return delta <= arcRad * 0.5
}

function chooseClockwise(owner, baseAngle) {
  const ax = Math.cos(baseAngle)
  const ay = Math.sin(baseAngle)

  if (typeof owner.lastFacingAngle === 'number') {
    const fx = Math.cos(owner.lastFacingAngle)
    const fy = Math.sin(owner.lastFacingAngle)
    const cross = fx * ay - fy * ax
    return cross < 0
  }

  if (owner.moveDir && (owner.moveDir.x || owner.moveDir.y)) {
    const len = Math.hypot(owner.moveDir.x, owner.moveDir.y)
    if (len > 0) {
      const fx = owner.moveDir.x / len
      const fy = owner.moveDir.y / len
      const cross = fx * ay - fy * ax
      return cross < 0
    }
  }

  return false
}

function spawnSwing({ ownerEntity, aimAt, shapeKey }) {
  const def = HITBOX_DEFS[shapeKey]
  if (!def) return null
  if (!ownerEntity) return null
  if (!ownerEntity.entityId) return null
  if (!ownerEntity.ownerId) return null

  const startMs = now()
  const endMs = startMs + def.durationMs

  const baseAngle = angleBetween(ownerEntity.pos, aimAt)
  const swingRad = deg2rad(def.sweepDegrees)   // keep your existing defs; do not change keys here
  const arcRad = deg2rad(def.arcDegrees)
  const clockwise = chooseClockwise(ownerEntity, baseAngle)

  let startAngle = baseAngle
  if (clockwise) {
    startAngle = baseAngle + swingRad * 0.5
  } else {
    startAngle = baseAngle - swingRad * 0.5
  }

  ownerEntity.lastFacingAngle = baseAngle

  const hb = {
    ownerId: ownerEntity.entityId,        // entity id (store key)
    ownerPlayerId: ownerEntity.ownerId,   // player id (store owner)
    instanceId: ownerEntity.instanceId,
    shapeKey,
    startMs,
    endMs,
    startAngle,
    swingRad,
    arcRad,
    radiusPx: (typeof def.rangePx === 'number' ? def.rangePx : (typeof def.radiusPx === 'number' ? def.radiusPx : 80)),
    hitSet: new Set(),
    clockwise,
    baseAngle
  }

  active.add(hb)
  return hb
}

function step() {
  const t = now()
  const toRemove = []

  for (const hb of active) {
    if (t >= hb.endMs) {
      toRemove.push(hb)
      continue
    }

    const owner = entityStore.get(hb.ownerPlayerId, hb.ownerId)
    if (!owner) {
      toRemove.push(hb)
      continue
    }

    const u = (t - hb.startMs) / (hb.endMs - hb.startMs)

    let centerAngle = hb.startAngle
    if (hb.clockwise) {
      centerAngle = hb.startAngle - hb.swingRad * u
    } else {
      centerAngle = hb.startAngle + hb.swingRad * u
    }

    // iterate only this player's store
    entityStore.each(hb.ownerPlayerId, (_id, e) => {
      if (!e) return
      if (e.entityId === hb.ownerId) return
      if (e.instanceId !== hb.instanceId) return
      if (hb.hitSet.has(e.entityId)) return

      const ok = isInsideSector({
        center: owner.pos,
        target: e.pos,
        centerAngle,
        arcRad: hb.arcRad,
        radiusPx: hb.radiusPx,
        targetRadiusPx: entityRadius(e)
      })
  
      if (ok) {
        hb.hitSet.add(e.entityId)
        console.log(`[hitbox] ${hb.shapeKey} (cw=${hb.clockwise}) owner=${hb.ownerId} hit target=${e.entityId}`)
      }
    })
  }

  for (const hb of toRemove) active.delete(hb)
}

let interval = null
function start() {
  if (interval) return
  interval = setInterval(step, TICK_MS)
}

module.exports = { start, spawnSwing }
