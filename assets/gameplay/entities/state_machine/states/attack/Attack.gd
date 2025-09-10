extends	State
class_name AttackState

func _enter():
	super._enter()
	
	if entity.has_anim("attack"):
		entity.animation_sprite.play("attack")

func _exit():
	super._exit()

func _physics_update(delta):
	super._physics_update(delta)
