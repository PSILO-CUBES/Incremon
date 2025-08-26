extends IdleState

func _enter():
	super._enter()

func _exit():
	super._exit()

func _physics_update(delta):
	if Input.is_action_pressed("move_up") \
	or Input.is_action_pressed("move_down") \
	or Input.is_action_pressed("move_left") \
	or Input.is_action_pressed("move_right") :
		Transitioned.emit(self, 'Walk')
		
	super._physics_update(delta)
