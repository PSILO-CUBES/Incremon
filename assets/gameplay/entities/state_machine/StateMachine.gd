extends Node

var current_state: State
var states: Dictionary = {}

var entity : CharacterBody2D

@export var init_state: State

func _ready():
	await get_tree().process_frame
	
	entity = get_parent()
	
	for child in get_children():
		if child is State:
			states[child.name.to_lower()] = child
			child.Transitioned.connect(on_child_tansition)
	
	if init_state:
		init_state._enter()
		current_state = init_state

func _process(delta: float) -> void:
	if current_state:
		current_state._update(delta)

func _physics_process(delta: float) -> void:
	if current_state:
		current_state._physics_update(delta)

func on_child_tansition(state, new_state_name):
	if state != current_state:
		return
	
	entity.current_state = new_state_name.to_lower()
	
	var new_state = states.get(entity.current_state)
	
	if !new_state:
		pass
	
	if current_state:
		current_state._exit()
	
	new_state._enter()
	
	current_state = new_state
