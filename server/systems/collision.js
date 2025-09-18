// server/systems/collision.js
//
// Authoritative collision & prediction (server).
// - Uses a FROZEN position snapshot (posIndex) so sweeps never read already-mutated positions.
// - Adds tiny, edge-safe tangent slide with a short-lived "coast" memory to avoid sticky grazes.
// - Keeps conservative ε and static bias so we don't reintroduce hop-over/clipping.
//
// Conventions: camelCase, no semicolons.

const ENEMIES   = require("../defs/enemiesConfig")
const Colliders = require("../maps/colliderRegistry")

// ─────────────────────────────────────────────────────────────────────────────
// Tuning
// ─────────────────────────────────────────────────────────────────────────────
const TUNING = Object.freeze({
  playerRadiusPx     : 30,
  mobRadiusDefaultPx : 11,

  epsilonPx          : 0.45,  // separation to rest outside contact
  nearZero           : 1e-6,

  maxSubsteps        : 3,     // dynamic iterations (also used by static settle)

  // Tiny, edge-safe slide to align with client behavior (prevents rollback)
  slideEnabled       : true,
  slideCapPx         : 1.5,   // base slide per tick (kept small)
  slideStepPx        : 0.75,  // micro-step size; static settle after each

  // Short "coast" after first contact to prevent stiction on grazes
  coastBonusPx       : 1.0,   // extra allowed slide while coasting
  coastMs            : 180,   // ~4 ticks @24Hz
  grazeAngleDeg      : 30,    // treat as graze if intent is within 30° of tangent
  minGrazeSlidePx    : 0.4,   // ensure at least this much slide on a graze

  // Static pass bias to catch grazes (props only)
  staticEdgeBiasPx   : 0.25,

  // Deadzone only used to detect "no intent"; we do not axis-lock
  intentDeadzonePx   : 0.05,
})

// ─────────────────────────────────────────────────────────────────────────────
// Small state: recent contact normals per entity (for coast)
// ─────────────────────────────────────────────────────────────────────────────
const CONTACT_MEM = new Map() // Map<entityId, { nx, ny, until }>

function _rememberContact(entityId, nx, ny) {
  CONTACT_MEM.set(String(entityId), { nx, ny, until: Date.now() + TUNING.coastMs })
}
function _getContact(entityId) {
  const rec = CONTACT_MEM.get(String(entityId))
  if (!rec) return null
  if (Date.now() > rec.until) { CONTACT_MEM.delete(String(entityId)); return null }
  return rec
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function dot(ax, ay, bx, by) { return ax * bx + ay * by }
function hypot(x, y) { return Math.sqrt(x * x + y * y) || 0 }
function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n) }

function radiusOf(ent) {
  if (!ent) return 0
  if (ent.type === "player") return TUNING.playerRadiusPx
  if (ent.type === "mob" || ent.mobType) {
    const def = ent.mobType ? ENEMIES[ent.mobType] : null
    if (def && Number.isFinite(def.collisionRadius)) return Math.max(1, def.collisionRadius)
    if (def && Number.isFinite(def.spawnSeparation))  return Math.max(1, Math.floor(def.spawnSeparation * 0.5))
    return TUNING.mobRadiusDefaultPx
  }
  return 0
}

function isSolid(ent) {
  if (!ent) return false
  if (ent.state === "dead" || ent.state === "despawn") return false
  return ent.type === "player" || ent.type === "mob" || !!ent.mobType
}

function hasIntent(prev, target) {
  const ix = (Number(target?.x) || 0) - (Number(prev?.x) || 0)
  const iy = (Number(target?.y) || 0) - (Number(prev?.y) || 0)
  return Math.abs(ix) > TUNING.intentDeadzonePx || Math.abs(iy) > TUNING.intentDeadzonePx
}

// angle between vector a and b in degrees (guarded)
function angleDeg(ax, ay, bx, by) {
  const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1
  const c = clamp((ax * bx + ay * by) / (la * lb), -1, 1)
  return Math.acos(c) * 180 / Math.PI
}

