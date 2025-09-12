extends WalkState
class_name PlayerWalk

var was_moving: bool = false
var emitter: Node = null

func _enter() -> void:
	super._enter()
	was_moving = false
	emitter = null
	if entity and entity.has_node("IntentEmitter"):
		emitter = entity.get_node("IntentEmitter")

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
	
	var moving_now := dir != Vector2.ZERO
	
	if moving_now:
		entity.move_dir = dir.normalized()
	else:
		# Important: zero the remembered direction so we do not drift after attacks
		if was_moving:
			entity.move_dir = Vector2.ZERO
			entity.velocity = Vector2.ZERO
			if emitter and emitter.has_method("move_stop"):
				emitter.move_stop()
	
	entity.velocity = entity.move_dir * entity.data.stats.spd
	
	if entity.has_method("move_and_slide"):
		entity.move_and_slide()

	was_moving = moving_now
