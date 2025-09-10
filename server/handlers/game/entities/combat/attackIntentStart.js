// server/handlers/game/entities/combat/attackIntentStart.js
// Aim is ALWAYS relative to mouse click. Server computes baseAngle from player.pos -> click.
// Midpoint of swing equals that angle. Sends authoritative viz data to the owner.
// Conventions: camelCase, no semicolons.

const FSM         = require('../../../../systems/fsm')
const AttackLoop  = require('../../../../systems/attackLoop')
const Movement    = require('../../../../systems/movementLoop')
const entityStore = require('../../../../world/entityStore')
const Hitboxes    = require('../../../../systems/hitboxManager')
const HB_DEFS     = require('../../../../defs/hitboxDefs')
const wsRegistry  = require('../../../../wsRegistry')

function sanitizePos(p) {
  if (!p) return { x: 0, y: 0 }
  const x = Number(p.x)
  const y = Number(p.y)
  if (Number.isNaN(x) || Number.isNaN(y)) return { x: 0, y: 0 }
  return { x, y }
}

function angleBetween(fromPos, toPos) {
  const dx = Number(toPos.x) - Number(fromPos.x)
  const dy = Number(toPos.y) - Number(fromPos.y)
  return Math.atan2(dy, dx)
}

module.exports = (ws, data = {}) => {
  // Basic guards
  if (!ws || !ws.playerId || !ws.hasSpawned) return

  const entityId = data.entityId ? String(data.entityId) : String(ws.playerEntityId)
  if (!entityId) return

  // Resolve entity
  const ent = entityStore.get(ws.playerId, entityId)
  if (!ent) return
  if (ent.type !== 'player') {
    // For now only players use this handler
    return
  }

  // If already attacking, ignore new attack intents to avoid re-arming the window
  if (ent.state === 'attack') return

  // Select hitbox shape
  let shapeKey = data.shapeKey
  if (!shapeKey || !HB_DEFS[shapeKey]) {
    shapeKey = 'player_basic_swing'
  }
  const def = HB_DEFS[shapeKey]
  if (!def) return

  // Click position and aim angle
  const clickPos = sanitizePos(data.pos)
  const baseAngle = angleBetween(ent.pos, clickPos)

  // Capture current move dir (if any) so we can auto-resume after the attack window
  let resumeDir = null
  try {
    const intentsByEntity = Movement._INTENTS && Movement._INTENTS.get(String(ws.playerId))
    if (intentsByEntity) {
      const d = intentsByEntity.get(String(entityId))
      if (d && typeof d.x === 'number' && typeof d.y === 'number') {
        resumeDir = { x: d.x, y: d.y }
      }
    }
  } catch (_e) {}

  // Freeze movement while attacking
  Movement.onMoveStop(ws.playerId, entityId)

  // ── EARLY STATE CHANGE (restored) ───────────────────────────────────────────
  const res = FSM.apply(ws.playerId, entityId, 'attackIntentStart')
  if (!res || !res.ok) return

  // Notify client of the state change immediately
  const nowEnt = entityStore.get(ws.playerId, entityId)
  if (nowEnt) {
    ws.send(JSON.stringify({
      event: 'entityStateUpdate',
      payload: {
        entityId: entityId,
        state: nowEnt.state
      }
    }))
  }

  // Start the authoritative attack window (drives attackFinished -> idle/walk)
  const attackMs = Number(def.durationMs)
  AttackLoop.start(
    ws.playerId,
    entityId,
    { x: ent.pos.x, y: ent.pos.y },  // attack origin = current player pos
    Number.isFinite(attackMs) ? attackMs : undefined,
    resumeDir
  )

  // Ensure hitbox system is ticking
  try { Hitboxes.start() } catch (_e) {}

  // Spawn the swing hitbox with mid-swing centered on baseAngle
  const hb = Hitboxes.spawnSwing(ws.playerId, ent, shapeKey, baseAngle)
  if (!hb) return

  // Visual sync for the owner (client will render tweened cone)
  const now = Date.now()
  const elapsedAtSendMs = now - hb.startMs
  const durationMs = def.durationMs

  wsRegistry.sendTo(ws.playerId, {
    event: 'hitboxSpawned',
    entityId: entityId,
    shapeKey: shapeKey,
    startMs: hb.startMs,
    elapsedAtSendMs: elapsedAtSendMs,
    durationMs: durationMs,
    radiusPx: def.rangePx,
    arcDegrees: def.arcDegrees,
    sweepDegrees: def.sweepDegrees,
    baseAngle: hb.baseAngle
  })
}
