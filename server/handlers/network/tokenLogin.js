const { ObjectId } = require("mongodb");
const dbModule = require("../../db");
const LLTokenManager = require("../../tokenManagers/lltokenManager");
const SLTokenManager = require("../../tokenManagers/sltokenManager");
const wsRegistry = require("../../wsRegistry");

module.exports = async (ws, data) => {
	const db = dbModule.getDb();
	const playersCollection = db.collection("players");
	const token = data.token;

	if (!token) {
		return ws.send(JSON.stringify({
			event: "tokenInvalid",
			message: "No token provided"
		}));
	}

	try {
		const userId = await LLTokenManager.verifyToken(token);
		if (!userId) {
			return ws.send(JSON.stringify({
				event: "tokenInvalid",
				message: "Invalid or expired token"
			}));
		}

		const id = ObjectId.createFromHexString(userId);
		const player = await playersCollection.findOne({ _id: id });
		if (!player) {
			return ws.send(JSON.stringify({
				event: "tokenInvalid",
				message: "Player not found"
			}));
		}

		if (!player.verified) {
			return ws.send(JSON.stringify({
				event: "tokenInvalid",
				message: "Account not verified. Please check your email."
			}));
		}

		// Normalize and store on ws once
		const playerId = player._id.toString();
		ws.playerId = playerId;
		ws.username = player.username;
		ws.token = token;
		wsRegistry.set(playerId, ws);

		// Short-lived token
		const slToken = SLTokenManager.createToken(playerId);
		ws.short_lived_token = slToken;

		ws.send(JSON.stringify({
			event: "loginSuccess",
			playerId,                 // string
			username: player.username,
			longLivedToken: token,
			shortLivedToken: slToken
		}));
	} catch (err) {
		console.error("MongoDB error:", err);
		ws.send(JSON.stringify({
			event: "tokenInvalid",
			message: "Server error"
		}));
	}
};