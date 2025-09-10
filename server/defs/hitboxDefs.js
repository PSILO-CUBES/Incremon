// server/defs/hitboxDefs.js
//
// Canonical, server-authoritative hitbox shapes for both players and enemies.
// Keep this tiny and data-driven so we can adjust without touching code.
//
// Conventions: camelCase, no semicolons.

module.exports = {
  // Player's default swing (already used by attackIntentStart)
  player_basic_swing: {
    type: "cone",
    rangePx: 128,
    arcDegrees: 100,
    sweepDegrees: 140,
    durationMs: 400,
    tickMs: 16
  },

  // Enemy: simple rectangle directly in front of the mob.
  // Center of the box sits at: mob.pos + forward * (offsetPx + heightPx/2)
  // Width runs left/right of facing, height runs along facing.
  enemy_front_box_basic: {
    type: "rect",
    widthPx: 48,
    heightPx: 32,
    offsetPx: 16,
    durationMs: 240,
    tickMs: 16
  }
}
