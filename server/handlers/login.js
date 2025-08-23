const { v4: uuidv4 } = require("uuid")
const bcrypt = require("bcrypt")

const dbModule = require("../db")
const LLTokenManager = require("../tokenManagers/LLTokenManager")
const SLTokenManager = require("../tokenManagers/SLTokenManager")

// { ip: { count, lastAttempt, blockUntil, strikes } }
const loginAttempts = {}
const MAX_ATTEMPTS = 5
const BASE_BLOCK_MS = 60_000

module.exports = async (ws, data, clientIp) => {
    const username = data.username
    const password = data.password

    const now = Date.now()
    if (!loginAttempts[clientIp]) {
        loginAttempts[clientIp] = { count: 0, lastAttempt: now, blockUntil: 0, strikes: 0 }
    }

    const attemptInfo = loginAttempts[clientIp]

    // Check if client is currently blocked
    if (now < attemptInfo.blockUntil) {
        return ws.send(JSON.stringify({
            event: "loginFailed",
            message: "Too many login attempts. Please try again later."
        }))
    }

    // Reset attempt count if enough time has passed
    if (now - attemptInfo.lastAttempt > BASE_BLOCK_MS) {
        attemptInfo.count = 0
    }
    attemptInfo.lastAttempt = now

    if (attemptInfo.count >= MAX_ATTEMPTS) {
        attemptInfo.strikes++
        const blockTime = BASE_BLOCK_MS * Math.pow(2, attemptInfo.strikes - 1)
        attemptInfo.blockUntil = now + blockTime
        attemptInfo.count = 0
        return ws.send(JSON.stringify({
            event: "loginFailed",
            message: `Too many login attempts. Blocked for ${Math.round(blockTime / 1000)}s.`
        }))
    }

    if (!username || !password) {
        attemptInfo.count++
        return ws.send(JSON.stringify({
            event: "loginFailed",
            message: "Username and password required"
        }))
    }

    const db = dbModule.getDb()
    const playersCollection = db.collection("players")

    try {
        const player = await playersCollection.findOne({ username })

        if (!player) {
            attemptInfo.count++
            return ws.send(JSON.stringify({
                event: "loginFailed",
                message: "Account does not exist"
            }))
        }

        const valid = await bcrypt.compare(password, player.password)
        if (!valid) {
            attemptInfo.count++
            return ws.send(JSON.stringify({
                event: "loginFailed",
                message: "Invalid credentials"
            }))
        }

        if (!player.verified) {
            return ws.send(JSON.stringify({
                event: "loginFailed",
                message: "Account not verified. Please check your email."
            }))
        }

        console.log(`🔑 Player logged in: ${username}`)
        ws.playerId = player._id

        const llToken = await LLTokenManager.createToken(player._id.toString())
        ws.token = llToken

        const slToken = SLTokenManager.createToken(player._id.toString())
        ws.short_lived_token = slToken

        attemptInfo.count = 0
        attemptInfo.strikes = 0
        attemptInfo.blockUntil = 0

        ws.send(JSON.stringify({
            event: "loginSuccess",
            playerId: player._id,
            username: player.username,
            longLivedToken: llToken,
            shortLivedToken: slToken
        }))

    } catch (err) {
        console.error("MongoDB error:", err)
        ws.send(JSON.stringify({
            event: "loginFailed",
            message: "Server error"
        }))
    }
}