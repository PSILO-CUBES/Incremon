extends Node2D
class_name RectHitboxVisual

var attack_owner: Node2D
var width_px: float = 0.0
var height_px: float = 0.0
var offset_px: float = 0.0
var duration_ms: int = 0
var base_angle: float = 0.0        # radians from server
var elapsed_at_send_ms: int = 0
var tick_ms: int = 16

var _start_ms_local: int = 0
var _u: float = 0.0
var _line_width: float = 2.0
var _max_alpha_fill: float = 0.22
var _max_alpha_line: float = 0.85

func _enter_tree() -> void:
	_start_ms_local = Time.get_ticks_msec() - max(elapsed_at_send_ms, 0)

func _process(_dt: float) -> void:
	if attack_owner == null:
		queue_free()
		return

	var now_ms := Time.get_ticks_msec()
	var u_den = max(1, duration_ms)
	_u = clamp(float(now_ms - _start_ms_local) / float(u_den), 0.0, 1.0)

	if now_ms - _start_ms_local >= duration_ms:
		queue_free()
		return

	queue_redraw()

func _draw() -> void:
	if attack_owner == null:
		return

	var center := attack_owner.global_position
	var w := width_px
	var h := height_px
	var ox := offset_px
	var ang := base_angle

	# Rectangle centered on owner, pushed forward by offset along base angle
	var fwd := Vector2(cos(ang), sin(ang))
	var origin := center + fwd * ox

	# Build local half-extents oriented by base angle
	var hx := w * 0.5
	var hy := h * 0.5
	var right := Vector2(cos(ang), sin(ang))
	var up := Vector2(-sin(ang), cos(ang))

	var p0 := origin + right * (-hx) + up * (-hy)
	var p1 := origin + right * ( hx) + up * (-hy)
	var p2 := origin + right * ( hx) + up * ( hy)
	var p3 := origin + right * (-hx) + up * ( hy)

	var fill_alpha := _max_alpha_fill * (0.5 + 0.5 * sin(_u * PI))
	var line_alpha := _max_alpha_line

	# Fill
	draw_colored_polygon(PackedVector2Array([p0, p1, p2, p3]), Color(1, 0, 0, fill_alpha))

	# Outline
	draw_polyline(PackedVector2Array([p0, p1, p2, p3, p0]), Color(1, 0, 0, line_alpha), _line_width, true)
