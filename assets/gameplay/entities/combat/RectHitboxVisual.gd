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
var _color_fill := Color(1, 0, 0, 0.22)
var _color_line := Color(1, 0, 0, 0.85)
var _line_width := 2.0
var _max_alpha_fill := 0.22
var _max_alpha_line := 0.85

func setup(owner_node: Node2D, data: Dictionary) -> void:
	attack_owner = owner_node
	width_px = float(data.get("widthPx", 48.0))
	height_px = float(data.get("heightPx", 32.0))
	offset_px = float(data.get("offsetPx", 16.0))
	duration_ms = int(data.get("durationMs", 300))
	base_angle = float(data.get("baseAngle", 0.0))
	elapsed_at_send_ms = int(data.get("elapsedAtSendMs", 0))

	_start_ms_local = Time.get_ticks_msec() - elapsed_at_send_ms
	z_as_relative = false
	z_index = 99999

	set_process(true)
	queue_redraw()

func _process(_dt: float) -> void:
	queue_redraw()

func _draw() -> void:
	if attack_owner == null:
		queue_free()
		return

	var now_ms := Time.get_ticks_msec()
	var u := 0.0
	var denom := float(duration_ms)
	if denom > 0.0:
		u = float(now_ms - _start_ms_local) / denom
	if u >= 1.0:
		queue_free()
		return
	if u < 0.0:
		u = 0.0
	if u > 1.0:
		u = 1.0

	# Pulse alpha slightly to make it readable but unobtrusive.
	var fill_a := _max_alpha_fill * (0.7 + 0.3 * sin(u * TAU))
	var line_a := _max_alpha_line

	var fwd := Vector2(cos(base_angle), sin(base_angle))
	var right := Vector2(fwd.y, -fwd.x)

	var hx := height_px * 0.5
	var hy := width_px * 0.5

	# Center of the rectangle: placed in front of the attacker
	var center := fwd * (offset_px + hx)

	# Corners in world axes relative to owner's local origin
	var c0 := center + (-hx) * fwd + (-hy) * right
	var c1 := center + (-hx) * fwd + (hy) * right
	var c2 := center + (hx) * fwd + (hy) * right
	var c3 := center + (hx) * fwd + (-hy) * right

	var pts := PackedVector2Array()
	pts.append(c0)
	pts.append(c1)
	pts.append(c2)
	pts.append(c3)

	draw_colored_polygon(pts, Color(_color_fill.r, _color_fill.g, _color_fill.b, fill_a))

	var outline := PackedVector2Array()
	outline.append(c0)
	outline.append(c1)
	outline.append(c2)
	outline.append(c3)
	outline.append(c0)
	draw_polyline(outline, Color(_color_line.r, _color_line.g, _color_line.b, line_a), _line_width, true)
