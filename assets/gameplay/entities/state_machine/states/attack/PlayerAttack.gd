extends AttackState
class_name PlayerAttack

var emitter: Node

func _enter():
	super._enter()
	emitter = null
	if entity and entity.has_node("IntentEmitter"):
		emitter = entity.get_node("IntentEmitter")

func _exit():
	super._exit()
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if dir != Vector2.ZERO and emitter and emitter.has_method("move_start"):
		emitter.move_start(dir.normalized())

func _physics_update(delta):
	super._physics_update(delta)
