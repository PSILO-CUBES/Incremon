// server/world/spawnManager.js
//
// Spawns *server-owned* mobs for a given player's instance and inserts them
// into the per-player entityStore via Store.create(playerId, {...}).
//
// Now with basic *non-overlapping placement*:
// - Maintains a lightweight occupancy index per player { entityId -> {x,y,mapId,instanceId} }.
// - Tries multiple nearby candidates to keep minimum separation from existing mobs.
// - Separation can be configured per unit via ENEMIES_CONFIG[unitId].spawnSeparation (px).
//
// Emits a single bus event "entity:spawned" so downstream listeners stay simple.

const { v4: uuidv4 } = require("uuid");
const wsRegistry = require("../wsRegistry");

const Bus = require("../world/bus");
const Store = require("../world/entityStore");
const ENEMIES_CONFIG = require("../defs/enemiesConfig");

// -----------------------------
// Occupancy index (per player)
// -----------------------------
// playerId -> Map(entityId -> { x, y, mapId, instanceId })
const OCC = new Map();

function occFor(playerId) {
  let m = OCC.get(playerId);
  if (!m) {
    m = new Map();
    OCC.set(playerId, m);
  }
  return m;
}

// Best-effort bootstrap from store if available (optional).
function ensureOccFromStore(playerId) {
  const m = occFor(playerId);
  if (m.size > 0) return;
  if (typeof Store.each !== "function") return; // optional API
  try {
    Store.each(playerId, (_id, row) => {
      if (!row || row.type !== "mob") return;
      const p = row.pos || { x: 0, y: 0 };
      m.set(row.entityId, {
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        mapId: row.mapId,
        instanceId: row.instanceId,
      });
    });
  } catch { /* ignore */ }
}

function recordSpawn(playerId, entity) {
  const m = occFor(playerId);
  const p = entity.pos || { x: 0, y: 0 };
  m.set(entity.entityId, {
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
    mapId: entity.mapId,
    instanceId: entity.instanceId,
  });
}

function recordDespawn(playerId, entityId) {
  const m = OCC.get(playerId);
  if (!m) return;
  m.delete(entityId);
}

// Keep positions fresh when something moves (nice to have; not required strictly for spawn).
Bus.on("entity:posChanged", ({ playerId, entityId, pos }) => {
  const m = OCC.get(playerId);
  if (!m) return;
  const r = m.get(entityId);
  if (!r) return;
  r.x = Number(pos?.x) || 0;
  r.y = Number(pos?.y) || 0;
});

Bus.on("entity:spawned", ({ playerId, entityId, entity }) => {
  wsRegistry.sendTo(playerId, { event: "entitySpawned", entityId, entity });
});

// Remove from index on despawn
Bus.on("entity:despawned", ({ playerId, entityId }) => {
  recordDespawn(playerId, entityId);
});

