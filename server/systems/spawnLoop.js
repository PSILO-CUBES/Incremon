// server/systems/spawnLoop.js
//
// Per-player spawn loop driven by mapConfig.json via getMapInfo(mapId).
// Delegates creation to spawnManager.spawnEnemy(...) so there's a single
//
// IMPORTANT pacing changes:
// - Treat mapInfo.spawnRatePerSec as a *TOTAL per-player* rate (not per spawner).
// - Enforce a minimum gap between spawns and an initial delay.
// - Limit new spawns per tick.
// Optional mapConfig keys (with defaults shown):
//   spawnInitialDelayMs: 1200
//   spawnMinGapMs: 800
//   spawnPerTickCap: 2

const wsRegistry = require("../wsRegistry");
const Store = require("../world/entityStore");
const { spawnEnemy } = require("./spawnManager");
const { getMapInfo } = require("../maps/mapRegistry");

if (!globalThis.__SPAWN_LOOP_SINGLETON__) {
  globalThis.__SPAWN_LOOP_SINGLETON__ = { running: false };
}
const SINGLETON = globalThis.__SPAWN_LOOP_SINGLETON__;

// hard caps/guards
const MAX_PLAYER_CREDIT = 50;

const perPlayer = new Map(); // playerId -> state

function ensurePlayer(pid) {
  let st = perPlayer.get(pid);
  if (!st) {
    st = {
      mapId: null,
      instanceId: null,

      // Spawner bookkeeping: spawnerId -> { alive:Set<entityId> }
      spawners: new Map(),

      // Alive mob ids for budget checks
      aliveAll: new Set(),

      // Born time (ms) for grace culling
      bornAtById: new Map(),

      // Player-level pacing
      playerCredit: 0,        // accrues at spawnRatePerSec * dt (TOTAL per player)
      lastTickMs: Date.now(), // for dt calc
      lastSpawnMs: 0,         // last time a mob actually spawned
      spawnGateMs: 0,         // initial delay gate
      minGapMs: 800,          // default, can be overridden per map
      perTickCap: 2,          // default, can be overridden per map

      // Custom modifiers if you want live tuning
      mods: {},
    };
    perPlayer.set(pid, st);
  }
  return st;
}

function ensureSlot(state, spawnerId) {
  let slot = state.spawners.get(spawnerId);
  if (!slot) {
    slot = { alive: new Set() };
    state.spawners.set(spawnerId, slot);
  }
  return slot;
}

function now() { return Date.now(); }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rndPoint(x, y, r) {
  const t = 2 * Math.PI * Math.random();
  const d = Math.sqrt(Math.random()) * r;
  return { x: x + Math.cos(t) * d, y: y + Math.sin(t) * d };
}

// Pull parameters and apply mods. Also initialize pacing gates on first tick for this map.
function computeParamsFromMapAndMods(mapInfo, st, tNow) {
  // Treat spawnRatePerSec as TOTAL per-player rate.
  let spawnRatePerSec = mapInfo.spawnRatePerSec ?? 1;

  // (We still honor burst ranges to introduce small randomness per spawn selection,
  // but actual spawn count is bounded by playerCredit + caps below.)
  let burstMin = mapInfo.burstMin ?? 1;
  let burstMax = mapInfo.burstMax ?? Math.max(1, burstMin);

  let maxAliveOnMap = mapInfo.maxAliveOnMap ?? 10;

  // Optional pacing knobs from map config:
  const cfgInitialDelay = Math.max(0, mapInfo.spawnInitialDelayMs ?? 1200);
  const cfgMinGapMs     = Math.max(50, mapInfo.spawnMinGapMs ?? 800);
  const cfgPerTickCap   = Math.max(1, mapInfo.spawnPerTickCap ?? 2);

  const m = st.mods || {};
  if (m.spawnRatePerSec != null) spawnRatePerSec = m.spawnRatePerSec;
  if (m.burstMin != null)        burstMin       = m.burstMin;
  if (m.burstMax != null)        burstMax       = m.burstMax;
  if (m.maxAliveOnMap != null)   maxAliveOnMap  = m.maxAliveOnMap;

  if (m.rateMul != null)   spawnRatePerSec = Math.max(0, spawnRatePerSec * m.rateMul);
  if (m.burstMul != null) {
    burstMin = Math.max(0, Math.floor(burstMin * m.burstMul));
    burstMax = Math.max(burstMin, Math.floor(burstMax * m.burstMul));
  }
  if (m.capAdd != null)    maxAliveOnMap = Math.max(0, Math.floor(maxAliveOnMap + m.capAdd));
  if (burstMax < burstMin) burstMax = burstMin;

  // Initialize pacing gates (one-time per map/session)
  if (st.spawnGateMs === 0) st.spawnGateMs = tNow + cfgInitialDelay;
  st.minGapMs   = cfgMinGapMs;
  st.perTickCap = cfgPerTickCap;

  return { spawnRatePerSec, burstMin, burstMax, maxAliveOnMap };
}

