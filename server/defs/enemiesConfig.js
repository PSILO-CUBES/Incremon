module.exports = {
  gablino: {
    name: 'gablino',

    // Core stats
    hp: 5,
    maxHp: 5,
    spd: 50,
    atk: 1,

    // Client scene path (client holds this asset locally)
    scenePath: "res://assets/gameplay/entities/monsters/enemies/gablino/Gablino.tscn",

    // Tags, drops, etc.
    tags: ["bones", "basic"],

    // Collision + spawn spacing
    collisionRadius: 20,
    spawnSeparation: 40,

    // AI engagement + pacing
    attackRangePx: 84,          // when within this, AI swaps to 'attack'
    attackTimer: 900,           // legacy pacing field (ms)
    attackCooldownMs: 900,      // post-attack cooldown (ms)

    // Per-enemy attack hitbox. Default here is a square front box.
    attack: {
      // Option A: inline hitbox definition (rect)
      hitbox: {
        type: "rect",
        widthPx: 36,
        heightPx: 48,
        offsetPx: 16,
        durationMs: 300,
        tickMs: 16
      }

      // Option B: use a shared def from hitboxDefs.js instead:
      // hitbox: { defKey: "enemy_front_box_basic" }
    }
  },
}