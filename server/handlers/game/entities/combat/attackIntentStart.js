// server/handlers/game/entities/combat/attackIntentStart.js
//
// Player-originated attack intent.
// Guards against spam while already attacking, transitions state via FSM,
// starts the attack window, and spawns a server-authoritative hitbox.
//
// Conventions: camelCase, no semicolons, no ternaries.

const FSM         = require("../../../../systems/fsm")
const AttackLoop  = require("../../../../systems/attackLoop")
const entityStore = require("../../../../world/entityStore")
const Hitboxes    = require("../../../../systems/hitboxManager")
const HB_DEFS     = require("../../../../defs/hitboxDefs")

function sanitizePos(p) {
  const out = { x: 0, y: 0 }
  if (p && typeof p.x === "number" && Number.isFinite(p.x)) out.x = p.x
  if (p && typeof p.y === "number" && Number.isFinite(p.y)) out.y = p.y
  return out
}

module.exports = function attackIntentStart(ws, payload) {
  if (!ws) return
  if (!ws.playerId) return
  if (!ws.hasSpawned) return

  const playerId = ws.playerId
  const entityId = String((payload && payload.entityId) || ws.playerEntityId || "Player")

  const ent = entityStore.get(playerId, entityId)
  if (!ent) return

  if (ent.state === "attack") return

  const click = sanitizePos(payload && payload.pos)

  const res = FSM.apply(playerId, entityId, "attackIntentStart")
  if (!res || !res.ok) return

  const defKey = "player_basic_swing"
  const def = HB_DEFS[defKey] || {}
  const durationMs = Number(def.durationMs) || 350

  AttackLoop.start(playerId, entityId, click, durationMs, null)

  const px = Number(ent.pos && ent.pos.x) || 0
  const py = Number(ent.pos && ent.pos.y) || 0
  const baseAngle = Math.atan2(click.y - py, click.x - px)

  Hitboxes.spawnSwing(playerId, ent, defKey, baseAngle)
}
