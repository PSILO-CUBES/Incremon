extends CharacterBody2D
class_name Entity

@export var entity_id : String
@export var is_player : bool = false
@export var is_npc : bool = false
@export var is_ally : bool = false
@export var is_boss : bool = false

@onready var animation_sprite: AnimatedSprite2D = %AnimatedSprite2D

const POINTING_HAND = preload("res://assets/utils/icons/pointing_hand.png")

var last_facing_left : bool = false
var current_state : String

var data : Dictionary
var move_dir : Vector2 = Vector2.ZERO

const HIT_COLOR := Color(1.0, 0.2, 0.2, 1.0)
const HIT_FADE_IN_TIME := 0.08
const HIT_HOLD_TIME := 0.05
const HIT_FADE_OUT_TIME := 0.12

var _base_modulate : Color = Color(1, 1, 1, 1)
var _hit_tween : Tween

func _ready() -> void:
	_resolve_animation_sprite()
	WebSocketClient.register_handler("entityHit", Callable(self, "_on_entity_hit"))
	if animation_sprite != null:
		_base_modulate = animation_sprite.modulate

func _exit_tree() -> void:
	WebSocketClient.unregister_handler("entityHit", Callable(self, "_on_entity_hit"))
	if _hit_tween != null and _hit_tween.is_running():
		_hit_tween.kill()
		_hit_tween = null
	if animation_sprite != null:
		animation_sprite.modulate = _base_modulate

func has_anim(anim: String) -> bool:
	if animation_sprite == null:
		return false
	var frames := animation_sprite.sprite_frames
	if frames == null:
		return false
	return frames.has_animation(anim)

func _on_entity_hit(p: Dictionary) -> void:
	if not p.has("targetId"):
		return
	if str(p.targetId) != str(entity_id):
		return
	_play_hit_flash()

func _play_hit_flash() -> void:
	if animation_sprite == null:
		return
	if _hit_tween != null and _hit_tween.is_running():
		_hit_tween.kill()
		_hit_tween = null
	animation_sprite.modulate = _base_modulate
	_hit_tween = create_tween()
	_hit_tween.set_parallel(false)
	var i := 0
	while i < 2:
		var phase_in := _hit_tween.tween_property(animation_sprite, "modulate", HIT_COLOR, HIT_FADE_IN_TIME)
		phase_in.set_trans(Tween.TRANS_SINE)
		phase_in.set_ease(Tween.EASE_OUT)
		_hit_tween.tween_interval(HIT_HOLD_TIME)
		var phase_out := _hit_tween.tween_property(animation_sprite, "modulate", _base_modulate, HIT_FADE_OUT_TIME)
		phase_out.set_trans(Tween.TRANS_SINE)
		phase_out.set_ease(Tween.EASE_IN)
		if i == 0:
			_hit_tween.tween_interval(0.04)
		i += 1

func _resolve_animation_sprite() -> void:
	if animation_sprite != null:
		return
	var found := _find_first_child_sprite()
	if found != null:
		animation_sprite = found

func _find_first_child_sprite() -> AnimatedSprite2D:
	for c in get_children():
		if c is AnimatedSprite2D:
			return c
	return null
