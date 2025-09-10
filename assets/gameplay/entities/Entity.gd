extends CharacterBody2D
class_name Entity

@export var entity_id : String
@export var is_player : bool = false
@export var is_npc : bool = false
@export var is_ally : bool = false
@export var is_boss : bool = false

@onready var animation_sprite: AnimatedSprite2D = %AnimatedSprite2D

var last_facing_left : bool = false
var current_state : String

var data : Dictionary

var move_dir : Vector2 = Vector2.ZERO

func _ready() -> void:
	WebSocketClient.register_handler("entityHit", Callable(self, "_on_entity_hit"))

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("entityHit", Callable(self, "_on_entity_hit"))

func has_anim(anim: String) -> bool:
	# Safely check if this AnimatedSprite2D has an animation by name.
	if animation_sprite == null:
		return false
	var frames := animation_sprite.sprite_frames
	if frames == null:
		return false
	return frames.has_animation(anim)

func _on_entity_hit(p):
	print('ouch')
	pass
