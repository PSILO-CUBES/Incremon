// server/systems/hitboxManager.js
//
// Authoritative hitboxes. Visuals restored to 'hitboxSpawned' event.
// No dependency on hitboxDefs.js; we keep an internal HITBOX_DEFS map
// seeded from playerDefaults/enemiesConfig and generate per-mob inline keys.
//
// Conventions: camelCase, no semicolons, no ternaries.

const ENEMIES_CONFIG   = require('../defs/enemiesConfig')
const PLAYER_DEFAULTS  = require('../defs/playerDefaults')
const entityStore      = require('../world/entityStore')
const wsRegistry       = require('../wsRegistry')
const Bus              = require('../world/bus')
const Collision        = require('./collision')
const Despawn          = require('../world/despawn')

const HITBOX_DEFS = {}
const active = new Set()

function now() { return Date.now() }

function seedStaticDefs() {
  try {
    const atk = PLAYER_DEFAULTS && PLAYER_DEFAULTS.DEFAULT_PLAYER_ATTACKS
      ? PLAYER_DEFAULTS.DEFAULT_PLAYER_ATTACKS.basicSwing
      : null
    const hb = atk && atk.hitbox ? atk.hitbox : null
    if (hb) {
      HITBOX_DEFS.player_basic_swing = {
        type: 'cone',
        rangePx: Number(hb.rangePx) || 128,
        arcDegrees: Number(hb.arcDegrees) || 100,
        sweepDegrees: Number(hb.sweepDegrees) || 140,
        durationMs: Number(hb.durationMs) || 400,
        tickMs: Number(hb.tickMs) || 16
      }
    }
  } catch (_e) {}

  let rectSeed = null
  try {
    if (ENEMIES_CONFIG && ENEMIES_CONFIG.shared && ENEMIES_CONFIG.shared.enemy_front_box_basic) {
      rectSeed = ENEMIES_CONFIG.shared.enemy_front_box_basic
    }
  } catch (_e) {}

  if (!rectSeed) {
    rectSeed = {
      type: 'rect',
      widthPx: 48,
      heightPx: 32,
      offsetPx: 16,
      durationMs: 300,
      tickMs: 16
    }
  }

  HITBOX_DEFS.enemy_front_box_basic = {
    type: 'rect',
    widthPx: Number(rectSeed.widthPx) || 48,
    heightPx: Number(rectSeed.heightPx) || 32,
    offsetPx: Number(rectSeed.offsetPx) || 16,
    durationMs: Number(rectSeed.durationMs) || 300,
    tickMs: Number(rectSeed.tickMs) || 16
  }
}

seedStaticDefs()

function isPlayerRow(row) { return row && row.type === 'player' }
function isMobRow(row)    { return row && row.type === 'mob' }

