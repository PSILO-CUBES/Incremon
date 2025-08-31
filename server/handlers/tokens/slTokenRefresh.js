const SLTokenManager = require("../../tokenManagers/sltokenManager")

module.exports = async (ws) => {
    if (!ws.playerId) {
        return ws.send(JSON.stringify({
            event: "slTokenRefreshed",
            message: "No player session found"
        }))
    }

    // Issue new short-lived token
    const slToken = SLTokenManager.createToken(ws.playerId.toString())
    ws.short_lived_token = slToken

    // Send back to client
    ws.send(JSON.stringify({
        event: "slTokenRefreshed",
        shortLivedToken: slToken
    }))
}