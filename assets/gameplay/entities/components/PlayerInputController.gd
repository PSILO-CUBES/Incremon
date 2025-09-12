extends Node
@onready var emitter := $"../IntentEmitter"

var was_moving: bool = false
var last_qdir: Vector2 = Vector2.ZERO

func _q_axis(v: float, t: float = 0.3) -> float:
	if v > t:
		return 1.0
	if v < -t:
		return -1.0
	return 0.0

func _process(_dt: float) -> void:
	var raw := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var qdir := Vector2(_q_axis(raw.x), _q_axis(raw.y))
	var moving := qdir != Vector2.ZERO

	if moving:
		if not was_moving:
			emitter.move_start(raw.normalized())
		else:
			if qdir != last_qdir:
				emitter.move_start(raw.normalized())
	else:
		if was_moving:
			emitter.move_stop()

	was_moving = moving
	last_qdir = qdir

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed and not event.is_echo():
		var viewport := get_viewport()
		var camera := viewport.get_camera_2d()
		if camera:
			var click_pos := camera.get_global_mouse_position()
			emitter.attack_start(click_pos)
