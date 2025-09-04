// server/systems/collision.js
//
// Continuous (segment) circle-vs-circle collision for a server-authoritative loop.
// Now also resolves STATIC MAP PROPS exported from Godot (polygons + circles).
//
// Dynamic entities:
//   • Moving circle vs moving obstacles (players/mobs) by sweeping in relative space
//     v_rel = v_mover - v_obstacle, TOI in relative frame, place at C(t)
//
// Static props (from colliderRegistry):
//   • Post-pass push-out against map "props" (poly/circle) with a few iterations
//
// Also includes:
//   • contact skin (benign tiny overlaps when moving out/tangent)
//   • capped tangent sliding per tick (no teleporty lateral jumps)
//   • iterative substeps
//
// Keep server code camelCase.

const Store      = require("../world/entityStore");
const ENEMIES    = require("../defs/enemiesConfig");
const Colliders  = require("../maps/colliderRegistry");

// ── Tuning (edit here) ──────────────────────────────────────────────────────
const TUNING = Object.freeze({
  playerRadiusPx      : 30,    // player "feet" radius in px
  mobRadiusDefaultPx  : 11,    // fallback mob radius if enemy def has no collisionRadius
  epsilonPx           : 0.65,  // separation placed just outside contact
  skinPx              : 1.2,   // allow this much initial overlap if moving out/tangent
  maxSubsteps         : 3,     // extra resolves for long moves / thin gaps
  slideEnabled        : true,  // slide along obstacle tangent after first hit
  slideCapPx          : 5.0,   // HARD CAP on total slide distance per tick
  separatingVelSlop   : 1e-4,  // treat near-tangent as separating
  nearZero            : 1e-6,  // numeric epsilon
});
// ────────────────────────────────────────────────────────────────────────────

// ---------- helpers ----------
function radiusOf(ent) {
  if (!ent) return 0;
  if (ent.type === "player") return TUNING.playerRadiusPx;

  if (ent.type === "mob" || ent.mobType) {
    const def = ent.mobType ? ENEMIES[ent.mobType] : null;
    if (def && Number.isFinite(def.collisionRadius)) return Math.max(1, def.collisionRadius);
    if (def && Number.isFinite(def.spawnSeparation))  return Math.max(1, Math.floor(def.spawnSeparation * 0.5));
    return TUNING.mobRadiusDefaultPx;
  }
  return 0;
}

function isSolid(ent) {
  if (!ent) return false;
  if (ent.state === "dead") return false;
  return ent.type === "player" || ent.type === "mob" || !!ent.mobType;
}

function dot(ax, ay, bx, by) { return ax*bx + ay*by; }

// ---------- benign overlap check (for dynamics) ----------
function benignStartOverlap(p0x, p0y, vx, vy, cx, cy, R) {
  const nx = p0x - cx;
  const ny = p0y - cy;
  const dist = Math.hypot(nx, ny);
  const depth = R - dist; // positive => overlapping
  if (depth <= 0 || depth > TUNING.skinPx) return false;
  if (dist <= TUNING.nearZero) return false; // at center: not benign
  const inv = 1.0 / dist;
  const nux = nx * inv, nuy = ny * inv;
  const vDotN = vx*nux + vy*nuy; // >0 outward, small negative ≈ tangent
  return vDotN >= -TUNING.separatingVelSlop;
}

/**
 * TOI for a moving circle p0→p1 relative to a *static* circle at (cx,cy) with radius R.
 * Supply p1 in the RELATIVE frame (i.e., p1_rel = p1 - v_obstacle).
 * Returns { t, startOverlapped } or null if no hit in [0,1].
 */
function firstHitParamRelative(p0x, p0y, p1x_rel, p1y_rel, cx, cy, R) {
  const vx = p1x_rel - p0x, vy = p1y_rel - p0y;
  const px = p0x - cx,      py = p0y - cy;

  const A = dot(vx, vy, vx, vy);
  if (A <= 1e-12) return null; // no motion

  const B = 2 * dot(px, py, vx, vy);
  const C = dot(px, py, px, py) - R*R;

  if (C <= 0) {
    if (benignStartOverlap(p0x, p0y, vx, vy, cx, cy, R)) return null;
    return { t: 0, startOverlapped: true };
  }

  const disc = B*B - 4*A*C;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-B - sqrtDisc) / (2*A);
  const t2 = (-B + sqrtDisc) / (2*A);

  let t = null;
  if (t1 >= 0 && t1 <= 1) t = t1;
  else if (t2 >= 0 && t2 <= 1) t = t2;
  if (t == null) return null;
  return { t, startOverlapped: false };
}

