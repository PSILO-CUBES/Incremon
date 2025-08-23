const { ObjectId } = require("mongodb")
const dbModule = require("../db")
const LLTokenManager = require("../tokenManagers/LLTokenManager")
const SLTokenManager = require("../tokenManagers/SLTokenManager")

module.exports = async (ws, data) => {
    const db = dbModule.getDb()
    const playersCollection = db.collection("players")
    const token = data.token

    if (!token) {
        return ws.send(JSON.stringify({
            event: "tokenInvalid",
            message: "No token provided"
        }))
    }

try {
    const userId = await LLTokenManager.verifyToken(token)
    if (!userId) {
        return ws.send(JSON.stringify({
            event: "tokenInvalid",
            message: "Invalid or expired token"
        }))
    }

    const id = ObjectId.createFromHexString(userId)
    const player = await playersCollection.findOne({ _id: id })

    if (!player) {
        return ws.send(JSON.stringify({
            event: "tokenInvalid",
            message: "Player not found"
        }))
    }

    if (!player.verified) {
        return ws.send(JSON.stringify({
            event: "tokenInvalid",
            message: "Account not verified. Please check your email."
        }))
    }

    // Store player info on ws
    ws.playerId = player._id
    ws.token = token

    // Generate short-lived token
    const slToken = SLTokenManager.createToken(player._id.toString())
    ws.short_lived_token = slToken

    // Send both LLToken and SLToken to client
    ws.send(JSON.stringify({
        event: "loginSuccess",
        playerId: player._id,
        username: player.username,
        longLivedToken: token,
        shortLivedToken: slToken
    }))

    } catch (err) {
        console.error("MongoDB error:", err)
        ws.send(JSON.stringify({
            event: "tokenInvalid",
            message: "Server error"
        }))
    }
}