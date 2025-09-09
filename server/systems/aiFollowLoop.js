// server/systems/aiFollowLoop.js
//
// Server-side AI that makes mobs chase their owner's player and
// switch to 'attack' when inside an attack radius. It enforces a
// server-authoritative ATTACK COOLDOWN and never re-triggers while
// already in 'attack'. After the attack window completes, the mob
// resumes walking toward the player using the resumeDir captured
// at attack start (handled by attackLoop).
//
// Integrates with existing systems:
//  - entityStore: read/write positions + states (emits bus events)
//  - movementLoop: accepts setDir/onMoveStop to drive motion
//  - fsm: validates and applies state transitions
//  - attackLoop: starts/finishes attack windows w/ resumeDir support
//  - wsRegistry: enumerate active players (per-player stores)
//
// Optional per-mob tuning:
//  - If ENEMIES_CONFIG[mob.mobType].attackRangePx is set, it overrides ATTACK_RANGE_PX
//  - If ENEMIES_CONFIG[mob.mobType].attackCooldownMs is set, it overrides COOLDOWN_MS
//
// Notes:
//  - We only call AttackLoop.start *after* a successful FSM.apply(...).
//  - While in 'attack' we DO NOT push movement (we stop).
//

const wsRegistry   = require("../wsRegistry");
const Store        = require("../world/entityStore");
const Movement     = require("./movementLoop");
const FSM          = require("./fsm");
const AttackLoop   = require("./attackLoop");
const ENEMIES_CONFIG = require("../defs/enemiesConfig");

// Base tunables (env overrides allowed elsewhere if you like)
const TICK_MS          = 80;   // AI tick
const ATTACK_RANGE_PX  = 64;   // default when enemy def doesn't specify
const RESUME_ATTACK_MS = 180;  // same default your attackLoop uses ---> ATTACK TIMER <-----
const COOLDOWN_MS      = 600;  // extra cooldown *after* the attack window -- default if no config found

// Cooldown ledger: Map<playerId, Map<entityId, number(nextAtMs)>>
const _cooldowns = new Map();

function _sub(map, key) {
  let m = map.get(key);
  if (!m) { m = new Map(); map.set(key, m); }
  return m;
}

function _toPos(p) {
  const x = (p && typeof p.x === "number") ? p.x : 0;
  const y = (p && typeof p.y === "number") ? p.y : 0;
  return { x, y };
}
function _norm(x, y) {
  const len = Math.hypot(x || 0, y || 0);
  if (!isFinite(len) || len <= 0.00001) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}
function _distSq(ax, ay, bx, by) {
  const dx = (ax - bx);
  const dy = (ay - by);
  return dx * dx + dy * dy;
}
function _rangeFor(mob) {
  const def = (mob && ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]) || null;
  const r = Number(def?.attackRangePx);
  return Number.isFinite(r) ? Math.max(0, r) : ATTACK_RANGE_PX;
}
function _cooldownFor(mob) {
  const def = (mob && ENEMIES_CONFIG && ENEMIES_CONFIG[mob.mobType]) || null;
  const cd = Number(def?.attackCooldownMs);
  return Number.isFinite(cd) ? Math.max(0, cd) : COOLDOWN_MS;
}
function _cooldownLeftMs(playerId, entityId) {
  const sub = _cooldowns.get(playerId);
  if (!sub) return 0;
  const until = sub.get(String(entityId)) || 0;
  const left = until - Date.now();
  return left > 0 ? left : 0;
}
function _armCooldown(playerId, entityId, totalMs) {
  const sub = _sub(_cooldowns, playerId);
  sub.set(String(entityId), Date.now() + Math.max(0, totalMs));
}

// Returns { playerRow, mobs: Array<[entityId, row]> } for a bound player
function _gatherForPlayer(playerId) {
  let playerRow = null;
  const mobs = [];
  if (typeof Store.each !== "function") {
    return { playerRow, mobs };
  }
  try {
    Store.each(playerId, (id, row) => {
      if (!row) return;
      if (row.type === "player") playerRow = row;
    });
    if (!playerRow) return { playerRow: null, mobs: [] };

    const mapId = playerRow.mapId;
    const instanceId = playerRow.instanceId;

    Store.each(playerId, (id, row) => {
      if (!row) return;
      if (row.type !== "mob") return;
      if (row.mapId !== mapId || row.instanceId !== instanceId) return; // per-player instance
      mobs.push([id, row]);
    });
  } catch (_e) {}
  return { playerRow, mobs };
}

function tick() {
  const playerIds = wsRegistry.dumpBindings();
  for (const playerId of playerIds) {
    const { playerRow, mobs } = _gatherForPlayer(playerId);
    if (!playerRow) continue;

    const p = _toPos(playerRow.pos);
    const pMap = playerRow.mapId;
    const pInst = playerRow.instanceId;

    for (const [entityId, mob] of mobs) {
      if (!mob) continue;
      if (mob.mapId !== pMap || mob.instanceId !== pInst) continue;

      const e = _toPos(mob.pos);
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const distSq = _distSq(p.x, p.y, e.x, e.y);

      const rangePx = _rangeFor(mob);
      const inRange = distSq <= rangePx * rangePx;

      // Current chase direction toward the player
      const dir = _norm(dx, dy);

      // If the mob is already attacking, don't push movement.
      if (mob.state === "attack") {
        Movement.onMoveStop(playerId, entityId);
        continue;
      }

      // Inside attack range?
      if (inRange) {
        // Respect server-side cooldown
        const cdLeft = _cooldownLeftMs(playerId, entityId);
        if (cdLeft > 0) {
          // On cooldown: just keep chasing to stay glued to the player
          if (dir.x !== 0 || dir.y !== 0) {
            Movement.setDir(playerId, entityId, dir);
          } else {
            Movement.onMoveStop(playerId, entityId);
          }
          continue;
        }

        // Not on cooldown and not already attacking → start attack
        Movement.onMoveStop(playerId, entityId); // freeze movement while attacking
        const res = FSM.apply(playerId, entityId, "attackIntentStart");
        if (res?.ok) {
          // Start authoritative attack window, capturing resumeDir
          AttackLoop.start(
            playerId,
            entityId,
            { x: p.x, y: p.y },   // attack pos = player's current position
            RESUME_ATTACK_MS,     // attack window length
            dir                   // resumeDir after the window completes
          );

          // Arm cooldown to extend *beyond* the attack window
          const extra = _cooldownFor(mob);
          _armCooldown(playerId, entityId, RESUME_ATTACK_MS + extra);
        }
        continue;
      }

      // Outside range → chase
      if (dir.x !== 0 || dir.y !== 0) {
        Movement.setDir(playerId, entityId, dir);
      } else {
        Movement.onMoveStop(playerId, entityId);
      }
    }
  }
}

// Boot the loop
let timer = setInterval(tick, TICK_MS);

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { stop };
