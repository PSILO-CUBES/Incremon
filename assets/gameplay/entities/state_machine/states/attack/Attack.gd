extends	State
class_name AttackState

func _enter():
	super._enter()
	
	if entity.has_anim("attack"):
		await get_tree().process_frame
		var sprite = entity.animation_sprite
		var anim_name = "attack"
		var frame_count = sprite.sprite_frames.get_frame_count(anim_name)
		var anim_fps = sprite.sprite_frames.get_animation_speed(anim_name)
		var speed_scale = (frame_count / anim_fps) / entity.attack_duration
		sprite.frame = 0
		sprite.speed_scale = speed_scale
		sprite.play(anim_name)

func _exit():
	super._exit()

func _physics_update(delta):
	super._physics_update(delta)

func walk_after_attack(attack_instance):
	attack_instance.tree_exited.connect(
		func ():
			Transitioned.emit(self, "walk")
	)
