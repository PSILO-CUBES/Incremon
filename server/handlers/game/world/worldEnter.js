const { v4: uuidv4 } = require("uuid");
const SLTokenManager = require("../../../tokenManagers/sltokenManager");
const { getMapInfo } = require("../../../maps/mapRegistry");

module.exports = (ws, data = {}) => {
	if (!ws.playerId) {
		return ws.send(JSON.stringify({ event: "worldInitFailed", message: "Not logged in" }));
	}

	if (data.shortLivedToken) {
		const ok = SLTokenManager.verifyToken(data.shortLivedToken, ws.playerId);
		if (!ok) {
			return ws.send(JSON.stringify({ event: "worldInitFailed", message: "Invalid or expired short-lived token" }));
		}
	}

	const mapId = "area1/m1"; // choose based on your logic
	ws.currentMapId = mapId;
	ws.instanceId = ws.instanceId || uuidv4();

	const info = getMapInfo(mapId);

	ws.send(JSON.stringify({
		event: "worldInit",
		username: ws.username || "Player",
		mapId,
		spawn: (info && info.spawns && info.spawns[0]) ? info.spawns[0] : { x: 320, y: 320 }, // preview only
		version: info?.version ?? 1,
		instanceId: ws.instanceId
	}));

	console.log(`-* [worldEnter] player=${ws.playerId} map=${mapId} instance=${ws.instanceId}`);
};