/**
 * Finds earliest hit against any solid in same map/instance using RELATIVE sweep.
 * velIndex: Map<entityId, {x:number, y:number}> for obstacle per-tick velocity (pixels this tick).
 * Returns null or: { t, cx, cy, R, ovx, ovy, startOverlapped }
 */
function sweepEarliestRelative(playerId, movingEnt, p0x, p0y, p1x, p1y, velIndex) {
  const r1     = radiusOf(movingEnt);
  const mapId  = movingEnt.mapId;
  const instId = movingEnt.instanceId;

  let best = null;

  Store.each(playerId, (otherId, other) => {
    if (!other || other.entityId === movingEnt.entityId) return;
    if (!isSolid(other)) return;
    if (other.mapId !== mapId || other.instanceId !== instId) return;

    const r2 = radiusOf(other);
    const cx = Number(other?.pos?.x) || 0;
    const cy = Number(other?.pos?.y) || 0;
    const R  = r1 + r2;

    const ov = velIndex?.get(String(otherId)) || { x: 0, y: 0 };

    // Build endpoint in relative space: p1_rel = p1 - v_obstacle
    const p1x_rel = p1x - ov.x;
    const p1y_rel = p1y - ov.y;

    const hit = firstHitParamRelative(p0x, p0y, p1x_rel, p1y_rel, cx, cy, R);
    if (!hit) return;
    if (!best || hit.t < best.t) {
      best = { t: hit.t, cx, cy, R, ovx: ov.x || 0, ovy: ov.y || 0, startOverlapped: hit.startOverlapped };
    }
  });

  return best;
}

/**
 * Resolve the path [prev -> target] with iterative substeps and capped sliding.
 * velIndex: per-tick obstacle velocities (pixels this tick).
 * (DYNAMIC entities only; static props are done in a post-pass below.)
 */
function resolvePath(playerId, movingEnt, prev, target, velIndex) {
  let p0x = Number(prev?.x)   || 0;
  let p0y = Number(prev?.y)   || 0;
  let p1x = Number(target?.x) || 0;
  let p1y = Number(target?.y) || 0;

  // world velocity of mover over this tick (unused directly, but left for clarity)
  const mvxFull = p1x - p0x;
  const mvyFull = p1y - p0y;

  let slideLeftPx = TUNING.slideCapPx;

  for (let step = 0; step <= TUNING.maxSubsteps; step++) {
    const hit = sweepEarliestRelative(playerId, movingEnt, p0x, p0y, p1x, p1y, velIndex);
    if (!hit) {
      // No collision along current segment → end here
      return { x: p1x, y: p1y, hit: false };
    }

    const vx = p1x - p0x, vy = p1y - p0y; // world mover segment for this substep
    const hx = p0x + vx * hit.t;
    const hy = p0y + vy * hit.t;

    // Normal computed in RELATIVE frame is equal to world normal at time t.
    // Enemy center advanced to time t in world space:
    const cx_t = hit.cx + hit.ovx * hit.t;
    const cy_t = hit.cy + hit.ovy * hit.t;

    const nxrX = (hx) - cx_t;
    const nxrY = (hy) - cy_t;
    const nLen = Math.hypot(nxrX, nxrY) || 1;
    const nx = nxrX / nLen, ny = nxrY / nLen;

    // Place just outside at time t
    const outX = cx_t + nx * (hit.R + TUNING.epsilonPx);
    const outY = cy_t + ny * (hit.R + TUNING.epsilonPx);

    if (!TUNING.slideEnabled || step === TUNING.maxSubsteps) {
      return { x: outX, y: outY, hit: true };
    }

    // Remaining fraction of the original world move for this substep
    const remain = 1 - hit.t;
    if (remain <= TUNING.nearZero) {
      return { x: outX, y: outY, hit: true };
    }

    // Tangent slide based on WORLD velocity
    const vDotN = vx*nx + vy*ny;
    let sx = vx - vDotN * nx;
    let sy = vy - vDotN * ny;

    // Use only the remaining fraction
    sx *= remain;
    sy *= remain;

    // If tangent is tiny, stop
    const sLen = Math.hypot(sx, sy);
    if (sLen <= TUNING.nearZero) {
      return { x: outX, y: outY, hit: true };
    }

    // CAP slide distance this tick
    const allowed = Math.max(0, Math.min(slideLeftPx, sLen));
    const scale = allowed / sLen;
    const cappedSX = sx * scale;
    const cappedSY = sy * scale;
    slideLeftPx -= allowed;

    // Advance to new segment
    const np0x = outX;
    const np0y = outY;
    const np1x = outX + cappedSX;
    const np1y = outY + cappedSY;

    if (allowed <= TUNING.nearZero ||
        (Math.abs(np1x - np0x) + Math.abs(np1y - np0y)) <= TUNING.nearZero) {
      return { x: outX, y: outY, hit: true };
    }

    p0x = np0x; p0y = np0y;
    p1x = np1x; p1y = np1y;
  }

  // Safety
  return { x: p0x, y: p0y, hit: true };
}

