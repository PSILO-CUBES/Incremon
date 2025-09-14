extends Node2D
class_name SwingHitboxVisual

var attack_owner: Node2D
var radius_px: float = 0.0
var arc_degrees: float = 0.0
var sweep_degrees: float = 0.0
var duration_ms: int = 0
var base_angle: float = 0.0
var elapsed_at_send_ms: int = 0

var _start_ms_local: int = 0
var _u: float = 0.0
var _segments: int = 28

func setup(owner_node: Node2D, data: Dictionary) -> void:
	attack_owner = owner_node
	radius_px = float(data.get("radiusPx", 96.0))
	arc_degrees = float(data.get("arcDegrees", 90.0))
	sweep_degrees = float(data.get("sweepDegrees", 120.0))
	duration_ms = int(data.get("durationMs", 400))
	base_angle = float(data.get("baseAngle", 0.0))
	elapsed_at_send_ms = int(data.get("elapsedAtSendMs", 0))
	_start_ms_local = Time.get_ticks_msec()
	set_process(true)
	set_notify_transform(true)

func _process(_dt: float) -> void:
	if attack_owner == null or not is_instance_valid(attack_owner):
		queue_free()
		return

	global_position = attack_owner.global_position

	var now_ms := Time.get_ticks_msec()
	var elapsed_ms := int(now_ms - _start_ms_local)
	var t_ms := elapsed_at_send_ms + elapsed_ms
	if duration_ms <= 0:
		_u = 1.0
	else:
		_u = clamp(float(t_ms) / float(duration_ms), 0.0, 1.0)

	queue_redraw()

	if _u >= 1.0:
		queue_free()

func _draw() -> void:
	if attack_owner == null or not is_instance_valid(attack_owner):
		return

	var arc_rad := deg_to_rad(arc_degrees)
	var sweep_rad := deg_to_rad(sweep_degrees)
	var half_arc_rad := arc_rad * 0.5

	var start_angle := base_angle - sweep_rad * 0.5
	var current_angle := start_angle + sweep_rad * _u

	var pts := PackedVector2Array()
	pts.append(Vector2.ZERO)

	var i := 0
	var step := 0.0
	if _segments <= 0:
		step = arc_rad
	else:
		step = arc_rad / float(_segments)

	var a := current_angle - half_arc_rad
	while i <= _segments:
		var px := cos(a) * radius_px
		var py := sin(a) * radius_px
		pts.append(Vector2(px, py))
		a += step
		i += 1

	var appear = clamp(_u * 3.0, 0.0, 1.0)
	var fade = clamp(1.0 - max(_u - 0.6, 0.0) / 0.4, 0.0, 1.0)
	var alpha_fill = 0.22 * appear * fade
	var alpha_line = 0.85 * appear * fade

	draw_colored_polygon(pts, Color(1, 0, 0, alpha_fill))

	if pts.size() > 1:
		var outline := pts.duplicate()
		outline.remove_at(0)
		draw_polyline(outline, Color(1, 0, 0, alpha_line), 2.0, true)
