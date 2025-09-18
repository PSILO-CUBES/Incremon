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

const HITBOX_DEFS = Object.create(null)

const active = new Set()

function now() {
  return Date.now()
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed static defs from configs so we don’t hardcode sizes in multiple places
// ────────────────────────────────────────
function seedStaticDefs() {
  let swingSeed = null
  try {
    const def = PLAYER_DEFAULTS && PLAYER_DEFAULTS.DEFAULT_PLAYER_ATTACKS
      ? PLAYER_DEFAULTS.DEFAULT_PLAYER_ATTACKS.basicSwing
      : null
    if (def && def.hitbox) swingSeed = def.hitbox
  } catch (_e) {}

  if (!swingSeed) swingSeed = {
    type: 'cone',
    rangePx: 96,
    arcDegrees: 90,
    sweepDegrees: 120,
    durationMs: 400,
    tickMs: 16
  }

  HITBOX_DEFS.player_basic_swing = {
    type: 'cone',
    rangePx: Number(swingSeed.rangePx) || 96,
    arcDegrees: Number(swingSeed.arcDegrees) || 90,
    sweepDegrees: Number(swingSeed.sweepDegrees) || 120,
    durationMs: Number(swingSeed.durationMs) || 400,
    tickMs: Number(swingSeed.tickMs) || 16
  }

  let rectSeed = null
  try {
    const e0 = ENEMIES_CONFIG && ENEMIES_CONFIG.slime
      ? ENEMIES_CONFIG.slime
      : null
    if (e0 && e0.attack && e0.attack.hitbox) rectSeed = e0.attack.hitbox
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

// ──────────────────────────────────────
// Store helpers
// ──────────────────────────────────────
function isPlayerRow(row) {
  return row && row.type === 'player'
}

function isMobRow(row) {
  return row && row.type === 'mob'
}

function getOwnerPlayerEntity(playerId) {
  let out = null
  if (typeof entityStore.each === 'function') {
    entityStore.each(playerId, (_id, row) => {
      if (row) {
        if (row.type === 'player') out = row
      }
    })
  }
  return out
}

function getRow(playerId, id) {
  if (!playerId) return null
  return entityStore.get(playerId, id)
}

// ──────────────────────────────────────
// Candidate listing (same as before)
// ─────────────────────────────────────────────────────────────────────────────
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
        if (row.state === 'despawn' || row.state === 'dead') return
        if (id === hb.ownerEntityId) return
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

  const elapsedAtSendMs = Date.now() - hb.startMs

  const payload = {
    event: 'hitboxSpawned',
    entityId: hb.ownerEntityId,
    startMs: hb.startMs,
    elapsedAtSendMs: elapsedAtSendMs,
    durationMs: hb.durationMs,
    shapeType: 'rect',
    widthPx: hb.widthPx,
    heightPx: hb.heightPx,
    offsetPx: hb.offsetPx,
    baseAngle: hb.baseAngle
  }

  wsRegistry.sendTo(ownerPlayerId, payload)
}


function sendSpawnVizCone(ownerPlayerId, hb) {
  const ws = wsRegistry.get(ownerPlayerId)
  if (!wsRegistry.isOpen(ws)) return

  const elapsedAtSendMs = Date.now() - hb.startMs

  const payload = {
    event: 'hitboxSpawned',
    entityId: hb.ownerEntityId,
    startMs: hb.startMs,
    elapsedAtSendMs: elapsedAtSendMs,
    durationMs: hb.durationMs,
    shapeType: 'cone',
    radiusPx: hb.radiusPx,
    arcDegrees: hb.arcDegrees,
    sweepDegrees: hb.sweepDegrees,
    baseAngle: hb.baseAngle
  }

  wsRegistry.sendTo(ownerPlayerId, payload)
}


// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers (rect + cone intersection against circle targets)
// ─────────────────────────────────────────────────────────────────────────────
function buildRectCorners(cx, cy, w, h, ox, baseAngle) {
  const halfW = w * 0.5
  const halfH = h * 0.5
  const cosA = Math.cos(baseAngle)
  const sinA = Math.sin(baseAngle)

  // forward (facing) offset rotated by baseAngle
  const cxOff = cx + cosA * ox
  const cyOff = cy + sinA * ox

  // local rect corners (x = forward, y = right)
  const local = [
    { x:  halfW, y:  halfH },
    { x: -halfW, y:  halfH },
    { x: -halfW, y: -halfH },
    { x:  halfW, y: -halfH }
  ]

  const out = []
  for (let i = 0; i < 4; i++) {
    const lx = local[i].x
    const ly = local[i].y
    const rx =  lx * cosA - ly * sinA
    const ry =  lx * sinA + ly * cosA
    out.push({ x: cxOff + rx, y: cyOff + ry })
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
  if (dotAD < 0) return false
  if (dotAB > abLenSq) return false
  if (dotAD > adLenSq) return false
  return true
}

function circleInCone(px, py, r, ox, oy, radius, arcDegrees, centerAngle) {
  // Step 1: distance check
  const dx = px - ox
  const dy = py - oy
  const dist = Math.hypot(dx, dy)
  if (dist > radius + r) return false

  // Step 2: angle check
  const angleToTarget = Math.atan2(dy, dx)
  let da = angleToTarget - centerAngle
  while (da > Math.PI) da -= Math.PI * 2
  while (da < -Math.PI) da += Math.PI * 2

  const halfArc = (arcDegrees * Math.PI / 180) * 0.5
  return Math.abs(da) <= halfArc
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
    expireAtMs: startMs + Number(def.durationMs || 0),
    durationMs: Number(def.durationMs) || 300,
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
    expireAtMs: startMs + Number(def.durationMs || 0),
    durationMs: Number(def.durationMs) || 400,
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
  const rect = buildRectCorners(
    cx, cy,
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

  const radius = Number(hb.radiusPx) || 0
  const arcRad = Math.abs((Number(hb.arcDegrees) || 0) * Math.PI / 180)
  const sweepRad = Math.abs((Number(hb.sweepDegrees) || 0) * Math.PI / 180)
  const halfArcRad = arcRad * 0.5

  const uNum = now() - hb.startMs
  const uDen = Math.max(1, hb.durationMs)
  let u = uNum / uDen
  if (u < 0) u = 0
  if (u > 1) u = 1

  const startAngle = Number(hb.baseAngle) - sweepRad * 0.5
  const currentAngle = startAngle + sweepRad * u

  const candidates = listTargetsFor(hb)
  if (!candidates || candidates.length === 0) return

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const row = c && c.row ? c.row : null
    if (!row || !row.pos) continue

    const key = String(c.id)
    if (hb.alreadyHit.has(key)) continue

    const r = Collision.radiusOf(row)
    const hit = circleInCone(
      Number(row.pos.x) || 0,
      Number(row.pos.y) || 0,
      Number(r) || 0,
      cx,
      cy,
      Number(hb.radiusPx) || 0,
      Number(hb.arcDegrees) || 0,
      Number(currentAngle) || 0
    )
    if (!hit) continue

    hb.alreadyHit.add(key)
    applyHit(hb.ownerPlayerId, hb.ownerEntityId, key, hb.defKey)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tick + expiry
// ─────────────────────────────────────────────────────────────────────────────
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

  Bus.on('attack:request', (evt) => {
    if (!evt) return
    const playerId = evt.playerId
    if (!playerId) return

    const attacker = getRow(playerId, evt.entityId)
    if (!attacker) return

    const defKey = typeof evt.defKey === 'string' && evt.defKey.length > 0
      ? evt.defKey
      : 'player_basic_swing'

    const def = HITBOX_DEFS[defKey]
    if (!def) return

    const baseAngle = Number(evt.baseAngleRad) || 0
    const attackDelayMs = Number(evt.delayMs) || 0

    const timeout = setTimeout(() => {
      if (def.type === 'rect') {
        spawnBox(playerId, attacker, defKey, baseAngle)
        return
      }
      if (def.type === 'cone') {
        spawnSwing(playerId, attacker, defKey, baseAngle)
        return
      }
    }, attackDelayMs)

    pendingAttackTimers.set(attacker, timeout)
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

  Bus.on('entity:spawned', (evt) => {
    if (!evt) return
    const e = evt.entity
    if (!e) return
    if (e.type !== 'mob') return
    const key = resolveEnemyHitboxDefKey(e)
    if (!key) return
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply damage: now uses player.stats.atk for player-sourced hits
// ─────────────────────────────────────────────────────────────────────────────
function applyHit(ownerPlayerId, attackerId, targetId, hitboxKey) {
  function finiteNumber(v, fb) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    return fb
  }

  const attacker = getRow(ownerPlayerId, attackerId)
  const target = getRow(ownerPlayerId, targetId)
  if (!attacker || !target) return

  const cfg = attacker.type === 'player'
    ? PLAYER_DEFAULTS
    : ENEMIES_CONFIG[attacker.mobType]

  let dmg = 1
  
  try {
    if (attacker.type === 'player') {
      let atkStat = 0
      if (attacker.stats && typeof attacker.stats.atk === 'number') {
        atkStat = attacker.stats.atk
      } else {
        if (PLAYER_DEFAULTS && PLAYER_DEFAULTS.DEFAULT_PLAYER_DATA && typeof PLAYER_DEFAULTS.DEFAULT_PLAYER_DATA.atk === 'number') {
          atkStat = PLAYER_DEFAULTS.DEFAULT_PLAYER_DATA.atk
        } else {
          atkStat = 1
        }
      }
      dmg = finiteNumber(atkStat, 1)
    } else {
      let baseDmg = null
      try {
        if (cfg && cfg.attack && typeof cfg.attack.damage === 'number') {
          baseDmg = cfg.attack.damage
        }
      } catch (_e2) {}
      if (typeof baseDmg === 'number') {
        dmg = finiteNumber(baseDmg, 1)
      } else {
        let mobAtk = 0
        if (attacker.stats && typeof attacker.stats.atk === 'number') {
          mobAtk = attacker.stats.atk
        } else {
          if (cfg && typeof cfg.atk === 'number') {
            mobAtk = cfg.atk
          } else {
            mobAtk = 1
          }
        }
        dmg = finiteNumber(mobAtk, 1)
      }
    }
  } catch (_e) {}

  const tStats = target.stats || { hp: 1, maxHp: 1 }
  const nextHp = finiteNumber(tStats.hp, 1) - dmg
  const maxHpNow = finiteNumber(tStats.maxHp, 1)

  if (target.type === 'mob') {
    const ws = wsRegistry.get(ownerPlayerId)
    if (!wsRegistry.isOpen(ws)) return

    const nextHpM = nextHp
    const row = entityStore.get(ownerPlayerId, targetId)
    if (!row) return
    row.stats = { hp: nextHpM, maxHp: maxHpNow }

    if (nextHpM <= 0) {
      try {
        row.state = 'dead'
        wsRegistry.sendTo(ownerPlayerId, {
          event: 'entityStatsUpdate',
          entityId: targetId,
          stats: { hp: 0, maxHp: maxHpNow }
        })
        Despawn.schedule(ownerPlayerId, targetId, 500)
      } catch (_e) {}
      return
    }

    wsRegistry.sendTo(ownerPlayerId, {
      event: 'entityStatsUpdate',
      entityId: targetId,
      stats: { hp: nextHpM, maxHp: maxHpNow }
    })
    return
  }

  if (target.type === 'player') {
    const ws = wsRegistry.get(ownerPlayerId)
    if (!wsRegistry.isOpen(ws)) return

    const nextHpP = nextHp
    const row = entityStore.get(ownerPlayerId, targetId)
    if (!row) return
    row.stats = { hp: nextHpP, maxHp: maxHpNow }

    if (nextHpP <= 0) {
      // future: player death flow
    }

    wsRegistry.sendTo(ownerPlayerId, {
      event: 'statsUpdate',
      stats: { hp: nextHpP }
    })
    return
  }
}

module.exports = { start, spawnSwing, spawnBox, resolveEnemyHitboxDefKey }
