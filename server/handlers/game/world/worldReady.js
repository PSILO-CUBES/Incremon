const { v4: uuidv4 } = require("uuid");
const { pickSpawn } = require("../../../maps/mapRegistry");
const Store = require("../../../world/entityStore");
const DEFAULT_PLAYER_DATA = require("../entities/player/data")

module.exports = (ws, data = {}) => {
  if (!ws.playerId) {
    return ws.send(JSON.stringify({ event: "worldInitFailed", message: "Not logged in" }));
  }

  const mapId = ws.currentMapId || "area1/m1";
  if (data.mapId && data.mapId !== mapId) {
    console.warn(`-* [worldReady] map mismatch: got=${data.mapId} expected=${mapId}`);
  }

  // Handshake gating:
  // 1) If the client hasn't acknowledged spawn yet, send ONLY the playerSpawn packet and bail.
  if (!ws.hasSpawned) {
    const entityId = ws.playerEntityId || uuidv4();
    ws.playerEntityId = entityId;

    // Authoritative spawn
    const spawn = pickSpawn(mapId, ws.playerId);
    ws.lastSpawn = spawn;

    ws.send(JSON.stringify({
      event: "playerSpawn",
      entityId,
      mapId,
      spawn,
      instanceId: ws.instanceId
    }));

    console.log(`-* [playerSpawn] player=${ws.playerId} entity=${entityId} map=${mapId} spawn=(${spawn.x},${spawn.y})`);
    return; // wait for playerSpawnAck before proceeding
  }

  // 2) After playerSpawnAck (server sets ws.hasSpawned = true), finish world init:
  ws.inWorld = true;

  // Ensure entityId exists and register in EntityStore
  ws.playerEntityId = ws.playerEntityId || uuidv4();
  Store.create(
    ws.playerId,
    {
      entityId: ws.playerEntityId,
      type: "player",
      mapId,
      instanceId: ws.instanceId,
      pos: ws.lastSpawn || pickSpawn(mapId, ws.playerId),
      state: "idle",
    }
  );

  ws.send(JSON.stringify({
    event: "worldReady",
    mapId,
    instanceId: ws.instanceId,
    // Add map info / nearby entities here later
  }));

  console.log(`-* [worldReady] player=${ws.playerId} entity=${ws.playerEntityId} map=${mapId} ready`);
};