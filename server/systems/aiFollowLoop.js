// server/systems/aiFollowLoop.js
//
// Server-side AI that makes mobs chase their owner's player and
// switch to 'attack' when inside an attack radius. It enforces a
// server-authoritative ATTACK COOLDOWN and never re-triggers while
// already in 'attack'. After the attack window completes, the mob
// resumes walking toward the player using the resumeDir captured
// at attack start (handled by attackLoop).
//
// Integrates with existing systems:
//  - entityStore: read/write positions + states (emits bus events)
//  - movementLoop: accepts setDir/onMoveStop to drive motion
//  - fsm: validates and applies state transitions
//  - attackLoop: starts/finishes attack windows w/ resumeDir support
//  - wsRegistry: enumerate active players (per-player stores)
//
// Optional per-mob tuning:
//  - If ENEMIES_CONFIG[mob.mobType].attackRangePx is set, it overrides ATTACK_RANGE_PX
//  - If ENEMIES_CONFIG[mob.mobType].attackCooldownMs is set, it overrides COOLDOWN_MS
//  - If ENEMIES_CONFIG[mob.mobType].attackTimer is set, it overrides RESUME_ATTACK_MS for the attack window
//
// Notes:
//  - We only call AttackLoop.start *after* a successful FSM.apply(...).
//  - While in 'attack' we DO NOT push movement (we stop).
//

const wsRegistry     = require("../wsRegistry")
const Store          = require("../world/entityStore")
const Movement       = require("./movementLoop")
const FSM            = require("./fsm")
const AttackLoop     = require("./attackLoop")
const ENEMIES_CONFIG = require("../defs/enemiesConfig")

// Base tunables
const TICK_MS          = 80      // AI tick
const ATTACK_RANGE_PX  = 64      // default when enemy def doesn't specify
const RESUME_ATTACK_MS = 180     // default attack window if def.attackTimer missing
const COOLDOWN_MS      = 600     // extra cooldown *after* the attack window -- default if no config found

// Cooldown ledger: Map<playerId, Map<entityId, number(nextAtMs)>>
const _cooldowns = new Map()

function _sub(map, key) {
  let m = map.get(key)
  if (!m) {
    m = new Map()
    map.set(key, m)
  }
  return m
}

function _toPos(p) {
  let x = 0
  let y = 0
  if (p && typeof p.x === "number") {
    x = p.x
  }
  if (p && typeof p.y === "number") {
    y = p.y
  }
  return { x: x, y: y }
}

function _norm(x, y) {
  const len = Math.hypot(Number(x) || 0, Number(y) || 0)
  if (!Number.isFinite(len) || len <= 1e-6) return { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}

function _distSq(x1, y1, x2, y2) {
  const dx = Number(x2) - Number(x1)
  const dy = Number(y2) - Number(y1)
  return dx * dx + dy * dy
}

function _rangeFor(mob) {
  var def = null
  if (mob && ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]) {
    def = ENEMIES_CONFIG[mob.mobType]
  }
  var r = Number(def && def.attackRangePx)
  if (Number.isFinite(r)) {
    if (r < 0) {
      return 0
    } else {
      return r
    }
  }
  return ATTACK_RANGE_PX
}

function _cooldownFor(mob) {
  var def = null
  if (mob && ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]) {
    def = ENEMIES_CONFIG[mob.mobType]
  }
  var cd = Number(def && def.attackCooldownMs)
  if (Number.isFinite(cd)) {
    if (cd < 0) {
      return 0
    } else {
      return cd
    }
  }
  return COOLDOWN_MS
}

function _attackTimerFor(mob) {
  var ms = RESUME_ATTACK_MS
  var def = null
  if (mob && ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]) {
    def = ENEMIES_CONFIG[mob.mobType]
  }
  if (def && typeof def.attackTimer === "number") {
    var n = Number(def.attackTimer)
    if (Number.isFinite(n)) {
      if (n < 0) {
        ms = 0
      } else {
        ms = n
      }
    }
  }
  return ms
}

function _cooldownLeftMs(playerId, entityId) {
  const sub = _cooldowns.get(playerId)
  if (!sub) return 0
  const until = sub.get(String(entityId)) || 0
  const left = until - Date.now()
  if (left > 0) {
    return left
  } else {
    return 0
  }
}

function _armCooldown(playerId, entityId, totalMs) {
  const sub = _sub(_cooldowns, playerId)
  sub.set(String(entityId), Date.now() + Math.max(0, totalMs))
}

// Returns { playerRow, mobs: Array<[entityId, row]> } for a bound player
function _gatherForPlayer(playerId) {
  let playerRow = null
  const mobs = []
  if (typeof Store.each !== "function") {
    return { playerRow, mobs }
  }
  try {
    Store.each(playerId, (id, row) => {
      if (!row) return
      if (row.type === "player") playerRow = row
    })
    if (!playerRow) return { playerRow: null, mobs: [] }

    const mapId = playerRow.mapId
    const instanceId = playerRow.instanceId

    Store.each(playerId, (id, row) => {
      if (!row) return
      if (row.type !== "mob") return
      if (row.mapId !== mapId || row.instanceId !== instanceId) return
      mobs.push([id, row])
    })
  } catch (_e) {}
  return { playerRow, mobs }
}

function tick() {
  const playerIds = wsRegistry.dumpBindings()
  for (const playerId of playerIds) {
    const { playerRow, mobs } = _gatherForPlayer(playerId)
    if (!playerRow) continue

    const p = _toPos(playerRow.pos)

    for (const [entityId, mob] of mobs) {
      if (!mob || mob.hp <= 0) {
        Movement.onMoveStop(playerId, entityId)
        continue
      }

      const e = _toPos(mob.pos)
      const dx = p.x - e.x
      const dy = p.y - e.y
      const distSq = _distSq(p.x, p.y, e.x, e.y)

      const rangePx = _rangeFor(mob)
      const inRange = distSq <= rangePx * rangePx

      const dir = _norm(dx, dy)

      if (mob.state === "attack") {
        Movement.onMoveStop(playerId, entityId)
        continue
      }

      if (inRange) {
        const cdLeft = _cooldownLeftMs(playerId, entityId)
        if (cdLeft > 0) {
          if (dir.x !== 0 || dir.y !== 0) {
            Movement.setDir(playerId, entityId, dir)
          } else {
            Movement.onMoveStop(playerId, entityId)
          }
          continue
        }

        Movement.onMoveStop(playerId, entityId)
        const res = FSM.apply(playerId, entityId, "attackIntentStart")
        if (res && res.ok) {
          var attackTimerMs = _attackTimerFor(mob)

          AttackLoop.start(
            playerId,
            entityId,
            { x: p.x, y: p.y },
            attackTimerMs,
            dir
          )

          const extra = _cooldownFor(mob)
          _armCooldown(playerId, entityId, attackTimerMs + extra)
        }
        continue
      }

      if (dir.x !== 0 || dir.y !== 0) {
        Movement.setDir(playerId, entityId, dir)
      } else {
        Movement.onMoveStop(playerId, entityId)
      }
    }
  }
}

// Boot the loop
let timer = setInterval(tick, TICK_MS)

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { stop }
