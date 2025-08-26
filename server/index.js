const WebSocket = require("ws")
const handleMessage = require("./handlers/messageHandler.js")
const dbModule = require("./db")
const express = require("express")

async function start() {
    await dbModule.connect()

    const wss = new WebSocket.Server({ port: 8080 })
    console.log("-* WebSocket server running on ws://127.0.0.1:8080")

    wss.on("connection", (ws, req) => {
        console.log("-* Client connected from:", req.socket.remoteAddress)

        ws.on("message", (msg) => {
            try {
                const data = JSON.parse(msg.toString())
                handleMessage(ws, data) // generic handler
            } catch (err) {
                console.error("Invalid message:", err)
            }
        })

        ws.on("close", () => {
            console.log("-* Client disconnected")
        })
    })

    // --- Express HTTP server for email verification ---
    const app = express()

    app.get("/verify", async (req, res) => {
        const token = req.query.token
        if (!token) return res.send("Invalid verification link.")

        const db = dbModule.getDb()
        const usersCollection = db.collection("players")
        const user = await usersCollection.findOne({ verificationToken: token })

        if (!user) {
            console.log("-* Invalid or expired token.")
            return res.send("Invalid or expired token.")
        }

        await usersCollection.updateOne(
            { _id: user._id },
            { $set: { verified: true }, $unset: { verificationToken: "" } }
        )

        res.send("Your account has been verified! You can now log in.")
    })

    // Listen on a different port from WebSocket
    const httpPort = 3000
    app.listen(httpPort, () => console.log(`-* HTTP server running on http://127.0.0.1:${httpPort}`))
}

start()