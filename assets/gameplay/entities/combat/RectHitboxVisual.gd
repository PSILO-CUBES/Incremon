extends Node2D
class_name RectHitboxVisual

var attack_owner: Node2D
var width_px: float = 0.0
var height_px: float = 0.0
var offset_px: float = 0.0
var duration_ms: int = 0
var base_angle: float = 0.0
var elapsed_at_send_ms: int = 0
var tick_ms: int = 16

var _start_ms_local: int = 0
var _u: float = 0.0
var _max_alpha_fill: float = 0.22
var _max_alpha_line: float = 0.85
var _line_width: float = 2.0

func setup(owner_node: Node2D, data: Dictionary) -> void:
	attack_owner = owner_node

	width_px = float(_get_any(data, ["widthPx", "width_px"], 0.0))
	height_px = float(_get_any(data, ["heightPx", "height_px"], 0.0))
	offset_px = float(_get_any(data, ["offsetPx", "offset_px"], 0.0))
	duration_ms = int(_get_any(data, ["durationMs", "duration_ms"], 0))
	base_angle = float(_get_any(data, ["baseAngle", "base_angle"], 0.0))
	elapsed_at_send_ms = int(_get_any(data, ["elapsedAtSendMs", "elapsed_at_send_ms"], 0))
	tick_ms = int(_get_any(data, ["tickMs", "tick_ms"], 16))

	_start_ms_local = Time.get_ticks_msec() - max(elapsed_at_send_ms, 0)
	_u = 0.0

	global_position = attack_owner.global_position

	set_process(true)
	set_physics_process(false)
	queue_redraw()

func _process(_dt: float) -> void:
	if attack_owner != null:
		global_position = attack_owner.global_position

	var now_ms := Time.get_ticks_msec()
	var elapsed = max(0, now_ms - _start_ms_local)
	if duration_ms > 0:
		_u = clamp(float(elapsed) / float(duration_ms), 0.0, 1.0)
	else:
		_u = 1.0

	queue_redraw()

	if _u >= 1.0:
		queue_free()

func _draw() -> void:
	if attack_owner == null:
		return

	var dir_x := cos(base_angle)
	var dir_y := sin(base_angle)

	var ox := dir_x * offset_px
	var oy := dir_y * offset_px

	var hw := width_px * 0.5
	var hh := height_px * 0.5

	var cos_a := cos(base_angle)
	var sin_a := sin(base_angle)

	var corners := PackedVector2Array()
	corners.append(Vector2(-hw, -hh))
	corners.append(Vector2( hw, -hh))
	corners.append(Vector2( hw,  hh))
	corners.append(Vector2(-hw,  hh))

	var pts := PackedVector2Array()
	var i := 0
	while i < 4:
		var px := corners[i].x
		var py := corners[i].y
		var rx := px * cos_a - py * sin_a
		var ry := px * sin_a + py * cos_a
		pts.append(Vector2(ox + rx, oy + ry))
		i += 1

	var appear = clamp(_u * 3.0, 0.0, 1.0)
	var fade = clamp(1.0 - max(_u - 0.6, 0.0) / 0.4, 0.0, 1.0)
	var alpha_fill = _max_alpha_fill * appear * fade
	var alpha_line = _max_alpha_line * appear * fade

	draw_colored_polygon(pts, Color(1, 0, 0, alpha_fill))

	var outline := PackedVector2Array()
	outline.append(pts[0])
	outline.append(pts[1])
	outline.append(pts[2])
	outline.append(pts[3])
	outline.append(pts[0])
	draw_polyline(outline, Color(1, 0, 0, alpha_line), _line_width, true)

func _get_any(data: Dictionary, keys: Array, default_val) -> Variant:
	var i := 0
	while i < keys.size():
		var k := str(keys[i])
		if data.has(k):
			return data[k]
		i += 1
	return default_val
