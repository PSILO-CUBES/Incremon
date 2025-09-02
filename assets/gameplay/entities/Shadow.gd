extends Node2D

@export var offset_x: float = 6.0
@export var offset_y: float = 6.0
@export var shadow_rotation: float = 0.1
@export var shadow_opacity: float = 0.5
@export var shadow_skew: float = 0.2  # skew factor (X-axis shear)

@onready var entity_sprite: AnimatedSprite2D = get_parent().get_node("EntityAnimationSprite")
@onready var shadow_sprite: AnimatedSprite2D = %ShadowAnimation2D
 
func _ready() -> void:
	# Share the same frames as the entity
	shadow_sprite.sprite_frames = entity_sprite.sprite_frames
	shadow_sprite.modulate = Color(0, 0, 0, shadow_opacity)
	shadow_sprite.z_index = entity_sprite.z_index - 1

func _process(_delta: float) -> void:
	# Apply position & rotation
	global_position = entity_sprite.global_position + Vector2(offset_x, offset_y)
	rotation = deg_to_rad(shadow_rotation)

	# Sync animation state
	if shadow_sprite.animation != entity_sprite.animation:
		shadow_sprite.play(entity_sprite.animation)

	if shadow_sprite.frame != entity_sprite.frame:
		shadow_sprite.frame = entity_sprite.frame

	shadow_sprite.flip_h = entity_sprite.flip_h
	shadow_sprite.flip_v = entity_sprite.flip_v

	# Apply skew (shear transform)
	var skew_transform := Transform2D()
	skew_transform.x = Vector2(1, shadow_skew)   # shear on X
	skew_transform.y = Vector2(0, 1)             # keep Y scale normal
	shadow_sprite.transform = skew_transform
