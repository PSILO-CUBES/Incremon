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
const Hitboxes       = require("./hitboxManager")

const TICK_MS          = 80
const DEFAULT_RANGE_PX = 64
const DEFAULT_WINDOW_MS= 350
const DEFAULT_CD_MS    = 650

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

function attackRangePx(mob) {
  if (!mob) return DEFAULT_RANGE_PX
  const cfg = ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType] ? ENEMIES_CONFIG[mob.mobType] : null
  if (!cfg) return DEFAULT_RANGE_PX
  if (cfg.attack && cfg.attack.rangePx && Number.isFinite(cfg.attack.rangePx)) return Number(cfg.attack.rangePx)
  if (cfg.attack && cfg.attack.hitbox && cfg.attack.hitbox.rangePx && Number.isFinite(cfg.attack.hitbox.rangePx)) return Number(cfg.attack.hitbox.rangePx)
  if (cfg.attack && cfg.attack.hitbox && cfg.attack.hitbox.offsetPx && Number.isFinite(cfg.attack.hitbox.offsetPx)) return Number(cfg.attack.hitbox.offsetPx) + DEFAULT_RANGE_PX * 0.5
  return DEFAULT_RANGE_PX
}

function windowFor(mob) {
  if (!mob) return DEFAULT_WINDOW_MS
  const def = ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType] ? ENEMIES_CONFIG[mob.mobType] : null
  if (def && def.attack && def.attack.hitbox && Number.isFinite(def.attack.hitbox.durationMs)) {
    const n = Number(def.attack.hitbox.durationMs)
    if (n < 0) return 0
    return n
  }
  return DEFAULT_WINDOW_MS
}

function cooldownFor(mob) {
  if (!mob) return DEFAULT_CD_MS
  const def = ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType] ? ENEMIES_CONFIG[mob.mobType] : null
  if (def && Number.isFinite(def.attackCooldownMs)) {
    if (def.attackCooldownMs < 0) return 0
    return def.attackCooldownMs
  }
  if (def && def.attack && Number.isFinite(def.attack.cooldownMs)) {
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
  if (left <= 0) return 0
  return left
}

function armCooldown(playerId, entityId, windowMs, cooldownMs) {
  const when = Date.now() + Math.max(0, Number(windowMs) || 0) + Math.max(0, Number(cooldownMs) || 0)
  const submap = sub(cooldowns, playerId)
  submap.set(String(entityId), when)
}

function gather(playerId) {
  let player = null
  const mobs = []
  if (typeof Store.each === "function") {
    Store.each(playerId, (id, row) => {
      if (!row) return
      if (row.state === "despawn" || row.state === "dead") return
      if (row.type === "player") {
        player = row
        return
      }
      if (row.type === "mob") {
        mobs.push([String(id), row])
      }
    })
  }
  return { player, mobs }
}

function tick() {
  const bound = wsRegistry.dumpBindings()
  for (const playerId of bound) {
    const g = gather(playerId)
    const player = g.player
    const mobs = g.mobs
    if (!player || mobs.length === 0) continue

    const p = toPos(player.pos)

    for (const pair of mobs) {
      const entityId = pair[0]
      const mob = pair[1]
      if (!mob) continue
      if (mob.hp <= 0) {
        Movement.onMoveStop(playerId, entityId)
        continue
      }
      const e = toPos(mob.pos)

      const v = { x: p.x - e.x, y: p.y - e.y }
      const d2 = distSq(p.x, p.y, e.x, e.y)
      const dir = norm(v.x, v.y)

      const range = attackRangePx(mob)
      const inRange = d2 <= range * range

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

      const baseAngle = Math.atan2(p.y - e.y, p.x - e.x)
      let defKey = null
      try {
        defKey = Hitboxes.resolveEnemyHitboxDefKey(mob)
      } catch (_e) {}
      if (defKey) {
        let hb = null
        try {
          const cfg = ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType] ? ENEMIES_CONFIG[mob.mobType] : null
          hb = cfg && cfg.attack ? cfg.attack.hitbox : null
        } catch (_e) {}
        if (hb && hb.type === "rect") {
          Hitboxes.spawnBox(playerId, mob, defKey, baseAngle)
        } else {
          Hitboxes.spawnSwing(playerId, mob, defKey, baseAngle)
        }
      }

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
