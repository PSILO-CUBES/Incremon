// server/systems/aiFollowLoop.js
//
// Server-side AI that makes mobs chase their owner's player and
// switch to 'attack' when inside an attack radius. It enforces a
// server-authoritative cooldown and never re-triggers while already
// in 'attack'. After each attack window, mobs resume pathing.
//
// Conventions: camelCase, no semicolons, no ternaries.

const wsRegistry     = require("../wsRegistry")
const Store          = require("../world/entityStore")
const Movement       = require("./movementLoop")
const FSM            = require("./fsm")
const AttackLoop     = require("./attackLoop")
const ENEMIES_CONFIG = require("../defs/enemiesConfig")

const TICK_MS          = 80
const DEFAULT_RANGE_PX = 64
const DEFAULT_WINDOW_MS= 350
const DEFAULT_CD_MS    = 650

// Map<playerId, Map<entityId, nextAllowedAtMs>>
const cooldowns = new Map()

function sub(map, key) {
  let m = map.get(key)
  if (!m) {
    m = new Map()
    map.set(key, m)
  }
  return m
}

function toPos(p) {
  const out = { x: 0, y: 0 }
  if (p && typeof p.x === "number") out.x = p.x
  if (p && typeof p.y === "number") out.y = p.y
  return out
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function norm(x, y) {
  const len = Math.hypot(x, y)
  if (len <= 1e-6) return { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}

function rangeFor(mob) {
  if (!mob) return DEFAULT_RANGE_PX
  const def = ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]
  if (def && typeof def.attackRangePx === "number" && Number.isFinite(def.attackRangePx)) {
    if (def.attackRangePx < 0) return 0
    return def.attackRangePx
  }
  if (def && def.attack && typeof def.attack.rangePx === "number" && Number.isFinite(def.attack.rangePx)) {
    if (def.attack.rangePx < 0) return 0
    return def.attack.rangePx
  }
  if (def && def.attack && def.attack.hitbox && typeof def.attack.hitbox.rangePx === "number") {
    const n = Number(def.attack.hitbox.rangePx)
    if (Number.isFinite(n)) {
      if (n < 0) return 0
      return n
    }
  }
  return DEFAULT_RANGE_PX
}

function windowFor(mob) {
  if (!mob) return DEFAULT_WINDOW_MS
  const def = ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]
  if (def && def.attack && typeof def.attack.durationMs === "number" && Number.isFinite(def.attack.durationMs)) {
    if (def.attack.durationMs < 0) return 0
    return def.attack.durationMs
  }
  if (def && def.attack && typeof def.attack.windowMs === "number" && Number.isFinite(def.attack.windowMs)) {
    if (def.attack.windowMs < 0) return 0
    return def.attack.windowMs
  }
  if (def && def.attack && def.attack.hitbox && typeof def.attack.hitbox.durationMs === "number") {
    const n = Number(def.attack.hitbox.durationMs)
    if (Number.isFinite(n)) {
      if (n < 0) return 0
      return n
    }
  }
  return DEFAULT_WINDOW_MS
}

function cooldownFor(mob) {
  if (!mob) return DEFAULT_CD_MS
  const def = ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]
  if (def && typeof def.attackCooldownMs === "number" && Number.isFinite(def.attackCooldownMs)) {
    if (def.attackCooldownMs < 0) return 0
    return def.attackCooldownMs
  }
  if (def && def.attack && typeof def.attack.cooldownMs === "number" && Number.isFinite(def.attack.cooldownMs)) {
    if (def.attack.cooldownMs < 0) return 0
    return def.attack.cooldownMs
  }
  return DEFAULT_CD_MS
}

function cdLeftMs(playerId, entityId) {
  const submap = cooldowns.get(playerId)
  if (!submap) return 0
  const until = submap.get(String(entityId)) || 0
  const left = until - Date.now()
  if (left > 0) return left
  return 0
}

function armCooldown(playerId, entityId, windowMs, cooldownMs) {
  const total = Math.max(0, Number(windowMs) || 0) + Math.max(0, Number(cooldownMs) || 0)
  sub(cooldowns, playerId).set(String(entityId), Date.now() + total)
}

function gather(playerId) {
  let player = null
  const mobs = []
  Store.each(playerId, (id, row) => {
    if (!row) return
    if (row.type === "player") player = row
  })
  if (!player) return { player: null, mobs: [] }
  Store.each(playerId, (id, row) => {
    if (!row) return
    if (row.type !== "mob") return
    if (row.mapId !== player.mapId) return
    if (row.instanceId !== player.instanceId) return
    mobs.push([id, row])
  })
  return { player, mobs }
}

function tick() {
  const bound = wsRegistry.dumpBindings()
  for (const playerId of bound) {
    const { player, mobs } = gather(playerId)
    if (!player || mobs.length === 0) continue

    const p = toPos(player.pos)

    for (const [entityId, mob] of mobs) {
      if (!mob) continue
      if (mob.hp <= 0) {
        Movement.onMoveStop(playerId, entityId)
        continue
      }

      const e = toPos(mob.pos)
      const rangePx = rangeFor(mob)
      const inRange = distSq(p.x, p.y, e.x, e.y) <= rangePx * rangePx
      const dir = norm(p.x - e.x, p.y - e.y)

      if (!inRange) {
        Movement.setDir(playerId, entityId, dir)
        continue
      }

      if (mob.state === "attack") {
        Movement.onMoveStop(playerId, entityId)
        continue
      }

      const left = cdLeftMs(playerId, entityId)
      if (left > 0) {
        if (dir.x !== 0 || dir.y !== 0) {
          Movement.setDir(playerId, entityId, dir)
        } else {
          Movement.onMoveStop(playerId, entityId)
        }
        continue
      }

      Movement.onMoveStop(playerId, entityId)

      const ok = FSM.apply(playerId, entityId, "attackIntentStart")
      if (!ok || !ok.ok) continue

      const windowMs = windowFor(mob)
      AttackLoop.start(playerId, entityId, { x: p.x, y: p.y }, windowMs, null)

      const cdMs = cooldownFor(mob)
      armCooldown(playerId, entityId, windowMs, cdMs)
    }
  }
}

let timer = setInterval(tick, TICK_MS)

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { stop }
