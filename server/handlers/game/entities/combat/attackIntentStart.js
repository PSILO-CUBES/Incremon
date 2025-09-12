// server/handlers/game/entities/combat/attackIntentStart.js
//
// Player attack intent → set FSM intent, start attack loop,
// compute angle, and spawn swing by defKey (to keep visuals identical).
//
// Conventions: camelCase, no semicolons, no ternaries.

const FSM             = require("../../../../systems/fsm")
const AttackLoop      = require("../../../../systems/attackLoop")
const Movement        = require("../../../../systems/movementLoop")
const entityStore     = require("../../../../world/entityStore")
const Hitboxes        = require("../../../../systems/hitboxManager")
const PLAYER_DEFAULTS = require("../../../../defs/playerDefaults")

const PLAYER_ATTACK_COOLDOWN_MS = 1000

function sanitizePos(p) {
  const out = { x: 0, y: 0 }
  if (p) {
    if (typeof p === "object") {
      const xv = Number(p.x)
      const yv = Number(p.y)
      if (Number.isFinite(xv)) out.x = xv
      if (Number.isFinite(yv)) out.y = yv
    }
  }
  return out
}

module.exports = (ws, data = {}) => {
  if (!ws) return
  if (!ws.playerId) return
  if (!ws.hasSpawned) return

  const entityId = data && data.entityId ? data.entityId : ws.playerEntityId
  const ent = entityStore.get(ws.playerId, entityId)
  if (!ent) return

  if (ent.type === "player") {
    const now = Date.now()
    const until = Number(ent.attackCooldownUntil) || 0
    if (until > now) {
      const remainingMs = until - now
      try {
        ws.send(JSON.stringify({
          event: "attackDenied",
          payload: {
            entityId: entityId,
            reason: "cooldown",
            remainingMs: remainingMs
          }
        }))
      } catch (_e) {}
      return
    }
  }

  const res = FSM.apply(ws.playerId, entityId, "attackIntentStart")
  if (!res) return
  if (!res.ok) return

  const click = sanitizePos(data && data.pos ? data.pos : null)

  let durationMs = 350
  try {
    const atk = PLAYER_DEFAULTS && PLAYER_DEFAULTS.DEFAULT_PLAYER_ATTACKS
      ? PLAYER_DEFAULTS.DEFAULT_PLAYER_ATTACKS.basicSwing
      : null
    if (atk && atk.hitbox && typeof atk.hitbox.durationMs === "number") {
      const n = Number(atk.hitbox.durationMs)
      if (Number.isFinite(n)) durationMs = n
    }
  } catch (_e) {}

  let mayResumeDir = null
  try {
    if (Movement && Movement._INTENTS) {
      const intents = Movement._INTENTS
      if (intents.has(ws.playerId)) {
        const sub = intents.get(ws.playerId)
        const key = String(entityId)
        if (sub && sub.has(key)) {
          mayResumeDir = sub.get(key)
        }
      }
    }
  } catch (_e) {}

  AttackLoop.start(ws.playerId, entityId, click, durationMs, mayResumeDir)

  const px = Number(ent.pos && ent.pos.x) || 0
  const py = Number(ent.pos && ent.pos.y) || 0
  const baseAngle = Math.atan2(click.y - py, click.x - px)

  const defKey = "player_basic_swing"
  Hitboxes.spawnSwing(ws.playerId, ent, defKey, baseAngle)
}
