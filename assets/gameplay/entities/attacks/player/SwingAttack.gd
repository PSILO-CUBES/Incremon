extends Hitbox
class_name SwingAttack

var radius: float = 128.0
var arc_degrees: float = 90.0
var segments: int = 10
var sweep_degrees: float = 120.0
var clockwise := true

func _ready():
	duration = 0.5
	super._ready()
	_rebuild_polygon()

func _rebuild_polygon():
	var pts := PackedVector2Array()
	pts.append(Vector2.ZERO)
	var half: float = deg_to_rad(arc_degrees) * 0.5
	var step: float = (half * 2.0) / max(1, segments)
	for i in range(segments + 1):
		var a: float = -half + step * i
		pts.append(Vector2.RIGHT.rotated(a) * radius)

	poly.polygon = pts
	visual.polygon = pts
	visual.color = Color(1, 0, 0, 0.3)

func _on_body_entered(body: Node) -> void:
	super._on_body_entered(body)

func start_click_attack(target_pos: Vector2, attack_sender: CharacterBody2D):
	_already_hit.clear()
	
	var dir: Vector2 = (target_pos - global_position).normalized()
	var face_angle: float = dir.angle()
	
	clockwise = target_pos.x >= global_position.x
	
	var half_sweep: float = deg_to_rad(sweep_degrees * 0.5)
	
	global_rotation = face_angle - half_sweep if clockwise else face_angle + half_sweep
	
	var target_rotation: float = global_rotation + deg_to_rad(sweep_degrees) if clockwise else global_rotation - deg_to_rad(sweep_degrees)
	
	var tween = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "global_rotation", target_rotation, duration)