function getOwnerPlayerEntity(playerId) {
  let out = null
  if (typeof entityStore.each === 'function') {
    entityStore.each(playerId, (id, row) => {
      if (row) {
        if (row.type === 'player') out = row
      }
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
// Visuals (unchanged event contract): 'hitboxSpawned'
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
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────
function orientedRectCorners(cx, cy, width, height, offset, baseAngle) {
  const hw = width * 0.5
  const hh = height * 0.5
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
  const abLenSq = abx * abx + aby * aby
  if (abLenSq <= 0) return { x: ax, y: ay }
  const apx = px - ax
  const apy = py - ay
  let t = (apx * abx + apy * aby) / abLenSq
  if (t < 0) t = 0
  if (t > 1) t = 1
  return { x: ax + abx * t, y: ay + aby * t }
}

function circleIntersectsOrientedRect(cx, cy, r, rectCorners) {
  if (r <= 0) return false
  const inside = pointInOrientedRect(cx, cy, rectCorners)
  if (inside) return true

  let minDist = Infinity
  for (let j = 0; j < 4; j++) {
    const a = rectCorners[j]
    const b = rectCorners[(j + 1) % 4]
    const cp = closestPointOnSegment(cx, cy, a.x, a.y, b.x, b.y)
    const d = Math.hypot(cx - cp.x, cy - cp.y)
    if (d < minDist) minDist = d
  }
  return minDist <= r
}

function pointInOrientedRect(px, py, corners) {
  const a = corners[0]
  const b = corners[1]
  const d = corners[3]

  const abx = b.x - a.x
  const aby = b.y - a.y
  const adx = d.x - a.x
  const ady = d.y - a.y

  const apx = px - a.x
  const apy = py - a.y

  const dotAB = apx * abx + apy * aby
  const dotAD = apx * adx + apy * ady
  const abLenSq = abx * abx + aby * aby
  const adLenSq = adx * adx + ady * ady

  if (dotAB < 0) return false
  if (dotAB > abLenSq) return false
  if (dotAD < 0) return false
  if (dotAD > adLenSq) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawners (keep defKey API so visuals payload has shapeKey)
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

  const cx = Number(attacker.pos.x) || 0
  const cy = Number(attacker.pos.y) || 0

  const sweepRad = (Number(hb.sweepDegrees) || 120) * Math.PI / 180
  const arcRad   = (Number(hb.arcDegrees) || 90)    * Math.PI / 180
  const halfArcRad = arcRad * 0.5

  const u = Math.min(1, Math.max(0, (now() - hb.startMs) / Math.max(1, hb.durationMs)))
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
    if (dist > (Number(HITBOX_DEFS[hb.defKey]?.rangePx) || hb.radiusPx)) {
      if (dist > hb.radiusPx) continue
    }

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
  const nowMs = now()
  const toRemove = []
  active.forEach((hb) => {
    if (!hb) return
    if (hb.expireAtMs <= nowMs) {
      toRemove.push(hb)
      return
    }

    if (hb.kind === 'rect') stepRect(hb)
    if (hb.kind === 'cone') stepCone(hb)
  })
  for (let i = 0; i < toRemove.length; i++) active.delete(toRemove[i])
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy hitbox resolution → defKey (keeps visuals contract intact)
// ─────────────────────────────────────────────────────────────────────────────
function resolveEnemyHitboxDefKey(entity) {
  let defKey = 'enemy_front_box_basic'
  if (!entity) return defKey
  if (!entity.mobType) return defKey

  const cfg = ENEMIES_CONFIG[entity.mobType]
  if (!cfg) return defKey

  const attack = cfg.attack
  if (!attack) return defKey
  const hb = attack.hitbox
  if (!hb) return defKey

  if (hb.defKey && HITBOX_DEFS[hb.defKey]) {
    return hb.defKey
  }

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

const pendingAttackTimers = new WeakMap()

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

    if (pendingAttackTimers.has(entity)) {
      clearTimeout(pendingAttackTimers.get(entity))
      pendingAttackTimers.delete(entity)
    }

    const attackDelayMs = 250

    const timeout = setTimeout(() => {
      if (def.type === 'rect') {
        spawnBox(playerId, entity, defKey, baseAngle)
        return
      }
      if (def.type === 'cone') {
        spawnSwing(playerId, entity, defKey, baseAngle)
        return
      }
    }, attackDelayMs)

    pendingAttackTimers.set(entity, timeout)
  })

  Bus.on('entity:stateChanged', (evt) => {
    if (!evt) return
    const entity = evt.entity
    if (!entity) return
    if (evt.to === 'attack') return
    const t = pendingAttackTimers.get(entity)
    if (t) {
      clearTimeout(t)
      pendingAttackTimers.delete(entity)
    }
  })
}

function applyHit(ownerPlayerId, attackerId, targetId, hitboxKey) {
  function finiteNumber(v, fb) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    return fb
  }

  function clamp(n, lo, hi) {
    let x = n
    if (x < lo) x = lo
    if (x > hi) x = hi
    return x
  }

  wsRegistry.sendTo(ownerPlayerId, {
    event: 'entityHit',
    attackerId: attackerId,
    targetId: targetId,
    hitboxKey: hitboxKey,
    source: 'server'
  })

  const attacker = entityStore.get(ownerPlayerId, attackerId)
  const target = entityStore.get(ownerPlayerId, targetId)
  if (!attacker) return
  if (!target) return

  const aStats = attacker.stats || {}
  const tStats = target.stats || {}
  const targetType = String(target.type || '')

  const atkMulti = 1

  if (targetType === 'mob') {
    const maxHpNow = finiteNumber(tStats.maxHp, finiteNumber(tStats.hp, 1))
    const hpNow = clamp(finiteNumber(tStats.hp, maxHpNow), 0, maxHpNow)
    const dmg = finiteNumber(aStats.atk, 1) * atkMulti

    let nextHp = hpNow - dmg
    if (nextHp < 0) nextHp = 0
    if (nextHp > maxHpNow) nextHp = maxHpNow

    tStats.hp = nextHp
    target.stats = tStats

    if (nextHp <= 0) {
      const Despawn = require('../world/despawn')
      try {
        Despawn.despawn(ownerPlayerId, targetId, 'killed')
      } catch (_e) {}
      return
    }

    wsRegistry.sendTo(ownerPlayerId, {
      event: 'entityStatsUpdate',
      entityId: targetId,
      stats: { hp: nextHp, maxHp: maxHpNow }
    })
    return
  }

  if (targetType === 'player') {
    const maxHp = finiteNumber(tStats.maxHp, finiteNumber(tStats.hp, 10))
    const hp = clamp(finiteNumber(tStats.hp, maxHp), 0, maxHp)
    const dmgP = finiteNumber(aStats.atk, 1)

    let nextHpP = hp - dmgP
    if (nextHpP < 0) nextHpP = 0
    if (nextHpP > maxHp) nextHpP = maxHp

    tStats.hp = nextHpP
    target.stats = tStats

    const ws = wsRegistry.get(ownerPlayerId)
    if (!wsRegistry.isOpen(ws)) return

    wsRegistry.sendTo(ownerPlayerId, {
      event: 'statsUpdate',
      stats: { hp: nextHpP }
    })
    return
  }
}

module.exports = { start, spawnSwing, spawnBox }
