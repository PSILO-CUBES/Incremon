// server/maps/mapRegistry.js
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "mapConfig.json");
let CFG;

function clamp(n, min, max) {
  if (min != null && n < min) n = min;
  if (max != null && n > max) n = max;
  return n;
}
function toNum(x, def) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}
function toInt(x, def) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : def;
}

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const json = JSON.parse(raw);

  // minimal validation + normalization
  for (const [id, infoRaw] of Object.entries(json)) {
    if (!infoRaw || typeof infoRaw !== "object") {
      throw new Error(`map ${id}: invalid object`);
    }

    const info = { ...infoRaw };

    // required: spawns list
    if (!Array.isArray(info.spawns) || info.spawns.length === 0) {
      throw new Error(`map ${id}: must define at least one spawn`);
    }
    for (const s of info.spawns) {
      if (typeof s.x !== "number" || typeof s.y !== "number") {
        throw new Error(`map ${id}: spawn must have numeric x,y`);
      }
    }

    // ----- map-level spawn properties (with safe defaults) -----
    info.spawnRatePerSec = clamp(toNum(info.spawnRatePerSec, 1), 0, 20); // ticks/spawner/sec
    info.burstMin = clamp(toInt(info.burstMin, 1), 0, 100);
    info.burstMax = clamp(toInt(info.burstMax, Math.max(1, info.burstMin)), info.burstMin, 100);
    info.maxAliveOnMap = clamp(toInt(info.maxAliveOnMap, 10), 0, 10000);

    // ----- Optional: spawners array (points + radius + type) -----
    if (info.spawners !== undefined) {
      if (!Array.isArray(info.spawners)) {
        throw new Error(`map ${id}: spawners must be an array if present`);
      }
      info.spawners = info.spawners.map((sp, i) => {
        if (typeof sp !== "object" || sp === null) {
          throw new Error(`map ${id}: spawner[${i}] must be an object`);
        }
        if (typeof sp.x !== "number" || typeof sp.y !== "number") {
          throw new Error(`map ${id}: spawner[${i}] must have numeric x,y`);
        }
        const radius = toNum(sp.radius, 64);
        const mobType = (typeof sp.mobType === "string" && sp.mobType.length) ? sp.mobType : "mob";
        const sid = sp.id || `${id}-s${i}`;
        return { id: sid, x: sp.x, y: sp.y, radius, mobType };
      });
    }

    json[id] = info; // write back normalized
  }

  return json;
}

try {
  CFG = loadConfig();
} catch (e) {
  console.error("Failed to load mapConfig.json:", e);
  // fail-safe default
  CFG = {
    "area1/m1": {
      version: 1,
      spawns: [{ x: 320, y: 320 }],
      spawnRatePerSec: 1,
      burstMin: 1,
      burstMax: 3,
      maxAliveOnMap: 10,
      spawners: []
    }
  };
}

function getMapInfo(mapId) {
  return CFG[mapId] || null;
}

function pickSpawn(mapId, playerId = "") {
  const info = getMapInfo(mapId);
  if (!info) return { x: 320, y: 320 };
  const list = info.spawns || [];
  if (list.length === 0) return { x: 320, y: 320 };
  // stable per-player index (optional)
  let idx = 0;
  if (playerId) {
    let h = 0;
    for (let i = 0; i < playerId.length; i++) h = (h * 33 + playerId.charCodeAt(i)) >>> 0;
    idx = h % list.length;
  }
  return list[idx];
}

module.exports = { getMapInfo, pickSpawn };
