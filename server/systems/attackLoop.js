// server/systems/attackLoop.js
//
// Server-authoritative attack windows with optional queued movement.
// When an attack starts, we store the attack position and start a short timer.
// While in 'attack', any incoming moveIntentStart is queued (not applied).
// When the timer completes, we finish the attack and, if a queued move exists
// (or a resumeDir was captured at attack start), we transition to 'walk'.
//

const FSM        = require("./fsm");
const Store      = require("../world/entityStore");
const Movement   = require("./movementLoop");
const wsRegistry = require("../wsRegistry");

const DEFAULT_ATTACK_MS = 1000; /* if durationMs from aiFollowLoop isint provided */

// timers: Map<playerId, Map<entityId, Timeout>>
const _timers = new Map();
// queued directions while in attack: Map<playerId, Map<entityId, {x,y}>>
const _queued = new Map();
// captured dir at attack start (used if no queued dir arrives): Map<playerId, Map<entityId, {x,y}>>
const _resume = new Map();
// attack positions: Map<playerId, Map<entityId, {x,y}>>
const _positions = new Map();

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

function start(playerId, entityId, attackPos, durationMs = DEFAULT_ATTACK_MS, resumeDir = null) {
  if (!playerId || !entityId) return;
  const ent = Store.get(playerId, entityId);
  if (!ent || ent.state !== "attack") return;

  const tmap = _sub(_timers, playerId);
  const k = String(entityId);
  const existing = tmap.get(k);
  if (existing) clearTimeout(existing);

  // store attack position
  _sub(_positions, playerId).set(k, { x: attackPos.x, y: attackPos.y });

  // Only players capture a resumeDir; enemies shouldn't auto-resume
  if (ent.type === "player" && resumeDir) {
    _sub(_resume, playerId).set(k, _norm(resumeDir));
  } else {
    const r = _sub(_resume, playerId);
    r.delete(k);
  }

  const ms = Math.max(1, durationMs);
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
  const p = _positions.get(playerId);
  if (p) p.delete(k);
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
      const nowEnt = Store.get(playerId, entityId);
      wsRegistry.sendTo(playerId, {
        event: "entityStateUpdate",
        payload: { 
          entityId, 
          state: nowEnt.state 
        }
      });
    }
  }

  if (ent.type === "player") {
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
        const nowEnt = Store.get(playerId, entityId);
        wsRegistry.sendTo(playerId, {
          event: "entityStateUpdate",
          payload: { 
            entityId, 
            state: nowEnt.state, 
            dir 
          }
        });
      }
    }
  } else {
    const q = _queued.get(playerId); if (q) q.delete(k);
    const r = _resume.get(playerId); if (r) r.delete(k);
  }

  const p = _positions.get(playerId);
  if (p) p.delete(k);
}

function getAttackPos(playerId, entityId) {
  const posMap = _positions.get(playerId);
  if (!posMap) return null;
  return posMap.get(String(entityId)) || null;
}

module.exports = {
  start,
  finish,
  cancel,
  queueMove,
  clearQueued,
  getAttackPos,
};
