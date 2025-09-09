// server/handlers/game/entities/combat/attackIntentStart.js
// Uses your existing FSM/AttackLoop but also emits a data-only "hitboxSpawned" to the owner client.

const entityStore = require('../../../../world/entityStore')
const { apply } = require('../../../../systems/fsm')                    // your FSM entry point
const AttackLoop = require('../../../../systems/attackLoop')            // your existing timer/resume flow
const Movement   = require('../../../../systems/movementLoop')
const Hitboxes   = require('../../../../systems/hitboxManager')
const HB_DEFS    = require('../../../../defs/hitboxDefs')
const wsRegistry = require('../../../../wsRegistry')

module.exports = function attackIntentStart(ws, payload) {
  if (!ws.playerId || !ws.hasSpawned) return
  const entityId = ws.playerEntityId
  const player = entityStore.get(ws.playerId, entityId)
  if (!player) return

  const aim = payload?.pos
  if (!aim || typeof aim.x !== 'number' || typeof aim.y !== 'number') return

  let resumeDir = null
  try {
    const intents = Movement._INTENTS && Movement._INTENTS.get(ws.playerId)
    if (intents && intents.has(String(entityId))) resumeDir = intents.get(String(entityId))
  } catch {}

  const fsmRes = apply(ws.playerId, entityId, 'attackIntentStart')
  if (!fsmRes?.ok) return

  const shapeKey = 'player_basic_swing'
  const def = HB_DEFS[shapeKey]
  const durationMs = Math.max(1, Number(def?.durationMs ?? 400))

  AttackLoop.start(ws.playerId, entityId, aim, durationMs, resumeDir)

  const hb = Hitboxes.spawnSwing({ ownerEntity: player, aimAt: aim, shapeKey })
  
  if (hb) {
    wsRegistry.sendTo(ws.playerId, {
      event: 'hitboxSpawned',
      payload: {
        entityId,
        state: player.state,
        shapeKey,
        startMs: hb.startMs,
        durationMs,
        radiusPx: hb.radiusPx,
        arcDegrees: def.arcDegrees,
        sweepDegrees: def.sweepDegrees,
        clockwise: hb.clockwise,
        baseAngle: hb.baseAngle
      }
    })
  }
}
