// server/systems/aiFollowLoop.js
//
// Simple server-side AI that makes spawned enemies chase the owner's player.
// Works per *player instance* (mapId + instanceId must match).
//
// It does not move entities directly; it just sets the movement direction
// into movementLoop via setDir(...). movementLoop integrates positions.
//
// Requirements:
// - Spawned enemies should carry `mobType` (unitId) on their row in entityStore.
// - The player's own row must have type === "player".
// - wsRegistry is used only to enumerate active playerIds (for per-player stores).
//
const wsRegistry = require("../wsRegistry");
const Store = require("../world/entityStore");
const Movement = require("./movementLoop");

// Tunables
const TICK_HZ = Number(process.env.AI_TICK_HZ || process.env.MOVEMENT_TICK_HZ || 15);
const TICK_MS = Math.max(1, Math.floor(1000 / TICK_HZ));
const ARRIVE_RADIUS = Number(process.env.AI_ARRIVE_RADIUS || 12); // px

function _norm(vx, vy) {
  const len = Math.hypot(vx, vy);
  if (len <= 1e-6) return { x: 0, y: 0 };
  return { x: vx / len, y: vy / len };
}

function tick() {
  const players = wsRegistry.dumpBindings();

  for (const playerId of players) {
    let playerRow = null;

    // Find player row once
    Store.each(playerId, (_id, e) => {
      if (!playerRow && e?.type === "player") playerRow = e;
    });
    if (!playerRow) continue;

    const px = Number(playerRow.pos?.x ?? 0);
    const py = Number(playerRow.pos?.y ?? 0);
    const pMap = playerRow.mapId;
    const pInst = playerRow.instanceId;

    // For every mob belonging to this player, chase the player
    Store.each(playerId, (eid, e) => {
      if (!e || e.state === "dead") return;
      if (!e.mobType) return; // only chase with mobs
      if (e.mapId !== pMap || e.instanceId !== pInst) return;

      const ex = Number(e.pos?.x ?? 0);
      const ey = Number(e.pos?.y ?? 0);
      const dx = px - ex;
      const dy = py - ey;
      const dist = Math.hypot(dx, dy);

      if (dist <= ARRIVE_RADIUS) {
        Movement.onMoveStop(playerId, eid);
      } else {
        Movement.setDir(playerId, eid, _norm(dx, dy));
      }
    });
  }
}

let timer = setInterval(tick, TICK_MS);
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
module.exports = { stop };
