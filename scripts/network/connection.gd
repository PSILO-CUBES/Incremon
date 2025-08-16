extends Node2D

var ws: WebSocketPeer = WebSocketPeer.new()
var connected := false

func _ready():
	# Attempt connection
	var err = ws.connect_to_url("ws://127.0.0.1:8080")
	if err != OK:
		print("Unable to connect to server.")
		set_process(false)
	else:
		print("Connecting...")
		set_process(true)

func _process(delta):
	# Poll the connection to handle messages
	ws.poll()
	
	# Check if connected
	if not connected and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		connected = true
		print("Connected to server!")

	# Handle incoming messages
	while ws.get_available_packet_count() > 0:
		var packet = ws.get_packet()
		var msg = packet.get_string_from_utf8()
		print("Server:", msg)
