extends Node2D
class_name SwingHitboxVisual

var attack_owner: Node2D
var radius_px: float
var arc_degrees: float
var sweep_degrees: float
var duration_ms: int
var base_angle: float
var elapsed_at_send_ms: int

var _start_ms_local: int = 0
var _segments := 28
var _u: float = 0.0

func setup(owner_node: Node2D, data: Dictionary) -> void:
	attack_owner = owner_node
	radius_px = float(data.get("radiusPx", 128.0))
	arc_degrees = float(data.get("arcDegrees", 100.0))
	sweep_degrees = float(data.get("sweepDegrees", 140.0))
	duration_ms = int(data.get("durationMs", 400))
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

	# Mid-swing aims at base_angle; sweep across the duration
	var sweep_from := deg_to_rad(-sweep_degrees * 0.5)
	var sweep_to := deg_to_rad(sweep_degrees * 0.5)
	var center_rot = base_angle + lerp(sweep_from, sweep_to, _u)

	if attack_owner and is_instance_valid(attack_owner):
		global_position = attack_owner.global_position

	rotation = center_rot
	queue_redraw()

	if _u >= 1.0:
		queue_free()

func _draw() -> void:
	# Sector centered on +X in local space, rotated by node rotation
	var half_arc := deg_to_rad(arc_degrees * 0.5)
	var start_a := -half_arc
	var end_a := half_arc

	var pts := PackedVector2Array()
	pts.append(Vector2.ZERO)

	var steps = max(8, _segments)
	var step := (end_a - start_a) / float(steps)
	var a := start_a
	var i := 0
	while i <= steps:
		pts.append(Vector2(cos(a), sin(a)) * radius_px)
		a += step
		i += 1

	var appear = clamp(_u * 3.0, 0.0, 1.0)
	var fade = clamp(1.0 - max(_u - 0.6, 0.0) / 0.4, 0.0, 1.0)
	var alpha_fill = 0.22 * appear * fade
	var alpha_line = 0.85 * appear * fade

	draw_colored_polygon(pts, Color(1, 0, 0, alpha_fill))

	var outline := pts.duplicate()
	if outline.size() > 0:
		outline.remove_at(0)
	draw_polyline(outline, Color(1, 0, 0, alpha_line), 2.0, true)
