extends Node

signal login_successful
signal login_error
signal login_confirmation
signal confirm_connection

var TokenStorage = preload("res://assets/network/scripts/token_storage.gd")

var ws: WebSocketPeer = WebSocketPeer.new()
var connected := false
var data := {}

func message_dispatcher() :
	match data.get("event", ""):
		"loginSuccess":
			
			var player_id = data.get("playerId", "")
			var ll_token = data.get("longLivedToken", "")
			var sl_token = data.get("shortLivedToken", "")
			
			if ll_token != "":
				TokenStorage.save_token(ll_token)
				
			emit_signal("login_successful", player_id, sl_token)
		"loginFailed":
			
			print("Login failed:", data.get("message", "Unknown reason"))
			emit_signal("login_error", data.get("message", "Unknown reason"))
		"createAccountSuccess":
			
			emit_signal("login_confirmation", data.get("message", ""))
		"createAccountFailed":
			
			print("Account creation failed:", data.get("message", "Unknown reason"))
			emit_signal("login_error", data.get("message", "Unknown reason"))
		"tokenInvalid" :
			
			print('No valid tokens found: ', data.get("message", "Unknown reason"))

func _process(_delta):
	if not ws:
		return
	
	ws.poll()
	
	if not connected and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		connected = true
		emit_signal("confirm_connection")
	
	if connected:
		_process_messages()

func _process_messages():
	while ws.get_available_packet_count() > 0:
		var msg = ws.get_packet().get_string_from_utf8()
		
		data = JSON.parse_string(msg)
		if typeof(data) != TYPE_DICTIONARY:
			continue
		
		message_dispatcher()
