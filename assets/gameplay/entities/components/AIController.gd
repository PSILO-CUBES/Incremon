extends Node
@onready var emitter := $"../IntentEmitter"

@export var enable_client_ai := false

const STOP_DISTANCE := 8.0
const DIR_RESEND_DOT := 0.995

var _target: Node = null
var _was_moving := false
var _last_sent_dir := Vector2.ZERO

func _ready() -> void:
	set_process(enable_client_ai)

func _process(_dt: float) -> void:
	if not enable_client_ai:
		return
	var me := get_parent()
	if me == null:
		return

	if _target == null or not is_instance_valid(_target):
		_target = _find_target()
		if _target == null:
			_stop_if_needed()
			return

	var to_target: Vector2 = (_target.global_position - me.global_position)
	var dist := to_target.length()
	var moving := dist > STOP_DISTANCE
	var dir = (to_target / max(dist, 0.0001)).normalized() if moving else Vector2.ZERO

	if moving:
		if not _was_moving or _dir_changed(_last_sent_dir, dir, DIR_RESEND_DOT):
			if emitter:
				emitter.send_intent("moveStart", {"dir": {"x": dir.x, "y": dir.y}})
			_last_sent_dir = dir
	else:
		_stop_if_needed()

	_was_moving = moving

func _stop_if_needed() -> void:
	if _was_moving:
		var me := get_parent()
		if me:
			me.move_dir = Vector2.ZERO
		if emitter:
			emitter.send_intent("moveStop")
		_last_sent_dir = Vector2.ZERO
		_was_moving = false

func _dir_changed(a: Vector2, b: Vector2, dot_epsilon: float) -> bool:
	return a.length_squared() == 0.0 or a.dot(b) < dot_epsilon

func _find_target() -> Node:
	# Prefer a node in group "LocalPlayer"
	var g := get_tree().get_first_node_in_group("LocalPlayer")
	if g != null:
		return g
	# Fallback: try a child named "Player" under World
	var world := get_tree().get_root().get_node_or_null("Game/World")
	if world:
		var allies := world.get_node_or_null("AlliedEntities")
		if allies:
			var candidate := allies.get_node_or_null("Player")
			if candidate:
				return candidate
	return null
