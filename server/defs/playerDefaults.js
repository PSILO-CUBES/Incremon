module.exports = {
  DEFAULT_PLAYER_DATA : Object.freeze({
    hp: 10,
    mp: 5,
    atk: 1,
    def: 1,
    acc: 1,
    spd: 200,
    lvl: 1,
    exp: 0
  }),

  DEFAULT_PLAYER_ATTACKS: Object.freeze({
    basicSwing: Object.freeze({
      name: "basicSwing",
      cooldownMs: 1000,
      hitbox: Object.freeze({
        type: "cone",
        rangePx: 128,
        arcDegrees: 100,
        sweepDegrees: 140,
        durationMs: 400,
        tickMs: 16
      })
    })
  })
}
