extends Node2D
class_name SwingHitboxVisual

var attack_owner: Node2D
var radius_px: float = 0.0
var arc_degrees: float = 0.0
var sweep_degrees: float = 0.0
var duration_ms: int = 0
var base_angle: float = 0.0
var elapsed_at_send_ms: int = 0
var segments: int = 28
var tick_ms: int = 16

var _start_ms_local: int = 0
var _u: float = 0.0

func setup(owner_node: Node2D, data: Dictionary) -> void:
	attack_owner = owner_node

	# Accept camelCase and snake_case from the server payload
	radius_px = float(_get_any(data, ["radiusPx", "radius_px"], 0.0))
	arc_degrees = float(_get_any(data, ["arcDegrees", "arc_degrees"], 0.0))
	sweep_degrees = float(_get_any(data, ["sweepDegrees", "sweep_degrees"], 0.0))
	duration_ms = int(_get_any(data, ["durationMs", "duration_ms"], 0))
	base_angle = float(_get_any(data, ["baseAngle", "base_angle"], 0.0))
	elapsed_at_send_ms = int(_get_any(data, ["elapsedAtSendMs", "elapsed_at_send_ms"], 0))
	segments = int(_get_any(data, ["segments", "segments"], 28))
	tick_ms = int(_get_any(data, ["tickMs", "tick_ms"], 16))

	# Sync the local timebase to the server's start so the sweep lines up
	_start_ms_local = Time.get_ticks_msec() - max(elapsed_at_send_ms, 0)
	print("DEBUG visual start_ms_local =", _start_ms_local, " (ticks =", Time.get_ticks_msec(), ")")
	_u = 0.0

	# Start positioned at the owner's global position
	global_position = attack_owner.global_position

	set_process(true)
	set_physics_process(false)
	queue_redraw()

func _process(_dt: float) -> void:
	# Follow the owner so detection and visuals align while moving
	if attack_owner != null:
		global_position = attack_owner.global_position

	var now_ms := Time.get_ticks_msec()
	var elapsed = max(0, now_ms - _start_ms_local)
	if duration_ms > 0:
		_u = clamp(float(elapsed) / float(duration_ms), 0.0, 1.0)
	else:
		_u = 1.0

	queue_redraw()

	# Cleanup when done
	if _u >= 1.0:
		queue_free()

func _draw() -> void:
	if attack_owner == null:
		return

	var center_angle := _current_angle(base_angle, sweep_degrees, _u)
	var pts := PackedVector2Array()
	pts.append(Vector2.ZERO)

	var seg_count = max(4, segments)
	var half_arc = abs(arc_degrees) * 0.5
	var start_deg = -half_arc
	var step := 0.0
	if seg_count > 0:
		step = (arc_degrees) / float(seg_count)

	var i := 0
	var a = start_deg
	while i <= seg_count:
		var ang := deg_to_rad(a) + center_angle
		var px := cos(ang) * radius_px
		var py := sin(ang) * radius_px
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

func _current_angle(base: float, sweep: float, u: float) -> float:
	var sweep_rad = abs(sweep) * PI / 180.0
	var start = base - sweep_rad * 0.5
	return start + sweep_rad * u

func _get_any(data: Dictionary, keys: Array, default_val) -> Variant:
	var i := 0
	while i < keys.size():
		var k := str(keys[i])
		if data.has(k):
			return data[k]
		i += 1
	return default_val
