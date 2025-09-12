// server/systems/attackLoop.js
//
// Manages server-authoritative attack windows per entity.
// While attacking, movement intents are queued. When the window ends,
// we finish the attack and optionally resume queued or remembered movement.
//
// Conventions: camelCase, no semicolons, no ternaries.

const FSM        = require("./fsm")
const Store      = require("../world/entityStore")
const Movement   = require("./movementLoop")
const wsRegistry = require("../wsRegistry")

const DEFAULT_ATTACK_MS = 350
const PLAYER_ATTACK_COOLDOWN_MS = 1000

// Map<playerId, Map<entityId, Timeout>>
const timers = new Map()
// Map<playerId, Map<entityId, {x,y}>>
const resumeDir = new Map()
// Map<playerId, Map<entityId, {x,y}>>
const queuedMove = new Map()
// Map<playerId, Map<entityId, {x,y}>>
const attackPos = new Map()

function sub(map, playerId) {
  let m = map.get(playerId)
  if (!m) {
    m = new Map()
    map.set(playerId, m)
  }
  return m
}

function normDir(d) {
  const x = Number(d && d.x) || 0
  const y = Number(d && d.y) || 0
  const mag = Math.hypot(x, y)
  if (mag <= 0) return { x: 0, y: 0 }
  return { x: x / mag, y: y / mag }
}

function isAttacking(playerId, entityId) {
  const t = timers.get(playerId)
  if (!t) return false
  return t.has(String(entityId))
}

function start(playerId, entityId, pos, durationMs, mayResumeDir) {
  const id = String(entityId)
  if (!playerId || !id) return false

  const ent = Store.get(playerId, id)
  if (!ent) return false
  if (ent.state !== "attack") return false

  const tmap = sub(timers, playerId)
  if (tmap.has(id)) return false

  const apt = sub(attackPos, playerId)
  const ax = Number(pos && pos.x) || 0
  const ay = Number(pos && pos.y) || 0
  apt.set(id, { x: ax, y: ay })

  if (mayResumeDir && (mayResumeDir.x !== 0 || mayResumeDir.y !== 0)) {
    sub(resumeDir, playerId).set(id, normDir(mayResumeDir))
  } else {
    const rsub = resumeDir.get(playerId)
    if (rsub) rsub.delete(id)
  }

  const ms = Math.max(1, Number(durationMs) || DEFAULT_ATTACK_MS)
  const handle = setTimeout(() => finish(playerId, id), ms)
  tmap.set(id, handle)

  const nowEnt = Store.get(playerId, id)
  wsRegistry.sendTo(playerId, {
    event: "entityStateUpdate",
    payload: { entityId: id, state: nowEnt ? nowEnt.state : "attack" }
  })

  return true
}

function finish(playerId, entityId) {
  const id = String(entityId)
  const tmap = timers.get(playerId)
  if (tmap && tmap.has(id)) {
    const h = tmap.get(id)
    try { clearTimeout(h) } catch (_e) {}
    tmap.delete(id)
  }

  const a = attackPos.get(playerId)
  if (a && a.has(id)) a.delete(id)

  // Attack window is over
  FSM.apply(playerId, id, "attackFinished")

  // Set player cooldown so they cannot re-enter attack immediately
  const ent = Store.get(playerId, id)
  if (ent && ent.type === "player") {
    const now = Date.now()
    ent.attackCooldownUntil = now + PLAYER_ATTACK_COOLDOWN_MS
    try {
      wsRegistry.sendTo(playerId, {
        event: "attackCooldown",
        payload: {
          entityId: id,
          cooldownMs: PLAYER_ATTACK_COOLDOWN_MS,
          until: ent.attackCooldownUntil
        }
      })
    } catch (_e) {}
  }

  // Prefer queued move set during attack, else remembered resume dir
  let dir = null
  const q = queuedMove.get(playerId)
  if (q && q.has(id)) {
    dir = q.get(id)
    q.delete(id)
  } else {
    const r = resumeDir.get(playerId)
    if (r && r.has(id)) {
      dir = r.get(id)
      r.delete(id)
    }
  }

  if (dir && (Math.abs(dir.x) > 0 || Math.abs(dir.y) > 0)) {
    const ok = FSM.apply(playerId, id, "moveIntentStart")
    if (ok && ok.ok) {
      Movement.onMoveStart(playerId, id, dir)
      const ent2 = Store.get(playerId, id)
      wsRegistry.sendTo(playerId, {
        event: "entityStateUpdate",
        payload: { entityId: id, state: ent2 ? ent2.state : "walk", dir: dir }
      })
    }
  }

  return true
}

function cancel(playerId, entityId) {
  const id = String(entityId)
  const tmap = timers.get(playerId)
  if (tmap) {
    const h = tmap.get(id)
    if (h) clearTimeout(h)
    if (tmap.has(id)) tmap.delete(id)
  }
  const r = resumeDir.get(playerId)
  if (r) r.delete(id)
  const q = queuedMove.get(playerId)
  if (q) q.delete(id)

  // Do not auto-set cooldown here unless you want cancels to still trigger cooldown
  FSM.apply(playerId, id, "attackFinished")
}

function queueMove(playerId, entityId, dir) {
  if (!isAttacking(playerId, entityId)) return false
  sub(queuedMove, playerId).set(String(entityId), normDir(dir || {}))
  return true
}

function clearQueued(playerId, entityId) {
  const q = queuedMove.get(playerId)
  if (q) q.delete(String(entityId))
}

function clearResume(playerId, entityId) {
  const r = resumeDir.get(playerId)
  if (r) r.delete(String(entityId))
}

function getAttackPos(playerId, entityId) {
  const m = attackPos.get(playerId)
  if (!m) return null
  return m.get(String(entityId)) || null
}

module.exports = {
  isAttacking,
  start,
  finish,
  cancel,
  queueMove,
  clearQueued,
  clearResume,
  getAttackPos
}
