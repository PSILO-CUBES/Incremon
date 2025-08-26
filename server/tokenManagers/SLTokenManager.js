const { v4: uuidv4 } = require('uuid')

const tokenStore = new Map()

function createToken(userId, durationMs = 10 * 60 * 1000) {
  const token = uuidv4()
  const expiresAt = Date.now() + durationMs

  tokenStore.set(token, { userId, expiresAt })

  // Automatically remove token when expired
  setTimeout(() => tokenStore.delete(token), durationMs)

  return token
}

function verifyToken(token) {
  const data = tokenStore.get(token)
  if (!data) return null

  if (data.expiresAt < Date.now()) {
    tokenStore.delete(token)
    return null
  }

  return data.userId
}

module.exports = {
    createToken,
    verifyToken,
}