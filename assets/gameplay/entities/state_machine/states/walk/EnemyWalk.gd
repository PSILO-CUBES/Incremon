extends WalkState
class_name EnemyWalk

var speed : int = 150

func _enter():
	super._enter()

func _exit():
	super._exit()

func _update(_delta: float):
	pass

func _physics_update(delta: float):
	super._physics_update(delta)
