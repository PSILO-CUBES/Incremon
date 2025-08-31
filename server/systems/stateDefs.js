module.exports = {
  player: {
    idle: {  moveIntentStart: { to: "walk" } },
    walk: { moveIntentStop:  { to: "idle" }, moveIntentStart: { to: "walk" } },
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