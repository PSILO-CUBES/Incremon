const { v4: uuidv4 } = require('uuid')

// In-memory store for short-lived tokens
const tokenStore = new Map()

/**
 * Create a short-lived token for a player
 * @param {string} userId - Player's MongoDB ObjectId as string
 * @param {number} durationMs - Token lifetime in milliseconds (default 10 min)
 * @returns {string} token value
 */
function createToken(userId, durationMs = 10 * 60 * 1000) {
  const token = uuidv4()
  const expiresAt = Date.now() + durationMs

  tokenStore.set(token, { userId, expiresAt })

  // Automatically remove token when expired
  setTimeout(() => tokenStore.delete(token), durationMs)

  return token
}

/**
 * Verify a short-lived token
 * @param {string} token - Token value
 * @returns {string|null} userId if valid, null if invalid/expired
 */
function verifyToken(token) {
  const data = tokenStore.get(token)
  if (!data) return null

  if (data.expiresAt < Date.now()) {
    tokenStore.delete(token)
    return null
  }

  return data.userId
}

/**
 * Optional: refresh token expiration (sliding expiration)
 * @param {string} token
 * @param {number} durationMs - new token lifetime in milliseconds
 * @returns {boolean} true if refreshed, false if token invalid
 */
function refreshToken(token, durationMs = 10 * 60 * 1000) {
  const data = tokenStore.get(token)
  if (!data) return false

  const newExpiresAt = Date.now() + durationMs
  data.expiresAt = newExpiresAt
  tokenStore.set(token, data)

  return true
}

module.exports = {
  createToken,
  verifyToken,
  refreshToken
}