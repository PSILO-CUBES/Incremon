const bcrypt = require("bcrypt");

const wsRegistry = require("../../wsRegistry");
const Player = require("../../schema/Player");
const LLTokenManager = require("../../tokenManagers/lltokenManager");
const SLTokenManager = require("../../tokenManagers/sltokenManager");
const { DEFAULT_PLAYER_DATA } = require("../../defs/playerDefaults");

// Pick any usable function from a token manager module.
// Supports: issue/create/generate/make/sign/new/... OR the module itself being a function.
function pickTokenFn(mod) {
  if (!mod) return null;
  const preferred = [
    "issue", "create", "generate", "make", "sign", "new",
    "issueFor", "createFor", "gen", "mint" // mint last, only if it actually exists
  ];
  for (const name of preferred) {
    if (typeof mod[name] === "function") return mod[name].bind(mod);
  }
  if (typeof mod === "function") return mod; // module itself is callable
  const anyFn = Object.keys(mod).find(k => typeof mod[k] === "function");
  return anyFn ? mod[anyFn].bind(mod) : null;
}

async function getToken(mod, userId, clientIp) {
  const fn = pickTokenFn(mod);
  if (!fn) return null;
  // Some impls accept (userId, ip), others just (userId)
  return fn.length >= 2 ? fn(userId, clientIp) : fn(userId);
}

module.exports = async (ws, data = {}, clientIp) => {
  try {
    const username = (data.username || "").trim();
    const password = data.password || "";

    if (!username || !password) {
      return ws.send(JSON.stringify({
        event: "loginFailed",
        message: "Username and password required"
      }));
    }

    // Find player
    const playerDoc = await Player.findOne({ username }).lean();
    if (!playerDoc) {
      return ws.send(JSON.stringify({
        event: "loginFailed",
        message: "Invalid credentials"
      }));
    }

    // (Optional) block unverified
    if (playerDoc.verified === false) {
      return ws.send(JSON.stringify({
        event: "loginFailed",
        message: "Email not verified"
      }));
    }

    // Password check
    const ok = await bcrypt.compare(password, playerDoc.passHash || "");
    if (!ok) {
      return ws.send(JSON.stringify({
        event: "loginFailed",
        message: "Invalid credentials"
      }));
    }

    // Ensure stats exist (backfill once)
    let playerData = playerDoc.playerData;
    if (!playerData || typeof playerData !== "object") {
      playerData = { ...DEFAULT_PLAYER_DATA };
      await Player.updateOne({ _id: playerDoc._id }, { $set: { playerData } });
    }

    const userIdStr = String(playerDoc._id);

    // Issue tokens using whatever function your managers expose
    const llToken = await getToken(LLTokenManager, userIdStr, clientIp);
    const slToken = await getToken(SLTokenManager, userIdStr, clientIp);

    if (!llToken || !slToken) {
      console.error("Token manager missing a callable issue function.", {
        llKeys: Object.keys(LLTokenManager || {}),
        slKeys: Object.keys(SLTokenManager || {})
      });
      return ws.send(JSON.stringify({
        event: "loginFailed",
        message: "Token service unavailable"
      }));
    }

    if (typeof wsRegistry.bindPlayer === "function") {
      wsRegistry.bindPlayer(ws, userIdStr);
    }

    ws.username = playerDoc.username;
    ws.hasSpawned = ws.hasSpawned || false;

    // Respond
    ws.send(JSON.stringify({
      event: "loginSuccess",
      playerId: userIdStr,
      username: playerDoc.username,
      longLivedToken: llToken,
      shortLivedToken: slToken,
      playerData, // { hp, atk, def, acc, spd, lvl, exp }
    }));
  } catch (err) {
    console.error("login error:", err);
    try {
      ws.send(JSON.stringify({
        event: "loginFailed",
        message: "Server error"
      }));
    } catch {}
  }
};
