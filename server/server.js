const WebSocket = require("ws");
const { MongoClient } = require("mongodb");

const handleMessage = require("./handlers/index.js");

// --- MongoDB connection ---
const mongoUrl = "mongodb://localhost:27017";
const dbName = "mygame";

async function start() {
    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        console.log("✅ Connected to MongoDB");

        const db = client.db(dbName);

        // --- WebSocket server ---
        const wss = new WebSocket.Server({ port: 8080 });
        console.log("🚀 WebSocket server running on ws://127.0.0.1:8080");

        wss.on("connection", (ws, req) => {
            console.log("🔗 Client connected from:", req.socket.remoteAddress);

            ws.on("message", (msg) => {
                try {
                  const data = JSON.parse(msg.toString());
                  handleMessage(ws, data); // delegate
                } catch (err) {
                  console.error("❌ Invalid message:", err);
                }
            });

            ws.on("close", () => {
                console.log("❌ Client disconnected");
            });
        });

    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}

start();