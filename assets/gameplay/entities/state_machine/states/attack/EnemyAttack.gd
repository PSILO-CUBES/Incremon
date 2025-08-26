extends	AttackState
class_name EnemyAttack

var target : CharacterBody2D
var duration : float = 2.0

func _enter():
	super._enter()
	start_attack(entity)

func _exit():
	super._exit()

func _physics_update(delta):
	super._physics_update(delta)

func start_attack(sender : CharacterBody2D):
	entity.attack_duration = duration
	
	print('attack')
	
	#var attack_scene = preload("res://assets/gameplay/entities/attacks/enemies/Tackle.tscn")
	#var attack_instance = attack_scene.instantiate()
	#attack_instance.global_position = entity.global_position
	#attack_instance.sender = sender
	#attack_instance.duration = duration
	#
	#get_parent().add_child(attack_instance)
	#
	#super.walk_after_attack(attack_instance)
