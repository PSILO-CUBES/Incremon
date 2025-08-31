const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "mapConfig.json");
let CFG;

function loadConfig() {
	const raw = fs.readFileSync(CONFIG_PATH, "utf8");
	const json = JSON.parse(raw);
	// minimal validation
	for (const [id, info] of Object.entries(json)) {
		if (!info || typeof info !== "object") throw new Error(`map ${id}: invalid object`);
		if (!Array.isArray(info.spawns) || info.spawns.length === 0) {
			throw new Error(`map ${id}: must define at least one spawn`);
		}
		for (const s of info.spawns) {
			if (typeof s.x !== "number" || typeof s.y !== "number") {
				throw new Error(`map ${id}: spawn must have numeric x,y`);
			}
		}
	}
	return json;
}

try {
	CFG = loadConfig();
} catch (e) {
	console.error("Failed to load mapConfig.json:", e);
	// fail-safe default
	CFG = {
		"area1/m1": { version: 1, spawns: [{ x: 320, y: 320 }] }
	};
}

function getMapInfo(mapId) {
	return CFG[mapId] || null;
}

function pickSpawn(mapId, playerId = "") {
	const info = getMapInfo(mapId);
	if (!info) return { x: 320, y: 320 };
	const list = info.spawns || [];
	if (list.length === 0) return { x: 320, y: 320 };
	// stable per-player index (optional)
	let idx = 0;
	if (playerId) {
		let h = 0;
		for (let i = 0; i < playerId.length; i++) h = (h * 33 + playerId.charCodeAt(i)) >>> 0;
		idx = h % list.length;
	}
	return list[idx];
}

module.exports = { getMapInfo, pickSpawn };
