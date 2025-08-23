const { v4: uuidv4 } = require('uuid')
const Token = require('../models/LLToken') // your Mongoose schema

async function createToken(userId) {
    const tokenValue = uuidv4()
    await Token.create({
        userId,
        token: tokenValue
    })
    return tokenValue
}

async function verifyToken(tokenValue) {
    const tokenDoc = await Token.findOne({ token: tokenValue })
    if (!tokenDoc) return null
    return tokenDoc.userId.toString() // ensure string
}

// TTL deletion is handled automatically by the schema
module.exports = {
    createToken,
    verifyToken
}