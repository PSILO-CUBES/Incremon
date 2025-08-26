extends WalkState
class_name PlayerWalk

var speed := 200.0

func _enter():
	super._enter()

func _exit():
	super._exit()

func _physics_update(delta):
	if entity == null:
		return
	
	var input_vector := Vector2.ZERO
	
	if Input.is_action_pressed("move_up"):
		input_vector.y -= 1
	if Input.is_action_pressed("move_down"):
		input_vector.y += 1
	if Input.is_action_pressed("move_left"):
		input_vector.x -= 1
	if Input.is_action_pressed("move_right"):
		input_vector.x += 1
	
	if input_vector.length() > 0:
		input_vector = input_vector.normalized() * speed
	
	entity.velocity = input_vector
	entity.move_and_slide()
	
	if entity.velocity.length() < 1 \
	and entity.velocity.length() > -1:
		Transitioned.emit(self, 'Idle')
	
	super._physics_update(delta)
