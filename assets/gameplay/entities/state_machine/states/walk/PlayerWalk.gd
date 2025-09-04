extends WalkState
class_name PlayerWalk

func _enter() -> void:
	super._enter()

func _exit() -> void:
	super._exit()

func _physics_update(delta: float) -> void:
	super._physics_update(delta)
	
	var dir := Vector2.ZERO
	if Input.is_action_pressed("move_right"):
		dir.x += 1
	if Input.is_action_pressed("move_left"):
		dir.x -= 1
	if Input.is_action_pressed("move_down"):
		dir.y += 1
	if Input.is_action_pressed("move_up"):
		dir.y -= 1
	
	if dir != Vector2.ZERO:
		entity.move_dir = dir.normalized()
	
	var velocity = entity.move_dir * entity.data.stats.spd
	entity.velocity = velocity
	
	if entity.has_method("move_and_slide"):
		entity.move_and_slide()
