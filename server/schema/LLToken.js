const mongoose = require('mongoose')

const tokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'players' },
  token: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: '24h' }
})

module.exports = mongoose.model('Token', tokenSchema)