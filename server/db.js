const { MongoClient } = require("mongodb");

const mongoUrl = "mongodb://localhost:27017";
const dbName = "mygame";

let db;

async function connect() {
    if (!db) {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        console.log("✅ Connected to MongoDB");
        db = client.db(dbName);
    }
    return db;
}

function getDb() {
    if (!db) throw new Error("MongoDB not connected yet");
    return db;
}

module.exports = { connect, getDb };