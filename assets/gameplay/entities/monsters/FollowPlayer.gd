extends CharacterBody2D

@export var speed: float = 100.0

var target: CharacterBody2D

func _ready() -> void:
	await get_tree().create_timer(0.5).timeout
	target = get_tree().get_root().get_node('Game/World/Player')

func _physics_process(delta: float) -> void:
	if target == null:
		return
	
	var dir = (target.global_position - global_position).normalized()
	velocity = dir * speed
	move_and_slide()
