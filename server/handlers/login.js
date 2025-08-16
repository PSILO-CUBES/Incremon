const { v4: uuidv4 } = require("uuid");
const playersDB = new Map();

module.exports = (ws, data) => {
    const username = data.username;
    if (!username) {
        return ws.send(JSON.stringify({
            event: "loginFailed",
            message: "Username required"
        }));
    }

    // Check if user already exists
    let player = Array.from(playersDB.values()).find(p => p.username === username);

    if (!player) {
        // New player signup
        const playerId = uuidv4();
        player = { id: playerId, username, resources: {} };
        playersDB.set(playerId, player);
        console.log(`🆕 Created new player: ${username} (${playerId})`);
    } else {
        console.log(`🔑 Existing player logged in: ${username}`);
    }

    // Attach player info to ws so future messages know who it is
    ws.playerId = player.id;

    // Respond to client
    ws.send(JSON.stringify({
        event: "loginSuccess",
        playerId: player.id,
        username: player.username
    }));
};