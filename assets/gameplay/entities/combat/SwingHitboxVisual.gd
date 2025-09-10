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

func setup(owner_node: Node2D, data: Dictionary) -> void:
	attack_owner = owner_node
	radius_px = float(data.get("radiusPx", 64.0))
	arc_degrees = float(data.get("arcDegrees", 90.0))
	sweep_degrees = float(data.get("sweepDegrees", 120.0))
	duration_ms = int(data.get("durationMs", 300))
	base_angle = float(data.get("baseAngle", 0.0))
	elapsed_at_send_ms = int(data.get("elapsedAtSendMs", 0))
	_start_ms_local = Time.get_ticks_msec() - elapsed_at_send_ms

	z_as_relative = false
	set_process(true)

func _process(_dt: float) -> void:
	queue_redraw()

func _draw() -> void:
	if attack_owner == null:
		return
	
	var now_local := Time.get_ticks_msec()
	var elapsed := now_local - _start_ms_local
	if duration_ms <= 0:
		duration_ms = 1
	var u = clamp(float(elapsed) / float(duration_ms), 0.0, 1.0)
	
	var sweep_rad := deg_to_rad(sweep_degrees)
	var arc_rad := deg_to_rad(arc_degrees)
	var center_angle = base_angle + (u - 0.5) * sweep_rad
	var start_angle = center_angle - arc_rad * 0.5
	var end_angle = center_angle + arc_rad * 0.5
	
	global_position = attack_owner.global_position
	
	var pts := PackedVector2Array()
	pts.append(Vector2.ZERO)
	
	var a = start_angle
	var step = (end_angle - start_angle) / float(_segments)
	var i := 0
	while i <= _segments:
		pts.append(Vector2(cos(a), sin(a)) * radius_px)
		a += step
		i += 1
	
	draw_colored_polygon(pts, Color(1, 0, 0, 0.22))
	var outline := pts.duplicate()
	if outline.size() > 0:
		outline.remove_at(0)
	draw_polyline(outline, Color(1, 0, 0, 0.85), 2.0, true)
	
	if u >= 1.0:
		queue_free()
