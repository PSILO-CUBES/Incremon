const mongoose = require("mongoose");

const wsRegistry = require("../../wsRegistry");
const Player = require("../../schema/Player");
const LLTokenModel = require("../../schema/LLToken");
const LLTokenManager = require("../../tokenManagers/lltokenManager");
const SLTokenManager = require("../../tokenManagers/sltokenManager");
const { DEFAULT_PLAYER_DATA } = require("../../defs/playerDefaults");

const { Types: { ObjectId } } = mongoose;

function isValidObjectId(id) {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id;
}

// Prefer DB lookup (most reliable), then try manager "verify"/"decode" style fns.
async function resolveUserIdFromLL(token, clientIp) {
  if (!token) return null;

  // --- A) DB lookup in LLToken collection
  try {
    const doc = await LLTokenModel.findOne({
      $or: [
        { token },                 // common field name
        { value: token },          // alt
        { longLivedToken: token }, // alt
      ],
    })
      .select("userId uid user playerId ownerId expiresAt expAt exp")
      .lean();

    if (doc) {
      const userId =
        doc.userId || doc.uid || doc.user || doc.playerId || doc.ownerId;

      // Optional expiry checks if your schema has them
      const now = Date.now();
      const expMs =
        (doc.expiresAt && new Date(doc.expiresAt).getTime()) ||
        (doc.expAt && new Date(doc.expAt).getTime()) ||
        null;
      if (expMs && expMs < now) return null;

      if (userId) return String(userId);
    }
  } catch (_) {
    // ignore and try manager below
  }

  // --- B) Try manager verify/validate/decode/etc.
  const tryFns = ["verify", "validate", "check", "decode", "parse"];
  for (const name of tryFns) {
    const fn = LLTokenManager && LLTokenManager[name];
    if (typeof fn !== "function") continue;
    try {
      const res =
        fn.length >= 2 ? await fn.call(LLTokenManager, token, clientIp)
                       : await fn.call(LLTokenManager, token);

      // Try several shapes: top-level, nested payload/data, or plain string
      const userId =
        (res && (res.userId || res.uid || res.user || res.id || res._id)) ||
        (res && res.payload && (res.payload.userId || res.payload.id)) ||
        (res && res.data && (res.data.userId || res.data.id)) ||
        (typeof res === "string" ? res : null);

      if (userId) return String(userId);
    } catch {
      // try next function
    }
  }

  // --- C) Absolute last resort: if token IS an ObjectId, treat it as user id
  if (typeof token === "string" && isValidObjectId(token)) {
    return token;
  }

  return null;
}

// Token issue helper (supports multiple method names)
function pickTokenFn(mod) {
  if (!mod) return null;
  const names = [
    "issue", "create", "generate", "make", "sign", "new",
    "issueFor", "createFor", "gen", "mint"
  ];
  for (const n of names) {
    if (typeof mod[n] === "function") return mod[n].bind(mod);
  }
  if (typeof mod === "function") return mod;
  const anyFn = Object.keys(mod).find(k => typeof mod[k] === "function");
  return anyFn ? mod[anyFn].bind(mod) : null;
}

async function getToken(mod, userId, clientIp) {
  const fn = pickTokenFn(mod);
  if (!fn) return null;
  return fn.length >= 2 ? fn(userId, clientIp) : fn(userId);
}

module.exports = async (ws, data = {}, clientIp) => {
  try {
    const providedLL =
      data.longLivedToken ||
      data.llToken ||
      data.token ||
      data.ll_token ||
      null;

    if (!providedLL) {
      return ws.send(JSON.stringify({
        event: "tokenInvalid",
        message: "Missing token"
      }));
    }

    const userIdStr = await resolveUserIdFromLL(providedLL, clientIp);
    if (!userIdStr || !isValidObjectId(userIdStr)) {
      return ws.send(JSON.stringify({
        event: "tokenInvalid",
        message: "Invalid or expired token"
      }));
    }

    // Load player
    let player = await Player.findById(userIdStr).lean();
    if (!player) {
      return ws.send(JSON.stringify({
        event: "tokenInvalid",
        message: "Player not found"
      }));
    }

    // Backfill stats if missing (keep existing field naming)
    let player_data = player.player_data;
    if (!player_data || typeof player_data !== "object") {
      player_data = { ...DEFAULT_PLAYER_DATA };
      await Player.updateOne({ _id: player._id }, { $set: { player_data } });
    }

    // Issue short-lived token with whatever method exists
    const shortLivedToken = await getToken(SLTokenManager, userIdStr, clientIp);
    if (!shortLivedToken) {
      return ws.send(JSON.stringify({
        event: "tokenInvalid",
        message: "Token service unavailable"
      }));
    }

    if (typeof wsRegistry.bindPlayer === "function") {
      wsRegistry.bindPlayer(ws, userIdStr);
    }

    ws.username = player.username;
    ws.hasSpawned = ws.hasSpawned || false;

    // Keep payload shape as you had it
    ws.send(JSON.stringify({
      event: "loginSuccess",
      playerId: userIdStr,
      username: player.username,
      longLivedToken: providedLL,
      shortLivedToken,
      player_data, // keeping existing name to avoid breaking your client right now
    }));
  } catch (err) {
    console.error("tokenLogin error:", err);
    try {
      ws.send(JSON.stringify({
        event: "tokenInvalid",
        message: "Server error"
      }));
    } catch {}
  }
};
