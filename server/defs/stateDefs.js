module.exports = {
  player: {
    idle: {
      moveIntentStart:   { to: "walk" },
      attackIntentStart: { to: "attack" },
    },
    walk: {
      moveIntentStop:    { to: "idle" },
      moveIntentStart:   { to: "walk" },
      attackIntentStart: { to: "attack" },
    },
    attack: {
      attackFinished:    { to: "idle" },
      // Players are allowed to cancel/override attack with fresh movement
      moveIntentStart:   { to: "walk" },
    },
  },

  mob: {
    idle: {
      moveIntentStart:   { to: "walk" },
      attackIntentStart: { to: "attack" },
    },
    walk: {
      moveIntentStop:    { to: "idle" },
      moveIntentStart:   { to: "walk" },
      attackIntentStart: { to: "attack" },
    },
    attack: {
      // Mobs CANNOT walk until attack is finished
      attackFinished:    { to: "idle" },
    },
  },

  vendor: {
    idle: { /* no movement allowed */ },
    walk: { /* unused */ },
  },

  pet: {
    idle: { moveIntentStart: { to: "walk" } },
    walk: {
      moveIntentStop:  { to: "idle" },
      moveIntentStart: { to: "walk" },
    },
  },
}
