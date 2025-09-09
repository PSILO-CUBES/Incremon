// server/defs/hitboxDefs.js
// Authoritative hitbox shape defs

module.exports = {
  player_basic_swing: {
    type: "cone",
    rangePx: 90,         // reach
    arcDegrees: 100,     // cone thickness
    sweepDegrees: 140,   // how far the swing rotates across the attack
    durationMs: 400,     // window (kept from your file)
    tickMs: 16,          // step
    clockwise: "auto",   // "auto" | true | false
    aim: "click"         // "click" | "forward"
  },

  enemy_default_bite: {
    type: "cone",
    rangePx: 60,
    arcDegrees: 70,
    sweepDegrees: 90,
    durationMs: 280,
    tickMs: 24,
    clockwise: false,
    aim: "forward"
  }
}
