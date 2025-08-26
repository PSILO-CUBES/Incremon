const mongoose = require('mongoose')
require('dotenv').config()

const mongoUrl = process.env.MONGO_URL
const dbName = process.env.DB_NAME

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUrl, { dbName })
    console.log('-* Connected to MongoDB via Mongoose')
  }
  return mongoose.connection
}

function getDb() {
  if (mongoose.connection.readyState === 0) throw new Error('MongoDB not connected yet')
  return mongoose.connection.db
}

module.exports = { connect, getDb }