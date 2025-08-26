extends Area2D
class_name Hitbox

var damage: int = 10
var duration: float

var _already_hit := {}

var sender : CharacterBody2D

@onready var poly: CollisionPolygon2D = $HitboxPolygon
@onready var visual: Polygon2D = $Visual

func _ready():
	if poly == null:
		push_error("CollisionPolygon2D not found!")
		return
	if visual == null:
		push_error("Visual Polygon2D not found!")
		return
	
	monitoring = true
	monitorable = false
	
	if not sender.attack_duration :
		duration = 0.5
	else :
		duration = sender.attack_duration
	
	if duration > 0:
		var timer := Timer.new()
		timer.wait_time = duration
		timer.one_shot = true
		timer.autostart = true
		add_child(timer)
		timer.timeout.connect(queue_free)

func _on_body_entered(body: Node) -> void:
	if body in _already_hit: return
	
	_already_hit[body] = true
	
	body.take_damage(damage, global_position, sender)
