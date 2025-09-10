// server/defs/hitboxDefs.js
//
// Shared hitbox definitions you can reference by defKey from enemiesConfig
// or from player attack logic. Keep small and data-only.
//
// Conventions: camelCase, no semicolons.

module.exports = {
  // Player default swing (used by player attack handler)
  player_basic_swing: {
    type: "cone",
    rangePx: 128,
    arcDegrees: 100,
    sweepDegrees: 140,
    durationMs: 400,
    tickMs: 16
  },

  // Generic enemy front box
  enemy_front_box_basic: {
    type: "rect",
    widthPx: 48,
    heightPx: 32,
    offsetPx: 16,
    durationMs: 300,
    tickMs: 16
  }
}
