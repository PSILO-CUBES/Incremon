extends Button

@onready var Connection = $".."

func _on_pressed():
	var ws = Connection.ws
	
	if ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		var payload = {
			"action": "gather",
			"resource" : "wood",
			"playerId": "p123"
		}
		
		ws.send_text(JSON.stringify(payload))
		
		print("Sent payload to server")
