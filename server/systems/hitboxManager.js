// server/systems/hitboxManager.js
//
// Server-authoritative hitboxes for both CONE swings and RECT front boxes.
// - Spawns enemy hitboxes automatically when a mob transitions into 'attack'
// - Hitbox shape + size come from enemiesConfig.attack.hitbox (inline or defKey)
// - Performs all detection on the server
// - Emits { event: 'entityHit', attackerId, targetId, hitboxKey, source:'server' }
//
// Exports:
//   start()
//   spawnSwing(ownerPlayerId, ownerEntity, defKey, baseAngleRad)   // for player existing logic
//   spawnBox(ownerPlayerId, ownerEntity, defKey, baseAngleRad)
//
// Conventions: camelCase, no semicolons.

const HITBOX_DEFS     = require('../defs/hitboxDefs')
const ENEMIES_CONFIG  = require('../defs/enemiesConfig')
const entityStore     = require('../world/entityStore')
const wsRegistry      = require('../wsRegistry')
const Bus             = require('../world/bus')
const Collision       = require('./collision')

const active = new Set() // currently alive hitboxes

function now() {
  return Date.now()
}

function clamp(v, lo, hi) {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function getOwnerPlayerEntity(playerId) {
  let out = null
  if (typeof entityStore.each === 'function') {
    entityStore.each(playerId, (_id, row) => {
      if (row && row.type === 'player') out = row
    })
  }
  return out
}

function applyHit(ownerPlayerId, attackerId, targetId, defKey) {
  const ws = wsRegistry.get(ownerPlayerId)
  if (!wsRegistry.isOpen(ws)) return
  wsRegistry.sendTo(ownerPlayerId, {
    event: 'entityHit',
    attackerId: attackerId,
    targetId: targetId,
    hitboxKey: defKey,
    source: 'server'
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Visualization hooks (optional; harmless if no client listener yet)
// ─────────────────────────────────────────────────────────────────────────────
function sendSpawnVizRect(ownerPlayerId, hb) {
  const ws = wsRegistry.get(ownerPlayerId)
  if (!wsRegistry.isOpen(ws)) return
  const elapsedAtSendMs = now() - hb.startMs
  wsRegistry.sendTo(ownerPlayerId, {
    event: 'hitboxSpawned',
    entityId: hb.ownerEntityId,
    shapeKey: hb.defKey,
    startMs: hb.startMs,
    elapsedAtSendMs: elapsedAtSendMs,
    durationMs: hb.durationMs,
    type: 'rect',
    widthPx: hb.widthPx,
    heightPx: hb.heightPx,
    offsetPx: hb.offsetPx,
    baseAngle: hb.baseAngle
  })
}

function sendSpawnVizCone(ownerPlayerId, hb) {
  const ws = wsRegistry.get(ownerPlayerId)
  if (!wsRegistry.isOpen(ws)) return
  const elapsedAtSendMs = now() - hb.startMs
  wsRegistry.sendTo(ownerPlayerId, {
    event: 'hitboxSpawned',
    entityId: hb.ownerEntityId,
    shapeKey: hb.defKey,
    startMs: hb.startMs,
    elapsedAtSendMs: elapsedAtSendMs,
    durationMs: hb.durationMs,
    type: 'cone',
    radiusPx: hb.radiusPx,
    arcDegrees: hb.arcDegrees,
    sweepDegrees: hb.sweepDegrees,
    baseAngle: hb.baseAngle
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry: circle vs oriented rectangle
// ─────────────────────────────────────────────────────────────────────────────
function circleIntersectsOrientedRect(cx, cy, r, rect) {
  const cos = Math.cos(rect.angle)
  const sin = Math.sin(rect.angle)

  const dx = cx - rect.cx
  const dy = cy - rect.cy

  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos

  const hx = rect.hw
  const hy = rect.hh

  const qx = clamp(lx, -hx, hx)
  const qy = clamp(ly, -hy, hy)

  const qdx = lx - qx
  const qdy = ly - qy
  const distSq = qdx * qdx + qdy * qdy
  return distSq <= r * r
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawners
// ─────────────────────────────────────────────────────────────────────────────
function spawnBox(ownerPlayerId, ownerEntity, defKey, baseAngleRad) {
  const def = HITBOX_DEFS[defKey]
  if (!def) return null
  if (def.type !== 'rect') return null

  const startMs = now()
  const hb = {
    kind: 'rect',
    defKey: defKey,
    ownerPlayerId: ownerPlayerId,
    ownerEntityId: ownerEntity.entityId,
    startMs: startMs,
    durationMs: Number(def.durationMs) || 200,
    expireAtMs: startMs + (Number(def.durationMs) || 200),
    tickMs: Number(def.tickMs) || 16,
    widthPx: Number(def.widthPx) || 48,
    heightPx: Number(def.heightPx) || 32,
    offsetPx: Number(def.offsetPx) || 16,
    baseAngle: Number(baseAngleRad) || 0,
    alreadyHit: new Set()
  }

  active.add(hb)
  sendSpawnVizRect(ownerPlayerId, hb)
  return hb
}

function spawnSwing(ownerPlayerId, ownerEntity, defKey, baseAngleRad) {
  const def = HITBOX_DEFS[defKey]
  if (!def) return null
  if (def.type !== 'cone') return null

  const startMs = now()
  const hb = {
    kind: 'cone',
    defKey: defKey,
    ownerPlayerId: ownerPlayerId,
    ownerEntityId: ownerEntity.entityId,
    startMs: startMs,
    durationMs: Number(def.durationMs) || 400,
    expireAtMs: startMs + (Number(def.durationMs) || 400),
    tickMs: Number(def.tickMs) || 16,
    radiusPx: Number(def.rangePx) || 96,
    arcDegrees: Number(def.arcDegrees) || 90,
    sweepDegrees: Number(def.sweepDegrees) || 120,
    baseAngle: Number(baseAngleRad) || 0,
    alreadyHit: new Set()
  }

  active.add(hb)
  sendSpawnVizCone(ownerPlayerId, hb)
  return hb
}

// ─────────────────────────────────────────────────────────────────────────────
// Steppers
// ─────────────────────────────────────────────────────────────────────────────
function stepRect(hb) {
  const attacker = entityStore.get(hb.ownerPlayerId, hb.ownerEntityId)
  if (!attacker) return 'remove'

  const angle = hb.baseAngle
  const forward = { x: Math.cos(angle), y: Math.sin(angle) }

  const cx = attacker.pos.x + forward.x * (hb.offsetPx + hb.heightPx * 0.5)
  const cy = attacker.pos.y + forward.y * (hb.offsetPx + hb.heightPx * 0.5)

  const rect = {
    cx: cx,
    cy: cy,
    angle: angle,
    hw: hb.widthPx * 0.5,
    hh: hb.heightPx * 0.5
  }

  const playerEnt = getOwnerPlayerEntity(hb.ownerPlayerId)
  if (!playerEnt) return

  const r = Collision.radiusOf(playerEnt)
  const hit = circleIntersectsOrientedRect(playerEnt.pos.x, playerEnt.pos.y, r, rect)
  if (!hit) return

  const key = String(playerEnt.entityId || 'player')
  if (hb.alreadyHit.has(key)) return

  hb.alreadyHit.add(key)
  applyHit(hb.ownerPlayerId, hb.ownerEntityId, key, hb.defKey)
}

function stepCone(hb) {
  const attacker = entityStore.get(hb.ownerPlayerId, hb.ownerEntityId)
  if (!attacker) return 'remove'

  const playerEnt = getOwnerPlayerEntity(hb.ownerPlayerId)
  if (!playerEnt) return

  const center = attacker.pos
  const radius = Number(hb.radiusPx) || 96
  const halfArcDeg = Number(hb.arcDegrees) || 90
  const base = hb.baseAngle

  const dx = playerEnt.pos.x - center.x
  const dy = playerEnt.pos.y - center.y
  const dist = Math.hypot(dx, dy)
  const maxR = radius + Collision.radiusOf(playerEnt)
  if (dist > maxR) return

  const angleTo = Math.atan2(dy, dx)
  let delta = normalizeAngle(angleTo - base)
  if (delta < 0) delta = -delta

  if (delta * 180 / Math.PI <= halfArcDeg * 0.5) {
    const key = String(playerEnt.entityId || 'player')
    if (!hb.alreadyHit.has(key)) {
      hb.alreadyHit.add(key)
      applyHit(hb.ownerPlayerId, hb.ownerEntityId, key, hb.defKey)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tick
// ─────────────────────────────────────────────────────────────────────────────
function step() {
  if (active.size === 0) return
  const t = now()
  const toRemove = []

  active.forEach(hb => {
    if (t >= hb.expireAtMs) {
      toRemove.push(hb)
      return
    }
    if (hb.kind === 'rect') stepRect(hb)
    if (hb.kind === 'cone') stepCone(hb)
  })

  for (let i = 0; i < toRemove.length; i++) active.delete(toRemove[i])
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy integration: spawn hitbox when mob enters 'attack'
// ─────────────────────────────────────────────────────────────────────────────
function resolveEnemyHitboxDefKey(entity) {
  let defKey = 'enemy_front_box_basic'
  if (!entity || !entity.mobType) return defKey

  const cfg = ENEMIES_CONFIG[entity.mobType]
  if (!cfg) return defKey

  const attack = cfg.attack
  if (!attack) return defKey
  const hb = attack.hitbox
  if (!hb) return defKey

  if (hb.defKey && HITBOX_DEFS[hb.defKey]) {
    return hb.defKey
  }

  // Inline definition path: we place a temp def in-memory under a synthetic key
  // so downstream code stays consistent with spawnBox/spawnSwing APIs.
  if (hb.type === 'rect') {
    const key = `__inline_rect_${entity.mobType}`
    HITBOX_DEFS[key] = {
      type: 'rect',
      widthPx: Number(hb.widthPx) || 48,
      heightPx: Number(hb.heightPx) || 32,
      offsetPx: Number(hb.offsetPx) || 16,
      durationMs: Number(hb.durationMs) || 300,
      tickMs: Number(hb.tickMs) || 16
    }
    return key
  }

  if (hb.type === 'cone') {
    const key = `__inline_cone_${entity.mobType}`
    HITBOX_DEFS[key] = {
      type: 'cone',
      rangePx: Number(hb.rangePx) || 96,
      arcDegrees: Number(hb.arcDegrees) || 90,
      sweepDegrees: Number(hb.sweepDegrees) || 120,
      durationMs: Number(hb.durationMs) || 400,
      tickMs: Number(hb.tickMs) || 16
    }
    return key
  }

  return defKey
}

function start() {
  // fixed tick for all hitboxes
  setInterval(step, 16)

  // when any entity changes to 'attack', spawn an attack hitbox for mobs
  Bus.on('entity:stateChanged', (evt) => {
    if (!evt) return
    if (evt.to !== 'attack') return

    const entity = evt.entity
    if (!entity) return
    if (entity.type !== 'mob') return

    const playerId = evt.playerId
    const playerEnt = getOwnerPlayerEntity(playerId)
    if (!playerEnt) return

    const dx = Number(playerEnt.pos.x) - Number(entity.pos.x)
    const dy = Number(playerEnt.pos.y) - Number(entity.pos.y)
    const baseAngle = Math.atan2(dy, dx)

    const defKey = resolveEnemyHitboxDefKey(entity)
    const def = HITBOX_DEFS[defKey]
    if (!def) return

    if (def.type === 'rect') {
      spawnBox(playerId, entity, defKey, baseAngle)
      return
    }

    if (def.type === 'cone') {
      spawnSwing(playerId, entity, defKey, baseAngle)
      return
    }
  })
}

module.exports = { start, spawnSwing, spawnBox }
