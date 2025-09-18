extends Node2D
class_name SwingHitboxVisual

var attack_owner: Node2D
var radius_px: float = 0.0
var arc_degrees: float = 0.0
var sweep_degrees: float = 0.0
var duration_ms: int = 0
var base_angle: float = 0.0        # radians from server
var elapsed_at_send_ms: int = 0
var tick_ms: int = 16

var _start_ms_local: int = 0
var _u: float = 0.0
var _line_width: float = 2.0
var _max_alpha_fill: float = 0.20
var _max_alpha_line: float = 0.90

func _enter_tree() -> void:
	# Sync local clock to server using elapsedAtSendMs
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

	# Always recompute from owner’s live position; server does this too.
	var center := attack_owner.global_position

	var arc_rad = abs(arc_degrees) * PI / 180.0
	var sweep_rad = abs(sweep_degrees) * PI / 180.0
	var half_arc = arc_rad * 0.5

	# Server grows the swing over u in [0..1] from baseAngle - sweep/2 → +sweep/2
	var start_angle = base_angle - sweep_rad * 0.5
	var curr_angle = start_angle + sweep_rad * _u

	# Build arc polygon fan for fill and outline for line
	var steps = max(10, int(ceil(arc_rad * 18.0)))  # 18 samples per rad ≈ smooth
	var points: Array[Vector2] = []
	points.append(center)

	var a0 = curr_angle - half_arc
	var a1 = curr_angle + half_arc
	var i := 0
	while i <= steps:
		var t := float(i) / float(steps)
		var a = lerp(a0, a1, t)
		points.append(center + Vector2(cos(a), sin(a)) * radius_px)
		i += 1

	# Alpha ramps in and out with u; matches server window best
	var alpha := _max_alpha_fill * (0.5 + 0.5 * sin(_u * PI))
	var line_alpha := _max_alpha_line

	if points.size() >= 3:
		var cols := PackedColorArray()
		var ci := 0
		while ci < points.size():
			cols.append(Color(1, 0, 0, alpha))
			ci += 1
		draw_colored_polygon(points, Color(1, 0, 0, alpha))

	# Outline
	var outline: PackedVector2Array = []
	var k := 1
	while k < points.size():
		outline.append(points[k])
		k += 1
	draw_polyline(outline, Color(1, 0, 0, line_alpha), _line_width, true)