// Create via manager (single source of truth)
function spawnOneViaManager(playerId, mapId, instanceId, sp, st) {
  const pos = rndPoint(sp.x, sp.y, sp.radius);
  const created = spawnEnemy({
    playerId,
    mapId,
    instanceId,
    unitId: sp.mobType || "mob",
    pos,
  });
  if (created && created.entityId) {
    st.aliveAll.add(created.entityId);
    st.bornAtById.set(created.entityId, now());
    const sid = sp.id || `${mapId}-s?`;
    ensureSlot(st, sid).alive.add(created.entityId);
  }
}

const BORN_GRACE_MS = 500;

function cullMissing(playerId) {
  const st = perPlayer.get(playerId);
  if (!st) return;

  const t = now();

  for (const eid of Array.from(st.aliveAll)) {
    const born = st.bornAtById.get(eid) || 0;
    if (born && t - born < BORN_GRACE_MS) continue;

    let e = null;
    try { e = Store.get && Store.get(playerId, eid); } catch {}
    const remove =
      !e ||
      e.ownerId !== playerId ||
      e.type !== "mob" ||
      e.state === "dead" ||
      e.deleted === true;

    if (remove) {
      st.aliveAll.delete(eid);
      st.bornAtById.delete(eid);
      // also remove from any slot.alive
      for (const [, slot] of st.spawners) slot.alive.delete(eid);
    }
  }
}

function setPlayerSpawnModifiers(playerId, mods = {}) {
  const st = ensurePlayer(playerId);
  st.mods = { ...st.mods, ...mods };
}

// Forget a player's spawn bookkeeping on disconnect
function onPlayerDisconnect(playerId) {
  perPlayer.delete(playerId);
}

let timer = null;

function start() {
  if (SINGLETON.running) return;
  SINGLETON.running = true;
  if (timer) return;

  timer = setInterval(() => {
    const ids = (typeof wsRegistry.dumpBindings === "function") ? wsRegistry.dumpBindings() : [];
    const tNow = now();

    for (const playerId of ids) {
      const ws = wsRegistry.get(playerId);
      if (!ws || ws.readyState !== 1) continue;

      const mapId = ws.currentMapId || "area1/m1";
      const instanceId = ws.instanceId;
      if (!instanceId) continue;

      const mapInfo = getMapInfo(mapId);
      const spawners = (mapInfo && Array.isArray(mapInfo.spawners)) ? mapInfo.spawners : [];
      if (!spawners.length) continue;

      const st = ensurePlayer(playerId);
      st.mapId = mapId;
      st.instanceId = instanceId;

      // dt + accrue player credit (TOTAL per-player rate)
      const dtSec = Math.max(0, (tNow - st.lastTickMs) / 1000);
      st.lastTickMs = tNow;

      const { spawnRatePerSec, burstMin, burstMax, maxAliveOnMap } =
        computeParamsFromMapAndMods(mapInfo, st, tNow);

      st.playerCredit = Math.min(
        MAX_PLAYER_CREDIT,
        st.playerCredit + spawnRatePerSec * dtSec
      );

      // Reconcile tracking vs store and compute budget
      cullMissing(playerId);
      let budgetMap = Math.max(0, maxAliveOnMap - st.aliveAll.size);
      if (budgetMap <= 0) continue;

      // Respect initial delay / min gap / per-tick cap / available credit
      if (tNow < st.spawnGateMs) continue;

      let spawnedThisTick = 0;

      // Randomize spawner order so different spawners get first dibs over time
      const shuffled = spawners.slice().sort(() => Math.random() - 0.5);

      // We do at most one spawn per spawner per tick, bounded by playerCredit & caps
      for (const sp of shuffled) {
        if (budgetMap <= 0) break;
        if (spawnedThisTick >= st.perTickCap) break;
        if (st.playerCredit < 1) break;
        if ((tNow - st.lastSpawnMs) < st.minGapMs) break;

        // Small randomness: flip a coin within burstMin..burstMax window
        // but we still only spawn 1 here to keep pacing strict.
        const want = rndInt(burstMin, burstMax);
        if (want <= 0) continue;

        spawnOneViaManager(playerId, mapId, instanceId, sp, st);

        st.playerCredit -= 1;
        st.lastSpawnMs = tNow;
        spawnedThisTick += 1;
        budgetMap -= 1;
      }
    }
  }, 100);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  SINGLETON.running = false;
}

module.exports = { start, stop, setPlayerSpawnModifiers, onPlayerDisconnect };
