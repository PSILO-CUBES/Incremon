const SLTokenManager = require("../tokenManagers/sltokenManager");

const routes = {
  login:           require("./network/login"),
  tokenLogin:      require("./network/tokenLogin"),
  createAccount:   require("./network/createAccount"),

  slTokenRefresh:  require("./tokens/slTokenRefresh"),
  
  worldEnter:      require("./game/world/worldEnter"),
  worldReady:      require("./game/world/worldReady"),

  playerSpawnAck:  require("./game/entities/player/playerSpawnAck"),
  
  moveIntentStart: require("./game/entities/move/moveIntentStart"),
  moveIntentStop:  require("./game/entities/move/moveIntentStop"),
};

// ---------- security knobs ----------
const ALLOWED_ACTIONS = new Set(Object.keys(routes));
const MAX_MSG_BYTES = 64 * 1024;            // 64KB max per message
const MAX_ACTION_LEN = 32;                   // keep action names short
const MAX_DEPTH = 8;                         // sanitize recursion depth
const RATE_TOKENS = 30;                      // token bucket capacity
const RATE_REFILL_PER_SEC = 30;              // refill rate

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Remove dangerous keys and mongo-looking operators recursively
function sanitize(obj, depth = 0) {
  if (depth > MAX_DEPTH) return {};
  if (Array.isArray(obj)) return obj.map((v) => sanitize(v, depth + 1));
  if (!isPlainObject(obj)) return obj;

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    // block prototype pollution & constructor tricks
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    // very defensive: drop mongo operator-style keys and dotted keys
    if (k.startsWith("$") || k.includes(".")) continue;

    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

function safeParseJSON(str) {
  try {
    // Reviver drops dangerous keys if they appear
    return [JSON.parse(str, (k, v) => {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return undefined;
      return v;
    }), null];
  } catch (e) {
    return [null, e];
  }
}

// Simple token-bucket rate limiter per connection
function allowMessage(ws) {
  const now = Date.now();
  if (!ws._rate) {
    ws._rate = { tokens: RATE_TOKENS, last: now };
    return true;
  }
  const dt = (now - ws._rate.last) / 1000;
  ws._rate.last = now;
  ws._rate.tokens = Math.min(RATE_TOKENS, ws._rate.tokens + dt * RATE_REFILL_PER_SEC);

  if (ws._rate.tokens >= 1) {
    ws._rate.tokens -= 1;
    return true;
  }
  // Optional: throttle warning
  if (!ws._lastRateWarn || now - ws._lastRateWarn > 1000) {
    try { ws.send(JSON.stringify({ event: "tooManyRequests" })); } catch {}
    ws._lastRateWarn = now;
  }
  return false;
}

function handleMessage(ws, raw, clientIp) {
  // ---- size guard ----
  if (Buffer.isBuffer(raw)) {
    if (raw.length > MAX_MSG_BYTES) {
      try { ws.close(1009, "Message too big"); } catch {}
      return;
    }
    raw = raw.toString("utf8");
  } else if (typeof raw === "string") {
    if (Buffer.byteLength(raw, "utf8") > MAX_MSG_BYTES) {
      try { ws.close(1009, "Message too big"); } catch {}
      return;
    }
  } else {
    return; // ignore non-string messages
  }

  // ---- rate limit ----
  if (!allowMessage(ws)) return;

  // ---- parse JSON safely ----
  const [msg, parseErr] = safeParseJSON(raw);
  if (parseErr || !isPlainObject(msg)) {
    try { ws.send(JSON.stringify({ event: "badJson" })); } catch {}
    return;
  }

  // ---- validate action ----
  const action = msg.action;
  if (typeof action !== "string" || action.length === 0 || action.length > MAX_ACTION_LEN) {
    try { ws.send(JSON.stringify({ event: "unknownAction" })); } catch {}
    return;
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    try { ws.send(JSON.stringify({ event: "unknownAction", action })); } catch {}
    return;
  }

  // ---- sanitize payload (drop 'action' and dangerous keys) ----
  const { action: _drop, ...rest } = msg;
  const payload = sanitize(rest);

  // ---- auth guard (short-lived token) ----
  const OPEN_ACTIONS = new Set(["login", "tokenLogin", "createAccount", "slTokenRefresh"]);
  if (!OPEN_ACTIONS.has(action)) {
    const t = payload.shortLivedToken || "";
    const ok = t && SLTokenManager.verifyToken(t, ws.playerId);
    if (!ok) {
      try { ws.send(JSON.stringify({ event: "authFailed" })); } catch {}
      return;
    }
  }

  // ---- dispatch ----
  const fn = routes[action];
  if (typeof fn !== "function") {
    try { ws.send(JSON.stringify({ event: "unknownAction", action })); } catch {}
    return;
  }

  try {
    fn(ws, payload, clientIp);
  } catch (err) {
    console.error(`Handler error in "${action}":`, err);
    try { ws.send(JSON.stringify({ event: "serverError" })); } catch {}
  }
}

module.exports = handleMessage;