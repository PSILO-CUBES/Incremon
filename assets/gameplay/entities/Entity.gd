extends CharacterBody2D
class_name Entity

@export var entity_id : String

@onready var animation_sprite: AnimatedSprite2D = %EntityAnimationSprite

var last_facing_left : bool = false
var current_state : String

func has_anim(anim: String) -> bool:
	# Safely check if this AnimatedSprite2D has an animation by name.
	if animation_sprite == null:
		return false
	var frames := animation_sprite.sprite_frames
	if frames == null:
		return false
	return frames.has_animation(anim)
