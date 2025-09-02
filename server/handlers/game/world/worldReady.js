const { v4: uuidv4 } = require("uuid");
const Player = require("../../../schema/Player");
const { pickSpawn } = require("../../../maps/mapRegistry");
const Store = require("../../../world/entityStore");
const { DEFAULT_PLAYER_DATA } = require("../../../defs/playerDefaults");

module.exports = async (ws, data = {}) => {
  try {
    if (!ws.playerId) {
      return ws.send(JSON.stringify({ event: "worldInitFailed", message: "Not logged in" }));
    }

    const mapId = ws.currentMapId || "area1/m1";
    if (data.mapId && data.mapId !== mapId) {
      console.warn(`-* [worldReady] map mismatch: got=${data.mapId} expected=${mapId}`);
    }

    // Instance id for the player's solo/ghost instance
    ws.instanceId = ws.instanceId || uuidv4();

    // Ensure the player has a world entity id
    ws.playerEntityId = ws.playerEntityId || uuidv4();

    // Stable spawn position from map registry (optionally cached on ws)
    const spawn = ws.lastSpawn || pickSpawn(mapId, ws.playerId);
    ws.lastSpawn = spawn;

    // Create or refresh in-memory entity
    Store.create(ws.playerId, {
      entityId: ws.playerEntityId,
      type: "player",
      mapId,
      instanceId: ws.instanceId,
      pos: spawn,
      state: "idle",
    });

    // Read playerData from DB; fall back if missing
    const doc = await Player.findById(ws.playerId).select("playerData").lean();
    const playerData = (doc && doc.playerData) ? doc.playerData : { ...DEFAULT_PLAYER_DATA };

    // ---- Idempotency guard: only send spawn before ACK ----
    if (!ws.hasSpawned) {
      ws.send(JSON.stringify({
        event: "playerSpawn",
        entityId: ws.playerEntityId,
        playerData,
        spawn,
      }));
    }

    // Complete/confirm handshake (safe to send multiple times)
    ws.send(JSON.stringify({
      event: "worldReady",
      mapId,
      instanceId: ws.instanceId,
    }));

    console.log(`-* [worldReady] player=${ws.playerId} entity=${ws.playerEntityId} map=${mapId} ready (hasSpawned=${!!ws.hasSpawned})`);
  } catch (err) {
    console.error("worldReady error:", err);
    try {
      ws.send(JSON.stringify({
        event: "worldInitFailed",
        message: "Server error during worldReady"
      }));
    } catch {}
  }
};