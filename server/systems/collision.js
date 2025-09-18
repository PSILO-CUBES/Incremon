// server/systems/collision.js
//
// AABB sweep against static AABBs. The moving body is an AABB with half-extents hx, hy.
// We inflate each static rect by (hx, hy) and sweep a point prev->wish using a slab test.
// This version reads static solids from colliderRegistry.getColliders(mapId)
// and converts polygon solids into AABB boxes on the fly.
//
// Conventions: camelCase, no semicolons

const Colliders = require("../maps/colliderRegistry")
const ENEMIES = require("../defs/enemiesConfig")
const { DEFAULT_PLAYER_DATA } = require("../defs/playerDefaults")

// ─────────────────────────────────────────────────────────────────────────────
// Size helpers
// ─────────────────────────────────────────────────────────────────────────────

function halfExtentsOf(ent) {
  if (ent && ent.type === "player") {
    const s = ent.stats || {}
    const hx = Number(s.colliderHx)
    const hy = Number(s.colliderHy)
    if (Number.isFinite(hx) && Number.isFinite(hy) && hx > 0 && hy > 0) return { hx: hx, hy: hy }
    // approx Capsule r=25, h=102
    return { hx: 25, hy: 51 }
  }

  if (ent && ent.type === "mob") {
    const s = ent.stats || {}
    const hxS = Number(s.colliderHx)
    const hyS = Number(s.colliderHy)
    if (Number.isFinite(hxS) && Number.isFinite(hyS) && hxS > 0 && hyS > 0) return { hx: hxS, hy: hyS }
    const def = ENEMIES ? ENEMIES[ent.mobType] : undefined
    const hxD = Number(def && def.colliderHx)
    const hyD = Number(def && def.colliderHy)
    if (Number.isFinite(hxD) && Number.isFinite(hyD) && hxD > 0 && hyD > 0) return { hx: hxD, hy: hyD }
    return { hx: 20, hy: 20 }
  }

  return { hx: 20, hy: 20 }
}

// kept for compatibility where code expects a "radius"
function radiusOf(ent) {
  const he = halfExtentsOf(ent)
  let r = he.hx
  if (he.hy > r) r = he.hy
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// Static rects from collider registry (polys → AABBs)
// ─────────────────────────────────────────────────────────────────────────────

const _rectCache = new Map()

function _buildAabbsFromSolids(solids) {
  const rects = []
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    const kind = s && s.kind ? String(s.kind).toLowerCase() : ""

    if (kind === "rect") {
      const x = Number(s.x)
      const y = Number(s.y)
      const w = Number(s.w)
      const h = Number(s.h)
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        rects.push({ x: x, y: y, w: w, h: h })
      }
      continue
    }

    if (kind === "poly" || (Array.isArray(s.verts) && s.verts.length >= 3)) {
      const verts = s.verts || []
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let vi = 0; vi < verts.length; vi++) {
        const vx = Number(verts[vi] && verts[vi].x)
        const vy = Number(verts[vi] && verts[vi].y)
        if (Number.isFinite(vx) && Number.isFinite(vy)) {
          if (vx < minX) minX = vx
          if (vy < minY) minY = vy
          if (vx > maxX) maxX = vx
          if (vy > maxY) maxY = vy
        }
      }
      if (minX < Infinity && minY < Infinity && maxX > -Infinity && maxY > -Infinity) {
        const w = Math.max(0, maxX - minX)
        const h = Math.max(0, maxY - minY)
        if (w > 0 && h > 0) {
          rects.push({ x: minX, y: minY, w: w, h: h })
        }
      }
    }
  }
  return rects
}

function _staticRects(mapId) {
  const key = String(mapId || "unknown")
  if (_rectCache.has(key)) return _rectCache.get(key)

  let rects = []
  let src = "not_found"

  try {
    const data = Colliders && typeof Colliders.getColliders === "function" ? Colliders.getColliders(mapId) : null
    if (data && Array.isArray(data.solids)) {
      rects = _buildAabbsFromSolids(data.solids)
      src = "getColliders(solids->AABBs)"
    }
  } catch (_e) {}

  if (rects.length > 0) {
    const r0 = rects[0]
    console.log("[COLREG] source=" + src + " count=" + rects.length + " sample=(" + r0.x + "," + r0.y + "," + r0.w + "," + r0.h + ")")
  } else {
    console.log("[COLREG] source=" + src + " count=0")
  }

  _rectCache.set(key, rects)
  return rects
}

// ─────────────────────────────────────────────────────────────────────────────
// Math
// ─────────────────────────────────────────────────────────────────────────────

