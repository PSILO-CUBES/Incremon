extends State
class_name WalkState

func _enter():
	super._enter()
	
	if entity.has_anim("walk"):
		entity.animation_sprite.play("walk")

func _exit():
	super._exit()

func _physics_update(delta):
	super._physics_update(delta)
	
	if entity.velocity.x != 0:
		entity.last_facing_left = entity.velocity.x < 0
		entity.animation_sprite.flip_h = entity.last_facing_left
	elif entity.velocity.y != 0:
		entity.animation_sprite.flip_h = entity.last_facing_left
	
