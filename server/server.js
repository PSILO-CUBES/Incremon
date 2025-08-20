const WebSocket = require("ws");
const handleMessage = require("./handlers/index.js");
const dbModule = require("./db");

async function start() {
    await dbModule.connect(); // initialize connection

    const wss = new WebSocket.Server({ port: 8080 });
    console.log("🚀 WebSocket server running on ws://127.0.0.1:8080");

    wss.on("connection", (ws, req) => {
        console.log("🔗 Client connected from:", req.socket.remoteAddress);

        ws.on("message", (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                handleMessage(ws, data); // still generic
            } catch (err) {
                console.error("❌ Invalid message:", err);
            }
        });

        ws.on("close", () => {
            console.log("❌ Client disconnected");
        });
    });
}

start();