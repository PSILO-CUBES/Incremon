// server/handlers/game/entities/combat/attackIntentStart.js
//
// Player-originated attack intent.
// Transitions to "attack", starts the attack window, spawns the hitbox,
// and (important) passes the current movement intent so movement can auto-resume.
//
// Conventions: camelCase, no semicolons, no ternaries.

const FSM         = require("../../../../systems/fsm")
const AttackLoop  = require("../../../../systems/attackLoop")
const Movement    = require("../../../../systems/movementLoop")
const entityStore = require("../../../../world/entityStore")
const Hitboxes    = require("../../../../systems/hitboxManager")
const HB_DEFS     = require("../../../../defs/hitboxDefs")

function sanitizePos(p) {
  const out = { x: 0, y: 0 }
  if (p && typeof p === "object") {
    const x = Number(p.x)
    const y = Number(p.y)
    if (Number.isFinite(x)) out.x = x
    if (Number.isFinite(y)) out.y = y
  }
  return out
}

module.exports = (ws, data = {}) => {
  if (!ws || !ws.playerId || !ws.hasSpawned) return

  const entityId = data && data.entityId ? data.entityId : ws.playerEntityId
  const ent = entityStore.get(ws.playerId, entityId)
  if (!ent) return

  const res = FSM.apply(ws.playerId, entityId, "attackIntentStart")
  if (!res || !res.ok) return

  const click = sanitizePos(data && data.pos ? data.pos : null)

  const defKey = "player_basic_swing"
  const def = HB_DEFS[defKey] || {}
  const durationMs = Number(def.durationMs) || 350

  // NEW: capture the player’s current move intent so we can resume it after the attack
  let mayResumeDir = null
  try {
    const intents = Movement && Movement._INTENTS ? Movement._INTENTS : null
    if (intents && intents.has(ws.playerId)) {
      const sub = intents.get(ws.playerId)
      const key = String(entityId)
      if (sub && sub.has(key)) {
        mayResumeDir = sub.get(key)
      }
    }
  } catch (_e) {}

  AttackLoop.start(ws.playerId, entityId, click, durationMs, mayResumeDir)

  const px = Number(ent.pos && ent.pos.x) || 0
  const py = Number(ent.pos && ent.pos.y) || 0
  const baseAngle = Math.atan2(click.y - py, click.x - px)

  Hitboxes.spawnSwing(ws.playerId, ent, defKey, baseAngle)
}
