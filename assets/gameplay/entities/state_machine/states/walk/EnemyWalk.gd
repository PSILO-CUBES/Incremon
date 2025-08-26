extends WalkState
class_name EnemyWalk

var speed : int = 150

func _enter():
	if not is_inside_tree():
		return
	
	super._enter()
	
	var root = get_tree().root
	if root.has_node("Game/World/Player"):
		entity.target = root.get_node("Game/World/Player")

func _exit():
	super._exit()

func _update(_delta: float):
	pass

func _physics_update(delta: float):
	if entity.target == null:
		return
	
	var dir = (entity.target.global_position - entity.global_position).normalized()
	entity.velocity = dir * speed
	entity.move_and_slide()
	
	super._physics_update(delta)
	
	if entity.bodies_in_range.has(entity.target):
		Transitioned.emit(self, "attack")
