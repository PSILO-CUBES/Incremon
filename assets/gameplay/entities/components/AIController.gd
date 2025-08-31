extends Node
@onready var emitter := $"../IntentEmitter"
var chasing := false

func _physics_process(_dt: float) -> void:
	# Super dumb example: flip a boolean to start/stop moving.
	if should_chase_player() and not chasing:
		chasing = true
		emitter.send_intent("moveStart", {"dir":{"x":1,"y":0}})
	elif (not should_chase_player()) and chasing:
		chasing = false
		emitter.send_intent("moveStop")

func should_chase_player() -> bool:
	return false  # replace with your AI condition
