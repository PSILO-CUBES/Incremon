extends AttackState
class_name PlayerAttack

var duration : float = 0.5

func _enter():
	super._enter()
	_attack()

func _exit():
	super._exit()

func _physics_update(delta):
	super._physics_update(delta)

func _pick_correct_weapon_hitbox() :
	return preload("res://assets/gameplay/entities/attacks/player/SwingAttack.tscn").instantiate()

func _attack():
	entity.attack_duration = duration
	var mouse_pos = entity.get_global_mouse_position()
	
	var swing = _pick_correct_weapon_hitbox()
	swing.global_position = entity.global_position
	swing.sender = entity
	
	get_tree().current_scene.add_child(swing)
	swing.start_click_attack(mouse_pos, entity)
	super.walk_after_attack(swing)
