// server/systems/hitboxManager.js
//
// Server-authoritative hitboxes for both CONE swings and RECT boxes.
// - Time-stepped at fixed 16 ms
// - All detection happens on the server
// - Emission is per-owner player (per-player instanced world)
//
// Exposes:
//   start()
//   spawnSwing(ownerPlayerId, ownerEntity, defKey, baseAngleRad)
//   spawnBox(ownerPlayerId, ownerEntity, defKey, baseAngleRad)
//
// Conventions: camelCase, no semicolons.

const HITBOX_DEFS  = require('../defs/hitboxDefs')
const entityStore  = require('../world/entityStore')
const wsRegistry   = require('../wsRegistry')
const Collide      = require('./collision')
const Bus          = require('../world/bus')

const active = new Set() // of hitbox objects

function now() { return Date.now() }
function deg2rad(d) { return d * Math.PI / 180 }

function clamp(v, lo, hi) {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function normDir(dir) {
  const x = Number(dir?.x) || 0
  const y = Number(dir?.y) || 0
  const len = Math.hypot(x, y)
  if (len <= 1e-6) return { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}

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

function _stepRect(hb) {
  const store = entityStore
  const attacker = store.get(hb.ownerPlayerId, hb.ownerEntityId)
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

  let hitPlayerId = null
  let hitPlayerEnt = null

  if (typeof store.each === 'function') {
    store.each(hb.ownerPlayerId, (id, row) => {
      if (row && row.type === 'player') {
        hitPlayerId = id
        hitPlayerEnt = row
      }
    })
  } else {
    const row = store.get(hb.ownerPlayerId, 'player')
    if (row) {
      hitPlayerId = 'player'
      hitPlayerEnt = row
    }
  }

  if (!hitPlayerEnt) return

  const r = Collide.radiusOf(hitPlayerEnt)
  const intersects = circleIntersectsOrientedRect(hitPlayerEnt.pos.x, hitPlayerEnt.pos.y, r, rect)

  if (intersects) {
    const key = String(hitPlayerId)
    if (!hb.alreadyHit.has(key)) {
      hb.alreadyHit.add(key)
      applyHit(hb.ownerPlayerId, hb.ownerEntityId, hitPlayerId, hb.defKey)
    }
  }
}

function _stepCone(hb) {
  const store = entityStore
  const attacker = store.get(hb.ownerPlayerId, hb.ownerEntityId)
  if (!attacker) return 'remove'

  let hitPlayerEnt = null
  if (typeof store.each === 'function') {
    store.each(hb.ownerPlayerId, (_id, row) => {
      if (row && row.type === 'player') hitPlayerEnt = row
    })
  }

  if (!hitPlayerEnt) return

  const center = attacker.pos
  const radius = Number(hb.radiusPx) || 96
  const halfArc = (Number(hb.arcDegrees) || 90) * 0.5
  const base = hb.baseAngle

  const dx = hitPlayerEnt.pos.x - center.x
  const dy = hitPlayerEnt.pos.y - center.y
  const dist = Math.hypot(dx, dy)
  if (dist > radius + Collide.radiusOf(hitPlayerEnt)) return

  const angleTo = Math.atan2(dy, dx)
  let delta = angleTo - base
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2

  if (Math.abs(delta) * 180 / Math.PI <= halfArc) {
    const key = String(hitPlayerEnt.entityId || 'player')
    if (!hb.alreadyHit.has(key)) {
      hb.alreadyHit.add(key)
      applyHit(hb.ownerPlayerId, hb.ownerEntityId, hitPlayerEnt.entityId || 'player', hb.defKey)
    }
  }
}

function step() {
  if (active.size === 0) return
  const t = now()
  const toDrop = []

  active.forEach(hb => {
    if (t >= hb.expireAtMs) {
      toDrop.push(hb)
      return
    }
    if (hb.kind === 'rect') _stepRect(hb)
    if (hb.kind === 'cone') _stepCone(hb)
  })

  for (let i = 0; i < toDrop.length; i++) active.delete(toDrop[i])
}

let timer = null
function start() {
  if (timer) return

  Bus.on('entity:stateChanged', (evt) => {
    if (!evt) return
    if (evt.to !== 'attack') return
    const entity = evt.entity
    if (!entity || entity.type !== 'mob') return

    const playerId = evt.playerId
    let playerRow = null
    if (typeof entityStore.each === 'function') {
      entityStore.each(playerId, (_id, row) => {
        if (row && row.type === 'player') playerRow = row
      })
    }
    if (!playerRow) return

    const dx = Number(playerRow.pos.x) - Number(entity.pos.x)
    const dy = Number(playerRow.pos.y) - Number(entity.pos.y)
    const baseAngle = Math.atan2(dy, dx)

    let defKey = 'enemy_front_box_basic'
    try {
      const ENEMIES_CONFIG = require('../defs/enemiesConfig')
      if (entity.mobType && ENEMIES_CONFIG[entity.mobType] && ENEMIES_CONFIG[entity.mobType].hitboxDefKey) {
        defKey = ENEMIES_CONFIG[entity.mobType].hitboxDefKey
      }
    } catch (e) {}

    spawnBox(playerId, entity, defKey, baseAngle)
  })

  timer = setInterval(step, 16)
}

module.exports = { start, spawnSwing, spawnBox }