// project v onto plane perpendicular to n (tangent component)
function tangentOf(vx, vy, nx, ny) {
  const vDotN = vx * nx + vy * ny
  return { tx: vx - vDotN * nx, ty: vy - vDotN * ny }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic circles (relative sweep)
// ─────────────────────────────────────────────────────────────────────────────
function resolveStartOverlapImmediate(p0x, p0y, cx, cy, R) {
  const dx = p0x - cx
  const dy = p0y - cy
  const d  = hypot(dx, dy)
  if (d >= R) return { x: p0x, y: p0y, pushed: false }
  const nx = d > 1e-6 ? dx / d : 1
  const ny = d > 1e-6 ? dy / d : 0
  const depth = (R - d) + TUNING.epsilonPx
  return { x: p0x + nx * depth, y: p0y + ny * depth, pushed: true, nx, ny }
}

function firstHitParamRelative(p0x, p0y, p1xRel, p1yRel, cx, cy, R) {
  const sx = p0x - cx
  const sy = p0y - cy
  const vx = p1xRel - p0x
  const vy = p1yRel - p0y

  const A = dot(vx, vy, vx, vy)
  const B = 2 * dot(sx, sy, vx, vy)
  const C = dot(sx, sy, sx, sy) - R * R
  if (A <= TUNING.nearZero) return null

  const D = B * B - 4 * A * C
  if (D < 0) return null

  const sqrtD = Math.sqrt(D)
  let t = (-B - sqrtD) / (2 * A)
  if (t < 0 || t > 1) {
    t = (-B + sqrtD) / (2 * A)
    if (t < 0 || t > 1) return null
  }
  return { t, cx, cy }
}

function sweepEarliestRelative(playerId, movingEnt, p0x, p0y, p1x, p1y, velIndex, posIndex) {
  const r1     = radiusOf(movingEnt)
  const mapId  = movingEnt.mapId
  const instId = movingEnt.instanceId

  let best = null

  // Iterate FROZEN snapshot (posIndex) instead of live store to avoid ordering bugs
  if (posIndex && typeof posIndex.forEach === "function") {
    posIndex.forEach((rec, otherId) => {
      if (!rec) return
      if (String(otherId) === String(movingEnt.entityId)) return
      if (!isSolid(rec)) return
      if (rec.mapId !== mapId || rec.instanceId !== instId) return

      const r2 = radiusOf(rec)
      const cx = Number(rec.x) || 0
      const cy = Number(rec.y) || 0
      const R  = r1 + r2

      // Start-overlap push-out (t=0)
      const start = resolveStartOverlapImmediate(p0x, p0y, cx, cy, R)
      if (start.pushed) {
        const hit = { t: 0, cx, cy, ovx: 0, ovy: 0, R, startPushed: start }
        best = best || hit
        return
      }

      const ov = velIndex?.get(String(otherId)) || { x: 0, y: 0 }
      const p1xRel = p1x - ov.x
      const p1yRel = p1y - ov.y

      const fh = firstHitParamRelative(p0x, p0y, p1xRel, p1yRel, cx, cy, R)
      if (!fh) return

      const hit = { t: fh.t, cx, cy, ovx: ov.x, ovy: ov.y, R, startPushed: null }
      if (!best || hit.t < best.t) best = hit
    })
    return best
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Static props helpers
// ─────────────────────────────────────────────────────────────────────────────
function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay
  const apx = px - ax, apy = py - ay
  const ab2 = abx * abx + aby * aby || 1e-6
  let t = (apx * abx + apy * aby) / ab2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return [ax + abx * t, ay + aby * t]
}

function pointInPolygon(px, py, verts) {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y
    const xj = verts[j].x, yj = verts[j].y
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-8) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function pushOutFromCircle(px, py, cx, cy, rSum) {
  const vx = px - cx, vy = py - cy
  const d  = hypot(vx, vy)
  if (d >= rSum) return null
  const nx = d > 1e-6 ? vx / d : 1
  const ny = d > 1e-6 ? vy / d : 0
  const depth = (rSum - d) + TUNING.epsilonPx
  return { dx: nx * depth, dy: ny * depth }
}

function pushOutFromPoly(px, py, verts, r) {
  if (!Array.isArray(verts) || verts.length < 3) return null

  let bestDx = 0, bestDy = 0
  let bestDist = Infinity
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length]
    const [cx, cy] = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y)
    const dx = px - cx, dy = py - cy
    const dist = hypot(dx, dy)
    if (dist < bestDist) { bestDist = dist; bestDx = dx; bestDy = dy }
  }

  const inside = pointInPolygon(px, py, verts)
  if (!inside) {
    if (bestDist >= r) return null
    const inv = bestDist > 1e-6 ? 1 / bestDist : 0
    const nx = inv ? (bestDx * inv) : 1
    const ny = inv ? (bestDy * inv) : 0
    const depth = (r - bestDist) + TUNING.epsilonPx
    return { dx: nx * depth, dy: ny * depth }
  }

  // Center inside polygon → push outward
  const inv = bestDist > 1e-6 ? 1 / bestDist : 0
  const nx = inv ? (-bestDx * inv) : -1
  const ny = inv ? (-bestDy * inv) : 0
  const depth = (r + bestDist) + TUNING.epsilonPx
  return { dx: nx * depth, dy: ny * depth }
}