// ────────────────────────────────────────────────────────────────────────────
// STATIC PROPS (from server/maps/colliders/<area>/<map>.json)
// ────────────────────────────────────────────────────────────────────────────

function pushOutFromCircle(px, py, cx, cy, rSum) {
  const vx = px - cx, vy = py - cy;
  const d = Math.hypot(vx, vy);
  if (d >= rSum) return null;
  const nx = d > 1e-6 ? vx / d : 1;
  const ny = d > 1e-6 ? vy / d : 0;
  const depth = (rSum - d) + TUNING.epsilonPx;
  return { dx: nx * depth, dy: ny * depth };
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const ab2 = abx*abx + aby*aby || 1e-6;
  let t = (apx*abx + apy*aby) / ab2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return [ax + abx*t, ay + aby*t];
}

function pushOutFromPoly(px, py, verts, r) {
  let bestDepth = 0, bestNx = 0, bestNy = 0, hit = false;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const [cx, cy] = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
    const dx = px - cx, dy = py - cy;
    const dist = Math.hypot(dx, dy);
    const depth = r - dist;
    if (depth > bestDepth) {
      hit = true;
      bestDepth = depth;
      if (dist > 1e-6) {
        bestNx = dx / dist; bestNy = dy / dist;
      } else {
        bestNx = 1; bestNy = 0;
      }
    }
  }
  if (!hit || bestDepth <= 0) return null;
  const push = bestDepth + TUNING.epsilonPx;
  return { dx: bestNx * push, dy: bestNy * push };
}

/**
 * Pushes a moving circle out of static props for the entity's map.
 * Uses a few small iterations so compound overlaps settle.
 */
function resolveStaticProps(movingEnt, pos) {
  const radius = radiusOf(movingEnt);
  const data = Colliders.getColliders(movingEnt.mapId);
  const props = Array.isArray(data?.props) ? data.props : [];

  let rx = Number(pos?.x) || 0;
  let ry = Number(pos?.y) || 0;

  for (let iter = 0; iter < TUNING.maxSubsteps; iter++) {
    let moved = false;

    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!p || typeof p !== "object") continue;

      if (p.kind === "circle") {
        const res = pushOutFromCircle(rx, ry, Number(p.x)||0, Number(p.y)||0, radius + (Number(p.r)||0));
        if (res) { rx += res.dx; ry += res.dy; moved = true; }
      } else if (p.kind === "poly" && Array.isArray(p.verts) && p.verts.length >= 3) {
        const res = pushOutFromPoly(rx, ry, p.verts, radius);
        if (res) { rx += res.dx; ry += res.dy; moved = true; }
      }
    }

    if (!moved) break;
  }

  return { x: rx, y: ry };
}

// ────────────────────────────────────────────────────────────────────────────
// Public wrappers (movementLoop calls this)
// We first do dynamic sweep/slide, then ensure final position is not
// overlapping any static props by running the prop push-out.
// ────────────────────────────────────────────────────────────────────────────

function resolveWithSubsteps(playerId, movingEnt, prev, target, velIndex) {
  const dyn = resolvePath(playerId, movingEnt, prev, target, velIndex);
  return resolveStaticProps(movingEnt, dyn);
}

function resolveContinuous(playerId, movingEnt, prev, target, velIndex) {
  return resolveWithSubsteps(playerId, movingEnt, prev, target, velIndex);
}

module.exports = {
  TUNING,
  radiusOf,
  isSolid,
  resolveWithSubsteps,
  resolveContinuous,
};
