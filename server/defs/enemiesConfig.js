module.exports = {
  // Optional shared shapes so existing `defKey` references still work
  shared: {
    enemy_front_box_basic: {
      name: 'enemy_front_box_basic',
      type: 'rect',
      widthPx: 48,
      heightPx: 32,
      offsetPx: 16,
      durationMs: 300,
      tickMs: 16
    }
  },

  gablino: {
    name: 'gablino',

    hp: 5,
    mp: 5,
    spd: 50,
    atk: 1,

    scenePath: 'res://assets/gameplay/entities/monsters/enemies/gablino/Gablino.tscn',
    tags: ['bones', 'basic'],

    attack: {
      rangePx: 64,
      cooldownMs: 1200,
      durationMs: 300,

      // Inline canonical hitbox (preferred)
      hitbox: {
        type: 'rect',
        widthPx: 36,
        heightPx: 48,
        offsetPx: 16,
        durationMs: 300,
        tickMs: 16
      }

      // Or reuse a shared one:
      // hitbox: { defKey: 'enemy_front_box_basic' }
    }
  }
}
