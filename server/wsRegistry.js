const _byPlayer = new Map();      // playerId -> ws
const _byWs = new WeakMap();      // ws -> playerId

function set(playerId, ws) {
  const prev = _byPlayer.get(playerId);
  if (prev && prev !== ws) { try { prev.close(1000, "Replaced"); } catch {} }
  _byPlayer.set(playerId, ws);
  _byWs.set(ws, playerId);
}

function get(playerId) {
  return _byPlayer.get(playerId) || null;
}

function remove(playerId) {
  const ws = _byPlayer.get(playerId);
  if (ws) { _byPlayer.delete(playerId); _byWs.delete(ws); }
}

function removeByWs(ws) {
  const pid = _byWs.get(ws);
  if (pid) remove(pid);
}

function sendTo(playerId, msg) {
  const ws = get(playerId);
  if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(msg)); return true; } catch {} }
  return false;
}

module.exports = { set, get, remove, removeByWs, sendTo, count: () => _byPlayer.size };