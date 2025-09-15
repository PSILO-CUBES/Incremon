// server/world/despawn.js
//
// Consistent despawn helper.
// - Removes from entityStore
// - Emits one canonical Bus event: "entity:despawned"
// - Optional delayed despawn via schedule(...)
// Conventions: camelCase, no semicolons, no ternaries.

const Bus = require("./bus")
const Store = require("./entityStore")

// Track delayed despawns so we can avoid duplicates and cancel if needed
const timers = new Map()

function keyFor(playerId, entityId) {
  return String(playerId) + "::" + String(entityId)
}

// Immediate despawn
function despawn(playerId, entityId, reason = "unknown") {
  const id = String(entityId)
  const pid = String(playerId)

  // Clear any pending timer for this entity
  cancel(pid, id)

  const e = Store.get(pid, id)
  if (!e) return false

  // Optional state mark
  e.state = "dead"

  // Remove from per-player store
  Store.remove(pid, id)

  // Single canonical event for downstream (ws send, spawn bookkeeping, etc.)
  Bus.emit("entity:despawned", { playerId: pid, entityId: id, reason })

  return true
}

// Delayed despawn (e.g., give client time to play death fade)
function schedule(playerId, entityId, delayMs = 0, reason = "scheduled") {
  const id = String(entityId)
  const pid = String(playerId)
  const k = keyFor(pid, id)

  if (typeof delayMs !== "number") {
    delayMs = 0
  }

  if (delayMs <= 0) {
    return despawn(pid, id, reason)
  }

  // Prevent multiple timers per same entity
  cancel(pid, id)

  const t = setTimeout(() => {
    timers.delete(k)
    try {
      despawn(pid, id, reason)
    } catch (_e) {
      // Swallow to keep the loop robust
    }
  }, delayMs)

  // Node timers keep process alive unless unref'd; do not unref in dev
  timers.set(k, t)
  return true
}

function cancel(playerId, entityId) {
  const k = keyFor(playerId, entityId)
  const t = timers.get(k)
  if (!t) return false
  clearTimeout(t)
  timers.delete(k)
  return true
}

function cancelAllForPlayer(playerId) {
  const pid = String(playerId)
  let n = 0
  for (const [k, t] of timers.entries()) {
    if (k.startsWith(pid + "::")) {
      clearTimeout(t)
      timers.delete(k)
      n += 1
    }
  }
  return n
}

module.exports = {
  despawn,
  schedule,
  cancel,
  cancelAllForPlayer
}
