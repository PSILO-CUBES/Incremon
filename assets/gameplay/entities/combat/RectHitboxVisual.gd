extends Node2D
class_name RectHitboxVisual

var attack_owner: Node2D
var width_px: float = 0.0
var height_px: float = 0.0
var offset_px: float = 0.0
var duration_ms: int = 0
var base_angle: float = 0.0
var elapsed_at_send_ms: int = 0

var _start_ms_local: int = 0
var _u: float = 0.0
var _max_alpha_fill: float = 0.22
var _max_alpha_line: float = 0.85
var _line_width: float = 2.0

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

	var hw := width_px * 0.5
	var hh := height_px * 0.5
	var ox := cos(base_angle) * (offset_px + hw)
	var oy := sin(base_angle) * (offset_px + hw)

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