// Static settle (props only)
function resolveStaticProps(movingEnt, pos) {
  const baseRadius = radiusOf(movingEnt)
  const radius = baseRadius + TUNING.staticEdgeBiasPx

  const data = Colliders.getColliders(movingEnt.mapId)
  const props = Array.isArray(data?.solids) ? data.solids
              : Array.isArray(data?.props)  ? data.props
              : []

  let rx = Number(pos?.x) || 0
  let ry = Number(pos?.y) || 0

  for (let iter = 0; iter < TUNING.maxSubsteps; iter++) {
    let moved = false
    for (let i = 0; i < props.length; i++) {
      const p = props[i]
      if (!p || typeof p !== "object") continue

      if (p.kind === "circle") {
        const res = pushOutFromCircle(rx, ry, Number(p.x) || 0, Number(p.y) || 0,
                                      radius + Math.max(0, Number(p.r) || 0))
        if (res) { rx += res.dx; ry += res.dy; moved = true }
      } else if (p.kind === "poly" && Array.isArray(p.verts) && p.verts.length >= 3) {
        const r = pushOutFromPoly(rx, ry, p.verts, radius)
        if (r) { rx += r.dx; ry += r.dy; moved = true }
      }
    }
    if (!moved) break
  }
  return { x: rx, y: ry }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic resolve with anti-stiction "coast" slide (snapshot-driven sweeps)
// ─────────────────────────────────────────────────────────────────────────────
function resolvePath(playerId, movingEnt, prev, target, velIndex, posIndex) {
  let p0x = Number(prev?.x)   || 0
  let p0y = Number(prev?.y)   || 0
  let p1x = Number(target?.x) || 0
  let p1y = Number(target?.y) || 0

  // Budget includes base cap + coast bonus if we just touched recently
  let budget = TUNING.slideEnabled ? TUNING.slideCapPx : 0
  const mem = _getContact(movingEnt.entityId)
  if (mem) budget += TUNING.coastBonusPx

  const intendVx = p1x - p0x
  const intendVy = p1y - p0y

  for (let step = 0; step <= TUNING.maxSubsteps; step++) {
    const hit = sweepEarliestRelative(playerId, movingEnt, p0x, p0y, p1x, p1y, velIndex, posIndex)
    if (!hit) {
      return { x: p1x, y: p1y, hit: false }
    }

    // Hit normal & "outside" placement
    let outX, outY, nx, ny
    if (hit.startPushed) {
      outX = hit.startPushed.x
      outY = hit.startPushed.y
      nx   = hit.startPushed.nx
      ny   = hit.startPushed.ny
    } else {
      const vx = p1x - p0x
      const vy = p1y - p0y

      const hx = p0x + vx * hit.t
      const hy = p0y + vy * hit.t

      const cxT = hit.cx + hit.ovx * hit.t
      const cyT = hit.cy + hit.ovy * hit.t

      const nxrX = hx - cxT
      const nxrY = hy - cyT
      const nLen = hypot(nxrX, nxrY) || 1
      nx = nxrX / nLen
      ny = nxrY / nLen

      outX = cxT + nx * (hit.R + TUNING.epsilonPx)
      outY = cyT + ny * (hit.R + TUNING.epsilonPx)
    }

    // Remember contact normal for short "coast" window
    _rememberContact(movingEnt.entityId, nx, ny)

    if (!TUNING.slideEnabled || budget <= TUNING.nearZero || !hasIntent(prev, target)) {
      return { x: outX, y: outY, hit: true }
    }

    // Tangent of intended move
    const { tx, ty } = tangentOf(intendVx, intendVy, nx, ny)
    let tLen = hypot(tx, ty)

    // If this is a shallow graze, ensure a minimum tiny slide
    if (tLen <= TUNING.nearZero) {
      // if intent is almost tangent (based on last mem normal), allow tiny nudge
      const m = mem || { nx, ny }
      const gx = -m.ny, gy = m.nx // one tangent orientation
      const ang = angleDeg(intendVx, intendVy, gx, gy)
      if (ang <= TUNING.grazeAngleDeg || Math.abs(ang - 180) <= TUNING.grazeAngleDeg) {
        // create a small tangent in the direction of intent projection
        const sign = (intendVx * gx + intendVy * gy) >= 0 ? 1 : -1
        return _finishWithSlide(movingEnt, outX, outY, gx * sign * TUNING.minGrazeSlidePx, gy * sign * TUNING.minGrazeSlidePx)
      }
      // otherwise just stop flush
      return { x: outX, y: outY, hit: true }
    }

    // Limit by budget and micro-step along static geometry
    const scale = Math.min(1, budget / tLen)
    const sx = tx * scale
    const sy = ty * scale

    return _finishWithSlide(movingEnt, outX, outY, sx, sy)
  }

  // Safety
  return { x: p0x, y: p0y, hit: true }
}

function _finishWithSlide(movingEnt, outX, outY, sx, sy) {
  const slid = _edgeSafeSlide(movingEnt, outX, outY, sx, sy)
  // Soft unstick: if we barely moved, try a tiny 0.25px nudge along the same direction
  if (hypot(slid.x - outX, slid.y - outY) < 0.1) {
    const len = hypot(sx, sy) || 1
    const nud = _edgeSafeSlide(movingEnt, outX, outY, (sx / len) * 0.25, (sy / len) * 0.25)
    return { x: nud.x, y: nud.y, hit: true }
  }
  return { x: slid.x, y: slid.y, hit: true }
}

// micro-step slide with static checks to avoid hopping over short edges/end-caps
function _edgeSafeSlide(movingEnt, startX, startY, sx, sy) {
  let len = hypot(sx, sy)
  if (len <= TUNING.nearZero) return { x: startX, y: startY }

  // Cap total step length to (base + possible coast bonus) but caller already scaled;
  // here we only ensure micro-steps and static settle.
  const step = Math.max(0.25, Math.min(TUNING.slideStepPx, len))
  const dx = sx / len
  const dy = sy / len

  let curX = startX
  let curY = startY
  let left = len

  while (left > TUNING.nearZero) {
    const dist = Math.min(step, left)
    const nx = curX + dx * dist
    const ny = curY + dy * dist

    const settled = resolveStaticProps(movingEnt, { x: nx, y: ny })

    // If static settle pulled significantly, stop just before penetration
    const pull = hypot(settled.x - nx, settled.y - ny)
    if (pull > 0.5) {
      const eps = 0.25
      const bx = curX + dx * Math.max(0, dist - eps)
      const by = curY + dy * Math.max(0, dist - eps)
      const bsettled = resolveStaticProps(movingEnt, { x: bx, y: by })
      return { x: bsettled.x, y: bsettled.y }
    }

    curX = settled.x
    curY = settled.y
    left -= dist
  }

  return { x: curX, y: curY }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public wrappers
// ─────────────────────────────────────────────────────────────────────────────
function resolveWithSubsteps(playerId, movingEnt, prev, target, velIndex, posIndex) {
  const dyn = resolvePath(playerId, movingEnt, prev, target, velIndex, posIndex)
  // Final static settle (props) for robustness
  return resolveStaticProps(movingEnt, { x: dyn.x, y: dyn.y })
}

function resolveContinuous(playerId, movingEnt, prev, target, velIndex, posIndex) {
  return resolveWithSubsteps(playerId, movingEnt, prev, target, velIndex, posIndex)
}

module.exports = {
  TUNING,
  radiusOf,
  isSolid,
  resolveWithSubsteps,
  resolveContinuous,
}