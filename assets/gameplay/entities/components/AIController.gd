extends Node
@onready var emitter := $"../IntentEmitter"

# Expect the parent to be your entity node (e.g., CharacterBody2D)
# with these fields:
#   var entity_id: String
#   var move_dir: Vector2 = Vector2.ZERO
#   var data := {"spd": <float>}   # server-provided movement speed

@export var target_path: NodePath  # set to the *local player's* node in the scene
var _target: Node = null

var _was_moving := false
var _last_sent_dir := Vector2.ZERO

func _ready() -> void:
	if target_path != NodePath(""):
		_target = get_node_or_null(target_path)

func _physics_process(_dt: float) -> void:
	# If no target, don’t move.
	if _target == null:
		_stop_if_needed()
		return

	var me := get_parent()
	if not me or not me.has_method("get_global_position"):
		_stop_if_needed()
		return

	var my_pos: Vector2 = me.get_global_position()
	var tgt_pos: Vector2 = _target.get_global_position()
	var to_target: Vector2 = (tgt_pos - my_pos)

	# Don’t spam if basically on top of target
	var moving := to_target.length_squared() > 1.0
	var dir := to_target.normalized() if moving else Vector2.ZERO

	# --- Client-side prediction: update local model immediately ---
	# Walk state will consume me.move_dir and apply velocity = dir * data.spd
	me.move_dir = dir

	# --- Networking: send intents only on start/stop or meaningful dir change ---
	if moving:
		if (not _was_moving) or _dir_changed(dir, _last_sent_dir):
			emitter.send_intent("moveStart", {"dir": {"x": dir.x, "y": dir.y}})
			_last_sent_dir = dir
	else:
		_stop_if_needed()

	_was_moving = moving

func _stop_if_needed() -> void:
	if _was_moving:
		# Clear local prediction as well
		var me := get_parent()
		if me:
			me.move_dir = Vector2.ZERO
		emitter.send_intent("moveStop")
		_last_sent_dir = Vector2.ZERO
		_was_moving = false

func _dir_changed(a: Vector2, b: Vector2, dot_epsilon: float = 0.995) -> bool:
	# Re-send when the angle changes enough (avoid noise); 0.995 ≈ ~5 degrees
	if a == Vector2.ZERO and b == Vector2.ZERO:
		return false
	if a == Vector2.ZERO or b == Vector2.ZERO:
		return true
	return a.dot(b) < dot_epsilon
