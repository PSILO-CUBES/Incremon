// server/maps/colliderRegistry.js
const fs = require("fs");
const path = require("path");

const ROOT = __dirname; // server/maps
const COLLIDERS_DIR = path.join(ROOT, "colliders");

const _cache = new Map();

function _sanitizeNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

function _sanitizeVertex(v) {
  return { x: _sanitizeNumber(v?.x), y: _sanitizeNumber(v?.y) };
}

function _sanitizeSolid(s) {
  if (!s || typeof s !== "object") return null;
  if (s.kind === "circle") {
    return {
      kind: "circle",
      x: _sanitizeNumber(s.x),
      y: _sanitizeNumber(s.y),
      r: Math.max(0, _sanitizeNumber(s.r)),
    };
  }
  if (s.kind === "poly") {
    const verts = Array.isArray(s.verts) ? s.verts.map(_sanitizeVertex).filter(Boolean) : [];
    if (verts.length >= 3) return { kind: "poly", verts };
    return null;
  }
  return null;
}

function _load(mapId) {
  const rel = mapId.replace(/\\+/g, "/"); // normalize
  const parts = rel.split("/");
  const file = path.join(COLLIDERS_DIR, ...parts.slice(0, -1), `${parts[parts.length - 1]}.json`);
  if (!fs.existsSync(file)) {
    return { mapId, version: 0, bounds: null, solids: [] };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("[colliderRegistry] Failed to parse:", file, err);
    return { mapId, version: 0, bounds: null, solids: [] };
  }
  const out = {
    mapId: String(raw.mapId || mapId),
    version: Number(raw.version) || 0,
    bounds: null,
    solids: [],
  };
  if (raw.bounds && typeof raw.bounds === "object") {
    out.bounds = {
      x: _sanitizeNumber(raw.bounds.x),
      y: _sanitizeNumber(raw.bounds.y),
      w: Math.max(0, _sanitizeNumber(raw.bounds.w)),
      h: Math.max(0, _sanitizeNumber(raw.bounds.h)),
    };
  }
  if (Array.isArray(raw.solids)) {
    out.solids = raw.solids.map(_sanitizeSolid).filter(Boolean);
  }
  return out;
}

function getColliders(mapId) {
  if (!_cache.has(mapId)) {
    _cache.set(mapId, _load(mapId));
  }
  return _cache.get(mapId);
}

function getMapBounds(mapId) {
  const data = getColliders(mapId);
  return data.bounds || null;
}

function invalidate(mapId) {
  _cache.delete(mapId);
}

module.exports = {
  getColliders,
  getMapBounds,
  invalidate,
};