// -----------------------------
// Helpers
// -----------------------------
function toPos(p) {
  const x = (p && typeof p.x === "number") ? p.x : 0;
  const y = (p && typeof p.y === "number") ? p.y : 0;
  return { x, y };
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Find a nearby non-overlapping position.
 * Tries 'attempts' random offsets around base within 'searchRadius' (px),
 * ensuring no existing mob for the *same player & map instance* is closer than minSep.
 *
 * Returns { x, y } or null if nothing found.
 */
function findClearPos(playerId, mapId, instanceId, basePos, minSepPx, attempts = 12, searchRadius = null) {
  ensureOccFromStore(playerId);

  const occ = occFor(playerId);
  const minSep = Math.max(0, Number(minSepPx) || 0);
  const minSepSq = minSep * minSep;

  // Simple predicate: is this candidate too close to any existing mob in the same map/instance?
  function isBlocked(cx, cy) {
    for (const [, rec] of occ) {
      if (!rec || rec.mapId !== mapId || rec.instanceId !== instanceId) continue;
      if (distSq(cx, cy, rec.x, rec.y) < minSepSq) return true;
    }
    return false;
  }

  // If base is fine, use it as-is
  if (!isBlocked(basePos.x, basePos.y)) {
    return { x: basePos.x, y: basePos.y };
  }

  // Default search radius ~ 3x separation (tunable)
  const R = searchRadius != null ? searchRadius : Math.max(minSep * 3, 1);

  // Try a handful of jittered offsets (expanding ring)
  for (let i = 0; i < attempts; i++) {
    // sample radius in [minSep*0.6 .. R], angle random
    const angle = Math.random() * Math.PI * 2;
    const rad = (minSep * 0.6) + Math.random() * (R - (minSep * 0.6));
    const cx = basePos.x + Math.cos(angle) * rad;
    const cy = basePos.y + Math.sin(angle) * rad;
    if (!isBlocked(cx, cy)) {
      return { x: cx, y: cy };
    }
  }

  // Give up – caller decides whether to skip or place at base.
  return null;
}

// -----------------------------
// Spawning
// -----------------------------

/**
 * Spawn a mob for a specific player's map instance.
 *
 * @param {Object} opts
 * @param {string} opts.playerId
 * @param {string} opts.mapId
 * @param {string} [opts.instanceId="default"]
 * @param {string} opts.unitId                 // key in ENEMIES_CONFIG (e.g. "slimie")
 * @param {{x:number,y:number}} opts.pos       // requested center
 * @returns {Object|null} created row or null
 */
function spawnEnemy(opts = {}) {
  const {
    playerId,
    mapId,
    instanceId = "default",
    unitId,
    pos,
  } = opts;

  if (!playerId) throw new Error("spawnEnemy requires opts.playerId");
  if (!mapId)    throw new Error("spawnEnemy requires opts.mapId");
  if (!unitId)   throw new Error("spawnEnemy requires opts.unitId");

  const def = ENEMIES_CONFIG[unitId];
  if (!def) {
    throw new Error(`Unknown enemy type "${unitId}"`);
  }

  const basePos = toPos(pos);

  // Minimum separation – per-unit override or default ~28px.
  const minSepPx = Number(def.spawnSeparation != null ? def.spawnSeparation : 28);

  // Try to find a clear spot near the requested position.
  // If none found, we can choose to skip or force spawn at base.
  // Here: fallback to base (keeps gameplay flowing) – change to "return null" if you prefer skipping.
  const clear = (minSepPx > 0)
    ? (findClearPos(playerId, mapId, instanceId, basePos, minSepPx, 14, Math.max(minSepPx * 3, 64)) || basePos)
    : basePos;

  const entityId = uuidv4();

  const row = {
    entityId,
    ownerId: playerId,     // entityStore field
    type: "mob",
    mobType: unitId,
    mapId,
    instanceId,
    pos: clear,
    state: "idle",

    // Optional metadata carried alongside:
    stats: {
      maxHp: def.hp,
      hp: def.hp,
      maxMp: def.mp,
      mp: def.mp,
      spd: def.spd,
      atk: def.atk,
    },
    scenePath: def.scenePath, // e.g. res://assets/.../Slimie.tscn
    createdAt: Date.now(),
  };

  // Insert into the per-player store
  const created = Store.create(playerId, row);
  if (!created) return null;

  // Record occupancy so future spawns can avoid this position
  recordSpawn(playerId, created);

  // Emit canonical spawn event
  Bus.emit("entity:spawned", {
    playerId,
    entityId: created.entityId,
    entity: created,
  });

  return created;
}

/**
 * Convenience batch spawner: tries to place each position non-overlapping.
 */
function spawnEnemyBatch(baseOpts = {}, positions = []) {
  const out = [];
  for (const p of positions) {
    try {
      const row = spawnEnemy({ ...baseOpts, pos: p });
      if (row) out.push(row);
    } catch (_e) {
      // swallow per-spawn error to avoid aborting the whole batch
    }
  }
  return out;
}

module.exports = {
  spawnEnemy,
  spawnEnemyBatch,
};
