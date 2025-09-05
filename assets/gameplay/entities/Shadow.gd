extends Node2D

@export var offset_x: float = -6.0
@export var offset_y: float = -6.0
@export var shadow_rotation: float = 0.1
@export var shadow_opacity: float = 0.5
@export var shadow_skew: float = 0.0  # shear factor (X-axis)

# --- Breathing controls ---
@export var breathe_speed_hz: float = 0.4        # cycles per second
@export var breathe_scale_amp: float = 0.02      # how much the shadow scales in/out
@export var breathe_opacity_amp: float = 0.08    # how much alpha oscillates
@export var breathe_offset_amp: float = 1.5      # vertical bob (px)
@export var base_scale_x: float = 1.0            # base ellipse width
@export var base_scale_y: float = 0.85           # base ellipse height (slightly flattened)
@export var randomize_phase: bool = true         # desync shadows per-entity
@export var phase_offset: float = 0.0            # optional manual phase (radians)

@onready var entity_sprite: AnimatedSprite2D = get_parent().get_node("AnimatedSprite2D")
@onready var shadow_sprite: AnimatedSprite2D = %ShadowAnimation2D

var _time_accum: float = 0.0

func _ready() -> void:
	# Share the same frames as the entity
	shadow_sprite.sprite_frames = entity_sprite.sprite_frames
	shadow_sprite.modulate = Color(0, 0, 0, shadow_opacity)
	shadow_sprite.z_index = entity_sprite.z_index - 1

	# Optional deterministic phase per instance (so a crowd doesn’t pulse in sync)
	if randomize_phase:
		var rng := RandomNumberGenerator.new()
		rng.seed = hash(get_path())   # deterministic per scene path
		phase_offset = rng.randf_range(0.0, TAU)

func _process(delta: float) -> void:
	_time_accum += delta
	var wave := sin(TAU * breathe_speed_hz * _time_accum + phase_offset) # -1..1

	# Apply position & rotation (with a tiny vertical bob)
	var bob := wave * breathe_offset_amp
	global_position = entity_sprite.global_position + Vector2(offset_x, offset_y + bob)
	rotation = deg_to_rad(shadow_rotation)

	# Sync animation state
	if shadow_sprite.animation != entity_sprite.animation:
		shadow_sprite.play(entity_sprite.animation)
	if shadow_sprite.frame != entity_sprite.frame:
		shadow_sprite.frame = entity_sprite.frame
	shadow_sprite.flip_h = entity_sprite.flip_h
	shadow_sprite.flip_v = entity_sprite.flip_v

	# Breathing: scale + subtle alpha pulse
	var sx := base_scale_x * (1.0 + breathe_scale_amp * wave)
	var sy := base_scale_y * (1.0 - breathe_scale_amp * 0.5 * wave)  # keep ellipse slightly flatter than X
	var a = clamp(shadow_opacity * (1.0 + breathe_opacity_amp * wave), 0.0, 1.0)
	shadow_sprite.modulate = Color(0, 0, 0, a)

	# Compose shear + scale into a single transform (keeps flip_h working)
	var t := Transform2D()
	t.x = Vector2(sx, shadow_skew)  # shear on X
	t.y = Vector2(0.0, sy)          # Y scale
	shadow_sprite.transform = t
