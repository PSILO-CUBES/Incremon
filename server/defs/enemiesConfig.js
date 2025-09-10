// server/defs/enemiesConfig.js
// Canonical, server-authoritative enemy definitions.
// The client must NOT define these. The server sends legit stats + scenePath.

module.exports = {
  gablino: {
    name : 'gablino',
    
    // Core stats (authoritative)
    hp: 5,
    spd: 50,
    atk: 1,

    // Client scene path (the client already has this resource locally)
    scenePath: "res://assets/gameplay/entities/monsters/enemies/gablino/Gablino.tscn",

    // Extra info (tags, drops, etc.)
    tags: ["bones", "basic"],

    // Collision + spawn spacing
    collisionRadius: 20,      // <— add this to tune blocking feel per mob
    spawnSeparation: 40,      // pixels

    attackRangePx: 84,
    attackTimer: 900,
    attackCooldownMs: 900,
  },

  // Add more enemies here...
  // gobbo: { hp: 10, spd: 4, atk: 2, scenePath: "res://...", tags: [] },
};
