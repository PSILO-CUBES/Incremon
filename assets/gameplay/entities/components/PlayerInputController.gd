extends Node
@onready var emitter := $"../IntentEmitter"

var was_moving := false
var last_qdir := Vector2.ZERO    # store quantized dir for comparisons

func q_axis(v: float, t: float = 0.3) -> float:
	if v >  t: return 1.0
	if v < -t: return -1.0
	return 0.0

func _process(_dt: float) -> void:
	# Raw input; Input.get_vector(...) is equivalent to the math you're doing
	var raw := Vector2(
		Input.get_action_strength("move_right") - Input.get_action_strength("move_left"),
		Input.get_action_strength("move_down")  - Input.get_action_strength("move_up")
	)

	# Quantized direction only for logic (debounce jitter)
	var qdir := Vector2(q_axis(raw.x), q_axis(raw.y))
	var moving := qdir != Vector2.ZERO

	# Use normalized raw for actual move start so diagonals aren’t faster
	var dir := raw.normalized() if raw.length_squared() > 0.0 else Vector2.ZERO

	if moving:
		if not was_moving:
			emitter.move_start(dir)
		elif qdir != last_qdir:
			# direction changed meaningfully
			emitter.move_start(dir)
	elif was_moving:
		emitter.move_stop()

	was_moving = moving
	last_qdir = qdir
