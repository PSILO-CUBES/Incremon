extends Node

@onready var world: Node2D = %World

const PLAYER = preload("res://assets/gameplay/player/player.tscn")

func _ready():
	_spawn_player()

func _spawn_player():
	var player = PLAYER.instantiate()
	world.add_child(player)
	player.position = Vector2(1280, 720)
	player.find_child('UsernameLabel').text = WebSocketClient.data.username
