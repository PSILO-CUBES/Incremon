// server/systems/attackLoop.js
//
// Server-authoritative attack windows with optional queued movement.
// When an attack starts, we start a short timer. While in 'attack',
// any incoming moveIntentStart is queued (not applied). When the
// timer completes, we finish the attack and, if a queued move exists
// (or a resumeDir was captured at attack start), we transition to 'walk'.
//

const FSM        = require("./fsm");
const Store      = require("../world/entityStore");
const Movement   = require("./movementLoop");
const wsRegistry = require("../wsRegistry");

const DEFAULT_ATTACK_MS = Number(process.env.ATTACK_MS || 180);

// timers: Map<playerId, Map<entityId, Timeout>>
const _timers = new Map();
// queued directions while in attack: Map<playerId, Map<entityId, {x,y}>>
const _queued = new Map();
// captured dir at attack start (used if no queued dir arrives): Map<playerId, Map<entityId, {x,y}>>
const _resume = new Map();

function _sub(map, playerId) {
  let m = map.get(playerId);
  if (!m) { m = new Map(); map.set(playerId, m); }
  return m;
}

function _norm(d) {
  const dx = Number(d?.x), dy = Number(d?.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

function queueMove(playerId, entityId, dir) {
  const m = _sub(_queued, playerId);
  m.set(String(entityId), _norm(dir));
}

function clearQueued(playerId, entityId) {
  const m = _queued.get(playerId);
  if (m) m.delete(String(entityId));
}

function _takeQueued(playerId, entityId) {
  const m = _queued.get(playerId);
  if (!m) return null;
  const key = String(entityId);
  const d = m.get(key) || null;
  if (d) m.delete(key);
  return d;
}

function start(playerId, entityId, durationMs = DEFAULT_ATTACK_MS, resumeDir = null) {
  if (!playerId || !entityId) return;
  const ent = Store.get(playerId, entityId);
  if (!ent || ent.state !== "attack") return;

  const tmap = _sub(_timers, playerId);
  const k = String(entityId);
  const existing = tmap.get(k);
  if (existing) clearTimeout(existing);

  if (resumeDir) {
    _sub(_resume, playerId).set(k, _norm(resumeDir));
  } else {
    const r = _sub(_resume, playerId);
    r.delete(k);
  }

  const ms = Math.max(1, Number(durationMs) || DEFAULT_ATTACK_MS);
  const timeout = setTimeout(() => finish(playerId, entityId), ms);
  tmap.set(k, timeout);
}

function cancel(playerId, entityId) {
  const k = String(entityId);
  const tmap = _timers.get(playerId);
  if (tmap) {
    const t = tmap.get(k);
    if (t) clearTimeout(t);
    tmap.delete(k);
  }
  const q = _queued.get(playerId);
  if (q) q.delete(k);
  const r = _resume.get(playerId);
  if (r) r.delete(k);
}

function finish(playerId, entityId) {
  const k = String(entityId);

  const tmap = _timers.get(playerId);
  if (tmap) tmap.delete(k);

  const ent = Store.get(playerId, entityId);
  if (!ent) return;

  if (ent.state === "attack") {
    const res = FSM.apply(playerId, entityId, "attackFinished");
    if (res?.ok) {
      wsRegistry.sendTo(playerId, {
        event: "entityStateUpdate",
        payload: { entityId, state: "idle" }
      });
    }
  }

  let dir = _takeQueued(playerId, entityId);
  if (!dir) {
    const r = _resume.get(playerId);
    dir = r ? r.get(k) : null;
    if (r) r.delete(k);
  }

  if (dir && (Math.abs(dir.x) + Math.abs(dir.y) > 0)) {
    const allow = FSM.apply(playerId, entityId, "moveIntentStart");
    if (allow?.ok) {
      Movement.onMoveStart(playerId, entityId, dir);
      wsRegistry.sendTo(playerId, {
        event: "entityStateUpdate",
        payload: { entityId, state: "walk", dir }
      });
    }
  }
}

module.exports = {
  start,
  finish,
  cancel,
  queueMove,
  clearQueued,
};
