extends Node

@onready var label = %ConnectingLabel

const LOGIN = preload("res://assets/network/scenes/Login.tscn")

var dot_count := 1
var dot_direction := 1
var time_accum := 0.0

func animate_connecting(connect_label: Label, delta: float) -> void:
	time_accum += delta
	if time_accum >= 0.5:
		time_accum = 0.0
		dot_count += dot_direction
	
		if dot_count >= 3:
			dot_direction = -1
		elif dot_count <= 1:
			dot_direction = 1
	
		connect_label.text = "Connecting" + ".".repeat(dot_count)

func _ready():
	var err = WebSocketClient.ws.connect_to_url("ws://127.0.0.1:8080")
	if err != OK:
		print("Unable to connect to server.")
		set_process(false)
		return
	
	WebSocketClient.register_noarg("connection_open", Callable(self, "_on_connected"))
	set_process(true)

func _process(delta):
	animate_connecting(label, delta)

func _on_connected():
	get_tree().change_scene_to_packed(LOGIN)
