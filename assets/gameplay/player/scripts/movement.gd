extends CharacterBody2D

@onready var player_sprite: AnimatedSprite2D = %PlayerAnimation

@export var speed := 200.0
var last_facing_left := false

const WALK_ANIM := "walk"
const IDLE_ANIM := "idle"

func _ready():
	pass

func has_anim(anim_name: StringName) -> bool:
	return player_sprite.sprite_frames != null and player_sprite.sprite_frames.has_animation(anim_name)

func _physics_process(_delta):
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
	
	velocity = input_vector
	move_and_slide()
	
	global_position = global_position.floor()
	
	if velocity.x != 0:
		last_facing_left = velocity.x < 0
		player_sprite.flip_h = last_facing_left
	elif velocity.y != 0:
		player_sprite.flip_h = last_facing_left
	
	if velocity.length() > 0:
		if has_anim(WALK_ANIM) and player_sprite.animation != WALK_ANIM:
			player_sprite.play(WALK_ANIM)
		elif not player_sprite.is_playing():
			player_sprite.play()
	else:
		if has_anim(IDLE_ANIM) and player_sprite.animation != IDLE_ANIM:
			player_sprite.play(IDLE_ANIM)
		else:
			player_sprite.stop()
