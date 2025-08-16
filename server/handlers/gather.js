module.exports = (ws, data) => {
  console.log("🪓 Gathering resource:", data.resource);

  const newTotal = 10; // replace with DB logic

  ws.send(JSON.stringify({
    event: "resourceUpdate",
    resource: data.resource,
    newTotal,
    playerId: data.playerId
  }));
};