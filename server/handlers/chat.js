module.exports = (ws, data) => {
  console.log("💬 Chat message:", data.message);

  // broadcast to all clients (example)
  ws.send(JSON.stringify({
    event: "chat",
    from: data.playerId,
    message: data.message
  }));
};