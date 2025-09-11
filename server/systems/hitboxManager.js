// server/systems/hitboxManager.js
//
// Server-authoritative hitboxes for both CONE swings and RECT front boxes.
// - Enemy hitboxes are driven by enemiesConfig[<mob>].attack.hitbox (inline or defKey)
// - Player swings remain cone
// - All detection runs on the server
//
// Conventions: camelCase, no semicolons.

const HITBOX_DEFS     = require('../defs/hitboxDefs')
const ENEMIES_CONFIG  = require('../defs/enemiesConfig')
const entityStore     = require('../world/entityStore')
const wsRegistry      = require('../wsRegistry')
const Bus             = require('../world/bus')
const Collision       = require('./collision') // we still use radiusOf(), etc.

const active = new Set()

function now() { return Date.now() }

function isPlayerRow(row) { return row && row.type === 'player' }
function isMobRow(row)    { return row && row.type === 'mob' }

function getOwnerPlayerEntity(playerId) {
  let out = null
  if (typeof entityStore.each === 'function') {
    entityStore.each(playerId, (_id, row) => {
      if (row && row.type === 'player') out = row
    })
  }
  return out
}

function getRow(playerId, entityId) {
  return entityStore.get(playerId, entityId)
}

function listTargetsFor(hb) {
  const out = []
  const attacker = getRow(hb.ownerPlayerId, hb.ownerEntityId)
  if (!attacker) return out

  const ownerIsPlayer = isPlayerRow(attacker)
  const ownerIsMob    = isMobRow(attacker)

  if (ownerIsMob) {
    const playerEnt = getOwnerPlayerEntity(hb.ownerPlayerId)
    if (playerEnt) out.push({ id: String(playerEnt.entityId || 'player'), row: playerEnt })
    return out
  }

  if (ownerIsPlayer) {
    if (typeof entityStore.each === 'function') {
      entityStore.each(hb.ownerPlayerId, (id, row) => {
        if (!row) return
        if (row.type !== 'mob') return
        if (row.mapId !== attacker.mapId) return
        if (row.instanceId !== attacker.instanceId) return
        out.push({ id: String(id), row })
      })
    }
    return out
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Client visualization messages
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
// Geometry helpers (local; no external dep)
// ─────────────────────────────────────────────────────────────────────────────
function orientedRectCorners(cx, cy, width, height, offset, baseAngle) {
  const hw = width * 0.5
  const hh = height * 0.5
  // place rect center forward along facing
  const ox = Math.cos(baseAngle) * (offset + hw)
  const oy = Math.sin(baseAngle) * (offset + hw)

  const corners = [
    { x: -hw, y: -hh },
    { x:  hw, y: -hh },
    { x:  hw, y:  hh },
    { x: -hw, y:  hh }
  ]

  const cosA = Math.cos(baseAngle)
  const sinA = Math.sin(baseAngle)

  const out = []
  for (let i = 0; i < 4; i++) {
    const px = corners[i].x
    const py = corners[i].y
    const rx = px * cosA - py * sinA
    const ry = px * sinA + py * cosA
    out.push({ x: cx + ox + rx, y: cy + oy + ry })
  }
  return out
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0
  return [ax + abx * t, ay + aby * t]
}

function pointInPolygon(px, py, verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y
    const xj = verts[j].x, yj = verts[j].y
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// Returns true on intersection
function circleIntersectsOrientedRect(cx, cy, cr, rectVerts) {
  if (!Array.isArray(rectVerts) || rectVerts.length !== 4) return false

  // If circle center is inside polygon → intersect
  if (pointInPolygon(cx, cy, rectVerts)) return true

  // Otherwise, check distance to each edge against radius
  let minDist2 = Infinity
  for (let i = 0; i < 4; i++) {
    const a = rectVerts[i]
    const b = rectVerts[(i + 1) % 4]
    const [qx, qy] = closestPointOnSegment(cx, cy, a.x, a.y, b.x, b.y)
    const dx = cx - qx
    const dy = cy - qy
    const d2 = dx * dx + dy * dy
    if (d2 < minDist2) minDist2 = d2
  }
  return minDist2 <= cr * cr
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
  const attacker = getRow(hb.ownerPlayerId, hb.ownerEntityId)
  if (!attacker) return 'remove'

  const cx = Number(attacker.pos.x) || 0
  const cy = Number(attacker.pos.y) || 0

  const rect = orientedRectCorners(
    cx,
    cy,
    hb.widthPx,
    hb.heightPx,
    hb.offsetPx,
    hb.baseAngle
  )

  const candidates = listTargetsFor(hb)
  if (candidates.length === 0) return

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const row = c.row
    if (!row || !row.pos) continue

    const key = String(c.id)
    if (hb.alreadyHit.has(key)) continue

    const r = Collision.radiusOf(row)
    const hit = circleIntersectsOrientedRect(row.pos.x, row.pos.y, r, rect)
    if (!hit) continue

    hb.alreadyHit.add(key)
    applyHit(hb.ownerPlayerId, hb.ownerEntityId, key, hb.defKey)
  }
}

function stepCone(hb) {
  const attacker = getRow(hb.ownerPlayerId, hb.ownerEntityId)
  if (!attacker) return 'remove'

  const cx = Number(attacker.pos && attacker.pos.x) || 0
  const cy = Number(attacker.pos && attacker.pos.y) || 0

  const radius = Number(hb.radiusPx) || 96

  const arcDegVal = Number(hb.arcDegrees)
  const halfArcRad = ((Number.isFinite(arcDegVal) ? arcDegVal : 90) * 0.5) * Math.PI / 180

  const sweepRad = (Number(hb.sweepDegrees) || 0) * Math.PI / 180
  const dur = Math.max(1, Number(hb.durationMs) || 400)
  const tNow = now()
  const u = Math.max(0, Math.min(1, (tNow - hb.startMs) / dur))

  const startAngle = Number(hb.baseAngle) - sweepRad * 0.5
  const currentAngle = startAngle + sweepRad * u

  const candidates = listTargetsFor(hb)
  if (!candidates || candidates.length === 0) return

  const edgeGracePx = 1

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const row = c && c.row ? c.row : null
    if (!row || !row.pos) continue

    const key = String(c.id)
    if (hb.alreadyHit.has(key)) continue

    const dx = Number(row.pos.x) - cx
    const dy = Number(row.pos.y) - cy
    const dist = Math.hypot(dx, dy)
    if (dist > (radius - edgeGracePx)) continue

    const ang = Math.atan2(dy, dx)
    let da = ang - currentAngle
    while (da > Math.PI) da -= Math.PI * 2
    while (da < -Math.PI) da += Math.PI * 2
    if (Math.abs(da) > halfArcRad) continue

    hb.alreadyHit.add(key)
    applyHit(hb.ownerPlayerId, hb.ownerEntityId, key, hb.defKey)
  }
}

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
// Enemy integration: spawn on state change
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

  // Inline per-mob hitbox (relative to attack.hitbox{})
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
  setInterval(step, 16)

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

function applyHit(ownerPlayerId, attackerId, targetId, hitboxKey) {
  wsRegistry.sendTo(ownerPlayerId, {
    event: 'entityHit',
    attackerId,
    targetId,
    hitboxKey,
    source: 'server'
  })
}

module.exports = { start, spawnSwing, spawnBox }
