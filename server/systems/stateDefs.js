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
      // internal/server-fired completion push (see handler)
      attackFinished:    { to: "idle" },
      // let fresh movement immediately override if desired
      moveIntentStart:   { to: "walk" },
    },
  },
  vendor: {
    idle: { /* no movement allowed */ },
    walk: { /* unused for vendor */ },
  },
  pet: {
    idle: {  moveIntentStart: { to: "walk" } },
    walk: { moveIntentStop:  { to: "idle" }, moveIntentStart: { to: "walk" } },
  },
};
