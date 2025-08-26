extends CharacterBody2D
class_name Entity

@onready var animation_sprite: AnimatedSprite2D = %EntityAnimationSprite

@export var is_ally : bool

var last_facing_left : bool = false
var current_state : String

var bodies_in_range: Dictionary = {}
var target : CharacterBody2D
var attack_duration : float

func _on_range_area_body_entered(body: Node2D) -> void:
	if body == self : return
	bodies_in_range[body] = true

func _on_range_area_body_exited(body: Node2D) -> void:
	bodies_in_range.erase(body)

func has_anim(anim_name: StringName) -> bool:
	return animation_sprite.sprite_frames != null and animation_sprite.sprite_frames.has_animation(anim_name)

func take_damage(damage, global_position, sender):
	# self takes damage
	# still needs to figure out who deals it
	print(sender)
