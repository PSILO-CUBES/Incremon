// server/defs/enemiesConfig.js
// Canonical, server-authoritative enemy definitions.
// The client must NOT define these. The server sends legit stats + scenePath.

module.exports = {
  gablino: {
    name : 'gablino',
    
    // Core stats (authoritative)
    hp: 5,
    spd: 5,
    atk: 1,

    // Client scene path (the client already has this resource locally)
    scenePath: "res://assets/gameplay/entities/monsters/enemies/gablino/Gablino.tscn",

    // Extra info (tags, drops, etc.)
    tags: ["bones", "basic"],

    // How far mobs can spawn from each other
    spawnSeparation: 40, // pixels
  },

  // Add more enemies here...
  // gobbo: { hp: 10, spd: 4, atk: 2, scenePath: "res://...", tags: [] },
};
