const Player = require("../../../../schema/Player");
const { DEFAULT_PLAYER_DATA } = require("../../../../defs/playerDefaults");

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function buildStats(src) {
  const def = DEFAULT_PLAYER_DATA;
  const out = {
    maxHp: num(src?.maxHp, def.hp),
    hp:    num(src?.hp,    def.hp),
    maxMp: num(src?.maxMp, def.mp),
    mp:    num(src?.mp,    def.mp),
    atk:   num(src?.atk,   def.atk),
    def:   num(src?.def,   def.def),
    acc:   num(src?.acc,   def.acc),
    spd:   num(src?.spd,   def.spd),
    lvl:   num(src?.lvl,   def.lvl),
    exp:   num(src?.exp,   def.exp),
  };

  if (out.maxHp <= 0) out.maxHp = 1;
  if (out.maxMp <= 0) out.maxMp = 1;
  if (out.hp < 0) out.hp = 0;
  if (out.mp < 0) out.mp = 0;
  if (out.hp > out.maxHp) out.hp = out.maxHp;
  if (out.mp > out.maxMp) out.mp = out.maxMp;
  if (out.exp < 0) out.exp = 0;

  return out;
}

module.exports = async function statsGet(ws, _data = {}) {
  try {
    if (!ws.playerId) {
      try { ws.send(JSON.stringify({ event: "statsFailed", message: "Not logged in" })); } catch {}
      return;
    }

    const doc = await Player.findById(ws.playerId).lean();
    if (!doc) {
      try { ws.send(JSON.stringify({ event: "statsFailed", message: "Player not found" })); } catch {}
      return;
    }

    const src =
      doc.playerData?.stats ??
      doc.playerData ??
      doc.player_data?.stats ??
      doc.player_data ??
      {};

    const stats = buildStats(src);

    // Backfill any missing fields in Mongo so future reads include them.
    const toSet = {};
    const keys = ["maxHp","hp","maxMp","mp","atk","def","acc","spd","lvl","exp"];
    for (const k of keys) {
      const hasK =
        (doc.playerData && doc.playerData.stats && Object.prototype.hasOwnProperty.call(doc.playerData.stats, k)) ||
        (doc.playerData && Object.prototype.hasOwnProperty.call(doc.playerData, k)) ||
        (doc.player_data && doc.player_data.stats && Object.prototype.hasOwnProperty.call(doc.player_data.stats, k)) ||
        (doc.player_data && Object.prototype.hasOwnProperty.call(doc.player_data, k));
      if (!hasK) {
        toSet[`playerData.stats.${k}`] = stats[k];
      }
    }
    if (Object.keys(toSet).length > 0) {
      await Player.updateOne({ _id: ws.playerId }, { $set: toSet });
    }

    try {
      ws.send(JSON.stringify({ event: "statsUpdate", ...stats }));
    } catch {}
  } catch (err) {
    console.error("statsGet error:", err);
    try { ws.send(JSON.stringify({ event: "statsFailed", message: "Server error" })); } catch {}
  }
};
