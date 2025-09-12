const mongoose = require("mongoose");
const { DEFAULT_PLAYER_DATA } = require('../defs/playerDefaults');

// Subdocument for stats (no _id)
const PlayerDataSchema = new mongoose.Schema({
  stats : {
    maxHp: { type: Number, default: DEFAULT_PLAYER_DATA.hp },
    hp:    { type: Number, default: DEFAULT_PLAYER_DATA.hp },
    maxMp: { type: Number, default: DEFAULT_PLAYER_DATA.mp },
    mp:    { type: Number, default: DEFAULT_PLAYER_DATA.mp },
    atk:   { type: Number, default: DEFAULT_PLAYER_DATA.atk },
    def:   { type: Number, default: DEFAULT_PLAYER_DATA.def },
    acc:   { type: Number, default: DEFAULT_PLAYER_DATA.acc },
    spd:   { type: Number, default: DEFAULT_PLAYER_DATA.spd },
    lvl:   { type: Number, default: DEFAULT_PLAYER_DATA.lvl },
    exp:   { type: Number, default: DEFAULT_PLAYER_DATA.exp },
  }
}, { _id: false });

const PlayerSchema = new mongoose.Schema({
  username:   { type: String, required: true, unique: true, index: true },
  email:      { type: String, unique: true, sparse: true, index: true },
  verified:   { type: Boolean, default: false, index: true },
  verifiedAt: { type: Date },
  verificationToken: { type: String, index: true },

  // Set on signup; TTL index below will purge the doc after this time
  verifyExpiresAt: { type: Date, index: true },

  passHash:  { type: String, required: true },

  // We will lazily create this at first verified login/spawn.
  playerData: { type: PlayerDataSchema, required: false },
}, {
  timestamps: true,
  minimize: true,
  collection: 'players',
});

// TTL: delete unverified accounts after verifyExpiresAt
// Docs that do not have verifyExpiresAt (or have it unset on verification) will NOT be deleted.

module.exports = mongoose.model("Player", PlayerSchema);