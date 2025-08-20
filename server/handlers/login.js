const { v4: uuidv4 } = require("uuid");
const dbModule = require("../db");

module.exports = async (ws, data) => {
    const username = data.username;
    if (!username) {
        return ws.send(JSON.stringify({
            event: "loginFailed",
            message: "Username required"
        }));
    }

    const db = dbModule.getDb();
    const playersCollection = db.collection("players");

    try {
        let player = await playersCollection.findOne({ username });

        if (!player) {
            const playerId = uuidv4();
            player = { id: playerId, username, resources: {} };
            await playersCollection.insertOne(player);
            console.log(`🆕 Created new player: ${username} (${playerId})`);
        } else {
            console.log(`🔑 Existing player logged in: ${username}`);
        }

        ws.playerId = player.id;

        ws.send(JSON.stringify({
            event: "loginSuccess",
            playerId: player.id,
            username: player.username
        }));
    } catch (err) {
        console.error("MongoDB error:", err);
        ws.send(JSON.stringify({
            event: "loginFailed",
            message: "Server error"
        }));
    }
};