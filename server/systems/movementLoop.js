// Purpose: Server-authoritative movement tick (default 15 Hz) for player/pet entities.
// - Integrates positions based on last known intended direction
// - Verifies max distance per tick using entity speed (ent.data.spd or default)
// - Clamps to map bounds from maps/mapRegistry
// - Emits pos updates via Store.setPos(...) which already forwards through Bus -> wsRegistry
//
// No external deps.

const Store = require("../world/entityStore");
const Bus = require("../world/bus");
const { getMapInfo } = require("../maps/mapRegistry");
const { DEFAULT_PLAYER_DATA } = require("../defs/playerDefaults");

// ---------- config ----------
const TICK_HZ = Number(process.env.MOVEMENT_TICK_HZ || 15);
const TICK_MS = Math.max(1, Math.floor(1000 / TICK_HZ));
const DEFAULT_SPD = (DEFAULT_PLAYER_DATA && DEFAULT_PLAYER_DATA.spd) || 200;

// Track active movement intents: key = `${playerId}:${entityId}`
const inputs = new Map();

// Utility: normalize a {x,y} vector; returns {x,y,len}
function normalizeVec(dir) {
  const x = Number(dir?.x) || 0;
  const y = Number(dir?.y) || 0;
  const len = Math.hypot(x, y);
  if (len <= 1e-6) return { x: 0, y: 0, len: 0 };
  return { x: x / len, y: y / len, len };
}

// Public API: handlers will call these on intent start/stop
function onMoveStart(playerId, entityId, dir) {
  if (!playerId || !entityId) return;
  const { x, y } = normalizeVec(dir);
  inputs.set(`${playerId}:${entityId}`, { x, y, lastSeen: Date.now() });
}

function onMoveStop(playerId, entityId) {
  if (!playerId || !entityId) return;
  inputs.delete(`${playerId}:${entityId}`);
}

// Cleanup when entities leave "walk" (e.g., go idle or despawn)
Bus.on("entity:stateChanged", ({ playerId, entityId, to }) => {
  if (to !== "walk") inputs.delete(`${playerId}:${entityId}`);
});

// Optional: if an entity is removed entirely
Bus.on("entity:removed", ({ playerId, entityId }) => {
  inputs.delete(`${playerId}:${entityId}`);
});

// Core simulation step
function step(dtSec) {
  // Iterate over a copy of keys to allow deletion inside loop
  for (const key of Array.from(inputs.keys())) {
    const [playerId, entityId] = key.split(":");
    const ent = Store.get(playerId, entityId);
    if (!ent) { inputs.delete(key); continue; }
    if (ent.state !== "walk") { inputs.delete(key); continue; }

    // Resolve speed
    const spd = Number(ent?.data?.spd) || DEFAULT_SPD;

    // Direction
    const intent = inputs.get(key);
    const { x: dirX, y: dirY } = intent || { x: 0, y: 0 };
    if (dirX === 0 && dirY === 0) { inputs.delete(key); continue; }

    // Integrate
    const dx = dirX * spd * dtSec;
    const dy = dirY * spd * dtSec;
    const nextX = Number(ent.pos?.x || 0) + dx;
    const nextY = Number(ent.pos?.y || 0) + dy;

    

    // Clamp to map bounds if available
    let clampedX = nextX, clampedY = nextY;
    if (ent.mapId) {
      try {
        const info = getMapInfo(ent.mapId);
        const b = info?.bounds;
        if (b) {
          clampedX = Math.min(Math.max(nextX, b.minX), b.maxX);
          clampedY = Math.min(Math.max(nextY, b.minY), b.maxY);
        }
      } catch {}
    }

    // Commit — Store.setPos should emit "entity:posChanged" via Bus
    Store.setPos(playerId, entityId, { x: clampedX, y: clampedY });
  }
}

// Ticker
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dtMs = Math.max(1, now - last);
  last = now;
  const dtSec = dtMs / 1000;
  step(dtSec);
}, TICK_MS);

module.exports = {
  onMoveStart,
  onMoveStop,
};