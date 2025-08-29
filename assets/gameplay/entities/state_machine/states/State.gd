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
	pass
