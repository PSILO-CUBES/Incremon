extends Node
@onready var emitter := $"../IntentEmitter"

var was_moving: bool = false
var last_qdir: Vector2 = Vector2.ZERO  # quantized dir for change detection

func _q_axis(v: float, t: float = 0.3) -> float:
	if v >  t: return 1.0
	if v < -t: return -1.0
	return 0.0

func _process(_dt: float) -> void:
	# Read raw inputs (Godot 4 helper gives normalized cardinal/diagonal properly)
	var raw: Vector2 = Input.get_vector("move_left", "move_right", "move_up", "move_down")

	# Quantize for logic so tiny jitters don’t spam intents
	var qdir := Vector2(_q_axis(raw.x), _q_axis(raw.y))
	var moving := (qdir != Vector2.ZERO)

	# Use normalized raw for actual direction (so diagonals aren’t faster)
	var dir := raw.normalized() if raw.length_squared() > 0.0 else Vector2.ZERO

	if moving:
		# on first press OR meaningful direction change → re-send moveStart
		if not was_moving or qdir != last_qdir:
			emitter.send_intent("moveStart", {"dir": {"x": dir.x, "y": dir.y}})
	elif was_moving:
		emitter.send_intent("moveStop")

	was_moving = moving
	last_qdir = qdir

func _unhandled_input(event: InputEvent) -> void:
	# Trigger an attack intent when the player clicks LMB
	if event is InputEventMouseButton \
		and event.button_index == MOUSE_BUTTON_LEFT \
		and event.pressed \
		and not event.is_echo():
		emitter.attack_start()
