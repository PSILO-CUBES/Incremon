extends	AttackState
class_name EnemyAttack

var target : CharacterBody2D
var duration : float = 2.0

func _enter():
	super._enter()

func _exit():
	super._exit()

func _physics_update(delta):
	super._physics_update(delta)
