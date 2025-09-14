const { v4: uuidv4 } = require("uuid");
const Player = require("../../../schema/Player");
const { pickSpawn } = require("../../../maps/mapRegistry");
const Store = require("../../../world/entityStore");
const { DEFAULT_PLAYER_DATA } = require("../../../defs/playerDefaults");

function num(v, d) {
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return d;
}

function buildStats(src) {
  const def = DEFAULT_PLAYER_DATA;
  const out = {
    maxHp: num(src && src.maxHp, def.hp),
    hp:    num(src && src.hp,    def.hp),
    maxMp: num(src && src.maxMp, def.mp),
    mp:    num(src && src.mp,    def.mp),
    atk:   num(src && src.atk,   def.atk),
    def:   num(src && src.def,   def.def),
    acc:   num(src && src.acc,   def.acc),
    spd:   num(src && src.spd,   def.spd),
    lvl:   num(src && src.lvl,   def.lvl),
    exp:   num(src && src.exp,   def.exp),
  };
  return out;
}

module.exports = async (ws, data = {}) => {
  try {
    if (!ws.playerId) {
      try {
        ws.send(JSON.stringify({ event: "worldInitFailed", message: "Not logged in" }));
      } catch (_) {}
      return;
    }

    let mapId = ws.currentMapId;
    if (!mapId) {
      mapId = "area1/m1";
    }

    // Optional sanity log if client echoed a different map id
    if (data && data.mapId && data.mapId !== mapId) {
      console.warn("-* [worldReady] map mismatch: got=" + data.mapId + " expected=" + mapId);
    }

    // Ensure instance + player entity ids are stable
    if (!ws.instanceId) {
      ws.instanceId = uuidv4();
    }
    if (!ws.playerEntityId) {
      ws.playerEntityId = uuidv4();
    }

    // Pick a stable spawn for this map/player
    const spawn = pickSpawn(mapId, ws.playerId);
    ws.lastSpawn = spawn;

    // Fetch player doc to see if any stats already exist
    let playerDoc = null;
    try {
      playerDoc = await Player.findById(ws.playerId).lean();
    } catch (_) {
      playerDoc = null;
    }

    let existingStats = null;
    if (playerDoc && playerDoc.playerData && playerDoc.playerData.stats) {
      existingStats = playerDoc.playerData.stats;
    }

    // Build final stats from defaults + any existing values
    const stats = buildStats(existingStats);

    // Create/refresh in-memory entity with stats attached
    Store.create(ws.playerId, {
      entityId: ws.playerEntityId,
      ownerId: ws.playerId,
      type: "player",
      mapId: mapId,
      instanceId: ws.instanceId,
      pos: { x: Number(spawn.x) || 0, y: Number(spawn.y) || 0 },
      state: "idle",
      stats: stats
    });

    // Tell the client to spawn the local player, including playerData.stats
    const payload = {
      event: "playerSpawn",
      entityId: ws.playerEntityId,
      mapId: mapId,
      instanceId: ws.instanceId,
      spawn: { x: Number(spawn.x) || 0, y: Number(spawn.y) || 0 },
      playerData: { stats: stats }
    };

    try {
      ws.send(JSON.stringify(payload));
    } catch (_) {}

    console.log(
      "-* [worldReady] player=" +
        ws.playerId +
        " entity=" +
        ws.playerEntityId +
        " map=" +
        mapId +
        " ready (hasSpawned=" +
        (ws.hasSpawned ? "true" : "false") +
        ")"
    );
  } catch (err) {
    console.error("worldReady error:", err);
    try {
      ws.send(JSON.stringify({
        event: "worldInitFailed",
        message: "Server error during worldReady"
      }));
    } catch (_) {}
  }
};
