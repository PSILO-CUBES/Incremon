extends Node
class_name State

signal Transitioned

var entity

func _enter():
	entity = get_parent().get_parent()

func _exit():
	pass

func _update(_delta: float):
	pass

func _physics_update(_delta: float):
	_check_attack()

func _check_attack():
	if Input.is_action_just_pressed("attack"):
		if entity.name != 'Player' : return
		if entity.current_state == 'attack' : return
		Transitioned.emit(self, "attack")
