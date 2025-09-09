// server/db.js
const mongoose = require("mongoose");
require("dotenv").config();

// --- hardening & sane defaults ---
mongoose.set("strictQuery", true); // reject unknown query fields
mongoose.set("sanitizeFilter", true);
mongoose.set("sanitizeProjection", true);

const mongoUrl = process.env.MONGO_URL;                // e.g. mongodb://localhost:27017
const dbName   = "mygame";

const isProd   = "production";

// Keep indexes auto-built in dev; turn off in prod (build once during deploy)
const autoIndex = !isProd;

// Conservative pool + fast failover so the server never hangs forever
const connectOpts = {
  dbName,
  autoIndex,                       // build indexes automatically in dev
  maxPoolSize: 20,                 // enough for your Node WS server
  minPoolSize: 2,                  // warm pool a bit
  serverSelectionTimeoutMS: 5000,  // fail fast if DB unavailable
  socketTimeoutMS: 45000,          // cut off dead sockets
  family: 4,                       // prefer IPv4
};

// Single-flight connection promise so connect() is idempotent
let connectOncePromise = null;

// Attach listeners once (nice for logging/ops)
let listenersAttached = false;
function attachConnListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on("connected", () => {
    console.log(`-* Mongo connected (db="${dbName}", pool=${connectOpts.maxPoolSize})`);
  });

  mongoose.connection.on("error", (err) => {
    console.error("-* Mongo connection error:", err?.message || err);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("-* Mongo disconnected");
  });
}

/**
 * Connect to MongoDB (idempotent).
 * - Fast fail if the DB is down (5s).
 * - Reuses an in-flight connect if called concurrently.
 */
async function connect() {
  attachConnListeners();

  // 1 = connected, 2 = connecting (per Mongoose docs)
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoose.connection.readyState === 2 && connectOncePromise) return connectOncePromise;

  if (!mongoUrl) {
    throw new Error("MONGO_URL is not set (check your .env)");
  }

  connectOncePromise = mongoose.connect(mongoUrl, connectOpts)
    .then(() => mongoose.connection)
    .catch((err) => {
      // Clear the promise on failure so a later retry can proceed
      connectOncePromise = null;
      throw err;
    });

  return connectOncePromise;
}

/**
 * Get the native driver DB handle after connect().
 */
function getDb() {
  if (mongoose.connection.readyState === 0) {
    throw new Error("MongoDB not connected yet — call connect() first");
  }
  return mongoose.connection.db;
}

/**
 * Optional graceful close (useful in tests or shutdown hooks).
 */
async function close() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

// Graceful shutdown (Ctrl+C / kill)
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try { await close(); } catch {}
    process.exit(0);
  });
}

module.exports = { connect, getDb, close };