function _rayVsAabb(p0, p1, rx, ry, rw, rh) {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y

  let tMin = 0
  let tMax = 1
  let nx = 0
  let ny = 0

  if (Math.abs(dx) < 1e-8) {
    if (p0.x < rx || p0.x > rx + rw) return { hit: false }
  } else {
    const inv = 1 / dx
    const t1 = (rx - p0.x) * inv
    const t2 = (rx + rw - p0.x) * inv
    let tEntry = t1
    if (t2 < t1) tEntry = t2
    let tExit = t2
    if (t1 > t2) tExit = t1
    if (tEntry > tMin) {
      tMin = tEntry
      if (t1 < t2) {
        nx = -1
        ny = 0
      } else {
        nx = 1
        ny = 0
      }
    }
    if (tExit < tMax) tMax = tExit
    if (tMin > tMax) return { hit: false }
  }

  if (Math.abs(dy) < 1e-8) {
    if (p0.y < ry || p0.y > ry + rh) return { hit: false }
  } else {
    const inv = 1 / dy
    const t1 = (ry - p0.y) * inv
    const t2 = (ry + rh - p0.y) * inv
    let tEntry = t1
    if (t2 < t1) tEntry = t2
    let tExit = t2
    if (t1 > t2) tExit = t1
    if (tEntry > tMin) {
      tMin = tEntry
      if (t1 < t2) {
        nx = 0
        ny = -1
      } else {
        nx = 0
        ny = 1
      }
    }
    if (tExit < tMax) tMax = tExit
    if (tMin > tMax) return { hit: false }
  }

  if (tMin < 0 || tMin > 1) return { hit: false }
  return { hit: true, t: tMin, nx: nx, ny: ny }
}

function _sweepAabbAgainstStaticsWithRects(rects, he, prev, wish) {
  if (!rects || rects.length === 0) return { x: wish.x, y: wish.y, blocked: false }

  const p0 = { x: prev.x, y: prev.y }
  const p1 = { x: wish.x, y: wish.y }

  let best = null

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const rx = Number(r.x) - he.hx
    const ry = Number(r.y) - he.hy
    const rw = Number(r.w) + 2 * he.hx
    const rh = Number(r.h) + 2 * he.hy
    const hit = _rayVsAabb(p0, p1, rx, ry, rw, rh)
    if (hit && hit.hit) {
      if (!best || hit.t < best.t) {
        best = { idx: i, rx: rx, ry: ry, rw: rw, rh: rh, t: hit.t, nx: hit.nx, ny: hit.ny }
      }
    }
  }

  if (!best) return { x: wish.x, y: wish.y, blocked: false }

  console.log("[HIT] rectIdx=" + best.idx + " t=" + best.t.toFixed(3) + " n=(" + best.nx + "," + best.ny + ") expanded=(" + best.rx + "," + best.ry + "," + best.rw + "," + best.rh + ") prev=(" + p0.x + "," + p0.y + ") wish=(" + p1.x + "," + p1.y + ")")

  const eps = 0.001
  const cx = p0.x + (p1.x - p0.x) * Math.max(0, best.t - eps)
  const cy = p0.y + (p1.y - p0.y) * Math.max(0, best.t - eps)

  const rxv = p1.x - cx
  const ryv = p1.y - cy
  let tx = rxv
  let ty = ryv
  if (best.nx !== 0) tx = 0
  if (best.ny !== 0) ty = 0

  const sx = cx + tx
  const sy = cy + ty

  const second = _sweepAabbAgainstStaticsWithRects_NoSlide(rects, he, { x: cx, y: cy }, { x: sx, y: sy })
  return { x: second.x, y: second.y, blocked: true }
}

function _sweepAabbAgainstStaticsWithRects_NoSlide(rects, he, prev, wish) {
  if (!rects || rects.length === 0) return { x: wish.x, y: wish.y }

  const p0 = { x: prev.x, y: prev.y }
  const p1 = { x: wish.x, y: wish.y }

  let best = null

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const rx = Number(r.x) - he.hx
    const ry = Number(r.y) - he.hy
    const rw = Number(r.w) + 2 * he.hx
    const rh = Number(r.h) + 2 * he.hy
    const hit = _rayVsAabb(p0, p1, rx, ry, rw, rh)
    if (hit && hit.hit) {
      if (!best || hit.t < best.t) best = { idx: i, t: hit.t }
    }
  }

  if (!best) return { x: wish.x, y: wish.y }

  const eps = 0.001
  const cx = p0.x + (p1.x - p0.x) * Math.max(0, best.t - eps)
  const cy = p0.y + (p1.y - p0.y) * Math.max(0, best.t - eps)
  return { x: cx, y: cy }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main API
// ─────────────────────────────────────────────────────────────────────────────

function resolveWithSubsteps(playerId, movingMeta, prev, clampedWish, velIndex, posIndex) {
  const he = {
    hx: Number(movingMeta && movingMeta.hx) || 20,
    hy: Number(movingMeta && movingMeta.hy) || 20
  }
  const mapId = movingMeta && movingMeta.mapId ? movingMeta.mapId : undefined

  const rects = _staticRects(mapId)

  const first = _sweepAabbAgainstStaticsWithRects(rects, he, prev, clampedWish)
  return { x: first.x, y: first.y }
}

module.exports = {
  resolveWithSubsteps,
  halfExtentsOf,
  radiusOf
}
