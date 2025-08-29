extends CharacterBody2D
class_name Entity

@onready var animation_sprite: AnimatedSprite2D = %EntityAnimationSprite

var last_facing_left : bool = false
var current_state : String
