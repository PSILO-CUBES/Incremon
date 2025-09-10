extends State
class_name IdleState

func _enter():
	super._enter()
	if entity.has_anim("idle"):
		entity.animation_sprite.play("idle")

func _exit():
	super._exit()

func _physics_update(delta):
	super._physics_update(delta)
