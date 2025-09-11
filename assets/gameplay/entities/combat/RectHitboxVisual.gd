extends Node2D
class_name RectHitboxVisual

var attack_owner: Node2D
var width_px: float
var height_px: float
var offset_px: float
var duration_ms: int
var base_angle: float
var elapsed_at_send_ms: int

var _start_ms_local: int = 0
var _max_alpha_fill := 0.22
var _max_alpha_line := 0.85
var _line_width := 2.0
var _u: float = 0.0

func setup(owner_node: Node2D, data: Dictionary) -> void:
	attack_owner = owner_node
	width_px = float(data.get("widthPx", 48.0))
	height_px = float(data.get("heightPx", 32.0))
	offset_px = float(data.get("offsetPx", 16.0))
	duration_ms = int(data.get("durationMs", 300))
	base_angle = float(data.get("baseAngle", 0.0))
	elapsed_at_send_ms = int(data.get("elapsedAtSendMs", 0))
	_start_ms_local = Time.get_ticks_msec()
	set_process(true)

func _process(_dt: float) -> void:
	var now_ms := Time.get_ticks_msec()
	var lived := float(now_ms - _start_ms_local + elapsed_at_send_ms)
	if duration_ms <= 0:
		_u = 1.0
	else:
		_u = clamp(lived / float(duration_ms), 0.0, 1.0)

	if attack_owner and is_instance_valid(attack_owner):
		global_position = attack_owner.global_position
	else:
		# stays where spawned if owner vanished
		pass

	rotation = base_angle
	queue_redraw()

	if _u >= 1.0:
		queue_free()

func _draw() -> void:
	# Stationary oriented rectangle placed in front of owner along +X of this node
	var half_h := height_px * 0.5
	var x0 := offset_px
	var x1 := offset_px + width_px

	var c0 := Vector2(x0, -half_h)
	var c1 := Vector2(x1, -half_h)
	var c2 := Vector2(x1,  half_h)
	var c3 := Vector2(x0,  half_h)

	var pts := PackedVector2Array()
	pts.append(c0)
	pts.append(c1)
	pts.append(c2)
	pts.append(c3)

	# Gentle appear → hold → fade
	var appear = clamp(_u * 3.0, 0.0, 1.0)
	var fade = clamp(1.0 - max(_u - 0.6, 0.0) / 0.4, 0.0, 1.0)
	var alpha_fill = _max_alpha_fill * appear * fade
	var alpha_line = _max_alpha_line * appear * fade

	draw_colored_polygon(pts, Color(1, 0, 0, alpha_fill))

	var outline := PackedVector2Array()
	outline.append(c0)
	outline.append(c1)
	outline.append(c2)
	outline.append(c3)
	outline.append(c0)
	draw_polyline(outline, Color(1, 0, 0, alpha_line), _line_width, true)
